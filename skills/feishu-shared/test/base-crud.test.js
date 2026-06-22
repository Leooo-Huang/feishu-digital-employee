import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchAll, upsert } from '../src/base-crud.js';

function stub(fn) {
  const calls = [];
  return { lark: async (argv, opts) => { calls.push({ argv, opts }); return fn(argv, opts, calls.length - 1); }, calls };
}

test('searchAll：分页取尽（满页续翻，不足一页即停）', async () => {
  const page0 = { records: Array.from({ length: 200 }, (_, i) => ({ record_id: 'r' + i })) };
  const page1 = { records: Array.from({ length: 50 }, (_, i) => ({ record_id: 'p1-' + i })) };
  const s = stub((argv, opts, i) => (i === 0 ? page0 : page1));
  const recs = await searchAll({ appToken: 'app', lark: s.lark }, 'tbl', [['状态', '==', '收集中']]);
  assert.equal(recs.length, 250);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].argv[s.calls[0].argv.indexOf('--offset') + 1], '0');
  assert.equal(s.calls[1].argv[s.calls[1].argv.indexOf('--offset') + 1], '200');
});

test('searchAll：单页不足即停（1 次调用）', async () => {
  const s = stub(() => ({ items: [{ id: 'a' }] }));
  const recs = await searchAll({ appToken: 'app', lark: s.lark }, 'tbl', []);
  assert.equal(recs.length, 1);
  assert.equal(s.calls.length, 1);
});

test('searchAll：持续满页 → 超 maxPages 抛错（拒绝静默截断 #4）', async () => {
  const full = { records: Array.from({ length: 200 }, (_, i) => ({ record_id: 'x' + i })) };
  const s = stub(() => full);
  await assert.rejects(
    () => searchAll({ appToken: 'app', lark: s.lark }, 'tbl', [], { maxPages: 2 }),
    /拒绝静默截断/,
  );
});

test('upsert：返回 record_id；无 --record-id=创建', async () => {
  const s = stub(() => ({ record: { record_id: 'newR' } }));
  const { recordId } = await upsert({ appToken: 'app', lark: s.lark }, 'tbl', { a: 1 });
  assert.equal(recordId, 'newR');
  assert.ok(!s.calls[0].argv.includes('--record-id'));
});

test('upsert：带 recordId=更新（argv 含 --record-id）', async () => {
  const s = stub(() => ({ record: { record_id: 'R9' } }));
  await upsert({ appToken: 'app', lark: s.lark }, 'tbl', { a: 1 }, 'R9');
  assert.ok(s.calls[0].argv.includes('--record-id'));
  assert.equal(s.calls[0].argv[s.calls[0].argv.indexOf('--record-id') + 1], 'R9');
});

test('upsert：解析不到 record_id → 抛错（#5/#6 杜绝孤儿记录）', async () => {
  const s = stub(() => ({ ok: true }));
  await assert.rejects(() => upsert({ appToken: 'app', lark: s.lark }, 'tbl', { a: 1 }), /未解析到 record_id/);
});
