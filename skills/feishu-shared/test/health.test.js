import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig, probeLive, summarize } from '../src/health.js';

test('checkConfig：env 缺则 ok=false 并给指引', () => {
  const r = checkConfig({});
  assert.equal(r.length, 2);
  assert.ok(r.every((c) => c.ok === false));
  assert.ok(r.every((c) => c.hint));
});

test('checkConfig：env 齐则 ok=true', () => {
  const r = checkConfig({ COLLECTOR_APP_TOKEN: 'a', KB_APP_TOKEN: 'b' });
  assert.ok(r.every((c) => c.ok === true));
});

test('probeLive：注入桩——用户 ready + 有知识空间', async () => {
  const run = async (argv) => {
    if (argv[1] === 'status') return { identities: { user: { status: 'ready' } } };
    return { items: [{ space_id: 'spc1' }] };
  };
  const r = await probeLive({}, { run });
  assert.ok(r.find((c) => c.item.includes('授权')).ok);
  assert.ok(r.find((c) => c.item.includes('知识空间')).ok);
});

test('probeLive：未授权 + 无知识空间 → ok=false 带指引', async () => {
  const run = async (argv) => (argv[1] === 'status' ? { identities: { user: { status: 'none' } } } : { items: [] });
  const r = await probeLive({}, { run });
  assert.equal(r.find((c) => c.item.includes('授权')).ok, false);
  const space = r.find((c) => c.item.includes('知识空间'));
  assert.equal(space.ok, false);
  assert.match(space.hint, /搭知识库/);
});

test('probeLive：探测抛错不崩，记为 ok=false', async () => {
  const run = async () => { throw new Error('network down'); };
  const r = await probeLive({}, { run });
  assert.ok(r.every((c) => c.ok === false));
});

test('summarize：缺失汇总', () => {
  assert.equal(summarize([{ ok: true }, { ok: true }]).allOk, true);
  const s = summarize([{ ok: true }, { ok: false, item: 'X' }]);
  assert.equal(s.allOk, false);
  assert.equal(s.missing.length, 1);
});
