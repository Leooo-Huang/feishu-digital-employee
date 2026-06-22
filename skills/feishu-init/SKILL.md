---
name: feishu-init
description: 飞书数字员工·书童引导（第三编排器）。当用户首次接触机器人、说"你好/帮助/你能做什么"、要"搭知识库/初始化/体检"、或公司刚开始用还没有任何文档数据时使用。负责欢迎与能力介绍、配置体检、以及冷启动——一键搭知识库骨架，再用"访谈式主动提问"或"引导上传导入"把初始资料建起来。解决"不知道能干什么、空系统从哪开始"。可移植 skill，Claude Code / OpenClaw / Hermes 通用。
---

# feishu-init · 书童引导（编排器）

补产品的 0→1 层：首次引导 + 配置体检 + 冷启动。与 `feishu-collector`、`feishu-kb-maintainer` 平级。
本 skill 是**大脑/编排器**：你读本文件，调度下列原子；入口 `bin/init.js` 已把消息分类成 init 意图并给出 `reply`/`hint`。

## 原子/模块地图
- `kb-scaffold`（STANDARD_TREE / planScaffold / createTree）→ `skills/atoms/kb-scaffold/`
- `kb-interview`（GENERIC_INTERVIEW / nextQuestion / formatAnswerForKb）→ `skills/atoms/kb-interview/`
- `health`（checkConfig / probeLive）、`doc`（createWikiNode/appendDoc）、`file`、`message` → `skills/feishu-shared/src/`
- 复用：导入走 `kb-extract` + `kb-route`(`skills/atoms/*`)；访谈对话可借 `collect-clean`。

## 触发与意图
运行时把"引导类"消息喂给 `bin/init.js`（`--text` 或 `--event`），它分类为 `welcome|help|health|scaffold|interview|import|unknown` 并给 `reply`（可直接发）/`hint`（你按下方流程执行）。bot 入群事件、首次对话、"你好"都应路由到此。

## 五条流程

### 1. 欢迎（welcome）
直接把 `reply`（欢迎语 + 三选项）发给用户（`message.sendGroup`/`sendDM`）。用户回复数字 → 1=搭知识库(流程4)、2=收集(转 feishu-collector)、3=能力菜单(流程2)。

### 2. 帮助 / 能力菜单（help）
直接发 `reply`（能力清单）。这是任何时候"我能做什么"的统一出口；意图不明(unknown)也回退到此，**绝不沉默**。

### 3. 配置体检（health，管理员向）
`bin/init.js` 已给 `checklist`(env 检查)。需要活体探测就再调 `health.probeLive(ctx)`（授权状态 / 知识空间是否存在），并进 `checklist`。把 `health.healthReportText` 的结果发给用户：✅就位 / ❌缺项+人话指引。能自动修的（建库 setup-base/setup-route-base、搭骨架）就引导用户确认后执行。

### 4. 冷启动·搭骨架 + 选路（scaffold）
1. 读知识空间现有节点标题（`wiki +node-list` 等）→ `kb-scaffold.planScaffold(已存在标题)` 得待建清单（幂等：已存在的跳过）。
2. `kb-scaffold.createTree(ctx, spaceId, plan)` 建标准节点树（公司总览及其 3 子页 / 项目空间 / 会议纪要库 / 群知识沉淀 / 公司待办看板 / OKR / 制度SOP）。**这是 kb-maintainer 能工作的前提**。
3. 发 `coldStartChoiceText`：问用户"有现成文档吗" → 有→流程5-导入；没有→流程5-访谈；两者皆可。

### 5. 冷启动·访谈式 / 引导上传
- **访谈式（interview）**：循环 `kb-interview.nextQuestion(已答keys)` 逐题问用户 → 收到答案 →（可借 `collect-clean` 规整）→ `kb-interview.formatAnswerForKb(item, answer, now)`（空答案返回 null=跳过，**缺失不编造**）→ `doc.appendDoc(目标节点docToken, content)` 写进对应 KB 节点 → `kb-route.recordRoute(source_type:'manual', source_id:'interview:<key>')` 留痕。全部答完 → 汇报"初始化完成 + 各节点链接"。
- **引导上传（import）**：提示"把名册/制度/项目清单/旧 Wiki 或 Notion 导出发我" → `file.inspectUrl`/`localToOnline` + `file.parseSource` 解析 → 你抽取归类 + `kb-extract.normalizeItems` → `kb-route.decideRoute` 去重 → `doc` 写进骨架对应节点 → `kb-route.recordRoute`。名册类顺带建立人名↔open_id 提示，便于后续 `contact` 解析。

## 配置（环境变量）
复用两条线的 `COLLECTOR_APP_TOKEN` / `KB_APP_TOKEN` / `KB_ROUTE_TABLE` / 可选 `LARK_PROFILE`；体检即检查这些是否就位。

## 部署
与另两个编排器同形态：Hermes/OpenClaw/CC 把"引导类"消息/入群事件路由到 `bin/init.js`，其输出交 agent 按本 SKILL 处理。bot 入群事件建议默认触发流程1（欢迎）。

## 范围（v1）
Markdown 文案 + 数字选项；同步访谈；幂等搭骨架；导入走现成管线。后续增强：交互卡片按钮+回调、异步多人访谈（复用 collector 催办）、写入回执/撤销。
