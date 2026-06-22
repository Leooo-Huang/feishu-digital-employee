import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC_INTERVIEW, nextQuestion, interviewProgress, formatAnswerForKb } from '../src/interview.js';
import { STANDARD_TREE } from '../../kb-scaffold/src/scaffold.js';

// 一致性：每道题的目标节点都必须是骨架标准树里的真实节点（顶层或子页）。
test('题库目标节点都在标准树内（与 kb-scaffold 一致）', () => {
  const titles = new Set(STANDARD_TREE.flatMap((n) => [n.title, ...(n.children || [])]));
  for (const q of GENERIC_INTERVIEW) assert.ok(titles.has(q.目标节点), `目标节点不在树内: ${q.目标节点}`);
});

test('nextQuestion：空→第一题；部分答→下一题；全答完→null', () => {
  assert.equal(nextQuestion([]).key, 'overview');
  assert.equal(nextQuestion(['overview', 'members']).key, 'projects');
  assert.equal(nextQuestion(GENERIC_INTERVIEW.map((q) => q.key)), null);
});

test('interviewProgress：计数与完成判定', () => {
  assert.deepEqual(interviewProgress(['overview']), { answered: 1, total: 5, complete: false });
  assert.equal(interviewProgress(GENERIC_INTERVIEW.map((q) => q.key)).complete, true);
});

test('formatAnswerForKb：正常答案 → {nodeTitle, content 带主题}', () => {
  const item = GENERIC_INTERVIEW.find((q) => q.key === 'okr');
  const r = formatAnswerForKb(item, '把书童跑通真机', '2026-W25');
  assert.equal(r.nodeTitle, 'OKR / 战略目标');
  assert.match(r.content, /## 战略目标 \/ OKR/);
  assert.match(r.content, /把书童跑通真机/);
});

test('formatAnswerForKb：空 / 纯空白答案 → null（跳过，不写，缺失不编造）', () => {
  const item = GENERIC_INTERVIEW[0];
  assert.equal(formatAnswerForKb(item, ''), null);
  assert.equal(formatAnswerForKb(item, '   '), null);
  assert.equal(formatAnswerForKb(item, null), null);
  assert.equal(formatAnswerForKb(item, undefined), null);
});
