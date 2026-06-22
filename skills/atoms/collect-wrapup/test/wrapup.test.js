import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWrapup } from '../src/wrapup.js';

const task = { 标题: '团建报名', 截止时间: '2026-06-19T18:00:00+08:00' };

test('未到期且有未终结槽位 → 不收工', () => {
  const now = new Date('2026-06-18T10:00:00+08:00');
  const slots = [{ 状态: '已问', 责任人原文: '张三', 字段名: 'T恤尺码' }];
  assert.equal(planWrapup(task, slots, now).shouldWrap, false);
});

test('全部终结（已填/跳过）且未到期 → 收工 reason=all-done', () => {
  const now = new Date('2026-06-18T10:00:00+08:00');
  const slots = [
    { 状态: '已填', 责任人原文: '张三', 字段名: 'T恤尺码' },
    { 状态: '跳过', 责任人原文: '李四', 字段名: 'T恤尺码' },
  ];
  const r = planWrapup(task, slots, now);
  assert.equal(r.shouldWrap, true);
  assert.equal(r.reason, 'all-done');
});

test('到期 → 收工 reason=expired，未交名单含「已问/跳过」、排除「已填/不适用」', () => {
  const now = new Date('2026-06-20T10:00:00+08:00'); // 已过截止
  const slots = [
    { 状态: '已填', 责任人原文: '张三', 字段名: '尺码' },
    { 状态: '已问', 责任人原文: '李四', 字段名: '尺码' },
    { 状态: '跳过', 责任人原文: '王五', 字段名: '尺码' },
    { 状态: '不适用', 责任人原文: '赵六', 字段名: '尺码' },
  ];
  const r = planWrapup(task, slots, now);
  assert.equal(r.shouldWrap, true);
  assert.equal(r.reason, 'expired');
  assert.equal(r.filled, 1);
  assert.equal(r.total, 4);
  const names = r.unfilled.map((s) => s.责任人原文).sort();
  assert.deepEqual(names, ['李四', '王五']); // 排除已填(张三)与不适用(赵六)
  assert.match(r.report, /已收 1\/4/);
  assert.match(r.report, /未交名单/);
  assert.match(r.report, /李四/);
  assert.ok(!r.report.includes('张三'), '已交者不进未交名单');
});

test('全收齐无未交 → 汇报显示无遗漏', () => {
  const now = new Date('2026-06-18T10:00:00+08:00');
  const slots = [{ 状态: '已填', 责任人原文: '张三', 字段名: '尺码' }];
  const r = planWrapup(task, slots, now);
  assert.equal(r.shouldWrap, true);
  assert.match(r.report, /无遗漏/);
});

test('无截止时间 + 未全终结 → 不收工（不被无效日期误触发）', () => {
  const now = new Date('2026-06-18T10:00:00+08:00');
  const r = planWrapup({ 标题: 'x' }, [{ 状态: '已问' }], now);
  assert.equal(r.shouldWrap, false);
});
