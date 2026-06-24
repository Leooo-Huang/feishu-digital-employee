import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDARD_TREE, planScaffold, createTree, DEFAULT_SPACE_NAME,
  findSpaceByName, nodeItemsOf, scaffoldStatus, ensureSpace, collectExistingTitles, initScaffold,
} from '../src/scaffold.js';

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

test('findSpaceByName：按名精确匹配返回 space_id，无则 undefined', () => {
  const spaces = [{ name: '别的库', space_id: 'spc_x' }, { name: DEFAULT_SPACE_NAME, space_id: 'spc_kb' }];
  assert.equal(findSpaceByName(spaces, DEFAULT_SPACE_NAME), 'spc_kb');
  assert.equal(findSpaceByName(spaces, '不存在'), undefined);
  assert.equal(findSpaceByName([], '任何'), undefined);
});

test('nodeItemsOf：多路径容差取节点数组', () => {
  assert.equal(nodeItemsOf({ items: [{ title: 'a' }] }).length, 1);
  assert.equal(nodeItemsOf({ data: { items: [{ title: 'a' }, { title: 'b' }] } }).length, 2);
  assert.deepEqual(nodeItemsOf({}), []);
});

test('scaffoldStatus：算骨架完整度（total=10）', () => {
  const empty = scaffoldStatus([]);
  assert.equal(empty.total, 10);
  assert.equal(empty.present, 0);
  assert.equal(empty.missing, 10);
  assert.equal(empty.complete, false);
  const full = scaffoldStatus(['公司总览', '公司战略与年度目标', '重要决策记录 Decision Log', '组织架构与成员',
    '项目空间', '会议纪要库', '群知识沉淀', '公司待办看板', 'OKR / 战略目标', '制度 / SOP / FAQ']);
  assert.equal(full.complete, true);
  assert.equal(full.present, 10);
  assert.equal(full.missing, 0);
});

test('ensureSpace：空间已存在 → 复用，不调 createSpace（幂等）', async () => {
  let created = false;
  const listSpaces = async () => [{ name: DEFAULT_SPACE_NAME, space_id: 'spc_have' }];
  const createSpace = async () => { created = true; return { spaceId: 'spc_new' }; };
  const r = await ensureSpace({}, DEFAULT_SPACE_NAME, { listSpaces, createSpace });
  assert.deepEqual(r, { spaceId: 'spc_have', existed: true });
  assert.equal(created, false);
});

test('ensureSpace：空间不存在 → 建新空间', async () => {
  const listSpaces = async () => [{ name: '别的库', space_id: 'spc_x' }];
  const createSpace = async (name) => { assert.equal(name, DEFAULT_SPACE_NAME); return { spaceId: 'spc_new' }; };
  const r = await ensureSpace({}, DEFAULT_SPACE_NAME, { listSpaces, createSpace });
  assert.deepEqual(r, { spaceId: 'spc_new', existed: false });
});

test('collectExistingTitles：递归 has_child 收全部层级标题', async () => {
  // 顶层「公司总览」有子级；列其子级返回 3 个子页。
  const listNodes = async (spaceId, { parentNodeToken } = {}) => {
    if (!parentNodeToken) {
      return { items: [
        { title: '公司总览', node_token: 'nt_overview', has_child: true },
        { title: '会议纪要库', node_token: 'nt_min', has_child: false },
      ] };
    }
    if (parentNodeToken === 'nt_overview') {
      return { items: [
        { title: '公司战略与年度目标', node_token: 'nt_a' },
        { title: '重要决策记录 Decision Log', node_token: 'nt_b' },
        { title: '组织架构与成员', node_token: 'nt_c' },
      ] };
    }
    return { items: [] };
  };
  const { titles, tokenByTitle } = await collectExistingTitles('spc_x', { listNodes });
  assert.ok(titles.includes('公司总览'));
  assert.ok(titles.includes('组织架构与成员')); // 子级也被收到
  assert.equal(titles.length, 5);
  // tokenByTitle 记录了已存在节点的 token，供部分补建时挂父节点
  assert.equal(tokenByTitle['公司总览'], 'nt_overview');
  assert.equal(tokenByTitle['组织架构与成员'], 'nt_c');
});

test('collectExistingTitles：防环——自引用 has_child 不无限递归', async () => {
  const listNodes = async (_s, { parentNodeToken } = {}) => {
    if (!parentNodeToken) return { items: [{ title: '自引用', node_token: 'nt_self', has_child: true }] };
    if (parentNodeToken === 'nt_self') return { items: [{ title: '自引用', node_token: 'nt_self', has_child: true }] };
    return { items: [] };
  };
  const { titles } = await collectExistingTitles('spc_x', { listNodes }); // visited 去重，不应卡死
  assert.ok(titles.length >= 1);
});

test('initScaffold：部分补建——父已存在、子页缺失，子页挂到已存在父（不错建到顶层）', async () => {
  const calls = [];
  // 已有：公司总览(有子级) + 仅 1 个子页"公司战略与年度目标"；缺另外 2 个子页 + 其余 6 个顶层。
  const deps = {
    listSpaces: async () => [{ name: DEFAULT_SPACE_NAME, space_id: 'spc_have' }],
    createSpace: async () => { throw new Error('不该建空间'); },
    listNodes: async (_s, { parentNodeToken } = {}) => {
      if (!parentNodeToken) return { items: [{ title: '公司总览', node_token: 'nt_overview', has_child: true }] };
      if (parentNodeToken === 'nt_overview') return { items: [{ title: '公司战略与年度目标', node_token: 'nt_a', has_child: false }] };
      return { items: [] };
    },
    create: async ({ title, parentNodeToken }) => { calls.push({ title, parentNodeToken }); return { node: { node_token: 'nt_' + title } }; },
  };
  const r = await initScaffold({}, {}, deps);
  assert.equal(r.existed, true);
  // 缺失的 2 个子页必须挂在已存在的「公司总览」(nt_overview) 下，而非顶层
  const decision = calls.find((c) => c.title === '重要决策记录 Decision Log');
  assert.equal(decision.parentNodeToken, 'nt_overview');
  const member = calls.find((c) => c.title === '组织架构与成员');
  assert.equal(member.parentNodeToken, 'nt_overview');
  // 已存在的「公司战略与年度目标」不重复建
  assert.ok(!calls.find((c) => c.title === '公司战略与年度目标'));
});

test('initScaffold：空租户 → 建空间 + 建全部 10 节点（注入全部 deps）', async () => {
  const calls = [];
  const deps = {
    listSpaces: async () => [], // 无任何空间
    createSpace: async () => ({ spaceId: 'spc_new' }),
    listNodes: async () => ({ items: [] }), // 新空间无节点
    create: async ({ title, parentNodeToken }) => { calls.push({ title, parentNodeToken }); return { node: { node_token: 'nt_' + title } }; },
  };
  const r = await initScaffold({}, {}, deps);
  assert.equal(r.spaceId, 'spc_new');
  assert.equal(r.existed, false);
  assert.equal(r.status.missing, 10);
  assert.equal(r.created.length, 10);
  assert.equal(calls[0].title, '公司总览'); // 先顶层
});

test('initScaffold：骨架已齐 → 不重复建（幂等，created 为空）', async () => {
  const allTitles = ['公司总览', '公司战略与年度目标', '重要决策记录 Decision Log', '组织架构与成员',
    '项目空间', '会议纪要库', '群知识沉淀', '公司待办看板', 'OKR / 战略目标', '制度 / SOP / FAQ'];
  let createCalls = 0;
  const deps = {
    listSpaces: async () => [{ name: DEFAULT_SPACE_NAME, space_id: 'spc_have' }],
    createSpace: async () => { throw new Error('不该建空间'); },
    listNodes: async (_s, { parentNodeToken } = {}) => (parentNodeToken
      ? { items: [] }
      : { items: allTitles.map((t) => ({ title: t, node_token: 'nt_' + t, has_child: false })) }),
    create: async () => { createCalls++; return { node: {} }; },
  };
  const r = await initScaffold({}, {}, deps);
  assert.equal(r.existed, true);
  assert.equal(r.status.complete, true);
  assert.equal(r.created.length, 0);
  assert.equal(createCalls, 0);
});
