// 配置体检：检查书童运行所需的配置/授权/库是否就位，给"还差什么 + 人话指引"。
// checkConfig 纯函数（查 env）；probeLive 活体探测（可注入 run，便于单测）。
import { larkJson } from './larkcli.js';

/** 纯函数：检查环境变量是否就位。返回 [{item, ok, hint}]。 */
export function checkConfig(env = process.env) {
  return [
    { item: '收集线状态库 COLLECTOR_APP_TOKEN', ok: !!env.COLLECTOR_APP_TOKEN,
      hint: '跑 feishu-collector/bin/setup-base.js 建库，把输出的 token 写进此环境变量' },
    { item: '知识库台账 KB_APP_TOKEN', ok: !!env.KB_APP_TOKEN,
      hint: '跑 feishu-kb-maintainer/bin/setup-route-base.js 建库，把输出的 token 写进此环境变量' },
  ];
}

/** 活体探测（I/O，可注入 run）：用户授权状态、知识空间是否存在。返回 [{item, ok, hint}]。 */
export async function probeLive(ctx = {}, { run = larkJson } = {}) {
  const out = [];
  try {
    const st = await run(['auth', 'status'], { profile: ctx.profile });
    const u = st?.identities?.user;
    const ready = u?.status === 'ready' || u?.available === true;
    out.push({ item: '用户身份授权', ok: !!ready,
      hint: ready ? '' : '运行 lark-cli auth login --scope "…" 一次性授权（见设计 §8.3 全量 scope）' });
  } catch (e) {
    out.push({ item: '用户身份授权', ok: false, hint: `探测失败：${e.message}` });
  }
  try {
    // wiki 是 user-scope 操作（与 doc.listWikiSpaces / scaffold 路径一致）：必须 --as user，
    // 否则默认 bot 身份没有 wiki scope，会把"知识空间存在"误判为否（冷启动检测假阴性）。
    const sp = await run(['wiki', '+space-list', '--page-all', '--as', 'user', '--format', 'json'], { profile: ctx.profile });
    const spaces = sp?.items || sp?.spaces || sp?.data?.items || [];
    out.push({ item: '知识库知识空间', ok: spaces.length > 0,
      hint: spaces.length ? '' : '还没有知识空间——用「搭知识库」让书童建标准骨架' });
  } catch (e) {
    out.push({ item: '知识库知识空间', ok: false, hint: `探测失败（可能缺 wiki scope）：${e.message}` });
  }
  return out;
}

/**
 * 事件订阅状态探测（I/O，可注入 run）：event bus daemon 是否在线（问题2 体检项）。
 * 真实结构（实测 `lark-cli event status --json`）：{ apps: [{ app_id, status, running }] }。
 * daemon 不在线 → 开完会收不到妙记事件、bot 入群也不触发，会议/冷启动两线断链。
 * 返回 [{item, ok, hint}]，无法解析时容差降级为 ok:false。
 */
export async function probeEvents(ctx = {}, { run = larkJson } = {}) {
  try {
    const st = await run(['event', 'status', '--json'], { profile: ctx.profile });
    const apps = st?.apps || st?.data?.apps || [];
    // 在线判定：任一 app 的 bus 在跑。以布尔 running 为准（权威字段）；
    // status 用**精确**匹配 'running'——不能用子串/正则，否则 'not_running' 含 'running' 会假阳。
    const anyRunning = apps.some((a) => a.running === true
      || (a.running === undefined && String(a.status || '').toLowerCase() === 'running'));
    const ok = apps.length > 0 && anyRunning;
    return [{
      item: '事件订阅 daemon（event bus）',
      ok,
      hint: ok ? ''
        : '事件 bus 未运行——开完会收不到妙记、bot 入群也不触发。长驻订阅：'
          + 'node skills/feishu-init/bin/init.js setup-events --start（建议 systemd 托管 Restart=always）',
    }];
  } catch (e) {
    return [{ item: '事件订阅 daemon（event bus）', ok: false, hint: `探测失败：${e.message}` }];
  }
}

/**
 * cron 定时任务状态探测（问题3 体检项）。检测系统 crontab 是否已装本项目的定时任务。
 * 自包含：不反向 import feishu-init 的 cron 模块，只按脚本名 grep `crontab -l` 输出。
 * 容差：crontab 不可用（无 crontab / 被 systemd timer 接管 / 容器无 cron）→ ok:false + 友好提示，不抛错。
 * @param deps.listCrontab 注入点（默认跑 `crontab -l`），便于单测。返回 crontab 文本（无则空串）。
 */
export async function probeCron(ctx = {}, { listCrontab = defaultListCrontab } = {}) {
  const jobs = [
    { item: 'cron·收集催办(tick)', pat: /tick\.js/ },
    { item: 'cron·群聊拉取/周报(digest)', pat: /digest\.js/ },
  ];
  let text;
  try {
    text = await listCrontab();
  } catch (e) {
    return [{ item: 'cron 定时任务', ok: false,
      hint: `读取 crontab 失败：${e.message}（若用 systemd timer 托管则无需 crontab，可查 systemctl --user list-timers）` }];
  }
  return jobs.map(({ item, pat }) => {
    const ok = pat.test(text || '');
    return { item, ok,
      hint: ok ? '' : '未配置——跑 node skills/feishu-init/bin/init.js setup-cron --install 安装定时任务' };
  });
}

// 默认 crontab 读取：`crontab -l`（无 crontab 时退出码非0 → 视为空串，非错误）。懒加载 child_process。
async function defaultListCrontab() {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '') : '';
}

/** 汇总：是否全部就位 + 缺失项。 */
export function summarize(checklist) {
  const missing = (checklist || []).filter((c) => !c.ok);
  return { allOk: missing.length === 0, missing };
}
