import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_STATES, TASK_STATES, nextSlotState } from '../src/state.js';

test('常量齐全', () => {
  assert.ok(SLOT_STATES.includes('已填'));
  assert.ok(TASK_STATES.includes('收集中'));
});
test('合法迁移：已问+收到回答 → 收到原始', () => {
  assert.equal(nextSlotState('已问', 'answer_received'), '收到原始');
});
test('清洗不通过 → 留在清洗中（追问）', () => {
  assert.equal(nextSlotState('清洗中', 'clean_failed'), '清洗中');
});
test('清洗通过 → 待确认', () => {
  assert.equal(nextSlotState('清洗中', 'clean_ok'), '待确认');
});
test('确认通过 → 已填', () => {
  assert.equal(nextSlotState('待确认', 'confirmed'), '已填');
});
test('确认被否 → 回清洗中', () => {
  assert.equal(nextSlotState('待确认', 'rejected'), '清洗中');
});
test('到期未填 → 跳过', () => {
  assert.equal(nextSlotState('已问', 'deadline_passed'), '跳过');
});
test('非法迁移抛错', () => {
  assert.throws(() => nextSlotState('已填', 'answer_received'));
});
