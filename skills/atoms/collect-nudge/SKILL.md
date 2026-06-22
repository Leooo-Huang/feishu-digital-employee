---
name: collect-nudge
description: 原子·催办挑选。selectSlotsToNudge(slots, task, now) 纯函数：挑出超间隔未填、未达 maxAttempts 的槽位，并对临近截止（<6h）打 urgent 标记。导出 NUDGE_STATES 作为"可催状态"单一真相源。发送由编排器经 feishu-shared/message 群内 @ 责任人执行。
---

# collect-nudge · 催办挑选（原子）

`src/schedule.js`，纯函数。

- `NUDGE_STATES` — 可催状态集合（待问/已问/清洗中/待确认/待澄清；**不含「收到原始」**，那是已答待清洗）。tick 据此查询，避免两份清单漂移。
- `selectSlotsToNudge(slots, { deadline, reminderIntervalH, maxAttempts }, now)` — 返回需催的槽位（附 `urgent`）。无效/缺失截止 → 按间隔照常催、不 urgent、不当永不到期。

实际发送（群内 @）、加急上限、收工，由 `feishu-collector` 编排器在 tick 里完成。
