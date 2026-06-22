// 文档评论：读文档正文 + 评论串、在评论串内回复。docs / drive 域。
// 命令面经实测校准 (lark-cli 1.0.53)：
//   docs +fetch --doc <token> --detail with-ids --doc-format markdown --scope full|keyword|section
//       --api-version v2 --as user --format json   读文档正文（理解评论上下文）。
//   drive file.comments list --params '{"file_token":"<t>","file_type":"docx","is_solved":false}'
//       --as user --format json   取该文档全部评论（schema: drive.file.comments.list；params 必填 file_token+file_type）。
//   drive file.comment.replys list --params '{"file_token":"<t>","file_type":"docx","comment_id":"<c>"}'
//       --as user --format json   取某评论的回复串。
//   drive file.comment.replys create --params '{"file_token":"<t>","file_type":"docx","comment_id":"<c>"}'
//       --data '{"content":{"elements":[{"type":"text","text_run":{"text":"回复正文"}}]}}'
//       --as bot --format json   在评论串内回复（schema: drive.file.comment.replys.create；data+params 必填）。
// ⚠️ 响应路径与 reply content 内 elements 结构待真机校准：reply content 用开放平台 reply_elements 形状，
//    下方按 {content:{elements:[{type:'text',text_run:{text}}]}} 构造；列表解析做防御性多路径。
import { larkJson } from './larkcli.js';

function pickList(res, keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, kk) => (o == null ? o : o[kk]), res);
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** 读文档正文（评论上下文）。默认全文 markdown；大文档可传 scope:'keyword'/'section' + keyword/startBlockId。 */
export async function readDocBody(fileToken, { profile, scope = 'full', keyword } = {}) {
  const argv = ['docs', '+fetch', '--doc', fileToken, '--detail', 'with-ids',
    '--doc-format', 'markdown', '--scope', scope, '--api-version', 'v2', '--as', 'user', '--format', 'json'];
  if (keyword) argv.push('--keyword', keyword);
  return larkJson(argv, { profile });
}

/** 列文档评论（默认只看未解决的）。 */
export async function listComments(fileToken, { profile, fileType = 'docx', isSolved = false } = {}) {
  const params = JSON.stringify({ file_token: fileToken, file_type: fileType, is_solved: isSolved });
  const res = await larkJson(['drive', 'file.comments', 'list', '--params', params,
    '--page-all', '--as', 'user', '--format', 'json'], { profile });
  return pickList(res, ['items', 'comments', 'data.items', 'data.comments']);
}

/** 列某条评论的回复串（判重：是否已回复过）。 */
export async function listReplies(fileToken, commentId, { profile, fileType = 'docx' } = {}) {
  const params = JSON.stringify({ file_token: fileToken, file_type: fileType, comment_id: commentId });
  const res = await larkJson(['drive', 'file.comment.replys', 'list', '--params', params,
    '--page-all', '--as', 'user', '--format', 'json'], { profile });
  return pickList(res, ['items', 'replies', 'data.items', 'data.replies']);
}

/** 纯函数：把回复文字包成 reply_elements 内容体（drive 评论回复格式）。 */
export function replyContentBody(text) {
  return JSON.stringify({ content: { elements: [{ type: 'text', text_run: { text: String(text) } }] } });
}

/**
 * 在评论串内回复。以 bot 身份发（数字员工对外身份）。
 * @param fileToken 文档 token  @param commentId 评论 id  @param text 回复正文
 */
export async function replyToComment(fileToken, commentId, text, { profile, fileType = 'docx' } = {}) {
  const params = JSON.stringify({ file_token: fileToken, file_type: fileType, comment_id: commentId });
  return larkJson(['drive', 'file.comment.replys', 'create', '--params', params,
    '--data', replyContentBody(text), '--as', 'bot', '--format', 'json'], { profile });
}
