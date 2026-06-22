// 催办挑选。纯函数：now 由调用方注入，便于测试。
const H = 3600 * 1000;

// 催办可挑选的状态（单一真相源，tick 据此查询，避免两份清单漂移）。
// 不含「收到原始」——那是"已答待清洗"，球在机器人侧，不应再催责任人。
export const NUDGE_STATES = ['待问', '已问', '清洗中', '待确认', '待澄清'];
const NUDGE_SET = new Set(NUDGE_STATES);

/**
 * 返回需要催办的槽位（附 urgent 标记）。
 * @param slots 槽位数组（字段同设计 §2：状态/最近询问时间/追问次数）
 * @param task  { deadline, reminderIntervalH, maxAttempts }
 * @param now   Date
 */
export function selectSlotsToNudge(slots, task, now) {
  const deadline = new Date(task.deadline);
  const validDeadline = !Number.isNaN(deadline.getTime());
  // 无效/缺失截止：按间隔正常催，但无法判定 urgent/过期（过期收工交 collect-wrapup）。
  const hoursToDeadline = validDeadline ? (deadline - now) / H : Infinity;
  if (hoursToDeadline < 0) return []; // 已过期 → 交收工逻辑，不在此催
  const urgent = validDeadline && hoursToDeadline <= 6;
  return slots.filter((s) => {
    if (!NUDGE_SET.has(s.状态)) return false;
    if ((Number(s.追问次数) || 0) >= task.maxAttempts) return false;
    const last = s.最近询问时间 ? new Date(s.最近询问时间) : new Date(0);
    return (now - last) / H >= task.reminderIntervalH;
  }).map((s) => ({ ...s, urgent }));
}
