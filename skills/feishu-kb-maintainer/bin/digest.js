#!/usr/bin/env node
// 心跳入口②：cron 周期触发。两类定时心跳（设计 §8.2）：
//   1. 群聊定时拉取：对配置的群按时间窗 im +chat-messages-list 拉消息，产出"待抽取批次"上下文给宿主 LLM。
//   2. 周期汇总：遍历路由幂等表内本周期的决策/待办/OKR 进展，产出"周报素材"上下文给宿主 LLM 汇编成周报页。
// 本脚本只做确定性的"拉取 + 聚合素材"，语言汇编（写周报正文）由宿主 LLM 按 SKILL.md 做后调 kb-write 追加。
//
// 命令面经实测校准 (lark-cli 1.0.53)：
//   im +chat-messages-list --chat-id oc_xxx --start <ISO> --end <ISO> --order asc --page-size 50 --as user --format json
//     （实测旗标为 --start/--end/--order，非 --start-time/--sort-type）。
// 配置：
//   KB_DIGEST_CHATS  逗号分隔的 chat_id（群聊定时拉取目标；省略则跳过拉取，只做周期汇总）。
//   KB_DIGEST_WINDOW_H  拉取时间窗小时数（默认 168 = 一周）。
import { larkJson } from '../src/larkcli.js';
import { queryByKind } from '../src/route-io.js';

const profile = process.env.LARK_PROFILE;
const ctx = {
  appToken: process.env.KB_APP_TOKEN,
  routeTableId: process.env.KB_ROUTE_TABLE || '路由幂等表',
  profile,
};
const WINDOW_H = Number(process.env.KB_DIGEST_WINDOW_H || 168);

function isoHoursAgo(h, now = new Date()) {
  return new Date(now.getTime() - h * 3600 * 1000).toISOString();
}

async function pullChat(chatId, startIso, endIso) {
  const res = await larkJson(['im', '+chat-messages-list', '--chat-id', chatId,
    '--start', startIso, '--end', endIso, '--order', 'asc', '--page-size', '50',
    '--as', 'user', '--format', 'json'], { profile }).catch((e) => ({ error: e.message, items: [] }));
  const items = res.items || res.messages || res.data?.items || [];
  return { chatId, count: items.length, error: res.error, messages: items };
}

async function pullChats(startIso, endIso) {
  const chats = (process.env.KB_DIGEST_CHATS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const c of chats) out.push(await pullChat(c, startIso, endIso));
  return out;
}

async function gatherDigestMaterial() {
  if (!ctx.appToken) return { doc: [], task: [], okr: [] };
  // 路由幂等表是各沉淀线的落点台账：按 target_kind 聚合本周期素材。
  const [doc, task, okr] = await Promise.all([
    queryByKind(ctx, 'doc').catch(() => []),
    queryByKind(ctx, 'task').catch(() => []),
    queryByKind(ctx, 'okr').catch(() => []),
  ]);
  const sinceIso = isoHoursAgo(WINDOW_H);
  const recent = (rows) => rows.filter((r) => (r.last_synced_at || '') >= sinceIso);
  return { doc: recent(doc), task: recent(task), okr: recent(okr) };
}

async function main() {
  const now = new Date();
  const startIso = isoHoursAgo(WINDOW_H, now);
  const endIso = now.toISOString();

  const chatBatches = await pullChats(startIso, endIso);
  const material = await gatherDigestMaterial();

  console.log(JSON.stringify({
    mode: 'digest',
    window: { startIso, endIso, hours: WINDOW_H },
    chatPulls: chatBatches.map((b) => ({ chatId: b.chatId, count: b.count, error: b.error })),
    chatBatches,
    digestMaterial: material,
    hint: '① 群聊定时拉取：对每个 chatBatches[].messages 用你的抽取（决策/结论/待办/FAQ，丢闲聊）→ '
      + 'extract.normalizeItems → route-io.decideRoute（source_id=chatId+时间窗）→ kb-write 更新群聊沉淀小节 → recordRoute。'
      + ' ② 周期汇总：把 digestMaterial.{doc,task,okr} 汇编成周报正文（你来写，缺失不编造）→ '
      + 'kb-write.appendDoc(周报页 docToken, 周报内容) → recordRoute(source_type=manual, source_id=weekly:<ISO周>)。',
  }, null, 2));
}

main().catch((e) => { console.error('digest 失败：', e.message); process.exit(1); });
