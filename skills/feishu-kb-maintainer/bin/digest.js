#!/usr/bin/env node
// 心跳入口②（编排器）：cron 周期触发。两类定时心跳（设计 §8.2）：
//   1. 群聊定时拉取：feishu-shared/chat.pullChats 按时间窗拉消息，产出"待抽取批次"给宿主 LLM。
//   2. 周期汇总：queryByKind 取路由台账 → kb-digest.selectRecent 筛本周期素材，产出"周报素材"给宿主 LLM。
// 本入口只做确定性的"拉取 + 选取"，语言汇编（写周报正文）由宿主 LLM 按 SKILL.md 调 doc.appendDoc 完成。
// 配置：KB_DIGEST_CHATS（逗号分隔 chat_id，省略则跳过拉取）；KB_DIGEST_WINDOW_H（窗口小时，默认 168）。
import { pathToFileURL } from 'node:url';
import { pullChats } from '../../feishu-shared/src/chat.js';
import { queryByKind } from '../../atoms/kb-route/src/route-io.js';
import { windowSinceMs, selectRecent } from '../../atoms/kb-digest/src/digest.js';

const profile = process.env.LARK_PROFILE;
const ctx = {
  appToken: process.env.KB_APP_TOKEN,
  routeTableId: process.env.KB_ROUTE_TABLE || '路由幂等表',
  profile,
};
const WINDOW_H = Number(process.env.KB_DIGEST_WINDOW_H || 168);

// cron 分调（迭代C）：--mode=chats 只拉群、--mode=report 只汇总周报、缺省两者都做（向后兼容）。
// 群聊拉取与周报频率不同（前者高频、后者周一一次），故 setup-cron 用不同 mode 分两条 crontab。
export function parseMode(argv = process.argv) {
  const arg = argv.find((a) => a && a.startsWith('--mode='))?.split('=')[1]
    || (argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : undefined);
  if (!arg) return { chats: true, report: true };
  const set = new Set(String(arg).split(',').map((m) => m.trim().toLowerCase()));
  const mode = { chats: set.has('chats'), report: set.has('report') };
  // 非法 mode（如 cron 行 typo `--mode=reprot`）会两者皆 false → 静默空跑；显式告警免误判"跑成功"。
  if (!mode.chats && !mode.report) console.error(`⚠ digest --mode=${arg} 无效（有效值 chats / report / chats,report），本次不拉群也不汇总`);
  return mode;
}
const MODE = parseMode();

function isoHoursAgo(h, now) {
  return new Date(now.getTime() - h * 3600 * 1000).toISOString();
}

async function gatherDigestMaterial(now) {
  if (!ctx.appToken) return { doc: [], task: [], okr: [] };
  // 路由幂等表是各沉淀线的落点台账：按 target_kind 聚合，再按时间窗筛近期（kb-digest 纯函数）。
  const [doc, task, okr] = await Promise.all([
    queryByKind(ctx, 'doc').catch(() => []),
    queryByKind(ctx, 'task').catch(() => []),
    queryByKind(ctx, 'okr').catch(() => []),
  ]);
  return selectRecent({ doc, task, okr }, windowSinceMs(WINDOW_H, now));
}

async function main() {
  const now = new Date();
  const startIso = isoHoursAgo(WINDOW_H, now);
  const endIso = now.toISOString();

  // 群聊拉取（仅 MODE.chats）。修：KB_DIGEST_CHATS 空时 ''.split(',') 会得 ['']，
  // 应 trim + filter Boolean 在源头过滤，否则会拿空 chatId 去拉（垃圾值进下游）。
  const chatIds = (process.env.KB_DIGEST_CHATS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const chatBatches = (MODE.chats && chatIds.length) ? await pullChats(chatIds, startIso, endIso, { profile }) : [];
  // 周报素材（仅 MODE.report）。
  const material = MODE.report ? await gatherDigestMaterial(now) : { doc: [], task: [], okr: [] };

  // 群聊拉取失败不静默：显式汇总并告警，否则会被当作"本周期无消息"而漏沉淀（P1）。
  const pullErrors = chatBatches.filter((b) => b.error).map((b) => ({ chatId: b.chatId, error: b.error }));
  if (pullErrors.length) {
    console.error(`⚠ digest 群聊拉取失败 ${pullErrors.length} 个（查不到≠没有，下轮应补拉）：${pullErrors.map((e) => e.chatId).join(', ')}`);
  }

  // cron 摘要（stderr，给 cron 日志一眼看清这次跑了啥；stdout 仍是给宿主 LLM 的结构化 JSON）。
  const matCount = (material.doc?.length || 0) + (material.task?.length || 0) + (material.okr?.length || 0);
  console.error(`[digest] mode=${[MODE.chats && 'chats', MODE.report && 'report'].filter(Boolean).join('+') || 'none'}`
    + ` chats=${chatIds.length} pulled=${chatBatches.reduce((n, b) => n + (b.count || 0), 0)} digestItems=${matCount} window=${WINDOW_H}h`);

  console.log(JSON.stringify({
    mode: 'digest',
    modes: { chats: MODE.chats, report: MODE.report },
    window: { startIso, endIso, hours: WINDOW_H },
    chatPulls: chatBatches.map((b) => ({ chatId: b.chatId, count: b.count, error: b.error })),
    pullErrors,
    chatBatches,
    digestMaterial: material,
    hint: '① 群聊定时拉取（mode=chats）：对每个 chatBatches[].messages 用你的抽取（决策/结论/待办/FAQ，丢闲聊）→ '
      + 'kb-extract.normalizeItems → kb-route.decideRoute（source_id=`<chatId>:<时间窗>`）→ doc 更新群聊沉淀小节 → kb-route.recordRoute。'
      + ' ② 周期汇总（mode=report）：把 digestMaterial.{doc,task,okr} 汇编成周报正文（你来写，缺失不编造）→ '
      + 'doc.appendDoc(周报页 docToken, 周报内容) → kb-route.recordRoute(source_type=manual, source_id=weekly:<ISO周>)。',
  }, null, 2));
}

// 仅作为入口脚本运行时执行 main()，被 import（单测 parseMode）时不跑。
// 用 URL 比 URL：import.meta.url 与 pathToFileURL(argv[1]).href 同为 file:// 形式。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('digest 失败：', e.message); process.exit(1); });
}
