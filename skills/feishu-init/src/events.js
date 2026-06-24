// 飞书事件自动订阅（问题2）。把 lark-cli event consume 的无限 NDJSON 流桥接到各处理脚本。
//
// 为什么需要 bridge（不能裸管道）：
//   `lark-cli event consume <key>` 持续流式输出（一事件一行、永不 EOF），
//   而 on-event.js/on-message.js 读 stdin-until-EOF 只取首行 → 裸管道会永久缓冲、最多处理 1 条。
//   故用长驻 bridge：逐行读 consume.stdout，每行 spawn `node <handler> --event '<line>'`（复用各 handler 的 --event 入口）。
//
// 为什么 minutes/vc 必须显式订阅：它们是 user 授权事件，不经 Hermes bot 网关推送——
//   不 consume 就"开完会收不到妙记事件"，会议沉淀线断链（这正是问题2的根因）。
//
// 进程模型（实测）：consume "connects to the event bus daemon (starting it if needed)"——
//   同机同 App 下，4 个 consume 进程共享**同一个本地 daemon（一个 bus、多 consumer/订阅）**，不冲突。
//   "每 App 全局仅一个 event bus" 指的是不能跨机/跨进程再开第二个 bus 连同一 App，与本机多 consumer 无关。
//
// 纯函数（consumeArgv/resolveHandler/planEvents/createLineQueue）可单测；
// IO（dispatchLine/bridgeEvent/runSetupEvents）注入 spawnFn 便于单测。
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveLark } from '../../feishu-shared/src/larkcli.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // skills/feishu-init/src

// handler id → bin 入口（相对本文件）。各 handler 均支持 `--event '<json>'` 单事件入口。
const HANDLER_PATHS = {
  kb: '../../feishu-kb-maintainer/bin/on-event.js', // 会议/群聊沉淀 + 评论兜底
  collector: '../../feishu-collector/bin/on-message.js', // 收集对象回复 / @机器人 指令
  init: '../bin/init.js', // bot 入群 → 冷启动欢迎+自动建骨架（接迭代A）
};

// 同时处理的事件行数上限（防高频群消息无限 fork handler 子进程；可用 KB_EVENTS_CONCURRENCY 覆盖）。
const DEFAULT_CONCURRENCY = Number(process.env.KB_EVENTS_CONCURRENCY) || 8;

// 必订阅事件（纯数据）。as 必须匹配 EventKey 声明的授权类型（实测 event list：minutes/vc=user，im 类=bot）。
export const REQUIRED_EVENTS = [
  { key: 'minutes.minute.generated_v1', as: 'user', handlers: ['kb'], desc: '会议妙记生成（录音链路）→ 会议沉淀' },
  { key: 'vc.note.generated_v1', as: 'user', handlers: ['kb'], desc: '会议 AI Summary 生成 → 会议沉淀' },
  { key: 'im.message.receive_v1', as: 'bot', handlers: ['kb', 'collector'], desc: '消息接收 → 群聊沉淀/评论兜底 + 收集回复' },
  { key: 'im.chat.member.bot.added_v1', as: 'bot', handlers: ['init'], desc: 'bot 入群 → 冷启动欢迎 + 自动建骨架' },
];

/** 纯函数：解析 handler id → 绝对路径。未知 id 抛错（不静默）。 */
export function resolveHandler(id, baseDir = HERE) {
  const rel = HANDLER_PATHS[id];
  if (!rel) throw new Error(`未知 handler: ${id}（可选：${Object.keys(HANDLER_PATHS).join('/')}）`);
  return resolve(baseDir, rel);
}

/**
 * 纯函数：构造一个事件的 consume argv（不含二进制名）。
 * profile 是 lark-cli **全局 flag**，必须排在子命令 `event` 之前 → 由本函数统一前置，
 * 避免各调用点各自拼 profile 造成顺序错位/重复（见 planEvents / bridgeEvent 均委托此函数）。
 */
export function consumeArgv(evt, { profile } = {}) {
  const pre = profile ? ['--profile', profile] : [];
  return [...pre, 'event', 'consume', evt.key, '--as', evt.as, '--quiet'];
}

/** 纯函数：定长并发队列。bound 个任务并发，超出排队。task=(item, done)=>void，done 回调后放行下一个。 */
export function createLineQueue(bound, task) {
  let active = 0;
  const q = [];
  function pump() {
    while (active < bound && q.length) {
      const item = q.shift();
      active++;
      let settled = false;
      const done = () => { if (settled) return; settled = true; active--; pump(); };
      try { task(item, done); } catch { done(); }
    }
  }
  return { push(item) { q.push(item); pump(); }, pending: () => q.length, active: () => active };
}

/** 纯函数：把事件计划展开成可读/可执行清单（setup-events 默认输出 + 文档用）。 */
export function planEvents(events = REQUIRED_EVENTS, { profile } = {}) {
  return events.map((e) => ({
    key: e.key,
    as: e.as,
    desc: e.desc,
    consume: `lark-cli ${consumeArgv(e, { profile }).join(' ')}`,
    handlers: e.handlers.map((h) => resolveHandler(h)),
  }));
}

/**
 * IO：把一行 NDJSON 事件分发给该 key 配置的全部 handler（spawn `node <handler> --event '<line>'`）。
 * 空行跳过。注入 spawnFn 便于单测。
 * @returns 已起子进程数组 [{handler, child}]
 */
export function dispatchLine(line, evt, { baseDir, spawnFn = spawn } = {}) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) return [];
  const procs = [];
  for (const h of evt.handlers) {
    const handlerPath = resolveHandler(h, baseDir);
    const child = spawnFn(process.execPath, [handlerPath, '--event', trimmed], { stdio: ['ignore', 'inherit', 'inherit'] });
    procs.push({ handler: h, child });
  }
  return procs;
}

/**
 * IO：为单个事件起 consume 子进程，逐行桥接到 handler；consume 退出后按延时自动重启（崩溃自愈）。
 * 用定长并发队列限制同时在跑的 handler 行数（防高频消息 fork 风暴）。
 * @returns {{stop, evt}} 调 stop() 终止本桥（不再重启、kill 当前 consume）。
 */
export function bridgeEvent(evt, {
  profile, baseDir, spawnFn = spawn, lark = resolveLark(),
  restartDelayMs = 2000, concurrency = DEFAULT_CONCURRENCY, log = console.error,
} = {}) {
  let stopped = false;
  let consume;
  let rl; // 当前 readline；consume 重启前关旧的，防 FD 悬挂。
  // 一行 = 一个并发单元；其下 N 个 handler 子进程全部退出后才放行下一行。
  const queue = createLineQueue(concurrency, (line, done) => {
    const procs = dispatchLine(line, evt, { baseDir, spawnFn });
    if (!procs.length) return done();
    let remaining = procs.length;
    const dec = () => { if (--remaining <= 0) done(); };
    for (const { child } of procs) {
      if (child && typeof child.on === 'function') child.on('exit', dec);
      else dec();
    }
  });
  function start() {
    // profile 由 consumeArgv 统一前置（lark-cli 全局 flag 须在子命令前）。
    const args = [...lark.pre, ...consumeArgv(evt, { profile })];
    consume = spawnFn(lark.cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    if (consume.stdout) {
      rl = createInterface({ input: consume.stdout });
      rl.on('line', (line) => { if (String(line).trim()) queue.push(line); });
    }
    consume.on('exit', (code) => {
      if (rl) { rl.close(); rl = undefined; } // 关旧 readline，重启前释放 FD
      if (stopped) return;
      log(`consume ${evt.key} 退出(code=${code})，${restartDelayMs}ms 后重启…`);
      setTimeout(() => { if (!stopped) start(); }, restartDelayMs);
    });
    return consume;
  }
  start();
  return {
    stop() {
      stopped = true;
      if (rl) { rl.close(); rl = undefined; }
      if (consume && !consume.killed) consume.kill('SIGTERM');
    },
    evt,
  };
}

/** IO：启动全部事件的 bridge（供 setup-events --start 长驻）。返回各 bridge 控制器数组（含 stop）。 */
export function runSetupEvents(events = REQUIRED_EVENTS, opts = {}) {
  return events.map((e) => bridgeEvent(e, opts));
}
