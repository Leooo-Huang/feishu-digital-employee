# feishu-init（书童·引导）· 设计与计划

> 目标：补产品的 0→1 层——首次引导 + 配置体检 + 冷启动（搭骨架 / 访谈式 / 引导上传）。
> 第三个编排器，与 `feishu-collector`、`feishu-kb-maintainer` 平级。**最大化复用既有原子**。
> 决策（用户已定）：①独立第三编排器；②访谈式 + 引导上传都做，先搭骨架再按情况选/适配；③访谈模板用通用版。
> 编写日期：2026-06-21。

## 一、架构（第三编排器）

```
skills/feishu-init/                编排器：引导 + 冷启动
├── SKILL.md                       大脑：意图分类 + 五条流程编排
├── bin/init.js                    入口：分类 init 意图，产出确定性工作上下文
├── src/{cards,intent}.js          纯函数：欢迎/能力菜单/体检报告文案；意图识别
├── test/
└── package.json

新增原子：
skills/atoms/kb-scaffold/          知识库骨架（标准节点树 + 幂等建树）
skills/atoms/kb-interview/         通用访谈模板（题库 + 取下一题 + 答案→KB写入格式）

新增共享：
skills/feishu-shared/src/health.js 配置体检（env/scope/Base/Wiki 探测，可注入）
```

调用方向同既有：编排器 → 原子 → feishu-shared。访谈复用 collector 对话/确认能力，导入复用 file+kb-extract+kb-route+doc。

## 二、五条流程（feishu-init SKILL.md 编排）

1. **欢迎 + 自我介绍**（触发：bot 入群 / 首次对话 / "你好"）：发欢迎文案 + 能力菜单（`cards`），给"立即试试"三选项。
2. **帮助 / 能力菜单**（触发："帮助/书童能做什么/menu"）：随时呼出能力清单。
3. **配置体检**（触发："体检/检查配置"，管理员向）：`health.checkConfig`+`probeLive` 逐项查 env/scope/Base/Wiki → 报告"还差什么 + 人话指引"；能自动做的（建库/搭骨架）就地触发。
4. **冷启动·搭骨架 + 选路**（触发："搭知识库/初始化"）：先 `kb-scaffold` 建标准节点树（幂等）；再问用户"你已有现成文档吗？" → 有→走导入；没有→走访谈；可都走。
5. **冷启动·访谈式 / 引导上传**：
   - 访谈式：`kb-interview` 通用题库，书童在对话里逐题问（公司简介/业务线/项目+负责人/OKR/制度SOP·FAQ/成员名册）→ 答案经 `doc.appendDoc` 写进对应 KB 节点 → `kb-route.recordRoute` 留痕。
   - 引导上传：提示用户发资料 → `file` 解析（本地转在线）→ `kb-extract` 归类 → `kb-route.decideRoute` 去重 → `doc` 写进骨架对应节点 → `recordRoute`。

## 三、新增组件设计

### kb-scaffold（原子，纯逻辑 + 幂等 I/O）
- `STANDARD_TREE`（纯数据）：公司总览{公司战略与年度目标, 重要决策记录 Decision Log, 组织架构与成员}、项目空间、会议纪要库、群知识沉淀、公司待办看板、OKR / 战略目标、制度 / SOP / FAQ。
- `planScaffold(existingTitles, tree=STANDARD_TREE)` 纯函数：对比已存在节点标题，返回**待建清单**（幂等：已存在的跳过，可重复运行）。
- `createTree(ctx, spaceId, plan, deps)` I/O：对待建清单逐个 `doc.createWikiNode`；`deps` 可注入便于单测。

### kb-interview（原子，纯逻辑）
- `GENERIC_INTERVIEW`（纯数据，通用、不绑定具体公司）：题项 `{key, 主题, question, 目标节点, 多轮?}`。
- `nextQuestion(template, answeredKeys)` 纯函数：返回下一道未答题（或 null=访谈完成）。
- `formatAnswerForKb(item, answer, now)` 纯函数：把一条答案格式化成 `{nodeTitle, content}`（带主题小标题），供 `doc.appendDoc`。**缺失不编造**：空答案跳过、不写。
- 实际"问/收/确认"由 feishu-init 大脑同步进行（管理员在场作答）；异步多人版可后续复用 collector 槽位机器。

### feishu-shared/health.js（共享，体检）
- `checkConfig(env)` 纯函数：检查 `COLLECTOR_APP_TOKEN`/`KB_APP_TOKEN`/`LARK_PROFILE` 等是否就位，返回清单 `[{item, ok, hint}]`。
- `probeLive(ctx, deps)` I/O（可注入）：`auth status`（身份/scope）、`wiki space-list`（知识空间在否）等活体探测，合并进清单。

### feishu-init/src/cards.js（纯函数文案）
- `welcomeText()`、`capabilityMenuText()`、`healthReportText(checklist)`、`coldStartChoiceText()`。
- v1 用 **Markdown 消息 + 数字选项**（`message` 发送）；交互卡片按钮版列为后续增强（需 card 回调事件接线）。

### feishu-init/src/intent.js（纯函数）
- `classifyInit(text)` → `welcome|help|health|scaffold|interview|import|unknown`，给 bin 路由。

## 四、复用关系（原子化红利）
- 访谈对话/清洗/确认：可复用 `collect-clean` 等；写回 KB 用 `doc`。
- 导入：`file` + `kb-extract` + `kb-route` + `doc` 全部现成。
- 发消息/卡片：`message`；建节点：`doc.createWikiNode`；体检探测：`larkcli`。
- **新增代码集中在**：kb-scaffold（树+幂等）、kb-interview（通用题库+格式化）、health（体检）、feishu-init（意图+文案+编排）。

## 五、落地步骤（每步配单测、保持全绿）
1. `kb-scaffold` 原子 + 单测（树结构、planScaffold 幂等）。
2. `kb-interview` 原子 + 单测（nextQuestion、formatAnswerForKb 空答案跳过）。
3. `feishu-shared/health.js` + 单测（checkConfig 纯逻辑；probeLive 注入桩）。
4. `feishu-init` 编排器：src/cards+intent + 单测；bin/init.js；SKILL.md；package.json。
5. 全量回归 + bin dry-run；更新 README/记忆。

## 六、范围与非目标（v1）
- v1：Markdown 文案 + 数字选项的引导；同步访谈；幂等搭骨架；导入走现成管线。
- 非目标（后续）：交互卡片按钮 + 回调；异步多人访谈（复用 collector 催办）；写入回执/撤销、conflict 确认卡片（审视文档 D/E/F，属另一批）。
