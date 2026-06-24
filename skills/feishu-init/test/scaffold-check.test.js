import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScaffoldReport, SCAFFOLD_EXIT } from '../src/scaffold-check.js';

// 标准树共 10 个节点（7 顶层 + 公司总览 3 子页，见 scaffold.js STANDARD_TREE）。这里只断言相对关系，不写死总数。

// 桩：probe 返回授权 ok、listSpaces 返回含目标空间、listNodes 按 parentNodeToken 返回节点。
function makeDeps({ authOk = true, spaces = [{ name: '公司知识库', space_id: 'sp1' }], nodesByParent = {} } = {}) {
  return {
    probe: async () => [
      { item: '用户身份授权', ok: authOk },
      { item: '知识库知识空间', ok: spaces.length > 0 },
    ],
    listSpaces: async () => spaces,
    listNodes: async (_spaceId, { parentNodeToken } = {}) => ({ items: nodesByParent[parentNodeToken || '__root__'] || [] }),
  };
}

test('未授权 → unauthorized, exit 2', async () => {
  const r = await buildScaffoldReport({}, makeDeps({ authOk: false }));
  assert.equal(r.status, 'unauthorized');
  assert.equal(r.exitCode, SCAFFOLD_EXIT.unauthorized);
});

test('知识空间不存在 → no_space, exit 1，且只读不建', async () => {
  const r = await buildScaffoldReport({}, makeDeps({ spaces: [] }));
  assert.equal(r.status, 'no_space');
  assert.equal(r.exitCode, 1);
  assert.match(r.message, /不存在/);
});

test('骨架齐全 → complete, exit 0', async () => {
  // 顶层 7 个 + 公司总览 3 子页全建好。
  const nodesByParent = {
    __root__: [
      { title: '公司总览', node_token: 't1', has_child: true },
      { title: '项目空间', node_token: 't2' },
      { title: '会议纪要库', node_token: 't3' },
      { title: '群知识沉淀', node_token: 't4' },
      { title: '公司待办看板', node_token: 't5' },
      { title: 'OKR / 战略目标', node_token: 't6' },
      { title: '制度 / SOP / FAQ', node_token: 't7' },
    ],
    t1: [
      { title: '公司战略与年度目标', node_token: 't1a' },
      { title: '重要决策记录 Decision Log', node_token: 't1b' },
      { title: '组织架构与成员', node_token: 't1c' },
    ],
  };
  const r = await buildScaffoldReport({}, makeDeps({ nodesByParent }));
  assert.equal(r.status, 'complete');
  assert.equal(r.exitCode, 0);
  assert.equal(r.scaffold.missing, 0);
});

test('骨架部分缺失 → incomplete, exit 1，含缺失节点清单', async () => {
  // 只建了顶层 2 个，其余全缺。
  const nodesByParent = {
    __root__: [
      { title: '公司总览', node_token: 't1' },
      { title: '会议纪要库', node_token: 't3' },
    ],
  };
  const r = await buildScaffoldReport({}, makeDeps({ nodesByParent }));
  assert.equal(r.status, 'incomplete');
  assert.equal(r.exitCode, 1);
  assert.ok(r.scaffold.missing > 0);
  assert.ok(r.scaffold.missingNodes.includes('OKR / 战略目标'));
});
