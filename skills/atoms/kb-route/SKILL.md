---
name: kb-route
description: 原子·路由幂等 + 覆盖保护。按 source_id 查路由台账、决定写/更新/跳过；更新前比对目标当前内容防止静默覆盖人工修改（conflict）。读写台账经 feishu-shared/base-crud（分页 + record_id 守护）。供知识库线写入前后调用。
---

# kb-route · 路由幂等 + 覆盖保护（原子）

`src/route-io.js`。`ctx = { appToken, routeTableId, profile?, lark? }`。

- `querySource(ctx, sourceId)` / `queryByKind(ctx, kind)` — 查台账（分页取尽）。
- `decideRoute(existing, newContent, currentTargetContent?)` — 纯函数，定 `write|update|skip|conflict`：
  - 内容指纹未变 → skip；变了 → update；
  - **覆盖保护（#11）**：若目标当前内容 ≠ 上次写入指纹（target_content_hash，缺则用 content_hash 兜底）→ `conflict`，**不自动覆盖**，转发起人确认。读不到目标内容则跳过该检查（向后兼容）。
- `recordRoute(ctx, decision, meta, status)` — 写成功后回写 locator/content_hash/target_content_hash/status/time。

路由表字段：source_*、target_*、content_hash、**target_content_hash**、status（含 conflict）、last_synced_at（见 setup-route-base）。
