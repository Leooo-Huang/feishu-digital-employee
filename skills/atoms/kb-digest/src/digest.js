// 周报素材选取（纯函数）。按时间窗从路由幂等台账记录里筛本周期素材。
// I/O（查台账 queryByKind、拉群、写周报正文）由编排器 bin/digest.js 执行。
// 时间用数值化比较，兼容 ISO 字符串 / 毫秒数读回，避免字符串字典序误判。

/** 窗口起点（毫秒时间戳）：now 往前 hours 小时。 */
export function windowSinceMs(hours, now) {
  return now.getTime() - hours * 3600 * 1000;
}

/** 从一组台账记录里筛出 last_synced_at >= sinceMs 的（无效时间值丢弃）。 */
export function recentRows(rows, sinceMs) {
  return (rows || []).filter((r) => {
    const t = new Date(r?.last_synced_at).getTime();
    return !Number.isNaN(t) && t >= sinceMs;
  });
}

/** 按 doc/task/okr 三类分别筛近期素材。 */
export function selectRecent({ doc = [], task = [], okr = [] } = {}, sinceMs) {
  return { doc: recentRows(doc, sinceMs), task: recentRows(task, sinceMs), okr: recentRows(okr, sinceMs) };
}
