// 源文件解析 + 本地文件转在线。
// 命令：飞书 URL→drive +inspect；本地文件→drive +import 然后 +task_result 轮询；
//      在线表格读→sheets +cells-get；多维表格→base +record-list/+field-list；文档→docs +fetch。
import { lark, larkJson } from './larkcli.js';

/** 飞书 URL → { kind, token }（含 wiki 解包） */
export async function inspectUrl(url, { profile } = {}) {
  const res = await larkJson(['drive', '+inspect', url, '--json'], { profile });
  return { kind: res.type || res.obj_type, token: res.token || res.obj_token, title: res.title };
}

/**
 * 本地 xlsx/docx/md/pptx → 飞书在线文档。失败必须抛错（禁止静默 fallback）。
 * @returns {Promise<{token:string, kind:string}>}
 */
export async function localToOnline(localPath, type, { profile } = {}) {
  const start = await larkJson(['drive', '+import', '--file', localPath, '--type', type, '--json'], { profile });
  const ticket = start.ticket || start.task_id || start.id;
  if (!ticket) throw new Error(`本地文件导入未返回 ticket（原始: ${JSON.stringify(start)}）`);
  // 轮询导入结果
  for (let i = 0; i < 30; i++) {
    const r = await larkJson(['drive', '+task_result', '--ticket', ticket, '--json'], { profile });
    const job = r.result || r;
    if (job.job_status === 0 || job.status === 'success' || job.token) {
      const token = job.token || job.url_token;
      if (!token) throw new Error(`导入成功但未拿到 token（原始: ${JSON.stringify(r)}）`);
      return { token, kind: type };
    }
    if (job.job_status && job.job_status !== 1 && job.job_status !== 2) {
      throw new Error(`本地文件导入失败 job_status=${job.job_status}: ${job.job_error_msg || ''}`);
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('本地文件导入轮询超时（30s）');
}

/**
 * 读源文件结构，返回标准化收集骨架。
 * @param ref { kind:'sheet'|'base'|'doc', token, sheetId? }
 * @returns {Promise<{kind, token, headers, rows, fillableColumns, assigneeColumn?}>}
 *   ⚠️ 待集成：各域读命令的响应字段路径以实测为准；下方为骨架，集成时按真实结构补全解析。
 */
export async function parseSource(ref, { profile } = {}) {
  if (ref.kind === 'sheet') {
    const res = await larkJson(['sheets', '+cells-get',
      '--range', `${ref.sheetId || 'Sheet1'}!A1:Z`, '--as', 'user', '--json'], { profile });
    const grid = res.values || res.valueRange?.values || [];
    const [headers = [], ...rows] = grid;
    return { kind: 'sheet', token: ref.token, sheetId: ref.sheetId, headers, rows,
      fillableColumns: headers, assigneeColumn: guessAssigneeColumn(headers) };
  }
  if (ref.kind === 'base') {
    const fields = pick(await larkJson(['base', '+field-list', '--base-token', ref.token,
      '--table-id', ref.tableId, '--as', 'user', '--json'], { profile }), 'fields', 'items');
    const recs = pick(await larkJson(['base', '+record-list', '--base-token', ref.token,
      '--table-id', ref.tableId, '--as', 'user', '--json'], { profile }), 'records', 'items');
    const headers = fields.map((f) => f.field_name || f.name);
    return { kind: 'base', token: ref.token, tableId: ref.tableId, headers,
      rows: recs, fillableColumns: headers, assigneeColumn: guessAssigneeColumn(headers) };
  }
  if (ref.kind === 'doc') {
    const { stdout } = await lark(['docs', '+fetch', '--doc', ref.token, '--as', 'user'], { profile });
    return { kind: 'doc', token: ref.token, raw: stdout };
  }
  throw new Error(`不支持的源文件类型: ${ref.kind}`);
}

function pick(res, ...keys) {
  for (const k of keys) if (res?.[k]) return res[k];
  if (res?.data) for (const k of keys) if (res.data[k]) return res.data[k];
  return [];
}

function guessAssigneeColumn(headers) {
  const cand = ['责任人', '负责人', '姓名', '成员', '员工', 'owner', 'assignee', 'name'];
  return headers.find((h) => cand.some((c) => String(h).toLowerCase().includes(c.toLowerCase())));
}
