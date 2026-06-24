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
- `findSpaceByName(spaces, name)` / `nodeItemsOf(res)` / `scaffoldStatus(existingTitles, tree)` 纯函数：按名定位知识空间、解析 `wiki +node-list` 响应里的节点数组、对照 STANDARD_TREE 算骨架完整度（present/missing/complete）。
- `ensureSpace(ctx, spaceName=DEFAULT_SPACE_NAME, {listSpaces, createSpace})` I/O（幂等）：先 `doc.listWikiSpaces` 按名查（`wiki +space-create` **本身无去重**，必须 list-first），命中复用、未命中才 `doc.createWikiSpace` 建（仅 `--as user`）→ `{spaceId, existed}`。
- `collectExistingTitles(spaceId, {profile, listNodes})` I/O：递归 `has_child` 用 `doc.listWikiNodes` 收全部层级节点，返回 `{titles, tokenByTitle}`（覆盖公司总览的 3 个子页，保证幂等不重复建子页）。`tokenByTitle` 喂给 `createTree` 的 `parentTokens`——**部分补建时**（父节点已存在、子页缺失）子页才挂得到正确父节点而不错建到顶层。带 visited 去重 + 深度上限防环。
- `initScaffold(ctx, {spaceName, tree}, deps)` I/O（高级编排，幂等）：`ensureSpace → collectExistingTitles → planScaffold → createTree` 一站式冷启动建骨架 → `{spaceId, existed, status, created}`。`createTree` 签名保持不变（向后兼容）。

### feishu-shared/doc.js（共享，新增 Wiki 空间/节点封装）
- `listWikiSpaces({profile})` → `wiki +space-list --page-all --as user`，返回 items[]（每项 `{space_id, name}`）。
- `createWikiSpace(name, {profile, description})` → `wiki +space-create --name --as user`，解析 `space.space_id` 返回 `{spaceId, raw}`。
- `listWikiNodes(spaceId, {profile, parentNodeToken})` → `wiki +node-list --space-id --page-all`，返回原始响应（节点含 `node_token/title/has_child`）。

### 冷启动自动触发（问题1：bot 入群 / 首次对话自动建骨架）
- `intent.eventKeyOf(ev)`（对标 kb-maintainer/on-event.js，显式 `event_key`/`header.event_type` 优先，结构推断对入群事件有歧义故不采用）+ `intent.classifyEvent(eventKey)`（`im.chat.member.bot.added_v1` → `welcome`）。
- `bin/init.js` 的 `readInput` 区分文本/事件；**对所有 welcome 意图**（入群事件 *或* 用户首次对话"你好"等）一律挂 `out.autoScaffold=true` + `out.scaffoldTrigger`（`bot_added`/`first_chat`）+ hint 指示宿主 LLM：**先探测骨架状态（probeLive 看空间 + scaffoldStatus 看节点完整度），缺则 `initScaffold` 幂等建，再发选路文案**。检测幂等（骨架已齐则跳过、不重复建），故无需判断"是否真首次"；这样即便入群事件结构异常降级为文本分类，冷启动也不丢失。
- **权限错位**：入群事件是 bot 授权触发，但建空间须 user 授权。user 未 ready 时降级为引导文案（"请管理员先 `lark-cli auth login` 授权"），不静默失败。

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

### 事件自动订阅（问题2：开完会 bot 收不到妙记事件）
飞书 user 授权事件（minutes/vc）不经 Hermes bot 网关，必须显式 `lark-cli event consume` 才能收到——这是"开完会无法自动入库"的根因。且 `event consume` 是**无限 NDJSON 流**，而 on-event.js 读 stdin-until-EOF 只取首行 → 裸管道 `consume | node on-event.js` 会永久缓冲、只处理 1 条。正确做法是**长驻 bridge**（方案A）。

- `feishu-init/src/events.js`：
  - `REQUIRED_EVENTS`（纯数据）：4 个必订阅事件 → `{key, as, handlers[], desc}`。`as` 必须匹配 EventKey 授权类型（minutes/vc=user，im 类=bot）；im.message → `[kb on-event, collector on-message]`、minutes/vc → `[kb on-event]`、bot.added → `[init]`（冷启动欢迎，接迭代A）。
  - `consumeArgv(evt,{profile})` / `resolveHandler(id,baseDir)` / `planEvents(...)` 纯函数：构造 `lark-cli event consume <key> --as <auth> --quiet` 命令、解析 handler 路径、展开可读计划（`--print`/文档/自检用）。
  - `dispatchLine(line,evt,{baseDir,spawnFn})` IO：把一行 NDJSON 事件 `spawn node <handler> --event '<line>'` 分发给该 key 的全部 handler（注入 spawnFn 便于单测）。
  - `bridgeEvent(evt,opts)` / `runSetupEvents(events,opts)` IO：起 consume 子进程→readline 逐行→dispatchLine；consume 退出后按延时自动重启（崩溃自愈）。
- `bin/init.js` 新增 `setup-events` 子命令（`process.argv[2]`）：默认打印订阅计划 + `event status` 自检（只读安全）；`--start` 才长驻启动全部 bridge（供 systemd `ExecStart`，配 `Restart=always`）。
- **约束**：`event consume` 单 key（无多 key），每事件一进程共享本机同一 daemon；飞书每 App **全局单 event bus**，多公司须多 Profile/AppID。
- `setup-route-base.js` 建表后追加"下一步订阅事件"引导，串起部署链路。

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

## 七、迭代记录（自动化部署闭环：冷启动 / 事件 / cron，2026-06-24）
按依赖顺序补齐"装好就能自己跑"的三层确定性接线（每条走完整 autodev-iterate 阶段 1-7，单测全绿）：

**迭代 A · 冷启动自动建骨架（问题4+1）**
- `kb-scaffold` 增 `ensureSpace`（检测/建知识空间）、`initScaffold`（空间→骨架全幂等）；`feishu-init` 流程1 在 bot 入群/首次对话自动检测+补建。
- 新增 `bin/init.js check-scaffold` 子命令（只读体检骨架，机器可读 JSON + exit code 0/1/2，供脚本/cron 无人值守）；源码 `src/scaffold-check.js`。
- 修 `health.probeLive`：`wiki +space-list` 补 `--as user`（否则 bot 身份无 wiki scope，知识空间检测假阴性；真机验证发现）。
- 文档依赖标注：`feishu-init` 加上下游依赖小节、新增 `kb-scaffold/SKILL.md`（kb-maintainer 依赖骨架前置）。

**迭代 B · 飞书事件自动订阅（问题2）**
- `consumeArgv(evt,{profile})` 统一前置 `--profile`（修测试契约冲突，消除 callers 双重前置）；`bridgeEvent` 重启前 `rl.close()` 防 FD 悬挂。
- 新增 `health.probeEvents`：按真实结构 `{apps:[{running}]}`（真机 `event status --json` 校准）报事件 bus 是否在线；体检 hint 接入。
- `feishu-init/SKILL.md` 部署小节扩展（4 事件清单 + systemd 托管 + 自检）；collector `setup-base.js` 补 setup-events 衔接提示。

**迭代 C · cron 定时任务（问题3）**
- 新增 `bin/init.js setup-cron`（系统 crontab，**非 `hermes cron create`**——该命令不存在，真机/文档核实）：`src/cron.js` 的 `planCron/renderCrontab/mergeCrontab`（marker 注释幂等合并，绝对 node 路径规避 cron PATH 极简）；默认打印计划，`--install` 幂等写入。配三任务：collector-tick(30min) / kb-chats(6h,`--mode=chats`) / kb-weekly(周一,`--mode=report`)。
- `digest.js` 增 `--mode chats|report` 分调（缺省两者，向后兼容）+ 修 `KB_DIGEST_CHATS` 空值 `['']` bug + cron stderr 摘要 + 入口 guard（import 不跑 main）。
- 新增 `health.probeCron`（自包含 grep `crontab -l`，容差 systemd timer 场景）；体检 hint 接入。
- `kb-maintainer/SKILL.md` 补 cron 配置小节（替换原"见迭代C"前向引用）。
