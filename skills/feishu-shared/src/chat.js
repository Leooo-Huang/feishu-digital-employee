// 群消息按时间窗拉取（I/O 能力模块）。命令面经实测校准 (lark-cli 1.0.53)：
//   im +chat-messages-list --chat-id oc_xxx --start <ISO> --end <ISO> --order asc --page-size 50 --as user --format json
//     （实测旗标为 --start/--end/--order，非 --start-time/--sort-type）。
// 单个群拉取失败不抛、返回 { error }，由调用方汇总（一个群失败不拖垮整批）。
import { larkJson } from './larkcli.js';

/** 拉单个群在 [startIso, endIso] 的消息（首页 page-size 条，与既有行为一致）。 */
export async function pullChatWindow(chatId, startIso, endIso, { profile, pageSize = 50 } = {}) {
  const res = await larkJson(['im', '+chat-messages-list', '--chat-id', chatId,
    '--start', startIso, '--end', endIso, '--order', 'asc', '--page-size', String(pageSize),
    '--as', 'user', '--format', 'json'], { profile, retries: 2 }).catch((e) => ({ error: e.message, items: [] }));
  const items = res.items || res.messages || res.data?.items || [];
  return { chatId, count: items.length, error: res.error, messages: items };
}

/** 批量拉多个群（逐个拉，失败项带 error 返回，不中断其余）。 */
export async function pullChats(chatIds, startIso, endIso, { profile, pageSize } = {}) {
  const out = [];
  for (const c of (chatIds || []).map((s) => String(s).trim()).filter(Boolean)) {
    out.push(await pullChatWindow(c, startIso, endIso, { profile, pageSize }));
  }
  return out;
}
