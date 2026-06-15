// 状态库 I/O：在飞书多维表格上读写「任务表/槽位表」。字段名见设计 §2。
// 命令名见 env-capabilities.yaml（base +record-upsert / +record-search / +record-get）。
// ⚠️ 待集成验证：lark base 各命令的 JSON 响应字段路径（record_id 等）以实测为准，
//   下方对常见形态做了防御性解析（record_id || id；records || items）。
import { lark, larkJson } from './larkcli.js';
import { contentHash, needsWrite } from './hash.js';

// ctx = { appToken, tasksTableId, slotsTableId, profile? }

function pickRecordId(res) {
  const r = res?.record || res?.data?.record || res;
  return r?.record_id || r?.id || res?.record_id;
}
function pickRecords(res) {
  return res?.records || res?.items || res?.data?.records || res?.data?.items || [];
}

async function upsertRecord(ctx, tableId, fields, recordId) {
  const argv = ['base', '+record-upsert', '--base-token', ctx.appToken,
    '--table-id', tableId, '--json', JSON.stringify(fields), '--as', 'user'];
  if (recordId) argv.push('--record-id', recordId);
  return larkJson(argv, { profile: ctx.profile });
}

/** 建一条任务记录，返回 task record_id */
export async function createTask(ctx, fields) {
  const res = await upsertRecord(ctx, ctx.tasksTableId, fields);
  return pickRecordId(res);
}

/** 批量建槽位记录；每条自动带 task_id 关联 */
export async function createSlots(ctx, taskId, slots) {
  const ids = [];
  for (const s of slots) {
    const res = await upsertRecord(ctx, ctx.slotsTableId, { ...s, task_id: taskId });
    ids.push(pickRecordId(res));
  }
  return ids;
}

/** 按状态查某任务的槽位 */
export async function querySlotsByStatus(ctx, taskId, status) {
  const filter = { logic: 'and', conditions: [
    { field: 'task_id', operator: 'is', value: [taskId] },
    { field: '状态', operator: 'is', value: [status] },
  ] };
  const res = await larkJson(['base', '+record-search', '--base-token', ctx.appToken,
    '--table-id', ctx.slotsTableId, '--filter-json', JSON.stringify(filter), '--as', 'user'],
    { profile: ctx.profile });
  return pickRecords(res).map(normalizeSlot);
}

/** 按责任人查某任务的未终结槽位（路由回复用） */
export async function querySlotsByAssignee(ctx, taskId, openId) {
  const filter = { logic: 'and', conditions: [
    { field: 'task_id', operator: 'is', value: [taskId] },
    { field: '责任人open_id', operator: 'is', value: [openId] },
  ] };
  const res = await larkJson(['base', '+record-search', '--base-token', ctx.appToken,
    '--table-id', ctx.slotsTableId, '--filter-json', JSON.stringify(filter), '--as', 'user'],
    { profile: ctx.profile });
  return pickRecords(res).map(normalizeSlot);
}

function normalizeSlot(rec) {
  const f = rec.fields || rec;
  return { slot_id: rec.record_id || rec.id, ...f };
}

/** 更新槽位字段（状态/追问次数/最近询问时间/值/内容指纹 等） */
export async function updateSlotState(ctx, slotId, patch) {
  return upsertRecord(ctx, ctx.slotsTableId, patch, slotId);
}

/**
 * 幂等写槽位值：比对存储的 内容指纹 决定是否真写。
 * @returns {{written:boolean, hash:string}}
 */
export async function upsertSlotValue(ctx, slot, value) {
  const oldHash = slot.内容指纹 || '';
  if (!needsWrite(oldHash, value)) return { written: false, hash: oldHash };
  const hash = contentHash(value);
  await updateSlotState(ctx, slot.slot_id, { 值: value, 内容指纹: hash });
  return { written: true, hash };
}
