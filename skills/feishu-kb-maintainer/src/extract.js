// 确定性抽取辅助：宿主 LLM（按 SKILL.md）做语言抽取，本模块只对其结构化输出
// 做归一化 / 去重 / 指纹。纯函数，无 LLM、无 lark-cli 调用、无副作用。
//
// 宿主 LLM 抽取出的「要点」统一形状：
//   { kind: 'decision'|'todo'|'conclusion'|'faq'|'progress', text, owner?, due?, krId? }
// 各沉淀线把 LLM 输出喂给 normalizeItems → 得到去重后、带 fingerprint 的要点，
// 再交路由层（route-io）按 fingerprint/content_hash 决定 upsert/skip。
import { contentHash, normalizeForHash } from './hash.js';

export const ITEM_KINDS = ['decision', 'todo', 'conclusion', 'faq', 'progress'];

/** 折叠空白并 trim，保留原始大小写用于展示（指纹另走 normalizeForHash） */
function squish(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 归一化单条要点：清洗文本字段、限定 kind 合法、附 fingerprint。
 * @returns {{kind,text,owner,due,krId,fingerprint}} 文本为空时返回 null（由调用方过滤）
 */
export function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const text = squish(item.text);
  if (!text) return null;
  const kind = ITEM_KINDS.includes(item.kind) ? item.kind : 'conclusion';
  const owner = item.owner != null ? squish(item.owner) : '';
  const due = item.due != null ? squish(item.due) : '';
  const krId = item.krId != null ? squish(item.krId) : '';
  // 指纹只取语义负载（kind + 归一化 text + owner + due + krId），
  // 与展示文本解耦，保证同一要点重复抽取得到同一 fingerprint。
  const payload = [kind, normalizeForHash(text), normalizeForHash(owner),
    normalizeForHash(due), normalizeForHash(krId)].join('|');
  return { kind, text, owner, due, krId, fingerprint: contentHash(payload) };
}

/**
 * 批量归一化 + 去重：丢弃空要点，按 fingerprint 去重（保留首次出现）。
 * @param items 宿主 LLM 抽取的要点数组
 * @returns 去重后的要点数组（每条带 fingerprint）
 */
export function normalizeItems(items) {
  const out = [];
  const seen = new Set();
  for (const raw of items || []) {
    const it = normalizeItem(raw);
    if (!it) continue;
    if (seen.has(it.fingerprint)) continue;
    seen.add(it.fingerprint);
    out.push(it);
  }
  return out;
}

/** 按 kind 分桶（路由层按 kind 决定写到 doc/task/okr/Decision Log） */
export function groupByKind(items) {
  const buckets = Object.fromEntries(ITEM_KINDS.map((k) => [k, []]));
  for (const it of items) (buckets[it.kind] ||= []).push(it);
  return buckets;
}

/**
 * 把一组归一化要点拼成一个稳定的「沉淀段落指纹」。
 * 群聊沉淀小节/会议纪要段按整段去重时用：要点集合相同 → 段落指纹相同 → skip。
 */
export function sectionFingerprint(items) {
  const joined = items.map((it) => it.fingerprint).sort().join('|');
  return contentHash(joined);
}
