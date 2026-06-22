import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInit } from '../src/intent.js';
import { welcomeText, capabilityMenuText, coldStartChoiceText, healthReportText } from '../src/cards.js';

test('classifyInit：意图分类', () => {
  assert.equal(classifyInit('你好'), 'welcome');
  assert.equal(classifyInit(''), 'welcome');
  assert.equal(classifyInit('你是谁'), 'welcome');
  assert.equal(classifyInit('帮助'), 'help');
  assert.equal(classifyInit('书童能做什么'), 'help');
  assert.equal(classifyInit('体检'), 'health');
  assert.equal(classifyInit('搭知识库'), 'scaffold');
  assert.equal(classifyInit('初始化'), 'scaffold');
  assert.equal(classifyInit('访谈'), 'interview');
  assert.equal(classifyInit('导入资料'), 'import');
  assert.equal(classifyInit('今天天气不错'), 'unknown');
});

test('welcomeText：含书童自我介绍与三选项', () => {
  const t = welcomeText();
  assert.match(t, /书童/);
  assert.match(t, /【1】/);
  assert.match(t, /收集|知识库/);
});

test('capabilityMenuText：含核心能力', () => {
  const t = capabilityMenuText();
  assert.match(t, /搭知识库/);
  assert.match(t, /访谈/);
  assert.match(t, /导入资料/);
});

test('coldStartChoiceText：访谈/导入两条路', () => {
  const t = coldStartChoiceText();
  assert.match(t, /访谈式/);
  assert.match(t, /导入式/);
});

test('healthReportText：缺失项标 ❌ 并带指引；全就位标全部就位', () => {
  const bad = healthReportText([{ item: 'A', ok: true }, { item: 'B', ok: false, hint: '去建库' }]);
  assert.match(bad, /❌ B —— 去建库/);
  assert.match(bad, /还差 1 项/);
  const ok = healthReportText([{ item: 'A', ok: true }]);
  assert.match(ok, /全部就位/);
});
