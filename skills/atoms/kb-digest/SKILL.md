---
name: kb-digest
description: 原子·周报素材选取。按时间窗从路由幂等台账筛出本周期的决策/待办/OKR 进展（纯函数，数值化时间比较）。查台账、拉群、写周报正文等 I/O 由编排器执行。
---

# kb-digest · 周报素材选取（原子）

`src/digest.js`，纯函数。

- `windowSinceMs(hours, now)` — 窗口起点毫秒时间戳。
- `recentRows(rows, sinceMs)` — 按 `last_synced_at` 数值化筛近期（兼容 ISO/毫秒/无效）。
- `selectRecent({doc,task,okr}, sinceMs)` — 三类分别筛。

I/O 编排在 `feishu-kb-maintainer/bin/digest.js`：`feishu-shared/chat.pullChats` 拉群 + `kb-route.queryByKind` 取台账 + 本原子选取近期；语言汇编（写周报正文）由宿主 LLM 调 `feishu-shared/doc.appendDoc`。
