// 配置体检：检查书童运行所需的配置/授权/库是否就位，给"还差什么 + 人话指引"。
// checkConfig 纯函数（查 env）；probeLive 活体探测（可注入 run，便于单测）。
import { larkJson } from './larkcli.js';

/** 纯函数：检查环境变量是否就位。返回 [{item, ok, hint}]。 */
export function checkConfig(env = process.env) {
  return [
    { item: '收集线状态库 COLLECTOR_APP_TOKEN', ok: !!env.COLLECTOR_APP_TOKEN,
      hint: '跑 feishu-collector/bin/setup-base.js 建库，把输出的 token 写进此环境变量' },
    { item: '知识库台账 KB_APP_TOKEN', ok: !!env.KB_APP_TOKEN,
      hint: '跑 feishu-kb-maintainer/bin/setup-route-base.js 建库，把输出的 token 写进此环境变量' },
  ];
}

/** 活体探测（I/O，可注入 run）：用户授权状态、知识空间是否存在。返回 [{item, ok, hint}]。 */
export async function probeLive(ctx = {}, { run = larkJson } = {}) {
  const out = [];
  try {
    const st = await run(['auth', 'status'], { profile: ctx.profile });
    const u = st?.identities?.user;
    const ready = u?.status === 'ready' || u?.available === true;
    out.push({ item: '用户身份授权', ok: !!ready,
      hint: ready ? '' : '运行 lark-cli auth login --scope "…" 一次性授权（见设计 §8.3 全量 scope）' });
  } catch (e) {
    out.push({ item: '用户身份授权', ok: false, hint: `探测失败：${e.message}` });
  }
  try {
    const sp = await run(['wiki', '+space-list', '--format', 'json'], { profile: ctx.profile });
    const spaces = sp?.items || sp?.spaces || sp?.data?.items || [];
    out.push({ item: '知识库知识空间', ok: spaces.length > 0,
      hint: spaces.length ? '' : '还没有知识空间——用「搭知识库」让书童建标准骨架' });
  } catch (e) {
    out.push({ item: '知识库知识空间', ok: false, hint: `探测失败（可能缺 wiki scope）：${e.message}` });
  }
  return out;
}

/** 汇总：是否全部就位 + 缺失项。 */
export function summarize(checklist) {
  const missing = (checklist || []).filter((c) => !c.ok);
  return { allOk: missing.length === 0, missing };
}
