---
name: feishu-kb-maintainer
description: 飞书"知识库自动维护数字员工"（被动沉淀）。当会议结束生成妙记纪要、群里产生有沉淀价值的讨论、文档里出现需回复的评论或 @机器人 提及、或到周期汇总时间时使用。机器人自动把决策/待办/结论/FAQ/目标进展抽取出来，智能路由 + content_hash 幂等地写进 Wiki 项目文档、原生 Task、原生 OKR、评论串，并定时汇总成周报。可移植 skill，Claude Code / OpenClaw / Hermes 通用。
---

# feishu-kb-maintainer · 知识库自动维护数字员工

把"会议 / 群聊 / 文档协作"里散落的决策、待办、结论、FAQ、目标进展，自动沉淀进公司知识库。
本 skill 是**大脑/编排器**：你（宿主 LLM）读本文件做语言抽取与路由决策，按工作流调度下列原子；**手脚**是 `feishu-shared/` 能力模块与 `skills/atoms/*` 原子（封装 lark-cli）；**记忆**是飞书多维表格「路由幂等表」；状态全在 Base，每次处理都"读 Base→抽取→路由判定→调 lark-cli 写回→回写 Base"，因此无状态、可移植、抗重启。

## 原子/模块地图（原子化后）
本文下方工作流用到的短名 → 实际位置：
- `route-io.*`（querySource/decideRoute/recordRoute/queryByKind）→ `skills/atoms/kb-route/`
- `extract.*`（normalizeItems/groupByKind/sectionFingerprint）→ `skills/atoms/kb-extract/`
- `kb-digest`（selectRecent/windowSinceMs）→ `skills/atoms/kb-digest/`（被 `bin/digest.js` 用）
- `minutes.*` / `doc.*`（原 kb-write）/ `task.*`（原 task-io）/ `okr.*`（原 okr-io）/ `comment.*` / `chat.*` → `skills/feishu-shared/src/`
- `larkcli` / `hash` / `base-crud` → `skills/feishu-shared/src/`（底座）

## 文档依赖（前置：骨架必须先存在）

本 skill 的 routing 把内容写进 Wiki **已存在**的知识空间节点（会议纪要库 / 群知识沉淀 / 公司总览·Decision Log / 项目页等）。**这些节点不由本 skill 创建**——若知识空间或标准节点缺失，写入无落点、沉淀失败。

- **骨架创建归属**：`feishu-init` 编排器 + `kb-scaffold` 原子负责建知识空间与标准节点树（`initScaffold`：`ensureSpace` 建空间 → `createTree` 建节点，幂等）。bot 入群事件会自动触发检测+补建（见 feishu-init SKILL.md 流程1）。
- **本 skill 工作前应确认**：`wiki +space-list` 有知识空间、`kb-scaffold.scaffoldStatus` 报骨架完整；缺则先引导走 feishu-init 的「搭知识库」。
- **命中不到目标节点**时（如新项目页未建）：不静默写错位置，转发起人确认是否建页（复用 `kb-scaffold` 思路按需补建项目子页）。

## 四条铁律（不可违反）

1. **群消息不逐条入库**：原始群消息信噪比低。累积一个时间窗/一定消息数后再抽取决策/结论/待办/FAQ，丢弃闲聊。绝不把每条消息塞进文档。
2. **写前去重（content_hash 幂等）+ 覆盖保护**：任何写入前先按 `source_id` 查路由幂等表，用 `route-io.decideRoute(existing, newContent, currentTargetContent)` 判定 write / update / skip / **conflict**。未变就 skip；**conflict**（目标内容自上次写入后被人工改过）→ **不覆盖**，把情况转发起人确认。要触发覆盖保护，update 前先读目标当前内容（`doc.fetchDoc` 局部 scope）传入 decideRoute。
3. **缺失不编造**：纪要无 AI 总结时你二次总结，但只基于真实素材；抽不到的字段（负责人/截止/KR）就留空，绝不臆造。
4. **403 不静默**：写文档/Task/OKR 遇 403（机器人非协作者/缺 scope）时，`larkcli.lark` 会抛错带 stderr——把原因如实报给发起人（加协作者 / 补 scope），绝不假装写成功。

## 核心数据模型：路由幂等表（Base）

字段（设计 §4.1）：`source_type`(meeting/chat/comment/manual)、`source_id`、`source_meta`、`target_kind`(doc/task/okr/comment)、`target_id`、`target_locator`、`content_hash`、`target_content_hash`（覆盖保护基线）、`status`(written/updated/skipped/conflict)、`last_synced_at`。
首次用 `bin/setup-route-base.js` 真建表（禁止手动建）。

幂等逻辑（`src/route-io.js`）：
- `querySource(ctx, sourceId)` 按 source_id 查既有记录（或 null）。
- `decideRoute(existing, newContent)` → `{action, hash, recordId, targetId, targetLocator}`：无记录=write、hash 变=update（按 target_locator 覆盖）、hash 未变=skip。
- 目标写成功后 `recordRoute(ctx, decision, meta, status)` 回写 locator+hash+status+time。

## 配置（环境变量）

`KB_APP_TOKEN`（状态库 Base）、`KB_ROUTE_TABLE`（默认"路由幂等表"）、可选 `LARK_PROFILE`（如 `qianhai`）、`KB_DIGEST_CHATS`（群聊定时拉取的 chat_id 列表）、`KB_DIGEST_WINDOW_H`（汇总/拉取时间窗小时，默认 168）。

## 两种触发

- **事件驱动**（`bin/on-event.js`）：运行时把飞书事件喂给它，它识别 EventKey、拉相关快照、输出"工作上下文"JSON 给你按下方工作流处理。
  - `minutes.minute.generated_v1`（会议妙记生成——录音链路，user 授权）→ 会议沉淀（功能 1/3/4）。
  - `vc.note.generated_v1`（智能纪要生成——AI Summary 链路，user 授权）→ 会议沉淀（功能 1/3/4）。
  - `im.message.receive_v1`（消息接收，bot 授权）→ 群聊沉淀（功能 2）；其中 @机器人 的文档内提及作为**文档评论线的兜底触发**（功能 5）。
  - ⚠️ 实测 `event list` 仅有 board/im/minutes/vc 段，**没有独立的文档评论 EventKey**，故评论线走 @机器人 提及兜底。
- **cron**（`bin/digest.js`）：① 群聊定时拉取（对 `KB_DIGEST_CHATS` 按时间窗 `im +chat-messages-list` 拉消息，补足无敏感权限时的实时读）；② 周期汇总（功能 7）。

## 工作流

### 功能 1 · 会议沉淀（event: minutes.minute.generated_v1 或 vc.note.generated_v1）

飞书有两条独立的会议产品链路，本功能均处理：

**路径 A · AI Summary 链路（event: vc.note.generated_v1）**
1. 从工作上下文拿 `meeting.meeting_id`（由事件提取）。`route-io.querySource` 已替你查过（`routeExisting`，source_id=meeting_id）。
2. `minutes.fetchMeetingNotes({meetingIds:[meeting_id]})` 取 `note_doc_token`/`note_id`/`verbatim_doc_token`。
3. `doc.fetchDoc(note_doc_token)` 取 AI Summary 全文（Markdown 格式）。
4. **你**基于全文抽取决策/待办/结论 → `extract.normalizeItems` 归一去重。
5. 对每个落点按 `route-io.decideRoute` 判定后写（同下方路径 B 第 4 步）。
6. 每个落点写成功后 `route-io.recordRoute(ctx, decision, {sourceType:'meeting', sourceId:meeting_id, targetKind, targetId, targetLocator}, status)`。

**路径 B · 录音妙记链路（event: minutes.minute.generated_v1）**
1. 从工作上下文拿 `minute.minuteToken`。`route-io.querySource` 已替你查过（`routeExisting`）。
2. `minutes.fetchNotes({minuteToken})` 取 `summary/todos/transcript`。`summary` 为空时**你**基于 transcript 二次总结（铁律 3：只据真实内容）。
3. 把总结/决策/待办整理成结构化要点（`{kind,text,owner?,due?,krId?}`）→ `extract.normalizeItems` 归一去重。
4. 对每个落点按 `route-io.decideRoute` 判定后写：
   - **会议纪要段** → 命中项目「会议纪要」小节：先 `doc.resolveWikiNode(节点)` 拿 docToken，再 `doc.fetchDoc`（取小节 block_id），按落点 `appendDoc`/`insertAfterBlock`/`replaceBlock`。写 `--content` 前**先 `lark-cli skills read lark-doc references/lark-doc-update.md` 和 `references/lark-doc-md.md`**，按其转义规则构造 Markdown/XML。
   - **决策（kind=decision 且为"拍板"）** → 同法追加到「重要决策记录 Decision Log」。
   - **行动项（kind=todo）** → 功能 3。
   - **KR 进展（kind=progress）** → 功能 4。
5. 每个落点写成功后 `route-io.recordRoute(ctx, decision, {sourceType:'meeting', sourceId:minuteToken, targetKind, targetId, targetLocator}, status)`。

**主动搜会补充**：对未通过事件触发的会议，用 `minutes.searchMeetings({start, end})` → 取 meeting_id → `minutes.fetchMeetingNotes({meetingIds})` 拿 AI Summary；若无 AI Summary 但有录音，则 `minutes.recordingMinuteToken({meetingIds})` → `minutes.fetchNotes({minuteToken})` 走妙记路径。

### 功能 2 · 群聊沉淀（event: im.message.receive_v1 或 cron 拉取）
1. **不逐条处理**（铁律 1）。事件触发时仅累积；真正抽取在 `digest.js` 按时间窗拉到一批后，或你判断累积足够时进行。
2. 对一批群消息**你**抽取决策/结论/待办/FAQ，丢闲聊 → `extract.normalizeItems` 去重。
3. `source_id = chatId + 时间窗`（如 `oc_xxx:2026-W24`）。`route-io.querySource` 查、`decideRoute` 判定。
4. 命中该群对应文档「群聊沉淀」小节 → `doc` 更新；拍板决策汇入 Decision Log。
5. `recordRoute(... source_type:'chat' ...)`。

### 功能 3 · 待办维护（原生 Task，单一事实源）
1. 行动项 → `task.createTask({summary, description:来源回链, assigneeOpenId, due, idempotencyKey})`（负责人原文先用通讯录解析成 open_id；解析不到则留空并在文档注明）。
2. 需提醒 → `task.setReminder(taskId, '1h')`。后续变更 `task.updateTask`。
3. 文档侧「公司待办看板」「项目待办汇总」是**只读镜像**：`task.listMyTasks`/`searchTasks` 取任务 → 渲染成只读列表用 `doc` 写镜像页。勾选/改在 Task App 内做，不在文档里改。
4. `recordRoute(target_kind:'task', target_id:task_guid)`。

### 功能 4 · 战略目标维护（原生 OKR，单一事实源）
1. **不新建 Objective**。你识别与某 KR 相关的进展 → `okr.createProgress({targetId:KR id, targetType:'key_result', text:进展, percent?, status?, sourceTitle, sourceUrl})`。
2. 「公司战略与年度目标」页按周镜像：`okr.listCycles`→取 cycle_id→`okr.cycleDetail(cycleId)` 读 Objective/KeyResult → 你汇编成可读汇总 → `doc.appendDoc/replaceBlock` 写镜像页。
3. `recordRoute(target_kind:'okr', target_id:KR id)`。

### 功能 5 · 文档评论智能回复（@机器人 文档内提及兜底触发）
1. `comment.readDocBody(fileToken)` 读文档正文理解上下文；`comment.listComments(fileToken)` 取未解决评论。
2. 对目标评论 `comment.listReplies(fileToken, commentId)` 判重（已回复过就 skip）。
3. **你**据正文+评论串生成回复 → `comment.replyToComment(fileToken, commentId, text)`（bot 身份，在评论串内回复）。
4. `recordRoute(source_type:'comment', source_id:commentId, target_kind:'comment', target_locator:commentId)` 防重复回复。

### 功能 6 · 智能路由 + 幂等（贯穿所有写入）
每条源在写入前都走 `querySource → decideRoute → 写目标 → recordRoute`。这是上面每个功能第 3~5 步里反复出现的同一闸门，杜绝重复写与写错文档。target_locator 形态：doc→block_id；task→task_guid；okr→KR id；comment→comment_id。

### 功能 7 · 周期汇总（cron: digest.js）
1. `digest.js` 已聚合 `digestMaterial.{doc,task,okr}`（本周期路由台账）。
2. **你**把它汇编成周报正文（缺失不编造）→ `doc.appendDoc(周报页 docToken, 周报内容)`。
3. `recordRoute(source_type:'manual', source_id:'weekly:<ISO周>', target_kind:'doc')`。

## 部署（各运行时挂心跳层 —— 上层逻辑一致，只差触发接线）

- **事件订阅（统一入口，推荐）**：`node skills/feishu-init/bin/init.js setup-events --start` 一次性长驻订阅 minutes/vc/im.message/bot.added 全部事件并桥接到本 `bin/on-event.js`（及 collector/init）。
  - ⚠️ **不要用裸管道** `event consume KEY | node on-event.js`：`event consume` 是无限 NDJSON 流（永不 EOF），而 on-event.js 读 stdin 到 EOF 才处理、只取首行 → 会永久缓冲、最多处理 1 条。必须走 `setup-events` 的 bridge（逐行 `node on-event.js --event '<line>'`）。
  - minutes/vc 是 **user 授权事件**，不经 Hermes bot 网关，**必须显式订阅**否则收不到。每事件一个 consume 进程共享本机 daemon；飞书每 App 全局仅一个 event bus（多公司须多 Profile/AppID）。
- **Claude Code / OpenClaw / Hermes**：把 `setup-events --start` 交各运行时的进程托管（systemd `Restart=always` / `openclaw cron` 守护 / supervisor）；`bin/digest.js` 由系统 cron 周期触发（见下「定时任务」）。
- **OpenClaw**：装飞书通道插件把消息/事件路由到 agent；`openclaw cron` 注册 `node bin/digest.js`。
- **Hermes**：gateway 接飞书通道与事件总线；`bin/digest.js` 外接系统 cron。

### 定时任务（cron，问题3）
统一用 `feishu-init` 的 `setup-cron` 子命令配置系统 crontab（**注意：无 `hermes cron create` 命令，项目用系统 crontab / systemd timer**）：
```bash
node skills/feishu-init/bin/init.js setup-cron            # 打印任务计划 + 可粘贴 crontab（只读）
node skills/feishu-init/bin/init.js setup-cron --install  # 幂等写入 crontab（保留你已有条目）
```
配三条任务（marker 注释幂等，重装不重复）：
| 任务 | 调度 | 命令 | 作用 |
|---|---|---|---|
| collector-tick | `*/30 * * * *` | `tick.js` | 收集线催办心跳 |
| kb-chats | `0 */6 * * *` | `digest.js --mode=chats` | 群聊定时拉取沉淀（`KB_DIGEST_CHATS` 指定的群，窗口 6h） |
| kb-weekly | `0 9 * * 1` | `digest.js --mode=report` | 周报素材汇总（窗口 168h） |

- **`digest.js --mode`**：`chats` 只拉群、`report` 只汇总周报、缺省两者都做（向后兼容）。群聊高频、周报每周一次，故分两条 crontab 用不同 mode/窗口。
- **调度/窗口可覆盖**：`COLLECTOR_TICK_CRON` / `KB_CHATS_CRON` / `KB_WEEKLY_CRON` / `KB_CHATS_WINDOW_H` / `KB_WEEKLY_WINDOW_H`。
- **cron 环境**：已用 node 绝对路径规避 cron 极简 PATH；但 `KB_APP_TOKEN` 等**密钥**须在 crontab 头（`NAME=value` 行）或 systemd `EnvironmentFile` 提供，否则任务空跑不报错。
- **自检**：体检 `health.probeCron(ctx)` 或 `crontab -l | grep feishu` 确认已装。
- **替代**：systemd user timer（与 `setup-events` 托管一致，`journalctl` 可观测）。

## 上线前置（需真机授权才能最终校准）

- **scope**（实测 dry-run 报缺）：`vc:note:read`（妙记纪要）、`okr:okr.progress:writeonly`（OKR 进展写入）、`okr:okr.period:readonly`（周期读取）、`task:task:write`/`task:task:read`（原生 Task）、`docx:document:write_only`（文档写回）、`drive` 评论读写、`im:message:send_as_bot`（评论回复以 bot 发）。缺 scope 时 lark-cli 抛 authorization 错并给出 `auth login --scope` 提示——按提示一次性补齐全部 scope。
- **bot 入群**：群消息发送/读取与文档评论 bot 回复要求 bot 是相关会话成员。
- **响应字段路径**：vc/task/okr/drive 各命令 JSON 响应里 minute summary、task_guid、cycle/progress、comment 列表的确切字段路径需真机校准（src 各模块已做防御性多路径解析，注释标了"响应路径待真机校准"）。
- 群全量读取需敏感权限 `im:message.group_msg`（管理员审批），否则退化为"@机器人主动归档"；不具备时靠 `digest.js` 定时拉取 + @机器人 提及补足。
