---
name: feishu-init
description: 飞书数字员工·书童引导（第三编排器）。当用户首次接触机器人、说"你好/帮助/你能做什么"、要"搭知识库/初始化/体检"、或公司刚开始用还没有任何文档数据时使用。负责欢迎与能力介绍、配置体检、以及冷启动——一键搭知识库骨架，再用"访谈式主动提问"或"引导上传导入"把初始资料建起来。解决"不知道能干什么、空系统从哪开始"。可移植 skill，Claude Code / OpenClaw / Hermes 通用。
---

# feishu-init · 书童引导（编排器）

补产品的 0→1 层：首次引导 + 配置体检 + 冷启动。与 `feishu-collector`、`feishu-kb-maintainer` 平级。
本 skill 是**大脑/编排器**：你读本文件，调度下列原子；入口 `bin/init.js` 已把消息分类成 init 意图并给出 `reply`/`hint`。

## 原子/模块地图
**前置原子**（冷启动核心，缺则功能不成立）：
- `kb-scaffold`（STANDARD_TREE / ensureSpace / initScaffold / scaffoldStatus）→ `skills/atoms/kb-scaffold/`（有 SKILL.md，含其外部/下游依赖）
- `kb-interview`（GENERIC_INTERVIEW / nextQuestion / formatAnswerForKb）→ `skills/atoms/kb-interview/`

**共享工具库**（feishu-shared，多编排器共用）：
- `health`（checkConfig / probeLive）、`doc`（createWikiNode / appendDoc / listWikiSpaces / listWikiNodes）、`file`、`message` → `skills/feishu-shared/src/`

**复用原子**：导入走 `kb-extract` + `kb-route`(`skills/atoms/*`)；访谈对话可借 `collect-clean`。

## 文档依赖（设计来源）
本编排器实现的设计依据：`personal/产品体验审视-不足与改进.md`（§3 重点 A/B：0→1 层、冷启动三件套）、`personal/feishu-init-设计与计划.md`。改行为前先读这两份，避免偏离原始设计意图。

## 下游依赖（本 skill 是谁的前提）
- **`feishu-kb-maintainer`**：其 routing 把内容写进**已存在**的 Wiki 节点；本 skill 的 `initScaffold` 搭出标准骨架是 kb-maintainer 能落点的**必要前提**。骨架缺失 → kb-maintainer 监听到会议/群聊也无处可写。
- **`feishu-collector`**：**无**此依赖（收集线写回用户文件 + 独立状态库 `COLLECTOR_APP_TOKEN`，与知识库骨架解耦）。两条线可并行初始化。

## 触发与意图
运行时把"引导类"消息喂给 `bin/init.js`（`--text` 或 `--event`），它分类为 `welcome|help|health|scaffold|interview|import|unknown` 并给 `reply`（可直接发）/`hint`（你按下方流程执行）。bot 入群事件、首次对话、"你好"都应路由到此。

## 五条流程

### 1. 欢迎（welcome）+ 冷启动骨架自动检测
直接把 `reply`（欢迎语 + 三选项）发给用户（`message.sendGroup`/`sendDM`）。用户回复数字 → 1=搭知识库(流程4)、2=收集(转 feishu-collector)、3=能力菜单(流程2)。

**bot 首次入群自动检测**：当 `bin/init.js` 收到 `im.chat.member.bot.added_v1` 事件时，输出 `intent:welcome` 且带 `autoScaffold:true`。此时除发欢迎语外，**自动**按 hint 执行冷启动检测（幂等、缺失不编造）：
1. `health.probeLive(ctx)` 看用户是否授权 + 知识空间是否存在。
2. 知识空间存在则 `kb-scaffold.collectExistingTitles(spaceId)` + `kb-scaffold.scaffoldStatus(titles)` 看骨架完整度。
3. **骨架缺失且用户已授权** → `kb-scaffold.initScaffold(ctx)`（内部自动 `ensureSpace` 检测/建知识空间 → 建标准节点树，全程幂等），建好后发 `coldStartChoiceText` 选访谈/导入。**这一步把"kb-maintainer 能工作的前提"自动补齐**。
4. **用户未授权**（建空间须 `--as user`）→ 不静默失败，发引导文案让管理员先 `lark-cli auth login` 授权。**骨架已齐** → 正常欢迎、不重复建。

### 2. 帮助 / 能力菜单（help）
直接发 `reply`（能力清单）。这是任何时候"我能做什么"的统一出口；意图不明(unknown)也回退到此，**绝不沉默**。

### 3. 配置体检（health，管理员向）
`bin/init.js` 已给 `checklist`(env 检查)。需要活体探测就再调 `health.probeLive(ctx)`（授权状态 / 知识空间是否存在），并进 `checklist`。**骨架状态检测**：知识空间存在时再 `kb-scaffold.collectExistingTitles(spaceId)` + `kb-scaffold.scaffoldStatus(titles)`，报"骨架 present/total 节点，缺 missing 个"，缺则引导 `initScaffold` 补建。把 `health.healthReportText` 的结果发给用户：✅就位 / ❌缺项+人话指引。能自动修的（建库 setup-base/setup-route-base、搭骨架）就引导用户确认后执行。

### 4. 冷启动·搭骨架 + 选路（scaffold）
1. 一步到位调 `kb-scaffold.initScaffold(ctx)`：内部 `ensureSpace`（`wiki +space-list` 按名查→缺则 `wiki +space-create` 建知识空间，仅 `--as user`，list-first 去重）→ `collectExistingTitles`（递归收全部节点标题）→ `planScaffold`（幂等待建清单）→ `createTree` 建标准节点树（公司总览及其 3 子页 / 项目空间 / 会议纪要库 / 群知识沉淀 / 公司待办看板 / OKR / 制度SOP）。**这是 kb-maintainer 能工作的前提**；返回 `{spaceId, existed, status, created}`。
2. 全程幂等：空间已存在则复用、节点已建则跳过，可反复运行不重复建。
3. 发 `coldStartChoiceText`：问用户"有现成文档吗" → 有→流程5-导入；没有→流程5-访谈；两者皆可。

### 5. 冷启动·访谈式 / 引导上传
- **访谈式（interview）**：循环 `kb-interview.nextQuestion(已答keys)` 逐题问用户 → 收到答案 →（可借 `collect-clean` 规整）→ `kb-interview.formatAnswerForKb(item, answer, now)`（空答案返回 null=跳过，**缺失不编造**）→ `doc.appendDoc(目标节点docToken, content)` 写进对应 KB 节点 → `kb-route.recordRoute(source_type:'manual', source_id:'interview:<key>')` 留痕。全部答完 → 汇报"初始化完成 + 各节点链接"。
- **引导上传（import）**：提示"把名册/制度/项目清单/旧 Wiki 或 Notion 导出发我" → `file.inspectUrl`/`localToOnline` + `file.parseSource` 解析 → 你抽取归类 + `kb-extract.normalizeItems` → `kb-route.decideRoute` 去重 → `doc` 写进骨架对应节点 → `kb-route.recordRoute`。名册类顺带建立人名↔open_id 提示，便于后续 `contact` 解析。

## 命令行子命令（部署/运维用，非对话）
`bin/init.js` 除默认的消息分类入口外，提供两个运维子命令：
- **`check-scaffold`**：只读体检骨架，打印机器可读 JSON + exit code（`0`=骨架齐全 / `1`=缺空间或缺节点 / `2`=未授权或出错）。**绝无副作用**（不建空间）。供部署脚本/cron 无人值守调用：`node bin/init.js check-scaffold && echo ok || 触发 initScaffold 补建`。源码 `src/scaffold-check.js`，复用 `health.probeLive` + `kb-scaffold.scaffoldStatus`。
- **`setup-events`**：事件订阅（问题2）。默认打印订阅计划 + `event status` 自检；`--start` 长驻订阅（交 systemd 托管）。
- **`setup-cron`**：配置系统 cron 定时任务（问题3：收集催办 tick + 群聊拉取 digest + 周报）。默认打印任务计划 + 可粘贴 crontab；`--install` 幂等写入系统 crontab（marker 注释识别、保留已有条目）。源码 `src/cron.js`。**无 `hermes cron create`，用系统 crontab**。

## 配置（环境变量）
复用两条线的 `COLLECTOR_APP_TOKEN` / `KB_APP_TOKEN` / `KB_ROUTE_TABLE` / 可选 `LARK_PROFILE`；体检即检查这些是否就位。

## 部署
与另两个编排器同形态：Hermes/OpenClaw/CC 把"引导类"消息/入群事件路由到 `bin/init.js`，其输出交 agent 按本 SKILL 处理。bot 入群事件建议默认触发流程1（欢迎）。

### 事件订阅（关键步骤，否则开完会收不到妙记）
本编排器的 `setup-events` 子命令统一管理 **4 个必订阅事件**（其余两条线复用同一 daemon）：
| EventKey | 授权 | 用途 |
|---|---|---|
| `minutes.minute.generated_v1` | user | 会议妙记生成（录音链路）→ 知识库会议沉淀 |
| `vc.note.generated_v1` | user | 会议 AI Summary 生成 → 知识库会议沉淀 |
| `im.message.receive_v1` | bot | 群聊消息 → 知识库群聊沉淀 / 收集线回复 |
| `im.chat.member.bot.added_v1` | bot | bot 入群 → 冷启动欢迎 + 自动建骨架 |

> `minutes`/`vc` 是 **user 授权**事件、不经 bot 网关，**不显式订阅就收不到**——这是"开完会沉淀线不工作"的根因（问题2）。

**两种模式**：
- 看订阅计划 + daemon 自检（只读）：`node bin/init.js setup-events`
- 长驻订阅（逐行桥接事件到各 handler，崩溃自重启）：`node bin/init.js setup-events --start` —— **必须交进程托管**（systemd/supervisor），不可前台手跑。

**systemd 用户服务示例**：
```ini
# ~/.config/systemd/user/feishu-events.service
[Service]
ExecStart=/usr/bin/node %h/.hermes/skills/feishu-init/bin/init.js setup-events --start
Restart=always
RestartSec=2
Environment=LARK_PROFILE=default     # 多公司时改为各 worker profile（每公司独立 App + 独立 profile）
```
`systemctl --user enable --now feishu-events` 启动后，用 `lark-cli event status` 或体检的 `health.probeEvents(ctx)` 确认 bus 在线。

> ⚠️ **不要用裸管道** `event consume KEY | node handler.js`：consume 是无限 NDJSON 流、handler 读 stdin-until-EOF 只处理首行，会永久缓冲。必须走 `setup-events` 的 bridge。
> ⚠️ **每 App 全局仅一个 event bus**：多公司须每公司独立 AppID + 独立 profile，不可两 profile 连同一 App。

## 范围（v1）
Markdown 文案 + 数字选项；同步访谈；幂等搭骨架；导入走现成管线。后续增强：交互卡片按钮+回调、异步多人访谈（复用 collector 催办）、写入回执/撤销。
