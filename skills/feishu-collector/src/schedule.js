// 催办挑选。纯函数：now 由调用方注入，便于测试。
const H = 3600 * 1000;
const OPEN = new Set(['待问', '已问', '收到原始', '清洗中', '待确认', '待澄清']); // 未终结=未填

/**
 * 返回需要催办的槽位（附 urgent 标记）。
 * @param slots 槽位数组（字段同设计 §2：状态/最近询问时间/追问次数）
 * @param task  { deadline, reminderIntervalH, maxAttempts }
 * @param now   Date
 */
export function selectSlotsToNudge(slots, task, now) {
  const deadline = new Date(task.deadline);
  const hoursToDeadline = (deadline - now) / H;
  if (hoursToDeadline < 0) return []; // 已过期由 tick 走收工逻辑，不在此催
  const urgent = hoursToDeadline <= 6;
  return slots.filter((s) => {
    if (!OPEN.has(s.状态)) return false;
    if ((s.追问次数 ?? 0) >= task.maxAttempts) return false;
    const last = s.最近询问时间 ? new Date(s.最近询问时间) : new Date(0);
    return (now - last) / H >= task.reminderIntervalH;
  }).map((s) => ({ ...s, urgent }));
}
