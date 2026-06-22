import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, normalizeForHash, needsWrite } from '../src/hash.js';

test('normalizeForHash 折叠空白并小写', () => {
  assert.equal(normalizeForHash('  A  B \n C '), 'a b c');
});
test('contentHash 对相同归一化输入稳定', () => {
  assert.equal(contentHash(' 决策 已通过 '), contentHash('决策  已通过'));
});
test('contentHash 对不同输入不同', () => {
  assert.notEqual(contentHash('通过'), contentHash('驳回'));
});
test('needsWrite: 空旧指纹必写', () => {
  assert.equal(needsWrite('', '任意内容'), true);
});
test('needsWrite: 同值 skip', () => {
  const h = contentHash('结论 A');
  assert.equal(needsWrite(h, '结论 A'), false);
});
test('needsWrite: 变值覆盖', () => {
  const h = contentHash('结论 A');
  assert.equal(needsWrite(h, '结论 B'), true);
});
