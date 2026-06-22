// 路由幂等表 I/O：在飞书多维表格上读写「路由幂等表」。字段见设计 §4.1。
// CRUD 下沉到 feishu-shared/base-crud（分页 + record_id 守护）；本模块只管路由语义与决策。
// ctx = { appToken, routeTableId, profile?, lark? }；ctx.lark 为单测注入桩（经 base-crud 透传）。
import { searchAll, upsert } from '../../../feishu-shared/src/base-crud.js';
import { contentHash } from '../../../feishu-shared/src/hash.js';

function normalizeRoute(rec) {
  const f = rec.fields || rec;
  return { record_id: rec.record_id || rec.id, ...f };
}

/** 按 source_id 查路由幂等表，返回首条命中记录（归一化）或 null */
export async function querySource(ctx, sourceId) {
  const recs = await searchAll(ctx, ctx.routeTableId, [['source_id', '==', sourceId]]);
  return recs.map(normalizeRoute)[0] || null;
}

/** 列出某 target_kind 的全部路由记录（周期汇总遍历用；已分页取尽，不再静默截断） */
export async function queryByKind(ctx, targetKind) {
  const recs = await searchAll(ctx, ctx.routeTableId, [['target_kind', '==', targetKind]]);
  return recs.map(normalizeRoute);
}

/** 写一条路由记录（创建/更新由 recordId 决定），返回 record_id（解析不到时 base-crud 会抛错） */
export async function upsertRoute(ctx, fields, recordId) {
  const { recordId: id } = await upsert(ctx, ctx.routeTableId, fields, recordId);
  return id;
}

/**
 * 纯函数：给定既有路由记录（或 null）+ 新内容（+ 可选的目标当前内容），决定写动作。无副作用、便于单测。
 * 幂等逻辑（设计 §6.5）：
 *   既有记录不存在            → write   （写目标并登记 locator+hash）
 *   存在且 content_hash 未变   → skip
 *   存在且 content_hash 变化   → update（按 target_locator 覆盖）
 * 覆盖保护（#11，设计 §7.6）：当需要 update，且记录了上次写入目标的指纹 target_content_hash，
 *   而 currentTargetContent（目标当前实际内容）与之不符 → 判定目标被人工改过 → action='conflict'，不自动覆盖。
 *   未提供 currentTargetContent（无法读取目标）则跳过该检查，保持向后兼容。
 * @param existing 路由记录或 null（含 content_hash / target_content_hash / target_id / target_locator）
 * @param newContent 将写入目标的内容文本（算指纹）
 * @param currentTargetContent 可选：目标位置当前的实际内容文本（由编排器读取后传入）
 * @returns {{action:'write'|'update'|'skip'|'conflict', hash, recordId?, targetId?, targetLocator?, reason?}}
 */
export function decideRoute(existing, newContent, currentTargetContent) {
  const hash = contentHash(newContent);
  if (!existing) return { action: 'write', hash };
  const base = { hash, recordId: existing.record_id, targetId: existing.target_id, targetLocator: existing.target_locator };
  if (existing.content_hash === hash) return { action: 'skip', ...base };
  // 覆盖保护：源已变需更新，但若目标内容自上次写入后被人工改过，则不自动覆盖，转发起人确认。
  const baseline = existing.target_content_hash || existing.content_hash;
  if (baseline && currentTargetContent !== undefined && contentHash(currentTargetContent) !== baseline) {
    return { action: 'conflict', ...base, reason: '目标内容自上次写入后疑似被人工修改，不自动覆盖，请发起人确认' };
  }
  return { action: 'update', ...base };
}

/**
 * 登记/更新一条路由结果到幂等表。在目标写成功后调用，回写 locator+hash+status+time。
 * @param decision decideRoute 的返回（带 recordId 时为更新）
 * @param meta { sourceType, sourceId, sourceMeta, targetKind, targetId, targetLocator, nowIso? }
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
    // 覆盖保护基线（#11）：记录本次写入目标的内容指纹 = 我们写下去的内容指纹；
    // 下次更新前比对目标当前内容是否仍等于它，以检测人工改动。
    target_content_hash: decision.hash,
    status,
    last_synced_at: meta.nowIso ?? new Date().toISOString(),
  };
  return upsertRoute(ctx, fields, decision.recordId);
}
