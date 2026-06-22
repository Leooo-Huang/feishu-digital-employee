import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as base from '../src/base-io.js';

// 集成测试：对真实飞书 Base 做 CRUD（非 mock，真调 lark-cli）。
// 前置：先 `node bin/setup-base.js` 建库，并配置环境变量：
//   COLLECTOR_APP_TOKEN / COLLECTOR_TASKS_TABLE / COLLECTOR_SLOTS_TABLE（可选 LARK_PROFILE）
// 未配置 COLLECTOR_APP_TOKEN 时整组跳过——真机验证用，不在 CI/无授权环境强跑。
const appToken = process.env.COLLECTOR_APP_TOKEN;
const skip = appToken ? false : '需 COLLECTOR_APP_TOKEN（真机集成，授权后跑）';
const ctx = {
  appToken,
  tasksTableId: process.env.COLLECTOR_TASKS_TABLE || '任务表',
  slotsTableId: process.env.COLLECTOR_SLOTS_TABLE || '槽位表',
  profile: process.env.LARK_PROFILE,
};

test('createTask → 返回 record_id', { skip }, async () => {
  const id = await base.createTask(ctx, { 标题: 'it-冒烟', 状态: '草稿' });
  assert.ok(id, '应返回 task record_id');
});

test('createSlots → querySlotsByStatus → updateSlotState 闭环', { skip }, async () => {
  const taskId = await base.createTask(ctx, { 标题: 'it-闭环', 状态: '收集中' });
  const [slotId] = await base.createSlots(ctx, taskId, [
    { 字段名: 'T恤尺码', 对象: '本人', 状态: '待问' },
  ]);
  assert.ok(slotId, '应返回 slot record_id');

  const waiting = await base.querySlotsByStatus(ctx, taskId, '待问');
  assert.ok(waiting.some((s) => s.slot_id === slotId), '应按状态查到待问槽位');

  await base.updateSlotState(ctx, slotId, { 状态: '已问' });
  const asked = await base.querySlotsByStatus(ctx, taskId, '已问');
  assert.ok(asked.some((s) => s.slot_id === slotId), '状态应更新为已问');
});

test('upsertSlotValue 幂等：同值第二次 skip，变值才写', { skip }, async () => {
  const taskId = await base.createTask(ctx, { 标题: 'it-幂等', 状态: '收集中' });
  const [slotId] = await base.createSlots(ctx, taskId, [{ 字段名: '邮箱', 状态: '清洗中' }]);

  const r1 = await base.upsertSlotValue(ctx, { slot_id: slotId, 内容指纹: '' }, 'a@b.com');
  assert.equal(r1.written, true, '首次应写入');

  const r2 = await base.upsertSlotValue(ctx, { slot_id: slotId, 内容指纹: r1.hash }, 'a@b.com');
  assert.equal(r2.written, false, '同值应 skip');

  const r3 = await base.upsertSlotValue(ctx, { slot_id: slotId, 内容指纹: r1.hash }, 'c@d.com');
  assert.equal(r3.written, true, '变值应覆盖写');
});

// ---- 单元测试（注入 lark 桩，验证守护逻辑，不打网络，无需真机）----

test('createTask：record_id 解析不到 → 抛错（杜绝孤儿任务 #5）', async () => {
  const uctx = { appToken: 'app', tasksTableId: 't', slotsTableId: 's', lark: async () => ({ ok: true }) };
  await assert.rejects(() => base.createTask(uctx, { 标题: 'x' }), /未解析到 record_id/);
});

test('upsertSlotValue：空值不写（不擦除已有，P2）', async () => {
  let called = 0;
  const uctx = { appToken: 'app', tasksTableId: 't', slotsTableId: 's', lark: async () => { called++; return { record: { record_id: 'r' } }; } };
  const r = await base.upsertSlotValue(uctx, { slot_id: 's1', 内容指纹: 'oldhash' }, '   ');
  assert.equal(r.written, false);
  assert.equal(r.skippedEmpty, true);
  assert.equal(called, 0, '空值不应触发任何写');
});

test('upsertSlotValue：变值才写（注入桩验证触发一次写）', async () => {
  let called = 0;
  const uctx = { appToken: 'app', tasksTableId: 't', slotsTableId: 's', lark: async () => { called++; return { record: { record_id: 'r' } }; } };
  const r = await base.upsertSlotValue(uctx, { slot_id: 's1', 内容指纹: '' }, 'L');
  assert.equal(r.written, true);
  assert.equal(called, 1);
});
