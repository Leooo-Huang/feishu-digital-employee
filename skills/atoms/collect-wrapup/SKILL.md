---
name: collect-wrapup
description: 原子·收工汇报。planWrapup(task, slots, now) 纯函数：判断任务是否到期或全部收齐，生成未交名单与完成汇报文案（缺失不编造）。群发汇报与置「已完成」的 I/O 由编排器执行。
---

# collect-wrapup · 收工汇报（原子）

`src/wrapup.js`，纯函数。

- `planWrapup(task, slots, now)` → `{ shouldWrap, reason:'expired'|'all-done', unfilled, filled, total, report }`。
  - 触发：已到截止，或全部槽位终结（已填/跳过/不适用）。
  - 未交名单 = 非「已填」且非「不适用」（「跳过」=到期未交，计入）。
  - `report` 含"已收 X/Y + 未交名单"，**只列真实槽位，缺失不编造**。
- `buildReport(task, {...})` — 单独的文案生成。

群发完成汇报（`feishu-shared/message`）、置任务「已完成」（`collect-store.updateTaskState`）由 `feishu-collector` tick 完成，任务级 idempotency-key 防重复发。
