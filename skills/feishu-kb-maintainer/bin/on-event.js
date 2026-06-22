#!/usr/bin/env node
// 心跳入口①：处理一条 incoming 事件。无状态——读 Base、产出"工作上下文"JSON 给宿主 LLM。
// 由运行时把飞书事件喂给本脚本（stdin NDJSON 一行 / --event '<json>'），本脚本：
//   - 识别 EventKey（实测：minutes.minute.generated_v1 = 会议妙记生成 user 授权；
//                          im.message.receive_v1 = 群消息接收 bot 授权）
//   - 拉相关上下文（会议 → minute 元信息；群消息 → 该群既有路由记录用于去重判定）
//   - 输出工作上下文，宿主 LLM 按 SKILL.md 决策并调 src/* 执行抽取与写回。
//
// 设计取舍：真正的语言抽取/路由决策由宿主 agent（CC=Claude / OpenClaw / Hermes）读 SKILL.md 完成；
// 本脚本只做"事件归一 + 快照拉取"，保持无状态、可移植。
// ⚠️ 文档评论无独立 EventKey（实测 `event list` 仅 board/im/minutes/vc 段，无 comment/docx 事件）——
//    评论线以「@机器人 文档内提及」为触发兜底，经 im.message.receive_v1 进入，见 SKILL.md 工作流 E。
import { querySource, queryByKind } from '../../atoms/kb-route/src/route-io.js';
import { isBotMentioned } from '../../feishu-shared/src/im-util.js';

const profile = process.env.LARK_PROFILE;
const ctx = {
  appToken: process.env.KB_APP_TOKEN,
  routeTableId: process.env.KB_ROUTE_TABLE || '路由幂等表',
  profile,
};

async function readEvent() {
  const i = process.argv.indexOf('--event');
  if (i >= 0) return JSON.parse(process.argv[i + 1]);
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  // event consume 输出 NDJSON；取第一行非空 JSON。
  const line = raw.split('\n').map((s) => s.trim()).find(Boolean) || '{}';
  return JSON.parse(line);
}

function eventKeyOf(ev) {
  return ev.event_key || ev.key || ev.header?.event_type || ev.schema_key
    || (ev.event?.minute_token || ev.minute_token ? 'minutes.minute.generated_v1' : null)
    || (ev.event?.message || ev.message ? 'im.message.receive_v1' : null);
}

function extractMessage(ev) {
  const m = ev.event?.message || ev.message || {};
  const sender = ev.event?.sender || ev.sender || {};
  return {
    chatId: m.chat_id, chatType: m.chat_type,
    senderOpenId: sender.sender_id?.open_id || sender.open_id,
    // 精确判定 @机器人：匹配 bot 自身 open_id（配 KB_BOT_OPEN_ID）；不再用裸文本 /@/ 误判。
    mentionsBot: isBotMentioned(m.mentions, process.env.KB_BOT_OPEN_ID),
    text: (() => { try { return JSON.parse(m.content || '{}').text || ''; } catch { return m.content || ''; } })(),
    messageId: m.message_id,
  };
}

function extractMinute(ev) {
  const e = ev.event || ev;
  return {
    minuteToken: e.minute_token,
    eventId: e.event_id,
    sourceType: e.minute_source?.source_type,
    sourceEntityId: e.minute_source?.source_entity_id,
  };
}

async function handleMinute(ev) {
  const minute = extractMinute(ev);
  // 幂等前置：按 source_id=minute_token 查路由幂等表，已记录则提示宿主可能 skip。
  // 注意：查询失败不静默吞（否则会被当作"无既有路由"→走 write→重复写库）；让其上抛由 main 记录。
  const existing = minute.minuteToken && ctx.appToken
    ? await querySource(ctx, minute.minuteToken) : null;
  return {
    eventKey: 'minutes.minute.generated_v1',
    line: 'meeting',
    minute,
    routeExisting: existing,
    hint: '会议沉淀：用 minutes.fetchNotes({minuteToken}) 取 summary/todos/transcript（无 summary 时你二次总结）→ '
      + 'extract.normalizeItems 归一去重 → 按 route-io.decideRoute 判定 write/update/skip → '
      + 'doc 追加纪要段（决策汇入 Decision Log）、task.createTask 写行动项、okr.createProgress 写 KR 进展 → '
      + 'route-io.recordRoute 回写。source_id=minute_token，target_kind 按落点 doc/task/okr。',
  };
}

async function handleMessage(ev) {
  const m = extractMessage(ev);
  // 群消息不逐条入库：本脚本只给出该群既有 doc 路由记录，宿主按时间窗累积后再抽取。
  // chatId 缺失则不查（避免 startsWith(undefined) 失配）；用分隔符 ':' 防前缀串台（oc_1 误命中 oc_1234）。
  // 约定：群聊 source_id 形如 `<chatId>:<时间窗>`。查询失败不静默吞，让其上抛。
  let chatRoutes = [];
  if (m.chatId && ctx.appToken) {
    const all = await queryByKind(ctx, 'doc');
    chatRoutes = all.filter((r) => (r.source_id || '').startsWith(`${m.chatId}:`));
  }
  return {
    eventKey: 'im.message.receive_v1',
    line: m.mentionsBot ? 'comment-or-chat(@机器人：可能文档评论兜底/群沉淀触发)' : 'chat',
    message: m,
    chatDocRoutes: chatRoutes,
    hint: '群聊沉淀：勿逐条入库。累积时间窗/消息数后（或 digest 定时拉取）由你抽取决策/结论/待办/FAQ、丢闲聊 → '
      + 'extract.normalizeItems 去重 → route-io.decideRoute 去重判定 → doc 更新「群聊沉淀」小节 → recordRoute（source_id=chatId+时间窗）。'
      + ' 若为 @机器人 的文档内提及（评论兜底）：用 comment.readDocBody + comment.listComments 读上下文 → comment.replyToComment 回复 → recordRoute(source_type=comment, source_id=comment_id)。',
  };
}

async function main() {
  const ev = await readEvent();
  const key = eventKeyOf(ev);
  let out;
  if (key === 'minutes.minute.generated_v1') out = await handleMinute(ev);
  else if (key === 'im.message.receive_v1') out = await handleMessage(ev);
  else out = { eventKey: key || 'unknown', line: 'ignore', hint: '非知识库线事件，忽略。', raw: ev };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('on-event 失败：', e.message); process.exit(1); });
