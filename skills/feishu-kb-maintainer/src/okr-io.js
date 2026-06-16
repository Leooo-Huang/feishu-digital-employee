// 原生 OKR I/O：okr 域。命令面经实测校准 (lark-cli 1.0.53)：
//   okr +progress-create --target-id <obj|kr id> --target-type objective|key_result
//       --content <ContentBlock JSON|@file|->  [--progress-percent N --progress-status normal|overdue|done]
//       [--source-title <显示标题> --source-url <来源链接>] --as user --format json   挂 KR 进展。
//       dry-run 实测需 scope okr:okr.progress:writeonly。
//   okr +progress-list --target-id <id> --target-type objective|key_result --as user --format json   读进展。
//   okr +cycle-list [--user-id <id> --time-range YYYY-MM--YYYY-MM] --as user --format json   列用户周期（取 cycle_id）。
//   okr +cycle-detail --cycle-id <id> --as user --format json   读周期下 Objective/KeyResult（按周镜像源）。
//
// ContentBlock 富文本格式（实测 lark-okr references/lark-okr-contentblock.md）：
//   { blocks:[ { block_element_type:'paragraph',
//                paragraph:{ elements:[ { paragraph_element_type:'textRun',
//                                         text_run:{ text:'进展文字' } } ] } } ] }
// ⚠️ 响应路径待真机校准：cycle/progress 各字段确切路径以实测为准，下方做防御性解析。
import { larkJson } from './larkcli.js';

function pickList(res, keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, kk) => (o == null ? o : o[kk]), res);
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** 纯函数：把一行进展文字包成 OKR ContentBlock（progress 内容字段格式）。 */
export function progressContentBlock(text) {
  return JSON.stringify({
    blocks: [{
      block_element_type: 'paragraph',
      paragraph: { elements: [{ paragraph_element_type: 'textRun', text_run: { text: String(text) } }] },
    }],
  });
}

/**
 * 给某 KR/Objective 写一条进展记录。
 * @param p { targetId, targetType:'key_result'|'objective', text, percent?, status?, sourceTitle?, sourceUrl? }
 */
export async function createProgress(p, { profile } = {}) {
  const argv = ['okr', '+progress-create', '--target-id', p.targetId,
    '--target-type', p.targetType, '--content', progressContentBlock(p.text),
    '--as', 'user', '--format', 'json'];
  if (p.percent != null && p.status) argv.push('--progress-percent', String(p.percent), '--progress-status', p.status);
  if (p.sourceTitle) argv.push('--source-title', p.sourceTitle);
  if (p.sourceUrl) argv.push('--source-url', p.sourceUrl);
  return larkJson(argv, { profile });
}

/** 列某目标/KR 的进展（去重/镜像用） */
export async function listProgress(targetId, targetType, { profile } = {}) {
  const res = await larkJson(['okr', '+progress-list', '--target-id', targetId,
    '--target-type', targetType, '--as', 'user', '--format', 'json'], { profile });
  return pickList(res, ['progress_list', 'items', 'data.progress_list', 'data.items']);
}

/** 列用户 OKR 周期（取 cycle_id 供 cycle-detail） */
export async function listCycles({ userId, timeRange } = {}, { profile } = {}) {
  const argv = ['okr', '+cycle-list', '--as', 'user', '--format', 'json'];
  if (userId) argv.push('--user-id', userId);
  if (timeRange) argv.push('--time-range', timeRange);
  const res = await larkJson(argv, { profile });
  return pickList(res, ['cycle_list', 'items', 'data.cycle_list', 'data.items']);
}

/** 读某周期下全部 Objective/KeyResult（按周镜像汇总页的源数据） */
export async function cycleDetail(cycleId, { profile } = {}) {
  return larkJson(['okr', '+cycle-detail', '--cycle-id', cycleId,
    '--as', 'user', '--format', 'json'], { profile });
}
