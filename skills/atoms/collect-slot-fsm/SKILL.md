---
name: collect-slot-fsm
description: 原子·收集槽位状态机。nextSlotState(当前态, 事件) 做白名单合法迁移，非法迁移抛错。纯函数，无 I/O。供收集线推进槽位状态时调用。
---

# collect-slot-fsm · 槽位状态机（原子）

`src/state.js`，纯函数。导出 `SLOT_STATES` / `TASK_STATES` / `nextSlotState(current, event)`。

主路径：待问 → 已问 → 收到原始 → 清洗中 ⇄ 追问 → 待确认 ⇄ 改正 → 已填；
旁支：待澄清（人名待解析）、不适用、跳过（到期未交）。非法组合显式抛错，不静默吞。
