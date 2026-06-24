// 骨架体检（问题4-c）：只读检测"知识空间是否存在 + 标准骨架是否齐全"，产出机器可读报告 + exit code，
// 供部署脚本 / cron / webhook 无人值守调用（如 `node bin/init.js check-scaffold && echo ok || 补建`）。
//
// 与 health 意图的分工：health 意图给"人话报告"（发给用户看）；check-scaffold 给"机器可读 JSON + exit code"
// （给脚本判断）。两者复用同一组探测（health.probeLive + kb-scaffold.scaffoldStatus），不重复造轮子。
//
// **关键：只读**。不能用 kb-scaffold.ensureSpace（它在缺失时会 `wiki +space-create` 建空间）——
//   体检命令绝不应有副作用。故走 listWikiSpaces + findSpaceByName 的只读路径；缺空间只报 no_space，不建。
import { probeLive } from '../../feishu-shared/src/health.js';
import { listWikiSpaces } from '../../feishu-shared/src/doc.js';
import {
  DEFAULT_SPACE_NAME, findSpaceByName, collectExistingTitles, scaffoldStatus,
} from '../../atoms/kb-scaffold/src/scaffold.js';

// 状态 → exit code 约定（便于脚本：0=无需动作；1=需补建；2=被阻塞/出错）。
export const SCAFFOLD_EXIT = { complete: 0, incomplete: 1, no_space: 1, unauthorized: 2, error: 2 };

/**
 * 只读编排：产出骨架体检报告。可注入 deps 便于单测（probe/listSpaces/listNodes）。
 * @param ctx { profile?, spaceName? }
 * @param deps.probe        默认 health.probeLive
 * @param deps.listSpaces   默认 doc.listWikiSpaces
 * @param deps.listNodes    透传给 collectExistingTitles（默认 doc.listWikiNodes）
 * @returns {{status, exitCode, message, checks?, spaceId?, scaffold?}}
 */
export async function buildScaffoldReport(ctx = {}, { probe = probeLive, listSpaces = listWikiSpaces, listNodes } = {}) {
  const profile = ctx.profile;
  const spaceName = ctx.spaceName || DEFAULT_SPACE_NAME;

  // 1. 活体探测：用户授权 + 知识空间存在性（人话 checklist 复用 health 的探测）。
  const checks = await probe({ profile });
  const authOk = !!checks.find((c) => /授权/.test(c.item))?.ok;
  if (!authOk) {
    return { status: 'unauthorized', exitCode: SCAFFOLD_EXIT.unauthorized, checks,
      message: '用户未授权（建/查 Wiki 需 --as user）。请管理员先 lark-cli auth login 授权后再体检。' };
  }

  // 2. 只读定位目标知识空间（按固定名精确匹配，不建）。
  const spaces = await listSpaces({ profile });
  const spaceId = findSpaceByName(spaces, spaceName);
  if (!spaceId) {
    return { status: 'no_space', exitCode: SCAFFOLD_EXIT.no_space, checks, spaceName,
      message: `知识空间「${spaceName}」不存在。跑冷启动（scaffold / initScaffold）一键建空间 + 标准骨架。` };
  }

  // 3. 递归收节点 → 对照标准树算完整度。
  const { titles } = await collectExistingTitles(spaceId, { profile, listNodes });
  const status = scaffoldStatus(titles);
  return {
    status: status.complete ? 'complete' : 'incomplete',
    exitCode: status.complete ? SCAFFOLD_EXIT.complete : SCAFFOLD_EXIT.incomplete,
    checks,
    spaceId,
    scaffold: {
      total: status.total, present: status.present, missing: status.missing,
      missingNodes: status.plan.map((p) => p.title),
    },
    message: status.complete
      ? `骨架齐全（${status.present}/${status.total} 节点）。`
      : `骨架缺 ${status.missing} 个节点（${status.present}/${status.total}）：${status.plan.map((p) => p.title).join('、')}。跑 initScaffold 幂等补建。`,
  };
}
