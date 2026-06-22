// 人名解析：把人名/邮箱解析成飞书用户候选。命令：contact +search-user（须 --as user）。
import { larkJson } from './larkcli.js';

function pickUsers(res) {
  return res?.users || res?.items || res?.data?.users || res?.data?.items || [];
}

/**
 * @returns {Promise<{status:'unique'|'ambiguous'|'none', candidates:Array<{open_id,name}>}>}
 *   unique→直接用；ambiguous→交 LLM/发起人消歧；none→标 待澄清
 */
export async function resolvePerson(raw, { profile } = {}) {
  const res = await larkJson(['contact', '+search-user', '--query', String(raw), '--as', 'user', '--json'],
    { profile });
  const candidates = pickUsers(res).map((u) => ({ open_id: u.open_id, name: u.name }));
  if (candidates.length === 1) return { status: 'unique', candidates };
  if (candidates.length === 0) return { status: 'none', candidates };
  return { status: 'ambiguous', candidates };
}
