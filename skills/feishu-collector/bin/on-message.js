#!/usr/bin/env node
// 心跳入口①：处理一条 incoming 消息事件。无状态——读 Base、产出"工作上下文"。
// 由各运行时把飞书消息事件喂给本脚本（stdin JSON 或 --event '<json>'），
// 输出一个 JSON「工作上下文」给宿主 LLM（按 SKILL.md 决策并执行动作）。
//
// 设计取舍：真正的语言理解/决策由宿主 agent（CC 下=Claude；OpenClaw 下=其 agent）
// 读 SKILL.md 完成；本脚本只做"快速归属判定 + 拉相关任务/槽位快照"，保持无状态、可移植。
import { querySlotsByAssignee } from '../src/base-io.js';
import { larkJson } from '../src/larkcli.js';

const profile = process.env.LARK_PROFILE;
const ctx = {
  appToken: process.env.COLLECTOR_APP_TOKEN,
  tasksTableId: process.env.COLLECTOR_TASKS_TABLE || '任务表',
  slotsTableId: process.env.COLLECTOR_SLOTS_TABLE || '槽位表',
  profile,
};

async function readEvent() {
  const i = process.argv.indexOf('--event');
  if (i >= 0) return JSON.parse(process.argv[i + 1]);
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function extract(ev) {
  const m = ev.event?.message || ev.message || ev;
  const sender = ev.event?.sender || ev.sender || {};
  return {
    chatId: m.chat_id, chatType: m.chat_type,
    senderOpenId: sender.sender_id?.open_id || sender.open_id,
    mentionsBot: JSON.stringify(m.mentions || '').includes('bot') || /@/.test(m.content || ''),
    text: (() => { try { return JSON.parse(m.content || '{}').text || ''; } catch { return m.content || ''; } })(),
    messageId: m.message_id,
  };
}

async function activeSlotsForSender(openId) {
  if (!ctx.appToken || !openId) return [];
  // 跨所有收集中任务找该 sender 的未终结槽位（消息归属判定）
  // 实测：+record-search 默认输出 markdown，需 --format json；filter.conditions 为数组三元组
  const body = JSON.stringify({ filter: { logic: 'and', conditions: [['责任人open_id', '==', openId]] }, limit: 200 });
  const res = await larkJson(['base', '+record-search', '--base-token', ctx.appToken,
    '--table-id', ctx.slotsTableId, '--json', body, '--format', 'json', '--as', 'user'], { profile })
    .catch(() => ({ records: [] }));
  return (res.records || res.items || []).map((r) => ({ slot_id: r.record_id || r.id, ...(r.fields || r) }))
    .filter((s) => !['已填', '跳过', '不适用'].includes(s.状态));
}

async function main() {
  const ev = await readEvent();
  const m = extract(ev);
  const senderSlots = await activeSlotsForSender(m.senderOpenId);
  const intent = m.mentionsBot ? 'mention(可能：新发起/进度查询/暂停取消/开放登记)'
    : (senderSlots.length ? 'reply(收集对象回复，推进其槽位)' : 'ignore(无关消息)');
  // 输出工作上下文给宿主 LLM
  console.log(JSON.stringify({
    intent, message: m,
    senderActiveSlots: senderSlots,
    hint: '按 SKILL.md 处理：mention→分类后走对应流程；reply→映射答案到 senderActiveSlots、清洗、复述确认、写回。',
  }, null, 2));
}

main().catch((e) => { console.error('on-message 失败：', e.message); process.exit(1); });
