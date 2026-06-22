import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_TREE, planScaffold, createTree } from '../src/scaffold.js';

test('STANDARD_TREE：公司总览含 3 个子页，共 7 个顶层', () => {
  assert.equal(STANDARD_TREE.length, 7);
  const overview = STANDARD_TREE.find((n) => n.title === '公司总览');
  assert.deepEqual(overview.children, ['公司战略与年度目标', '重要决策记录 Decision Log', '组织架构与成员']);
});

test('planScaffold：空知识空间 → 全量待建（7 顶层 + 3 子页 = 10）', () => {
  const plan = planScaffold([]);
  assert.equal(plan.length, 10);
  assert.equal(plan.filter((p) => p.parent === null).length, 7);
  assert.equal(plan.filter((p) => p.parent === '公司总览').length, 3);
});

test('planScaffold：幂等——已存在的跳过', () => {
  const plan = planScaffold(['公司总览', '公司战略与年度目标', 'OKR / 战略目标']);
  const titles = plan.map((p) => p.title);
  assert.ok(!titles.includes('公司总览'));
  assert.ok(!titles.includes('公司战略与年度目标'));
  assert.ok(!titles.includes('OKR / 战略目标'));
  // 但公司总览其余子页仍要建
  assert.ok(titles.includes('重要决策记录 Decision Log'));
  assert.ok(titles.includes('组织架构与成员'));
});

test('planScaffold：全部已存在 → 空清单（可反复运行不重复建）', () => {
  const all = ['公司总览', '公司战略与年度目标', '重要决策记录 Decision Log', '组织架构与成员',
    '项目空间', '会议纪要库', '群知识沉淀', '公司待办看板', 'OKR / 战略目标', '制度 / SOP / FAQ'];
  assert.equal(planScaffold(all).length, 0);
});

test('createTree：先顶层后子级，子级带父 node token（注入桩验证）', async () => {
  const calls = [];
  const create = async ({ title, parentNodeToken }) => {
    calls.push({ title, parentNodeToken });
    return { node: { node_token: 'nt_' + title } };
  };
  const plan = planScaffold(['项目空间', '会议纪要库', '群知识沉淀', '公司待办看板', 'OKR / 战略目标', '制度 / SOP / FAQ']);
  // 剩：公司总览(顶层) + 其 3 子页
  const created = await createTree({}, 'spc_x', plan, { create });
  // 顶层「公司总览」先建，且无 parentNodeToken
  assert.equal(calls[0].title, '公司总览');
  assert.equal(calls[0].parentNodeToken, undefined);
  // 子页带父 token = nt_公司总览
  const child = calls.find((c) => c.title === '组织架构与成员');
  assert.equal(child.parentNodeToken, 'nt_公司总览');
  assert.equal(created.find((c) => c.title === '公司总览').nodeToken, 'nt_公司总览');
});
