// 消息收发：群发/私信/加急。命令面经实测校准 (lark-cli 1.0.53)。
// 发送默认 --as bot（无人值守优先 bot 身份）。
// 加急 urgent_* 是 bot-only raw 命令：--params 含 message_id/user_id_type，--data 含 user_id_list，
// 且要求 bot 是该消息发送者并在会话内。
import { lark, larkJson } from './larkcli.js';

/** 发群消息，返回发送结果（含 message_id 供加急用） */
export async function sendGroup(chatId, text, { profile, idempotencyKey } = {}) {
  const argv = ['im', '+messages-send', '--chat-id', chatId, '--text', text, '--format', 'json', '--as', 'bot'];
  if (idempotencyKey) argv.push('--idempotency-key', idempotencyKey);
  return larkJson(argv, { profile });
}

/** 发私信(DM)，返回发送结果（含 message_id 供加急用） */
export async function sendDM(openId, text, { profile, idempotencyKey } = {}) {
  const argv = ['im', '+messages-send', '--user-id', openId, '--text', text, '--format', 'json', '--as', 'bot'];
  if (idempotencyKey) argv.push('--idempotency-key', idempotencyKey);
  return larkJson(argv, { profile });
}

function pickMessageId(res) {
  return res?.message_id || res?.data?.message_id || res?.item?.message_id || res?.data?.items?.[0]?.message_id;
}

/**
 * 飞书应用内加急（buzz）。节制使用：仅 urgent 时调。
 * @param messageId om_xxx（须是 bot 本身发出的消息）
 * @param openIds 被加急用户 open_id 列表（须在会话内）
 */
export async function buzz(messageId, openIds, { profile } = {}) {
  return lark(['im', 'messages', 'urgent_app',
    '--params', JSON.stringify({ message_id: messageId, user_id_type: 'open_id' }),
    '--data', JSON.stringify({ user_id_list: openIds }),
    '--format', 'json', '--as', 'bot'], { profile });
}

export { pickMessageId };
