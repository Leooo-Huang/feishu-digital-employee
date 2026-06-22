// 收工汇报（契约 #10）：判断任务是否该收工，生成未交名单与汇报文案。纯函数。
// I/O（群发汇报、置任务「已完成」）由编排器 tick 执行。缺失绝不编造——未交名单源自真实槽位状态。
const TERMINAL = new Set(['已填', '跳过', '不适用']); // 终结态
const SUBMITTED = '已填';
const EXCUSED = '不适用'; // 不适用=豁免，不计入未交

/**
 * 判断任务是否收工 + 生成汇报。纯函数，便于单测。
 * 触发：已到截止（expired）或全部槽位终结（all-done）。
 * @param task  { 标题?, 截止时间? }
 * @param slots 该任务全部槽位（含 状态/责任人原文/责任人open_id/字段名/对象）
 * @param now   Date
 * @returns {{shouldWrap:boolean, reason?:'expired'|'all-done', unfilled?:Array, filled?:number, total?:number, report?:string}}
 */
export function planWrapup(task, slots, now) {
  const deadline = new Date(task.截止时间 ?? task.deadline ?? '');
  const expired = !Number.isNaN(deadline.getTime()) && (deadline.getTime() - now.getTime()) <= 0;
  const allTerminal = slots.length > 0 && slots.every((s) => TERMINAL.has(s.状态));
  if (!expired && !allTerminal) return { shouldWrap: false };
  const total = slots.length;
  const filled = slots.filter((s) => s.状态 === SUBMITTED).length;
  // 未交名单：非「已填」且非「不适用」（「跳过」=到期未交，计入未交）。
  const unfilled = slots.filter((s) => s.状态 !== SUBMITTED && s.状态 !== EXCUSED);
  const reason = (allTerminal && !expired) ? 'all-done' : 'expired';
  return { shouldWrap: true, reason, unfilled, filled, total, report: buildReport(task, { filled, total, unfilled, reason }) };
}

/** 生成完成汇报文案（含未交名单）。纯函数。 */
export function buildReport(task, { filled, total, unfilled, reason }) {
  const title = task.标题 || '收集任务';
  const head = reason === 'all-done'
    ? `✅ 收集任务【${title}】已全部收齐`
    : `⏰ 收集任务【${title}】已到截止`;
  const lines = [`${head}，已收 ${filled}/${total}。`];
  if (unfilled.length) {
    lines.push('未交名单：');
    for (const s of unfilled) {
      const who = s.责任人原文 || s.对象 || '（待认领）';
      lines.push(`· ${who} — ${s.字段名 || ''}`.trimEnd());
    }
  } else {
    lines.push('全部已交，无遗漏。');
  }
  return lines.join('\n');
}
