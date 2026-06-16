// 幂等核心：内容指纹 + 写/跳过决策。纯函数，无副作用。
import { createHash } from 'node:crypto';

/** 归一化：trim + 折叠内部空白 + 小写，保证语义相同的值指纹一致 */
export function normalizeForHash(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 内容指纹：归一化后取 sha256 前 16 hex */
export function contentHash(value) {
  return createHash('sha256').update(normalizeForHash(value)).digest('hex').slice(0, 16);
}

/** 幂等决策：旧指纹为空（从未写）或与新值指纹不同 → 需要写 */
export function needsWrite(oldHash, newValue) {
  if (!oldHash) return true;
  return oldHash !== contentHash(newValue);
}
