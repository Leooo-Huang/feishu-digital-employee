import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItem, normalizeItems, groupByKind, sectionFingerprint, ITEM_KINDS } from '../src/extract.js';

test('normalizeItem 清洗文本并附 fingerprint', () => {
  const it = normalizeItem({ kind: 'decision', text: '  上线  时间  定为 周五 ' });
  assert.equal(it.kind, 'decision');
  assert.equal(it.text, '上线 时间 定为 周五');
  assert.match(it.fingerprint, /^[0-9a-f]{16}$/);
});

test('normalizeItem 空文本返回 null', () => {
  assert.equal(normalizeItem({ kind: 'todo', text: '   ' }), null);
  assert.equal(normalizeItem(null), null);
});

test('normalizeItem 非法 kind 归为 conclusion', () => {
  assert.equal(normalizeItem({ kind: '乱写', text: 'x' }).kind, 'conclusion');
});

test('指纹与展示文本解耦：仅空白差异 → 同指纹', () => {
  const a = normalizeItem({ kind: 'todo', text: '提交 周报', owner: '张三' });
  const b = normalizeItem({ kind: 'todo', text: '  提交   周报  ', owner: '张三' });
  assert.equal(a.fingerprint, b.fingerprint);
});

test('owner/due/krId 不同 → 指纹不同', () => {
  const a = normalizeItem({ kind: 'todo', text: '提交周报', owner: '张三' });
  const b = normalizeItem({ kind: 'todo', text: '提交周报', owner: '李四' });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('normalizeItems 去重（保留首次）并丢空', () => {
  const out = normalizeItems([
    { kind: 'decision', text: '通过方案 A' },
    { kind: 'decision', text: '通过方案  A' }, // 重复（归一后同指纹）
    { kind: 'todo', text: '' },                 // 丢弃
    { kind: 'conclusion', text: '结论 B' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((i) => i.kind), ['decision', 'conclusion']);
});

test('groupByKind 按类型分桶且桶齐全', () => {
  const buckets = groupByKind(normalizeItems([
    { kind: 'decision', text: 'd1' },
    { kind: 'todo', text: 't1' },
    { kind: 'todo', text: 't2' },
  ]));
  for (const k of ITEM_KINDS) assert.ok(Array.isArray(buckets[k]));
  assert.equal(buckets.decision.length, 1);
  assert.equal(buckets.todo.length, 2);
});

test('sectionFingerprint：要点集合相同 → 段落指纹相同（顺序无关）', () => {
  const a = normalizeItems([{ kind: 'todo', text: 'x' }, { kind: 'decision', text: 'y' }]);
  const b = normalizeItems([{ kind: 'decision', text: 'y' }, { kind: 'todo', text: 'x' }]);
  assert.equal(sectionFingerprint(a), sectionFingerprint(b));
});

test('sectionFingerprint：要点集合不同 → 段落指纹不同', () => {
  const a = normalizeItems([{ kind: 'todo', text: 'x' }]);
  const b = normalizeItems([{ kind: 'todo', text: 'x' }, { kind: 'todo', text: 'z' }]);
  assert.notEqual(sectionFingerprint(a), sectionFingerprint(b));
});
