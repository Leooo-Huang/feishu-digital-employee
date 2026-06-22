import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowSinceMs, recentRows, selectRecent } from '../src/digest.js';

const now = new Date('2026-06-20T00:00:00Z');
const sinceMs = windowSinceMs(168, now); // 一周前

test('windowSinceMs：往前 N 小时', () => {
  assert.equal(windowSinceMs(1, now), now.getTime() - 3600 * 1000);
});

test('recentRows：只保留窗口内（数值化比较，兼容 ISO/毫秒/无效）', () => {
  const rows = [
    { id: 'a', last_synced_at: '2026-06-19T00:00:00Z' },       // 窗口内
    { id: 'b', last_synced_at: '2026-06-01T00:00:00Z' },       // 窗口外
    { id: 'c', last_synced_at: now.getTime() - 1000 },          // 毫秒数，窗口内
    { id: 'd', last_synced_at: 'not-a-date' },                  // 无效 → 丢弃
    { id: 'e' },                                                // 缺字段 → 丢弃
  ];
  const got = recentRows(rows, sinceMs).map((r) => r.id).sort();
  assert.deepEqual(got, ['a', 'c']);
});

test('selectRecent：三类分别筛', () => {
  const r = selectRecent({
    doc: [{ id: 'd1', last_synced_at: '2026-06-19T00:00:00Z' }],
    task: [{ id: 't1', last_synced_at: '2026-05-01T00:00:00Z' }],
    okr: [],
  }, sinceMs);
  assert.equal(r.doc.length, 1);
  assert.equal(r.task.length, 0);
  assert.equal(r.okr.length, 0);
});

test('selectRecent：缺省入参不崩', () => {
  const r = selectRecent(undefined, sinceMs);
  assert.deepEqual(r, { doc: [], task: [], okr: [] });
});
