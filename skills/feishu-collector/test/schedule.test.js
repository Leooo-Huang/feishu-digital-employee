import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSlotsToNudge } from '../src/schedule.js';

const task = { deadline: '2026-06-19T18:00:00+08:00', reminderIntervalH: 24, maxAttempts: 3 };
const now = new Date('2026-06-17T18:00:00+08:00');

test('未填且超过催办间隔 → 入选', () => {
  const slots = [{ slot_id: 's1', 状态: '已问', 最近询问时间: '2026-06-16T10:00:00+08:00', 追问次数: 0 }];
  assert.equal(selectSlotsToNudge(slots, task, now).length, 1);
});
test('已填 → 不催', () => {
  const slots = [{ slot_id: 's1', 状态: '已填', 最近询问时间: '2026-06-16T10:00:00+08:00', 追问次数: 0 }];
  assert.equal(selectSlotsToNudge(slots, task, now).length, 0);
});
test('刚问过（未到间隔）→ 不催', () => {
  const slots = [{ slot_id: 's1', 状态: '已问', 最近询问时间: '2026-06-17T12:00:00+08:00', 追问次数: 0 }];
  assert.equal(selectSlotsToNudge(slots, task, now).length, 0);
});
test('超过最大追问次数 → 不再催', () => {
  const slots = [{ slot_id: 's1', 状态: '已问', 最近询问时间: '2026-06-15T10:00:00+08:00', 追问次数: 3 }];
  assert.equal(selectSlotsToNudge(slots, task, now).length, 0);
});
test('临近截止（<6h）→ urgent=true', () => {
  const nearNow = new Date('2026-06-19T14:00:00+08:00');
  const slots = [{ slot_id: 's1', 状态: '已问', 最近询问时间: '2026-06-18T10:00:00+08:00', 追问次数: 1 }];
  const r = selectSlotsToNudge(slots, task, nearNow);
  assert.equal(r.length, 1);
  assert.equal(r[0].urgent, true);
});
test('已过期 → 不在此催（交收工逻辑）', () => {
  const pastNow = new Date('2026-06-20T10:00:00+08:00');
  const slots = [{ slot_id: 's1', 状态: '已问', 最近询问时间: '2026-06-18T10:00:00+08:00', 追问次数: 0 }];
  assert.equal(selectSlotsToNudge(slots, task, pastNow).length, 0);
});
