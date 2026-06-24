// 知识库骨架（原子）。冷启动时一键搭出标准节点树，让 kb-maintainer 的 routing 有落点。
// 树结构 + planScaffold/findSpaceByName/nodeItemsOf/scaffoldStatus 是纯函数（可单测）；
// ensureSpace/collectExistingTitles/createTree/initScaffold 是幂等 I/O（复用 feishu-shared/doc，可注入 deps 便于单测）。
import { createWikiNode, listWikiSpaces, createWikiSpace, listWikiNodes } from '../../../feishu-shared/src/doc.js';

// 默认知识空间名。冷启动按此名 list-first 去重（wiki +space-create 本身无去重，固定名避免建重）。
export const DEFAULT_SPACE_NAME = '公司知识库';

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

// ── 知识空间存在性检测 + 骨架完整度（问题4：空租户连知识空间都没有）──

/** 纯函数：从 wiki +space-list 的 items 里按名精确匹配，返回该空间 space_id（无则 undefined）。 */
export function findSpaceByName(spaces = [], name) {
  const hit = (spaces || []).find((s) => (s.name || s.space_name) === name);
  return hit ? (hit.space_id || hit.spaceId || hit.id) : undefined;
}

/** 纯函数：从 wiki +node-list 响应里取节点数组（多路径容差）。 */
export function nodeItemsOf(res) {
  return res?.items || res?.nodes || res?.data?.items || [];
}

/**
 * 纯函数：对照标准树算骨架完整度。
 * @returns {total, present, missing, complete, plan}
 */
export function scaffoldStatus(existingTitles = [], tree = STANDARD_TREE) {
  const total = tree.reduce((n, node) => n + 1 + (node.children?.length || 0), 0);
  const plan = planScaffold(existingTitles, tree);
  return { total, present: total - plan.length, missing: plan.length, complete: plan.length === 0, plan };
}

/**
 * 幂等 I/O：检测知识空间存在则复用，不存在才建（wiki +space-create 仅 --as user 且无去重，故先 list 按名过滤）。
 * 注意：幂等只对"串行重跑"成立。并发触发（同时两个入群事件）或历史已误建同名空间时，
 * 仍可能重复建/选中空壳——冷启动是管理员一次性动作，并发罕见；同名空间需人工 wiki +delete-space 清理。
 * @param ctx { profile? }
 * @param spaceName 目标空间名（默认 DEFAULT_SPACE_NAME，固定名避免建重）
 * @param deps.listSpaces / deps.createSpace 注入点（默认 doc.listWikiSpaces / doc.createWikiSpace）
 * @returns {{spaceId, existed}}
 */
export async function ensureSpace(ctx = {}, spaceName = DEFAULT_SPACE_NAME, { listSpaces = listWikiSpaces, createSpace = createWikiSpace } = {}) {
  const spaces = await listSpaces({ profile: ctx.profile });
  const existing = findSpaceByName(spaces, spaceName);
  if (existing) return { spaceId: existing, existed: true };
  const { spaceId } = await createSpace(spaceName, { profile: ctx.profile });
  return { spaceId, existed: false };
}

/**
 * 幂等 I/O：递归收集知识空间内全部层级的节点（has_child 才下钻），返回 {titles, tokenByTitle}。
 * 必须收子级，否则只比顶层会把公司总览的 3 个子页误判为"待建"而重复建。
 * tokenByTitle 喂给 createTree 的 parentTokens——**关键**：部分补建时（父节点已存在、子页缺失），
 * 子页才能挂到已存在父节点下，而不是错建到顶层。
 * 带 visited 去重防环（正常 Wiki 是树，但防御分页异常导致的自引用无限递归）。
 * @param deps.listNodes 注入点（默认 doc.listWikiNodes）
 */
export async function collectExistingTitles(spaceId, { profile, listNodes = listWikiNodes } = {}) {
  const titles = [];
  const tokenByTitle = {};
  const visited = new Set();
  async function walk(parentNodeToken, depth) {
    if (depth > 20) return; // 深度兜底：防异常响应导致的过深/无限下钻
    const res = await listNodes(spaceId, { profile, parentNodeToken });
    for (const it of nodeItemsOf(res)) {
      const token = it.node_token || it.nodeToken;
      if (it.title) { titles.push(it.title); if (token) tokenByTitle[it.title] = token; }
      if (it.has_child && token && !visited.has(token)) { visited.add(token); await walk(token, depth + 1); }
    }
  }
  await walk(undefined, 0);
  return { titles, tokenByTitle };
}

/**
 * 高级编排（幂等）：完整冷启动建骨架。ensureSpace → collectExistingTitles → planScaffold → createTree。
 * @param ctx { profile? }
 * @param options.spaceName / options.tree
 * @param deps 透传给 ensureSpace / collectExistingTitles / createTree（listSpaces/createSpace/listNodes/create）
 * @returns {{spaceId, existed, status, created}}
 */
export async function initScaffold(ctx = {}, { spaceName = DEFAULT_SPACE_NAME, tree = STANDARD_TREE } = {}, deps = {}) {
  const { spaceId, existed } = await ensureSpace(ctx, spaceName, deps);
  const { titles, tokenByTitle } = await collectExistingTitles(spaceId, { profile: ctx.profile, listNodes: deps.listNodes });
  const status = scaffoldStatus(titles, tree);
  // 把已存在父节点的 token 透传给 createTree，部分补建时子页才挂得到正确父节点（不错建到顶层）。
  const created = status.plan.length ? await createTree(ctx, spaceId, status.plan, { ...deps, parentTokens: tokenByTitle }) : [];
  return { spaceId, existed, status, created };
}
