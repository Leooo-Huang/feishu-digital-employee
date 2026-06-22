import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, needsWrite } from '../src/hash.js';

test('contentHash 对相同归一化输入稳定', () => {
  assert.equal(contentHash(' L '), contentHash('L'));
});
test('contentHash 对不同输入不同', () => {
  assert.notEqual(contentHash('L'), contentHash('M'));
});
test('needsWrite: 空旧指纹必写', () => {
  assert.equal(needsWrite('', 'L'), true);
});
test('needsWrite: 同值 skip', () => {
  const h = contentHash('L');
  assert.equal(needsWrite(h, 'L'), false);
});
test('needsWrite: 变值覆盖', () => {
  const h = contentHash('L');
  assert.equal(needsWrite(h, 'M'), true);
});
