import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash } from '../src/hash.js';
import { decideRoute, querySource, queryByKind, recordRoute, upsertRoute } from '../src/route-io.js';

// ---- 纯决策逻辑（decideRoute）：幂等三态 ----

test('decideRoute: 无既有记录 → write', () => {
  const d = decideRoute(null, '一段会议纪要');
  assert.equal(d.action, 'write');
  assert.equal(d.hash, contentHash('一段会议纪要'));
  assert.equal(d.recordId, undefined);
});

test('decideRoute: 指纹未变 → skip（带回既有落点）', () => {
  const content = '同样的内容';
  const existing = { record_id: 'rec1', content_hash: contentHash(content),
    target_id: 'docx_x', target_locator: 'blk_3' };
  const d = decideRoute(existing, content);
  assert.equal(d.action, 'skip');
  assert.equal(d.recordId, 'rec1');
  assert.equal(d.targetLocator, 'blk_3');
});

test('decideRoute: 指纹变化 → update（按既有落点覆盖）', () => {
  const existing = { record_id: 'rec1', content_hash: contentHash('旧'),
    target_id: 'docx_x', target_locator: 'blk_3' };
  const d = decideRoute(existing, '新');
  assert.equal(d.action, 'update');
  assert.equal(d.recordId, 'rec1');
  assert.equal(d.hash, contentHash('新'));
  assert.equal(d.targetId, 'docx_x');
});

// ---- I/O 层（注入 lark 桩，验证 argv 与解析，不打网络）----

function makeStub(responses) {
  const calls = [];
  const lark = async (argv) => {
    calls.push(argv);
    const key = argv.slice(0, 2).join(' '); // e.g. 'base +record-search'
    const r = responses[key];
    return typeof r === 'function' ? r(argv) : r;
  };
  return { lark, calls };
}

test('querySource: 解析 records 首条 + 携带 --format json', async () => {
  const { lark, calls } = makeStub({
    'base +record-search': { records: [{ record_id: 'recA', fields: { source_id: 's1', content_hash: 'h1' } }] },
  });
  const ctx = { appToken: 'app', routeTableId: 'tbl', lark };
  const rec = await querySource(ctx, 's1');
  assert.equal(rec.record_id, 'recA');
  assert.equal(rec.content_hash, 'h1');
  const argv = calls[0];
  assert.ok(argv.includes('--format') && argv.includes('json'), 'record-search 必须带 --format json');
  assert.ok(argv.includes('+record-search'));
  // filter.conditions 为数组三元组 ["source_id","==","s1"]
  const body = JSON.parse(argv[argv.indexOf('--json') + 1]);
  assert.deepEqual(body.filter.conditions, [['source_id', '==', 's1']]);
});

test('querySource: 无命中 → null', async () => {
  const { lark } = makeStub({ 'base +record-search': { records: [] } });
  const ctx = { appToken: 'app', routeTableId: 'tbl', lark };
  assert.equal(await querySource(ctx, 'nope'), null);
});

test('queryByKind: 防御性解析 items 形态', async () => {
  const { lark } = makeStub({
    'base +record-search': { items: [{ id: 'r1', fields: { target_kind: 'doc' } }] },
  });
  const ctx = { appToken: 'app', routeTableId: 'tbl', lark };
  const rows = await queryByKind(ctx, 'doc');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].record_id, 'r1');
});

test('upsertRoute: 无 recordId=创建（argv 不含 --record-id）', async () => {
  const { lark, calls } = makeStub({ 'base +record-upsert': { record: { record_id: 'newRec' } } });
  const ctx = { appToken: 'app', routeTableId: 'tbl', lark };
  const id = await upsertRoute(ctx, { source_id: 's1' });
  assert.equal(id, 'newRec');
  assert.ok(!calls[0].includes('--record-id'));
});

test('upsertRoute: 带 recordId=更新（argv 含 --record-id）', async () => {
  const { lark, calls } = makeStub({ 'base +record-upsert': { record: { record_id: 'recX' } } });
  const ctx = { appToken: 'app', routeTableId: 'tbl', lark };
  await upsertRoute(ctx, { status: 'updated' }, 'recX');
  assert.ok(calls[0].includes('--record-id'));
  assert.equal(calls[0][calls[0].indexOf('--record-id') + 1], 'recX');
});

test('recordRoute(write): 创建记录并落 content_hash + status=written', async () => {
  const { lark, calls } = makeStub({ 'base +record-upsert': { record: { record_id: 'recNew' } } });
  const ctx = { appToken: 'app', routeTableId: 'tbl', lark };
  const decision = decideRoute(null, '内容X');
  const id = await recordRoute(ctx, decision, {
    sourceType: 'meeting', sourceId: 'min_1', targetKind: 'doc', targetId: 'docx_1', targetLocator: 'blk_1',
  }, 'written');
  assert.equal(id, 'recNew');
  const fields = JSON.parse(calls[0][calls[0].indexOf('--json') + 1]);
  assert.equal(fields.content_hash, contentHash('内容X'));
  assert.equal(fields.status, 'written');
  assert.equal(fields.source_id, 'min_1');
  assert.ok(!calls[0].includes('--record-id')); // 新建
});

test('recordRoute(update): 沿用既有 recordId/locator 覆盖', async () => {
  const { lark, calls } = makeStub({ 'base +record-upsert': { record: { record_id: 'rec1' } } });
  const ctx = { appToken: 'app', routeTableId: 'tbl', lark };
  const existing = { record_id: 'rec1', content_hash: contentHash('旧'), target_id: 'docx_1', target_locator: 'blk_1' };
  const decision = decideRoute(existing, '新内容');
  await recordRoute(ctx, decision, { sourceType: 'chat', sourceId: 'oc_1:w1', targetKind: 'doc' }, 'updated');
  assert.ok(calls[0].includes('--record-id'));
  const fields = JSON.parse(calls[0][calls[0].indexOf('--json') + 1]);
  assert.equal(fields.status, 'updated');
  assert.equal(fields.content_hash, contentHash('新内容'));
  assert.equal(fields.target_locator, 'blk_1'); // 沿用既有落点
});
