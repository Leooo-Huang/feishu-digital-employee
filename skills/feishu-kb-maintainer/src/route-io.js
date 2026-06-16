// 路由幂等表 I/O：在飞书多维表格上读写「路由幂等表」。字段见设计 §4.1。
// 命令面经实测校准 (lark-cli 1.0.53)：
//   base +record-search --base-token <t> --table-id <表> --json '<filterBody>' --format json --as user
//     ⚠️ +record-search 默认输出 markdown，必须带 --format json；
//        filter.conditions 为数组三元组 ["字段","操作符",值]，文本相等用 ==。
//   base +record-upsert --base-token <t> --table-id <表> [--record-id <r>] --json '<字段映射>' --format json --as user
//     不带 record-id=创建，带=更新；不会按业务键自动 upsert，故先 querySource 再决定。
// ⚠️ 响应路径待真机校准：lark base 各命令 JSON 响应里 record_id / records 的确切路径以实测为准，
//    下方对常见形态做防御性多路径解析（record_id||id；records||items||data.*）。
import { larkJson } from './larkcli.js';
import { contentHash } from './hash.js';

// ctx = { appToken, routeTableId, profile?, lark? }
// 注入点：ctx.lark（可选）——默认用 larkJson；单测可注入桩以验证幂等决策不打网络。
function client(ctx) {
  return ctx.lark || larkJson;
}

function pickRecordId(res) {
  const r = res?.record || res?.data?.record || res;
  return r?.record_id || r?.id || res?.record_id;
}
function pickRecords(res) {
  return res?.records || res?.items || res?.data?.records || res?.data?.items || [];
}
function normalizeRoute(rec) {
  const f = rec.fields || rec;
  return { record_id: rec.record_id || rec.id, ...f };
}

// 实测：filter.conditions 为数组三元组，logic and；limit 上限按服务端，取 200。
function searchBody(conditions, limit = 200) {
  return JSON.stringify({ filter: { logic: 'and', conditions }, limit });
}

/** 按 source_id 查路由幂等表，返回首条命中记录（归一化）或 null */
export async function querySource(ctx, sourceId) {
  const res = await client(ctx)(['base', '+record-search', '--base-token', ctx.appToken,
    '--table-id', ctx.routeTableId, '--json', searchBody([['source_id', '==', sourceId]]),
    '--format', 'json', '--as', 'user'], { profile: ctx.profile });
  const recs = pickRecords(res).map(normalizeRoute);
  return recs[0] || null;
}

/** 列出某 target_kind 的全部路由记录（周期汇总遍历用） */
export async function queryByKind(ctx, targetKind) {
  const res = await client(ctx)(['base', '+record-search', '--base-token', ctx.appToken,
    '--table-id', ctx.routeTableId, '--json', searchBody([['target_kind', '==', targetKind]]),
    '--format', 'json', '--as', 'user'], { profile: ctx.profile });
  return pickRecords(res).map(normalizeRoute);
}

/** 写一条路由记录（创建/更新由 recordId 决定），返回 record_id */
export async function upsertRoute(ctx, fields, recordId) {
  const argv = ['base', '+record-upsert', '--base-token', ctx.appToken,
    '--table-id', ctx.routeTableId, '--json', JSON.stringify(fields), '--format', 'json', '--as', 'user'];
  if (recordId) argv.push('--record-id', recordId);
  const res = await client(ctx)(argv, { profile: ctx.profile });
  return pickRecordId(res);
}

/**
 * 纯函数：给定既有路由记录（或 null）+ 新内容，决定写动作。无副作用、不打网络，便于单测。
 * 幂等逻辑（设计 §6.5）：
 *   既有记录不存在            → write   （写目标并登记 locator+hash）
 *   存在且 content_hash 变化   → update  （按 target_locator 覆盖）
 *   存在且 content_hash 未变   → skip
 * @param existing 路由记录或 null（含 content_hash / target_id / target_locator）
 * @param newContent 将写入目标的内容文本（用于算指纹）
 * @returns {{action:'write'|'update'|'skip', hash, recordId?, targetId?, targetLocator?}}
 */
export function decideRoute(existing, newContent) {
  const hash = contentHash(newContent);
  if (!existing) return { action: 'write', hash };
  if (existing.content_hash === hash) {
    return { action: 'skip', hash, recordId: existing.record_id,
      targetId: existing.target_id, targetLocator: existing.target_locator };
  }
  return { action: 'update', hash, recordId: existing.record_id,
    targetId: existing.target_id, targetLocator: existing.target_locator };
}

/**
 * 登记/更新一条路由结果到幂等表。在目标写成功后调用，回写 locator+hash+status+time。
 * @param ctx
 * @param decision decideRoute 的返回（带 recordId 时为更新）
 * @param meta { sourceType, sourceId, sourceMeta, targetKind, targetId, targetLocator }
 * @param status 'written'|'updated'|'skipped'
 */
export async function recordRoute(ctx, decision, meta, status) {
  const fields = {
    source_type: meta.sourceType,
    source_id: meta.sourceId,
    source_meta: meta.sourceMeta ?? '',
    target_kind: meta.targetKind,
    target_id: meta.targetId ?? decision.targetId ?? '',
    target_locator: meta.targetLocator ?? decision.targetLocator ?? '',
    content_hash: decision.hash,
    status,
    last_synced_at: new Date().toISOString(),
  };
  return upsertRoute(ctx, fields, decision.recordId);
}
