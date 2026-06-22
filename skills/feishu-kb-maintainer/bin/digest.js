#!/usr/bin/env node
// 心跳入口②（编排器）：cron 周期触发。两类定时心跳（设计 §8.2）：
//   1. 群聊定时拉取：feishu-shared/chat.pullChats 按时间窗拉消息，产出"待抽取批次"给宿主 LLM。
//   2. 周期汇总：queryByKind 取路由台账 → kb-digest.selectRecent 筛本周期素材，产出"周报素材"给宿主 LLM。
// 本入口只做确定性的"拉取 + 选取"，语言汇编（写周报正文）由宿主 LLM 按 SKILL.md 调 doc.appendDoc 完成。
// 配置：KB_DIGEST_CHATS（逗号分隔 chat_id，省略则跳过拉取）；KB_DIGEST_WINDOW_H（窗口小时，默认 168）。
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

  const chatIds = (process.env.KB_DIGEST_CHATS || '').split(',');
  const chatBatches = await pullChats(chatIds, startIso, endIso, { profile });
  const material = await gatherDigestMaterial(now);

  // 群聊拉取失败不静默：显式汇总并告警，否则会被当作"本周期无消息"而漏沉淀（P1）。
  const pullErrors = chatBatches.filter((b) => b.error).map((b) => ({ chatId: b.chatId, error: b.error }));
  if (pullErrors.length) {
    console.error(`⚠ digest 群聊拉取失败 ${pullErrors.length} 个（查不到≠没有，下轮应补拉）：${pullErrors.map((e) => e.chatId).join(', ')}`);
  }

  console.log(JSON.stringify({
    mode: 'digest',
    window: { startIso, endIso, hours: WINDOW_H },
    chatPulls: chatBatches.map((b) => ({ chatId: b.chatId, count: b.count, error: b.error })),
    pullErrors,
    chatBatches,
    digestMaterial: material,
    hint: '① 群聊定时拉取：对每个 chatBatches[].messages 用你的抽取（决策/结论/待办/FAQ，丢闲聊）→ '
      + 'kb-extract.normalizeItems → kb-route.decideRoute（source_id=`<chatId>:<时间窗>`）→ doc 更新群聊沉淀小节 → kb-route.recordRoute。'
      + ' ② 周期汇总：把 digestMaterial.{doc,task,okr} 汇编成周报正文（你来写，缺失不编造）→ '
      + 'doc.appendDoc(周报页 docToken, 周报内容) → kb-route.recordRoute(source_type=manual, source_id=weekly:<ISO周>)。',
  }, null, 2));
}

main().catch((e) => { console.error('digest 失败：', e.message); process.exit(1); });
