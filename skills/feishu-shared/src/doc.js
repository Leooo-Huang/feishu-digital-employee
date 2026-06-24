// 知识库文档写入：docs / wiki 域。命令面经实测校准 (lark-cli 1.0.53)。
//   wiki +node-get --node-token <wikcn|docx|URL> [--obj-type docx] --as user --format json
//       拿 Wiki 节点详情，从中取 obj_token（docx document_id）后才能用 docs +update 写正文。
//   docs +fetch --doc <token> --detail with-ids --doc-format markdown --scope outline|keyword|section
//       --as user --format json   读文档（取 block_id 用于精确替换；优先局部 scope，别全量）。
//   docs +update --doc <token> --command append|block_insert_after|block_replace|str_replace
//       --block-id <b> --content <内容> --doc-format markdown --api-version v2 --as user --format json
//
// ⚠️ 写 --content 前宿主 LLM 必须先 `lark-cli skills read lark-doc references/lark-doc-update.md`
//    和 `references/lark-doc-md.md`，按其规则构造内容（Markdown 行首 # + - > | 需转义；XML 标签会生效）。
//    本模块只做命令编排与防御性解析，内容由调用方按上述规则备好。
// ⚠️ 写回保护（设计 §7.6）：403 不静默失败——larkcli.lark 已把 stderr 包进抛错，调用方据此提示加协作者。
import { lark, larkJson } from './larkcli.js';

function pickFirst(obj, paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v != null) return v;
  }
  return undefined;
}

/**
 * 解析 Wiki 节点 → 正文文档 token（docx document_id）。
 * @param nodeToken wiki node_token / obj_token / Lark URL
 * @returns {{docToken, objType, raw}}
 */
export async function resolveWikiNode(nodeToken, { profile, objType } = {}) {
  if (!nodeToken) throw new Error('wiki +node-get 缺 node-token');
  const argv = ['wiki', '+node-get', '--node-token', nodeToken, '--as', 'user', '--format', 'json'];
  if (objType) argv.push('--obj-type', objType);
  const res = await larkJson(argv, { profile });
  const node = res?.node || res?.data?.node || res;
  return {
    docToken: pickFirst({ node, res }, ['node.obj_token', 'res.obj_token', 'res.data.node.obj_token']),
    objType: pickFirst({ node, res }, ['node.obj_type', 'res.obj_type', 'res.data.node.obj_type']),
    raw: res,
  };
}

/**
 * 读文档（取 block_id 做精确定位）。默认 outline scope（轻量）；keyword/section/range 见 docs +fetch --help。
 */
export async function fetchDoc(docToken, { profile, scope = 'outline', keyword, startBlockId, detail = 'with-ids', docFormat = 'markdown' } = {}) {
  if (!docToken) throw new Error('docs +fetch 缺 doc token');
  const argv = ['docs', '+fetch', '--doc', docToken, '--detail', detail,
    '--doc-format', docFormat, '--scope', scope, '--api-version', 'v2', '--as', 'user', '--format', 'json'];
  if (keyword) argv.push('--keyword', keyword);
  if (startBlockId) argv.push('--start-block-id', startBlockId);
  return larkJson(argv, { profile });
}

/** 在文档末尾追加一段（会议纪要/群聊沉淀/周报追加用）。content 已由调用方按 lark-doc 规则备好。 */
export async function appendDoc(docToken, content, { profile, docFormat = 'markdown' } = {}) {
  if (!docToken) throw new Error('docs +update(append) 缺 doc token');
  if (content == null || String(content).trim() === '') throw new Error('docs +update(append) 内容为空，拒绝写空（缺失不编造）');
  return larkJson(['docs', '+update', '--doc', docToken, '--command', 'append',
    '--content', content, '--doc-format', docFormat, '--api-version', 'v2',
    '--as', 'user', '--format', 'json'], { profile });
}

/** 在指定 block 之后插入（按小节标题 block_id 定位，不破坏其它小节）。 */
export async function insertAfterBlock(docToken, blockId, content, { profile, docFormat = 'markdown' } = {}) {
  if (!docToken || !blockId) throw new Error('docs +update(block_insert_after) 缺 doc token 或 block-id');
  if (content == null || String(content).trim() === '') throw new Error('docs +update(block_insert_after) 内容为空，拒绝写空');
  return larkJson(['docs', '+update', '--doc', docToken, '--command', 'block_insert_after',
    '--block-id', blockId, '--content', content, '--doc-format', docFormat, '--api-version', 'v2',
    '--as', 'user', '--format', 'json'], { profile });
}

/** 覆盖替换指定 block（幂等更新落点：content_hash 变化时按 target_locator=block_id 覆盖）。 */
export async function replaceBlock(docToken, blockId, content, { profile, docFormat = 'markdown' } = {}) {
  if (!docToken || !blockId) throw new Error('docs +update(block_replace) 缺 doc token 或 block-id');
  if (content == null || String(content).trim() === '') throw new Error('docs +update(block_replace) 内容为空，拒绝写空');
  return larkJson(['docs', '+update', '--doc', docToken, '--command', 'block_replace',
    '--block-id', blockId, '--content', content, '--doc-format', docFormat, '--api-version', 'v2',
    '--as', 'user', '--format', 'json'], { profile });
}

/** 在 Wiki 知识空间下建文档节点（骨架补建用）。obj-type 默认 docx。 */
export async function createWikiNode({ title, spaceId, parentNodeToken, objType = 'docx' }, { profile } = {}) {
  const argv = ['wiki', '+node-create', '--title', title, '--obj-type', objType,
    '--node-type', 'origin', '--as', 'user', '--format', 'json'];
  if (spaceId) argv.push('--space-id', spaceId);
  if (parentNodeToken) argv.push('--parent-node-token', parentNodeToken);
  return larkJson(argv, { profile });
}

// ── Wiki 知识空间/节点封装（冷启动自动建骨架用，实测 lark-cli 1.0.56）──
// wiki +space-list 默认单页(50条)，须 --page-all 才不漏判；space-create 仅 --as user 且无去重；
// node-list 列顶层节点（给 --parent-node-token 则列其子级）。

/** 列出当前身份可见的全部知识空间（--page-all）。返回 items[]，每项含 {space_id, name}。 */
export async function listWikiSpaces({ profile } = {}) {
  const res = await larkJson(['wiki', '+space-list', '--page-all', '--as', 'user', '--format', 'json'], { profile });
  return res?.items || res?.spaces || res?.data?.items || [];
}

/** 建知识空间（仅 --as user）。返回 {spaceId, raw}；spaceId 防御性多路径解析。 */
export async function createWikiSpace(name, { profile, description } = {}) {
  if (!name) throw new Error('wiki +space-create 缺 --name（未命名空间几乎必是误建）');
  const argv = ['wiki', '+space-create', '--name', name, '--as', 'user', '--format', 'json'];
  if (description) argv.push('--description', description);
  const res = await larkJson(argv, { profile });
  const spaceId = pickFirst(res, ['space.space_id', 'space_id', 'data.space.space_id', 'data.space_id']);
  if (!spaceId) throw new Error(`wiki +space-create 未拿到 space_id：${JSON.stringify(res).slice(0, 300)}`);
  return { spaceId, raw: res };
}

/** 列知识空间内节点（--page-all）。省略 parentNodeToken=顶层；给则列该节点子级。返回原始响应。 */
export async function listWikiNodes(spaceId, { profile, parentNodeToken } = {}) {
  if (!spaceId) throw new Error('wiki +node-list 缺 space-id');
  const argv = ['wiki', '+node-list', '--space-id', spaceId, '--page-all', '--as', 'user', '--format', 'json'];
  if (parentNodeToken) argv.push('--parent-node-token', parentNodeToken);
  return larkJson(argv, { profile });
}

export { lark };
