// 会议纪要读取：vc / minutes 域。命令面经实测校准 (lark-cli 1.0.53)：
//   vc +notes --minute-tokens <t,..> | --meeting-ids <m,..> | --calendar-event-ids <c,..> --as user --format json
//       取妙记纪要（AI 总结 / 决策 / 待办 / 逐字稿）。dry-run 实测需 scope vc:note:read。
//   vc +recording --meeting-ids <m,..> | --calendar-event-ids <c,..> --as user --format json
//       由会议/日程定位 minute_token。
//   vc +search --query <kw> --start <YYYY-MM-DD|ISO> --end <..> [--participant-ids|--organizer-ids ou,..]
//       --page-size 1-30 --as user --format json  按关键词/时间/参会人搜会议记录。
//   minutes +download --minute-token <t> ...      按需取音视频（本模块不默认下载）。
// ⚠️ 响应路径待真机校准：notes 各字段（summary/todos/transcript）确切路径以实测为准，
//    下方对常见形态做防御性多路径解析。
import { larkJson } from './larkcli.js';

function pickFirst(obj, paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v != null) return v;
  }
  return undefined;
}

/** 按关键词/时间窗搜会议记录 */
export async function searchMeetings({ query, start, end, participantIds, organizerIds }, { profile } = {}) {
  const argv = ['vc', '+search', '--as', 'user', '--format', 'json'];
  if (query) argv.push('--query', query);
  if (start) argv.push('--start', start);
  if (end) argv.push('--end', end);
  if (participantIds?.length) argv.push('--participant-ids', participantIds.join(','));
  if (organizerIds?.length) argv.push('--organizer-ids', organizerIds.join(','));
  return larkJson(argv, { profile });
}

/** 由会议 id / 日程 instance id 拿 minute_token */
export async function recordingMinuteToken({ meetingIds, calendarEventIds }, { profile } = {}) {
  const argv = ['vc', '+recording', '--as', 'user', '--format', 'json'];
  if (meetingIds?.length) argv.push('--meeting-ids', meetingIds.join(','));
  if (calendarEventIds?.length) argv.push('--calendar-event-ids', calendarEventIds.join(','));
  const res = await larkJson(argv, { profile });
  return pickFirst(res, ['minute_token', 'data.minute_token', 'items.0.minute_token', 'data.items.0.minute_token']);
}

/**
 * 取一篇妙记纪要。优先按 minute_token，亦可按会议/日程 id。
 * @returns {{summary, todos:Array, transcript, raw}} —— summary/todos 缺失时为空（交宿主 LLM 二次总结）。
 */
export async function fetchNotes({ minuteToken, meetingIds, calendarEventIds }, { profile } = {}) {
  const argv = ['vc', '+notes', '--as', 'user', '--format', 'json'];
  if (minuteToken) argv.push('--minute-tokens', minuteToken);
  if (meetingIds?.length) argv.push('--meeting-ids', meetingIds.join(','));
  if (calendarEventIds?.length) argv.push('--calendar-event-ids', calendarEventIds.join(','));
  const res = await larkJson(argv, { profile });
  return {
    summary: pickFirst(res, ['summary', 'data.summary', 'items.0.summary', 'data.items.0.summary',
      'note.summary', 'data.note.summary']) ?? '',
    todos: pickFirst(res, ['todos', 'data.todos', 'items.0.todos', 'data.items.0.todos',
      'action_items', 'data.action_items']) ?? [],
    transcript: pickFirst(res, ['transcript', 'data.transcript', 'items.0.transcript',
      'data.items.0.transcript']) ?? '',
    raw: res,
  };
}
