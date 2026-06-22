// 知识库骨架（原子）。冷启动时一键搭出标准节点树，让 kb-maintainer 的 routing 有落点。
// 树结构 + planScaffold 是纯函数（可单测）；createTree 是幂等 I/O（复用 feishu-shared/doc.createWikiNode，可注入）。
import { createWikiNode } from '../../../feishu-shared/src/doc.js';

// 标准节点树（见设计 §2.1）。children 为该节点下应预建的子页；项目空间/会议纪要库/群知识沉淀为容器，子页动态加。
export const STANDARD_TREE = [
  { title: '公司总览', children: ['公司战略与年度目标', '重要决策记录 Decision Log', '组织架构与成员'] },
  { title: '项目空间', children: [] },
  { title: '会议纪要库', children: [] },
  { title: '群知识沉淀', children: [] },
  { title: '公司待办看板', children: [] },
  { title: 'OKR / 战略目标', children: [] },
  { title: '制度 / SOP / FAQ', children: [] },
];

/**
 * 纯函数：对比知识空间里已存在的节点标题，产出**待建清单**（幂等：已存在的跳过，可反复运行）。
 * @param existingTitles 已存在节点标题数组
 * @returns Array<{title, parent}>  parent=null 为顶层，否则为父节点标题
 */
export function planScaffold(existingTitles = [], tree = STANDARD_TREE) {
  const have = new Set(existingTitles);
  const plan = [];
  for (const node of tree) {
    if (!have.has(node.title)) plan.push({ title: node.title, parent: null });
    for (const child of node.children || []) {
      if (!have.has(child)) plan.push({ title: child, parent: node.title });
    }
  }
  return plan;
}

function pickNodeToken(res) {
  return res?.node?.node_token || res?.node_token || res?.data?.node?.node_token || res?.data?.node_token;
}

/**
 * 幂等建树：对待建清单逐个建节点；先顶层后子级（子级需父节点 token）。
 * @param ctx { profile? }
 * @param spaceId 知识空间 id
 * @param plan planScaffold 的返回
 * @param deps.create 注入点（默认 doc.createWikiNode），便于单测
 * @param deps.parentTokens 已存在父节点的 {标题: node_token}（幂等再跑时，子级可挂到已存在父）
 * @returns Array<{title, parent, nodeToken}>
 */
export async function createTree(ctx, spaceId, plan, { create = createWikiNode, parentTokens = {} } = {}) {
  const tokenByTitle = { ...parentTokens };
  const created = [];
  const ordered = [...plan.filter((p) => !p.parent), ...plan.filter((p) => p.parent)];
  for (const node of ordered) {
    const parentNodeToken = node.parent ? tokenByTitle[node.parent] : undefined;
    const res = await create({ title: node.title, spaceId, parentNodeToken, objType: 'docx' }, { profile: ctx.profile });
    const nodeToken = pickNodeToken(res);
    if (nodeToken) tokenByTitle[node.title] = nodeToken;
    created.push({ title: node.title, parent: node.parent, nodeToken });
  }
  return created;
}
