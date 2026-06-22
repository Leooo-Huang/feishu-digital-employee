---
name: feishu-collector
description: 飞书"收集数字员工"。当用户上传文档/表格并 @机器人 要求收集其中信息、或查询收集进度、或暂停/取消收集任务时使用。机器人在群里/私信主动对话收集、清洗确认、幂等写回文件、自动催办与收工汇报。可移植 skill，Claude Code / OpenClaw / Hermes 通用。
---

# feishu-collector · 收集数字员工

把"上传文档/表格 + @机器人下指令"变成一个会主动对话收集、清洗、催办、写回的数字员工。
本 skill 是**大脑/编排器**：你（宿主 LLM）读本文件做决策，按工作流调度下列原子；**手脚**是 `feishu-shared/` 能力模块与 `skills/atoms/*` 原子（封装 lark-cli）；**记忆**是飞书多维表格（任务表/槽位表）；状态全在 Base，每次处理都"读 Base→决策→执行→写回 Base"，因此无状态、可移植、抗重启。

## 原子/模块地图（原子化后）
本文下方工作流用到的短名 → 实际位置：
- `collect-store`（base-io：createTask/createSlots/querySlots*/queryTasksByStatus/updateSlotState/updateTaskState/upsertSlotValue）→ `skills/atoms/collect-store/`
- `clean.*`（cleanIdCard/Size/Email/Date）→ `skills/atoms/collect-clean/`
- `state.nextSlotState`（状态机）→ `skills/atoms/collect-slot-fsm/`
- `schedule.selectSlotsToNudge` + `NUDGE_STATES`（催办挑选）→ `skills/atoms/collect-nudge/`
- `wrapup.planWrapup`（收工汇报）→ `skills/atoms/collect-wrapup/`
- `file.*` / `contact.*` / `message.*`（含 sendGroupMention/buzz）/ `cell-write.*` → `skills/feishu-shared/src/`
- `larkcli` / `hash` / `base-crud` → `skills/feishu-shared/src/`（底座）

## 两条铁律（不可违反）

1. **写真人前先发起确认**：解析出收集计划后，必须先在群里把"要收集什么字段、问哪些人、什么场所、截止时间、催办策略"复述给发起人，得到确认后才开始向真人发问。
2. **写回前复述确认**：把清洗后的值复述给提供者确认无误，再写回文件。

并遵守：① 缺失值**绝不编造**，到期未交就如实列入"未交名单"；② 写文件 403 时**不静默失败**，提示发起人加协作者；③ 本地文件转在线失败**不静默 fallback**，报明原因。

## 核心数据模型

一个收集任务 = 一组**槽位**。槽位 = `字段名 × 对象(关于谁/哪行) × 落点(写回位置) × 责任人(可选) × 值 × 状态`。
槽位状态机（用 `collect-slot-fsm` 的 `nextSlotState`）：`待问→已问→收到原始→清洗中⇄清洗中(追问)→待确认⇄清洗中(改正)→已填`，旁支 `跳过/不适用/待澄清`。

## 配置（环境变量）

`COLLECTOR_APP_TOKEN`（状态库 Base）、`COLLECTOR_TASKS_TABLE`（默认"任务表"）、`COLLECTOR_SLOTS_TABLE`（默认"槽位表"）、可选 `LARK_PROFILE`（如 `qianhai`）。首次用 `bin/setup-base.js` 建库。

## 工作流

### A. 意图分类
收到 @机器人 消息 → 判断：**新发起**（带文件/表格 + 收集意图）/ **进度查询**（"还差谁/进度"）/ **暂停取消** / **开放式登记上报**。
收到非 @ 的私信/消息 → 若发送者在某活跃任务有未终结槽位 → 走 **收集推进**；否则忽略。
（`bin/on-message.js` 已替你做了快速归属判定并给出 senderActiveSlots，可直接用。）

### B. 新发起
1. 拿到文件引用：飞书链接 → `file.inspectUrl(url)`；本地文件 → `file.localToOnline(path, type)`（失败必须报错）。
2. `file.parseSource(ref)` 读结构（headers/rows/可填列/责任人列）。
3. 用你的推理把"结构 + 指令"转成**收集计划**：
   - 形态判定：表格按行收集 / 问题清单向特定人 / 开放式登记。
   - 字段集、每槽 `对象` 与 `落点`、`场所`（群/私信/混合）、`截止时间`、`催办策略`（间隔小时 + maxAttempts）。
   - 责任人：对每个责任人原文调 `contact.resolvePerson(raw)` →
     `unique` 直接用；`ambiguous` 列候选交发起人/继续追问消歧；`none` 槽位标 `待澄清`，发起确认时一并列出无法匹配的人名。
4. **发起确认**（铁律1）：在群里发计划摘要，等发起人确认。
5. 确认后落库：`base-io.createTask(ctx, 任务字段)` → `base-io.createSlots(ctx, taskId, 槽位[])`，任务状态 `收集中`。
6. 发首轮询问：按场所 `message.sendDM`/`sendGroup`；每槽 `updateSlotState(ctx, slotId, {状态:'已问', 最近询问时间: now})`。

### C. 收集推进（收到收集对象回复）
1. 取 `senderActiveSlots`（on-message 已给）或 `base-io.querySlotsByAssignee`。
2. 用你的推理把这条回复**映射到一个/多个槽位**（一句话可能答多个字段）。
3. 对每个被答的字段值做**清洗**：能用 `clean.cleanIdCard/cleanSize/cleanEmail/cleanDate` 的用之；不在内置类型里的，按字段语义自行校验。
   - 不合格 → 用返回的 `followup` 追问，槽位留 `清洗中`（`nextSlotState('清洗中','clean_failed')`）。
4. 合格 → **复述确认**（铁律2）。对方否认 → 回 `清洗中` 重来。
5. 确认 → 写回目标文件：用 `cell-write.buildWriteCommand(落点, 值)` 生成命令、`larkcli.lark()` 执行（幂等由 `base-io.upsertSlotValue` 的 `内容指纹` 比对保证：同值 skip、变值覆盖）；成功后槽位 `已填`。
   - 写回 403 → 不静默失败，提示发起人把机器人加为该文件协作者。
   - 目标格已被人工改且与将写入不一致 → 不覆盖，转发起人确认。

### D. 进度查询
聚合该任务槽位状态 → 回"已收 X/Y，还差 〔责任人 + 字段〕…"。

### E. 暂停/取消/收工
- 暂停/取消：更新任务状态 `暂停`/`已取消`，停止催办。
- 收工：**已由 `bin/tick.js` 自动完成**（见 F）——全部终结或到期 → 群发完成汇报（含未交名单）→ 任务置 `已完成`。你需要的话可在汇报里附上填好的文件链接。

### F. 催办 + 收工（由 `bin/tick.js` 周期触发，通常无需你手动介入）
tick 逐任务隔离处理（单任务出错不影响其他），每任务一次取全槽（消 N+1）：
- **催办**：`schedule.selectSlotsToNudge`（按 `NUDGE_STATES` 挑超间隔未填、未达 maxAttempts 的槽，临近截止 <6h 标 urgent）→ **统一在发起群里公开 @ 责任人**发提醒（`message.sendGroupMention`，带 `--idempotency-key`=`slot_id#轮次` 防重复 @；先记计数后发送，崩溃也不重复刷屏）；无责任人槽发群内普通认领提醒。urgent 时对该群催办消息 `message.buzz` 加急，**每槽加急有上限**（`加急次数` 字段，默认 3）。催办不走私信。
- **收工**：`wrapup.planWrapup(task, allSlots, now)` 判定到期/全终结 → 群发完成汇报（含未交名单，`wrapup` 生成、缺失不编造）→ `collect-store.updateTaskState` 置 `已完成`，任务级 idempotency-key 防重复发。

## 部署（各运行时挂心跳层 —— 上层逻辑完全一致，只差触发接线）

- **Claude Code**：`lark-cli event consume im.message.receive_v1` 管道到 `bin/on-message.js`，其输出交当前 agent 按本 SKILL 处理；`bin/tick.js` 用 `/schedule` 周期触发。
- **OpenClaw**：装飞书通道插件（`@larksuite/openclaw-lark`）把消息路由到 agent；`openclaw cron` 注册 `node bin/tick.js`（自带 cron）。
- **Hermes**（本项目选定运行时）：
  1. skill 放 `~/.hermes/skills/feishu-collector/`（Hermes 启动时自动注册）。
  2. 对话入口由 Hermes 飞书 channel 提供：收到 @机器人/私信 → agent 读本 SKILL.md → 用 terminal 工具调 `node bin/on-message.js --event '<事件JSON>'` 取工作上下文 → 按工作流执行（手脚=terminal 调 lark-cli）。
     ⚠️ Hermes 飞书 channel 投递给 agent 的消息结构需在 Hermes 环境确认后对接 `bin/on-message.js` 的 `extract()`（所需字段：chat_id / chat_type / sender open_id / mentions / content / message_id）。
  3. 催办：系统 cron 注册 `cd ~/.hermes/skills/feishu-collector && node bin/tick.js`（如每 30 分钟一次）。
  4. 环境变量：`COLLECTOR_APP_TOKEN` / `COLLECTOR_TASKS_TABLE` / `COLLECTOR_SLOTS_TABLE`（+ 可选 `LARK_PROFILE`），由 `bin/setup-base.js` 输出。

## 上线前置（见 ../../docs/pipeline/env-capabilities.yaml 的 missing_or_unverified）

补 bot 发送消息 scope、让 bot 入群（加急/群发需要）、确认在线表格写 scope、刷新过期的 user token。本功能**不需要**敏感的 `im:message.group_msg`。
