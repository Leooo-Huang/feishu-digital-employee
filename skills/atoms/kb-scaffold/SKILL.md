---
name: kb-scaffold
description: 原子·知识库标准骨架建树。冷启动时一键搭出知识空间 + 标准节点树（公司总览/项目空间/会议纪要库/群知识沉淀/公司待办看板/OKR/制度SOP），让 kb-maintainer 的 routing 有落点。全程幂等：已存在则复用、缺失则补建，可反复运行不重复建。
---

# kb-scaffold · 知识库标准骨架（原子）

`src/scaffold.js`。`ctx = { profile? }`。空租户冷启动的**地基**：先有骨架节点，sink 才有落点。

## 纯函数（可单测）
- `STANDARD_TREE` — 标准节点树（顶层 7 类 + 公司总览 3 子页）。
- `planScaffold(existingTitles, tree?)` — 对比已存在标题，产出**待建清单**（幂等：已存在跳过）。
- `findSpaceByName(spaces, name)` — 从 `wiki +space-list` 结果按名精确匹配取 `space_id`。
- `scaffoldStatus(existingTitles, tree?)` — 算完整度 `{total, present, missing, complete, plan}`。
- `nodeItemsOf(res)` — 从 `wiki +node-list` 响应多路径容差取节点数组。

## 幂等 I/O（可注入 deps 便于单测）
- `ensureSpace(ctx, spaceName?, deps?)` — 知识空间存在则复用，缺则建（`wiki +space-create` 仅 `--as user` 且无去重，故 list-first 按名过滤）。返回 `{spaceId, existed}`。**有副作用（会建空间）——只读体检请勿调用，用 `findSpaceByName` 只读路径。**
- `collectExistingTitles(spaceId, deps?)` — 递归收全部层级节点（`has_child` 才下钻，带 visited 防环）。返回 `{titles, tokenByTitle}`；`tokenByTitle` 喂给 `createTree` 让子页挂到正确父节点。
- `createTree(ctx, spaceId, plan, deps?)` — 按待建清单建节点，先顶层后子级。
- `initScaffold(ctx, options?, deps?)` — 高级编排：`ensureSpace → collectExistingTitles → planScaffold → createTree`，完整冷启动建骨架。返回 `{spaceId, existed, status, created}`。

## 外部依赖
- `feishu-shared/src/doc.js`：`listWikiSpaces` / `createWikiSpace` / `listWikiNodes` / `createWikiNode`（均 `--as user`，wiki 是 user-scope 操作）。

## 上游 / 下游依赖
- **上游（谁调本原子）**：`feishu-init` 编排器——bot 入群/「搭知识库」时调 `initScaffold` 建骨架；`bin/init.js check-scaffold` 调只读纯函数体检完整度。
- **下游（谁依赖本原子的产物）**：`feishu-kb-maintainer`——其 routing 假设骨架节点已存在，缺则会议/群聊沉淀无落点。

## 文档依赖（设计来源）
`personal/产品体验审视-不足与改进.md` §3 重点 B1（自动搭知识库骨架，kb-maintainer 工作前提）、`personal/feishu-init-设计与计划.md`。
