// 状态库 I/O：在飞书多维表格上读写「任务表/槽位表」。字段名见设计 §2。
// CRUD 下沉到 feishu-shared/base-crud（分页 + record_id 守护）；本模块只管收集线的表语义。
// ctx = { appToken, tasksTableId, slotsTableId, profile?, lark? }；ctx.lark 为单测注入桩（经 base-crud 透传）。
import { searchAll, upsert } from '../../../feishu-shared/src/base-crud.js';
import { contentHash, needsWrite, normalizeForHash } from '../../../feishu-shared/src/hash.js';

// 提取 base-crud 所需的最小 ctx（含注入桩）。
function bc(ctx) { return { appToken: ctx.appToken, profile: ctx.profile, lark: ctx.lark }; }

function normalizeSlot(rec) {
  const f = rec.fields || rec;
  return { slot_id: rec.record_id || rec.id, ...f };
}

/** 建一条任务记录，返回 task record_id（解析不到时 base-crud 抛错，杜绝孤儿任务） */
export async function createTask(ctx, fields) {
  const { recordId } = await upsert(bc(ctx), ctx.tasksTableId, fields);
  return recordId;
}

/** 批量建槽位记录；每条自动带 task_id 关联（record_id 解析不到即抛错） */
export async function createSlots(ctx, taskId, slots) {
  const ids = [];
  for (const s of slots) {
    const { recordId } = await upsert(bc(ctx), ctx.slotsTableId, { ...s, task_id: taskId });
    ids.push(recordId);
  }
  return ids;
}

/** 按状态查某任务的槽位（已分页取尽，不再静默截断） */
export async function querySlotsByStatus(ctx, taskId, status) {
  const recs = await searchAll(bc(ctx), ctx.slotsTableId, [['task_id', '==', taskId], ['状态', '==', status]]);
  return recs.map(normalizeSlot);
}

/** 按责任人查某任务的未终结槽位（路由回复用；已分页取尽） */
export async function querySlotsByAssignee(ctx, taskId, openId) {
  const recs = await searchAll(bc(ctx), ctx.slotsTableId, [['task_id', '==', taskId], ['责任人open_id', '==', openId]]);
  return recs.map(normalizeSlot);
}

/** 跨所有任务按责任人查槽位（on-message 归属判定用；已分页取尽，不静默截断） */
export async function querySlotsByAssigneeAll(ctx, openId) {
  const recs = await searchAll(bc(ctx), ctx.slotsTableId, [['责任人open_id', '==', openId]]);
  return recs.map(normalizeSlot);
}

/** 查某任务的全部槽位（收工/汇总用，已分页取尽；一次取全替代按状态多次查，消 N+1） */
export async function querySlotsByTask(ctx, taskId) {
  const recs = await searchAll(bc(ctx), ctx.slotsTableId, [['task_id', '==', taskId]]);
  return recs.map(normalizeSlot);
}

/** 按状态查任务（如「收集中」；已分页取尽，tick 扫描用） */
export async function queryTasksByStatus(ctx, status) {
  const recs = await searchAll(bc(ctx), ctx.tasksTableId, [['状态', '==', status]]);
  return recs.map((r) => ({ task_id: r.record_id || r.id, ...(r.fields || r) }));
}

/** 更新槽位字段（状态/追问次数/最近询问时间/值/内容指纹 等） */
export async function updateSlotState(ctx, slotId, patch) {
  return upsert(bc(ctx), ctx.slotsTableId, patch, slotId);
}

/** 更新任务字段（状态/completed_at 等；收工置「已完成」用） */
export async function updateTaskState(ctx, taskId, patch) {
  return upsert(bc(ctx), ctx.tasksTableId, patch, taskId);
}

/**
 * 幂等写槽位值：比对存储的 内容指纹 决定是否真写。
 * 空值不写（P2）：呼应"缺失值绝不编造/不擦除"，避免把已有值覆盖成空。
 * @returns {{written:boolean, hash:string, skippedEmpty?:boolean}}
 */
export async function upsertSlotValue(ctx, slot, value) {
  const oldHash = slot.内容指纹 || '';
  if (normalizeForHash(value) === '') return { written: false, hash: oldHash, skippedEmpty: true };
  if (!needsWrite(oldHash, value)) return { written: false, hash: oldHash };
  const hash = contentHash(value);
  await updateSlotState(ctx, slot.slot_id, { 值: value, 内容指纹: hash });
  return { written: true, hash };
}
