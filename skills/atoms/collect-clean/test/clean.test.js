import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanIdCard, cleanSize, cleanEmail, cleanDate } from '../src/clean.js';

test('身份证：合法 18 位通过', () => {
  assert.deepEqual(cleanIdCard('11010119900307123X'),
    { ok: true, value: '11010119900307123X' });
});
test('身份证：含空格归一化后通过', () => {
  assert.equal(cleanIdCard(' 110101 1990 0307 1234 ').ok, true);
});
test('身份证：位数不足返回追问', () => {
  const r = cleanIdCard('12345');
  assert.equal(r.ok, false);
  assert.match(r.followup, /18 位/);
});
test('尺码：全角/大小写归一化', () => {
  assert.deepEqual(cleanSize('ｌ'), { ok: true, value: 'L' });
  assert.deepEqual(cleanSize(' xl '), { ok: true, value: 'XL' });
});
test('尺码：非法值追问', () => {
  assert.equal(cleanSize('大号').ok, false);
});
test('邮箱：合法通过、非法追问', () => {
  assert.equal(cleanEmail('a@b.com').ok, true);
  assert.equal(cleanEmail('a@@b').ok, false);
});
test('日期：多格式归一到 YYYY-MM-DD', () => {
  assert.equal(cleanDate('2026/6/9').value, '2026-06-09');
  assert.equal(cleanDate('2026年6月9日').value, '2026-06-09');
});
test('日期：不存在的日期被拒（13 月 / 2 月 30 日）', () => {
  const r1 = cleanDate('2026-13-01');
  assert.equal(r1.ok, false);
  assert.match(r1.followup, /不存在/);
  const r2 = cleanDate('2026-02-30');
  assert.equal(r2.ok, false);
  assert.match(r2.followup, /不存在/);
});
test('日期：合法边界（闰年 2 月 29 日）通过', () => {
  assert.equal(cleanDate('2024-02-29').value, '2024-02-29');
});
