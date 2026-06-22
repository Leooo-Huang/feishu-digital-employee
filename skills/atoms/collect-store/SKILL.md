---
name: collect-store
description: 原子·收集线状态持久化。在飞书多维表格读写「任务表/槽位表」：建任务/建槽、按状态/责任人/任务查槽、查收集中任务、更新槽位与任务、幂等写槽位值。供 feishu-collector 编排器与 tick 调用。
---

# collect-store · 收集线状态库（原子）

`src/base-io.js`，基于 `feishu-shared/base-crud`（分页 + record_id 守护）。`ctx = { appToken, tasksTableId, slotsTableId, profile?, lark? }`。

- `createTask(ctx, fields)` / `createSlots(ctx, taskId, slots)` — 建记录，返回 record_id（解析不到即抛错，杜绝孤儿）。
- `querySlotsByStatus` / `querySlotsByAssignee` / `querySlotsByAssigneeAll`（跨任务）/ `querySlotsByTask`（全槽）/ `queryTasksByStatus` — 分页取尽。
- `updateSlotState` / `updateTaskState` — 改字段。
- `upsertSlotValue(ctx, slot, value)` — 幂等写值，**空值不覆盖**已有。
