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
  const argv = ['docs', '+fetch', '--doc', docToken, '--detail', detail,
    '--doc-format', docFormat, '--scope', scope, '--api-version', 'v2', '--as', 'user', '--format', 'json'];
  if (keyword) argv.push('--keyword', keyword);
  if (startBlockId) argv.push('--start-block-id', startBlockId);
  return larkJson(argv, { profile });
}

/** 在文档末尾追加一段（会议纪要/群聊沉淀/周报追加用）。content 已由调用方按 lark-doc 规则备好。 */
export async function appendDoc(docToken, content, { profile, docFormat = 'markdown' } = {}) {
  return larkJson(['docs', '+update', '--doc', docToken, '--command', 'append',
    '--content', content, '--doc-format', docFormat, '--api-version', 'v2',
    '--as', 'user', '--format', 'json'], { profile });
}

/** 在指定 block 之后插入（按小节标题 block_id 定位，不破坏其它小节）。 */
export async function insertAfterBlock(docToken, blockId, content, { profile, docFormat = 'markdown' } = {}) {
  return larkJson(['docs', '+update', '--doc', docToken, '--command', 'block_insert_after',
    '--block-id', blockId, '--content', content, '--doc-format', docFormat, '--api-version', 'v2',
    '--as', 'user', '--format', 'json'], { profile });
}

/** 覆盖替换指定 block（幂等更新落点：content_hash 变化时按 target_locator=block_id 覆盖）。 */
export async function replaceBlock(docToken, blockId, content, { profile, docFormat = 'markdown' } = {}) {
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

export { lark };
