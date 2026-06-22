// 多维表格通用 CRUD：分页查询 + record_id 守护的 upsert + get。Phase B #4/#5/#6。
// 用 ctx.lark || larkJson 调用（支持单测注入桩，避免打网络）。
// 命令面（--help 实证 lark-cli 1.0.53/1.0.55）：
//   +record-search 用 offset/limit 翻页（无 page_token）；filter 走 --json 以绕开 --keyword 必填；
//   +record-upsert 无 --record-id=创建、有=更新。⚠️ offset 与 --json 同传的组合待真机校准。
import { larkJson } from './larkcli.js';

function runner(ctx) { return ctx.lark || larkJson; }

export function pickRecords(res) {
  return res?.records || res?.items || res?.data?.records || res?.data?.items || [];
}
export function pickRecordId(res) {
  const r = res?.record || res?.data?.record || res;
  return r?.record_id || r?.id || res?.record_id;
}

/**
 * 分页查询：用 offset/limit 循环直到取尽（#4 防静默截断）。返回原始记录数组。
 * @param ctx { appToken, profile?, lark? }
 * @param conditions filter 三元组数组，如 [['状态','==','收集中']]
 */
export async function searchAll(ctx, tableId, conditions, { limit = 200, maxPages = 100 } = {}) {
  const run = runner(ctx);
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const body = JSON.stringify({ filter: { logic: 'and', conditions }, limit });
    const argv = ['base', '+record-search', '--base-token', ctx.appToken, '--table-id', tableId,
      '--json', body, '--offset', String(page * limit), '--format', 'json', '--as', 'user'];
    const res = await run(argv, { profile: ctx.profile, retries: 2 });
    const recs = pickRecords(res);
    out.push(...recs);
    if (recs.length < limit) return out; // 末页（不足一页即取尽）
  }
  throw new Error(`base 查询超过 ${maxPages} 页（表 ${tableId}）仍未取尽，拒绝静默截断`);
}

/** upsert：无 recordId=创建，有=更新；解析不到 record_id 即报错（#5/#6，杜绝孤儿记录/静默丢 id）。 */
export async function upsert(ctx, tableId, fields, recordId) {
  const run = runner(ctx);
  const argv = ['base', '+record-upsert', '--base-token', ctx.appToken, '--table-id', tableId,
    '--json', JSON.stringify(fields), '--format', 'json', '--as', 'user'];
  if (recordId) argv.push('--record-id', recordId);
  const res = await run(argv, { profile: ctx.profile });
  const id = pickRecordId(res);
  if (!id) throw new Error(`base 写记录后未解析到 record_id（表 ${tableId}；原始: ${JSON.stringify(res).slice(0, 300)}）`);
  return { recordId: id, raw: res };
}

/** 取单条记录（按需）。 */
export async function get(ctx, tableId, recordId) {
  const run = runner(ctx);
  const res = await run(['base', '+record-get', '--base-token', ctx.appToken, '--table-id', tableId,
    '--record-id', recordId, '--format', 'json', '--as', 'user'], { profile: ctx.profile, retries: 2 });
  return res?.record || res?.data?.record || res;
}
