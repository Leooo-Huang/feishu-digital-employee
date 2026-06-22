---
name: feishu-shared
description: 飞书数字员工共享底座（lib，非独立触发）。lark-cli 封装、内容指纹幂等、多维表格通用 CRUD，以及飞书读写能力模块（message/contact/file/cell-write/doc/minutes/chat/task/okr/comment/im-util）。被各原子 skill 与编排器 import 复用。
---

# feishu-shared · 共享底座

可复用模块（直接 `import`），不作为独立可触发 skill。两个编排器与所有原子共享同一份，避免重复。

## 基础设施
- `src/larkcli.js` — `lark(argv,{profile,timeoutMs,retries})` / `larkJson(...)`：execFile 调 lark-cli，带**超时**、**JSON 解析守护**、**保留退出码**（识别 exit 10 二次确认）、**幂等读可选重试**。
- `src/hash.js` — `contentHash` / `needsWrite` / `normalizeForHash`：内容指纹与写/跳过决策。
- `src/base-crud.js` — `searchAll`（offset/limit **分页取尽**）/ `upsert`（**record_id 守护**）/ `get`：多维表格通用 CRUD，支持 `ctx.lark` 注入便于单测。

## 飞书读写能力模块（薄封装，跨域复用）
| 模块 | 能力 |
|---|---|
| `message` | 群发 / 私信 / 群内 @ / 加急 buzz |
| `contact` | 人名 → open_id 解析 |
| `file` | 飞书链接/本地文件 → 在线 + 读结构 |
| `cell-write` | sheet/base/doc 单元格值写回命令 |
| `doc` | Wiki 节点 / 文档段落 读写（含必填参数守卫） |
| `minutes` | 会议搜索 + 妙记纪要获取 |
| `chat` | 群消息按时间窗拉取 |
| `task` | 原生 Task 读写（必填参数守卫） |
| `okr` | 原生 OKR 进展 / 周期读 |
| `comment` | 文档评论读 / 回 |
| `im-util` | `isBotMentioned` 精确判定 @机器人 |
