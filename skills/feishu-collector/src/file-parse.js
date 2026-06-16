// 源文件解析 + 本地文件转在线。命令面经实测校准 (lark-cli 1.0.53)：
//   飞书 URL → drive +inspect --url（url 是旗标，不是位置参数）
//   本地文件 → drive +import --file --type → drive +task_result --ticket --scenario import 轮询
//   在线表格 → sheets +workbook-info 取首表 sheet_id → sheets +cells-get --spreadsheet-token --sheet-id --range(无前缀)
//   多维表格 → base +field-list / +record-list；文档 → docs +fetch --detail with-ids --doc-format markdown
import { larkJson } from './larkcli.js';

/** 飞书 URL → { kind, token, title }（含 wiki 解包） */
export async function inspectUrl(url, { profile } = {}) {
  const res = await larkJson(['drive', '+inspect', '--url', url, '--format', 'json'], { profile });
  const r = res.data || res;
  return { kind: r.type || r.obj_type, token: r.token || r.obj_token, title: r.title };
}

/**
 * 本地 xlsx/docx/md/pptx → 飞书在线文档。失败必须抛错（禁止静默 fallback）。
 * @returns {Promise<{token:string, kind:string}>}
 */
export async function localToOnline(localPath, type, { profile } = {}) {
  const start = await larkJson(['drive', '+import', '--file', localPath, '--type', type, '--format', 'json'], { profile });
  const s = start.data || start;
  const ticket = s.ticket || s.task_id || s.id;
  if (!ticket) throw new Error(`本地文件导入未返回 ticket（原始: ${JSON.stringify(start)}）`);
  for (let i = 0; i < 30; i++) {
    const r = await larkJson(['drive', '+task_result', '--ticket', ticket, '--scenario', 'import', '--format', 'json'], { profile });
    const job = r.result || r.data?.result || r.data || r;
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
 * @param ref { kind:'sheet'|'base'|'doc', token, sheetId?, tableId? }
 * @returns {Promise<{kind, token, headers, rows, fillableColumns, assigneeColumn?}>}
 */
export async function parseSource(ref, { profile } = {}) {
  if (ref.kind === 'sheet') {
    const info = await larkJson(['sheets', '+workbook-info', '--spreadsheet-token', ref.token,
      '--format', 'json', '--as', 'user'], { profile });
    const sheets = info.sheets || info.items || info.data?.sheets || [];
    const first = sheets[0] || {};
    const sheetId = ref.sheetId || first.sheet_id || first.id;
    const res = await larkJson(['sheets', '+cells-get', '--spreadsheet-token', ref.token,
      ...(sheetId ? ['--sheet-id', sheetId] : ['--sheet-name', first.title || 'Sheet1']),
      '--range', 'A1:Z', '--include', 'value', '--format', 'json', '--as', 'user'], { profile });
    const grid = res.values || res.valueRange?.values || res.data?.values || [];
    const [headers = [], ...rows] = grid;
    return { kind: 'sheet', token: ref.token, sheetId, headers, rows,
      fillableColumns: headers, assigneeColumn: guessAssigneeColumn(headers) };
  }
  if (ref.kind === 'base') {
    const fields = pick(await larkJson(['base', '+field-list', '--base-token', ref.token,
      '--table-id', ref.tableId, '--format', 'json', '--as', 'user'], { profile }), 'fields', 'items');
    const recs = pick(await larkJson(['base', '+record-list', '--base-token', ref.token,
      '--table-id', ref.tableId, '--format', 'json', '--as', 'user'], { profile }), 'records', 'items');
    const headers = fields.map((f) => f.field_name || f.name);
    return { kind: 'base', token: ref.token, tableId: ref.tableId, headers,
      rows: recs, fillableColumns: headers, assigneeColumn: guessAssigneeColumn(headers) };
  }
  if (ref.kind === 'doc') {
    const res = await larkJson(['docs', '+fetch', '--doc', ref.token, '--detail', 'with-ids',
      '--doc-format', 'markdown', '--format', 'json', '--as', 'user'], { profile });
    return { kind: 'doc', token: ref.token, content: res.content || res.data?.content || res };
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
