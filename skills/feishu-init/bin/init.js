#!/usr/bin/env node
// 心跳入口（编排器·书童引导）：把一条"引导类"消息分类，产出工作上下文给宿主 LLM。
// 用法: node bin/init.js --text "你好"  | node bin/init.js --event '<事件JSON>'
import { classifyInit, classifyEvent, eventKeyOf } from '../src/intent.js';
import { welcomeText, capabilityMenuText, coldStartChoiceText, healthReportText } from '../src/cards.js';
import { checkConfig } from '../../feishu-shared/src/health.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { REQUIRED_EVENTS, planEvents, runSetupEvents } from '../src/events.js';
import { buildScaffoldReport } from '../src/scaffold-check.js';
import { planCron, renderCrontab, mergeCrontab } from '../src/cron.js';
import { larkJson } from '../../feishu-shared/src/larkcli.js';

// 仓库根：bin/ 上溯三级（bin → feishu-init → skills → repo）。cron 命令需 cd 进此目录。
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// 把入参归一为 {kind, text?, eventKey?}：--text 直给文本；--event 区分入群事件 vs 消息事件。
function readInput(argv = process.argv) {
  const ti = argv.indexOf('--text');
  if (ti >= 0) return { kind: 'text', text: argv[ti + 1] || '' };
  const ei = argv.indexOf('--event');
  if (ei >= 0) {
    let ev = {};
    try { ev = JSON.parse(argv[ei + 1] || '{}'); } catch { ev = {}; }
    const eventKey = eventKeyOf(ev);
    // bot 入群（首次接触）：无消息文本，作为结构化事件直接走欢迎+自动检测骨架。
    if (eventKey === 'im.chat.member.bot.added_v1') return { kind: 'event', eventKey };
    // 消息事件：取文本走文本分类。
    const m = ev.event?.message || ev.message || {};
    let text = '';
    try { text = JSON.parse(m.content || '{}').text || ''; } catch { text = m.content || ''; }
    return { kind: 'text', text, eventKey };
  }
  return { kind: 'text', text: '' };
}

function main() {
  const input = readInput();
  const intent = input.kind === 'event' ? (classifyEvent(input.eventKey) || 'unknown') : classifyInit(input.text);
  const out = { intent };
  switch (intent) {
    case 'welcome':
      out.reply = welcomeText();
      // 冷启动自动检测：bot 入群（im.chat.member.bot.added_v1）**或用户首次对话**（"你好"等触发的 welcome）
      // 都附带此检测指令——这是问题1的核心接线。检测本身幂等（骨架已齐则跳过），故无需判断"是否真首次"，
      // 对所有 welcome 一律挂；这样即便入群事件结构异常降级为文本分类，冷启动仍不丢失。
      out.autoScaffold = true;
      out.scaffoldTrigger = input.kind === 'event' ? 'bot_added' : 'first_chat';
      out.hint = '冷启动自动检测（缺失不编造、幂等可重跑、骨架已齐则跳过不重复建）：'
        + '① 先 health.probeLive(ctx) 看用户是否授权 + 知识空间是否存在；'
        + '② kb-scaffold.collectExistingTitles(spaceId).titles + scaffoldStatus 看骨架完整度；'
        + '③ 骨架缺失且用户已授权 → kb-scaffold.initScaffold(ctx)（内部 ensureSpace 检测/建知识空间 → 建标准节点树，全程幂等），建好后发 coldStartChoiceText 选访谈/导入；'
        + '④ 用户未授权（建空间须 --as user）→ 别静默失败，发引导文案让管理员先 lark-cli auth login 授权；骨架已齐 → 正常欢迎、不重复建。';
      break;
    case 'help': out.reply = capabilityMenuText(); break;
    case 'health': {
      out.checklist = checkConfig();
      out.reply = healthReportText(out.checklist);
      out.hint = '活体探测：health.probeLive(ctx)（授权/知识空间）+ health.probeEvents(ctx)（事件 bus 是否在线，问题2）'
        + ' + health.probeCron(ctx)（cron 定时任务是否已装，问题3）并进 checklist；'
        + '骨架状态：知识空间存在时再 kb-scaffold.collectExistingTitles(spaceId) + scaffoldStatus(titles) 报"骨架 present/total 节点，缺 missing 个"，缺则引导 initScaffold 补建；'
        + '事件 bus 未运行 → 引导 setup-events --start；cron 未装 → 引导 setup-cron --install（否则群聊沉淀/周报不定时跑）。';
      break;
    }
    case 'scaffold':
      out.reply = coldStartChoiceText();
      out.hint = '流程4：kb-scaffold.initScaffold(ctx)（内部 ensureSpace 检测/建知识空间 → collectExistingTitles → planScaffold → createTree，全程幂等）；再据用户回复进 interview / import。';
      break;
    case 'interview':
      out.hint = '流程5-访谈：kb-interview.nextQuestion 逐题问 → 收答 → formatAnswerForKb → doc.appendDoc 写进目标节点 → kb-route.recordRoute 留痕（空答案跳过、缺失不编造）。';
      break;
    case 'import':
      out.hint = '流程5-导入：提示用户发资料 → file 解析（本地转在线）→ kb-extract 归类 → kb-route.decideRoute 去重 → doc 写进骨架对应节点 → recordRoute。';
      break;
    default:
      out.reply = capabilityMenuText();
      out.hint = '意图不明：回退到能力菜单，别让用户撞到沉默。';
  }
  console.log(JSON.stringify(out, null, 2));
}

// 子命令 setup-events：自动订阅飞书事件（问题2）。
//   默认：打印订阅计划 + event status 自检（只读安全，给部署者看"该订哪些、当前 daemon 状态"）。
//   --start：长驻启动全部 bridge（供 systemd ExecStart，配 Restart=always），收事件即分发给 handler。
async function setupEventsCli() {
  const profile = process.env.LARK_PROFILE;
  const start = process.argv.includes('--start');
  const plan = planEvents(REQUIRED_EVENTS, { profile });
  if (!start) {
    let status = null;
    try { status = await larkJson(['event', 'status', '--json'], { profile }); } catch (e) { status = { error: e.message }; }
    console.log(JSON.stringify({
      mode: 'setup-events:plan',
      events: plan,
      busStatus: status,
      hint: '这是订阅计划（未启动）。真正长驻订阅请加 --start（建议交 systemd 托管：ExecStart=node bin/init.js setup-events --start，Restart=always）。'
        + ' minutes/vc 是 user 授权事件、不经 bot 网关，必须订阅否则开完会收不到妙记事件。每事件一个 consume 进程，共享本机 daemon；飞书每 App 全局仅一个 event bus。',
    }, null, 2));
    return;
  }
  console.error(`启动事件订阅（长驻）：${plan.map((p) => p.key).join(', ')}`);
  runSetupEvents(REQUIRED_EVENTS, { profile });
  // 长驻：不退出，由 consume bridge 持续收事件并分发；进程托管交 systemd。
}

// 子命令 check-scaffold：只读体检骨架（问题4-c）。打印机器可读 JSON + exit code（0=齐/1=缺/2=阻塞）。
//   供部署脚本/cron 无人值守调用：`node bin/init.js check-scaffold && echo ok || 触发补建`。绝无副作用（不建空间）。
async function checkScaffoldCli() {
  const ctx = { profile: process.env.LARK_PROFILE };
  const report = await buildScaffoldReport(ctx);
  console.log(JSON.stringify({ mode: 'check-scaffold', ...report }, null, 2));
  process.exit(report.exitCode);
}

// 子命令 setup-cron：配置系统 cron 定时任务（问题3）。
//   默认：打印任务计划 + 可粘贴 crontab（只读安全）。
//   --install：幂等写入系统 crontab（读 `crontab -l` → mergeCrontab → `crontab -` 写回，保留用户已有条目）。
function readCrontab() {
  // crontab -l 在"无 crontab"时退出码非0且 stderr "no crontab for user" → 视为空，不当错误。
  const r = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '') : '';
}
function writeCrontab(text) {
  const r = spawnSync('crontab', ['-'], { input: text, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`crontab 写入失败：${r.stderr || r.error?.message || 'unknown'}`);
}
function setupCronCli() {
  const install = process.argv.includes('--install');
  const entries = planCron({ repoRoot: REPO_ROOT, profile: process.env.LARK_PROFILE });
  if (!install) {
    console.log(JSON.stringify({
      mode: 'setup-cron:plan',
      entries: entries.map((e) => ({ id: e.id, schedule: e.schedule, desc: e.desc, command: e.command })),
      crontab: renderCrontab(entries),
      hint: '这是计划（未安装）。加 --install 幂等写入系统 crontab（保留你已有条目）。'
        + ' 已用 node 绝对路径规避 cron PATH 极简；但 KB_APP_TOKEN/COLLECTOR_APP_TOKEN 等**密钥**需在 crontab 头'
        + '（NAME=value 行）或 systemd EnvironmentFile 提供，否则任务空跑不报错。'
        + ' 替代：systemd user timer（与 setup-events 托管一致，journalctl 可观测）。',
    }, null, 2));
    return;
  }
  const merged = mergeCrontab(readCrontab(), entries);
  writeCrontab(merged);
  console.log(`✅ 已幂等写入 crontab：${entries.map((e) => e.id).join('、')}`);
  console.log('用 `crontab -l` 查看；确保 cron 能读到 KB_APP_TOKEN 等密钥（crontab 头或 systemd EnvironmentFile）。');
}

const sub = process.argv[2];
if (sub === 'setup-events') {
  setupEventsCli().catch((e) => { console.error('setup-events 失败：', e.message); process.exit(1); });
} else if (sub === 'setup-cron') {
  try { setupCronCli(); } catch (e) { console.error('setup-cron 失败：', e.message); process.exit(1); }
} else if (sub === 'check-scaffold') {
  checkScaffoldCli().catch((e) => {
    console.log(JSON.stringify({ mode: 'check-scaffold', status: 'error', exitCode: 2, message: e.message }, null, 2));
    process.exit(2);
  });
} else {
  main();
}
