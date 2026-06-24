# 新增公司飞书数字员工：完整 Checklist

> 本文档是给 AI 助手和人类操作者的**逐步执行清单**，基于实际部署踩坑经验总结。
> 每一步都有前置条件和验证方法，不要跳步，不要回退重来。

## 前置条件

- [x] lark-cli 已安装（`@larksuite/cli`，**不是** `feishu-cli`）
- [x] Hermes Agent 已安装
- [x] 服务器上已有至少一个正常运行的飞书 worker profile（如 `feishu-worker`）

---

## Phase 0：信息收集（全部确认后再动手）

在开始之前，**一次性收集所有信息**：

```
新公司名称：____________
飞书应用 App ID：____________
飞书应用 App Secret：____________
lark-cli named profile 名：____________（建议与 Hermes profile 同名）
Hermes profile 名：____________（建议用公司简称，如 zhidong）
model：____________（默认跟随 default profile）
飞书域名：feishu（国内）/ lark（海外）
```

> ⚠️ **核心原则：先收集全部信息，再一次性创建所有文件，不要迭代式改一步重启一次。**

---

## Phase 1：飞书应用创建

### 1.1 在飞书开放平台创建应用

1. 打开 https://open.feishu.cn/app → 创建企业自建应用
2. **确认是正确公司**（看左上角公司名！不要选错公司！）
3. 创建后记录 App ID 和 App Secret
4. 开通权限并**发布版本**

### 1.2 初始化 lark-cli named profile

```bash
# ⚠️ 必须清除 HERMES 环境变量，否则会干扰
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli config init --name <profile名> --force-init
```

- 输入 App ID 和 App Secret
- **关闭 strict-mode**（AI 执行环境需要）：选 No

### 1.3 验证 lark-cli profile

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> config show
```

确认输出中 `appId` 是**新公司的 App ID**（不是其他公司的）。

> 💡 **踩坑**：lark-cli 切换 profile 用 `--profile <name>` 参数，**不是** `LARK_PROFILE` 环境变量。不要用环境变量切换 profile。

---

## Phase 2：User 身份授权

lark-cli 以 user 身份创建 Base（Bot 身份缺少 `base:table:create` 权限）。

### 2.1 生成授权链接

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> auth login --no-wait --json
```

输出中包含 `verification_url` 和 `device_code`。

### 2.2 生成二维码

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> auth qrcode \
  --url "<verification_url>" \
  --output /tmp/lark-<profile名>-qrcode.png
```

### 2.3 发送二维码给用户

将 `verification_url` 和二维码图片发给用户，**等待用户完成授权**。

> ⚠️ **踩坑**：
> - device_code 有效期 600 秒，超时需要重新生成
> - **不要**生成后立刻阻塞等 device-code，**不要**短 timeout 反复重试
> - 每次重新调用 `auth login --device-code` 会**作废上一个 device code**
> - 正确流程：生成 → 发给用户 → 等用户回复已完成 → 再续轮询

### 2.4 完成授权轮询

用户确认完成授权后：

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> auth login --device-code "<device_code>"
```

成功后输出 `OK: 授权成功! 用户: <名字>`。

### 2.5 验证

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> auth status
```

---

## Phase 3：创建 Hermes Profile

### 3.1 创建 profile

```bash
hermes profile create <profile名> --description "<公司名>飞书数字员工"
```

这会创建 `~/.hermes/profiles/<profile名>/` 目录，包含 `SOUL.md`、`config.yaml`、profile.yaml。

### 3.2 配置 config.yaml

```bash
# 模型配置（跟 default profile 一致）
hermes -p <profile名> config set model.default <model>
hermes -p <profile名> config set model.provider <provider>
hermes -p <profile名> config set model.base_url <url>
hermes -p <profile名> config set model.api_key <key>

# 平台配置
hermes -p <profile名> config set platforms.feishu.enabled true
hermes -p <profile名> config set platforms.feishu.connection_mode websocket
hermes -p <profile名> config set platforms.weixin.enabled false
```

### 3.3 写入 .env

> ⚠️ **关键踩坑**：终端/CLI 工具会对 `FEISHU_APP_SECRET` 等 secret 值做脱敏截断（只显示前几个字符 + `...`）。
> **不要用 terminal 的 heredoc/cat/echo 写入 secret 值，必须用 Python `write_file` 或 `execute_code` 直接写文件。**

正确做法 — 用 Python 解密并写入（不受终端脱敏影响）：

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os

# 从 lark-cli keychain 解密 App Secret
with open(os.path.expanduser('~/.local/share/lark-cli/master.key'), 'rb') as f:
    key = f.read()
enc_path = f'~/.local/share/lark-cli/appsecret_<APP_ID>.enc'
with open(os.path.expanduser(enc_path), 'rb') as f:
    enc = f.read()
secret = AESGCM(key).decrypt(enc[:12], enc[12:], None).decode()

# 写入 .env（用 Python 直接写，不要用终端 heredoc）
env_content = f"""FEISHU_APP_ID=<APP_ID>
FEISHU_APP_SECRET={secret}
GATEWAY_ALLOW_ALL_USERS=true
"""
with open(os.path.expanduser(f'~/.hermes/profiles/<profile名>/.env'), 'w') as f:
    f.write(env_content)
```

> ⚠️ **另一踩坑**：`GATEWAY_ALLOW_ALL_USERS=true` 如果不写，Gateway 会拒绝所有消息并提示 `No user allowlists configured`。

### 3.4 验证 .env

```bash
xxd ~/.hermes/profiles/<profile名>/.env | head -20
```

确认 `FEISHU_APP_SECRET=` 后面是完整的 32 字符，**不是**被截断的 `okpu6X...`。

### 3.5 写入 SOUL.md

```bash
cat > ~/.hermes/profiles/<profile名>/SOUL.md << 'EOF'
你是「<公司名>数字员工」，一个工作在飞书上的 AI 助手。

## 身份
- 你是<公司名>公司的专属 AI 数字员工
- 通过飞书与团队成员协作
- 语言：中文

## 核心能力
1. **信息收集**：通过飞书多维表格收集成员信息
2. **知识库维护**：自动从会议纪要、讨论、文档中提取要点
3. **周报生成**：基于知识库台账自动生成周报素材
4. **日常协助**：回答问题、整理文档、总结内容

## 工作原则
- 主动、简洁、有条理
- 不确定时先确认再行动
- 处理完任务后主动汇报结果
EOF
```

---

## Phase 4：同步 Skills

```bash
WORKER_SKILLS=~/.hermes/profiles/<profile名>/skills
SOURCE_SKILLS=<项目目录>/skills  # 或从已有 worker 复制

# 复制飞书相关 skills
cp -r $SOURCE_SKILLS/feishu-init $WORKER_SKILLS/
cp -r $SOURCE_SKILLS/feishu-collector $WORKER_SKILLS/
cp -r $SOURCE_SKILLS/feishu-kb-maintainer $WORKER_SKILLS/
cp -r $SOURCE_SKILLS/feishu-shared $WORKER_SKILLS/

# atoms 必须保持扁平结构！不要放到 feishu-atoms/ 子目录下
cp -r $SOURCE_SKILLS/atoms $WORKER_SKILLS/
```

> ⚠️ **关键踩坑**：atoms 目录必须是 `skills/atoms/`，不能是 `skills/feishu-atoms/`。多个 skill（如 scaffold-check.js）用相对路径 `../../atoms/` 引用。

---

## Phase 5：创建 Base（状态库）

### 5.1 用 lark-cli user 身份创建表

```bash
# ⚠️ 必须指定 --profile
cd <项目目录>
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-collector/bin/setup-base.js

env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-kb-maintainer/bin/setup-route-base.js
```

### 5.2 记录输出的 token

将输出的 `COLLECTOR_APP_TOKEN`、`COLLECTOR_TASKS_TABLE`、`COLLECTOR_SLOTS_TABLE`、`KB_APP_TOKEN`、`KB_ROUTE_TABLE` 追加到 profile 的 `.env`：

```python
# 用 Python 追加，不要用终端 heredoc
additional_env = """
COLLECTOR_APP_TOKEN=<token>
COLLECTOR_TASKS_TABLE=<table_id>
COLLECTOR_SLOTS_TABLE=<table_id>
KB_APP_TOKEN=<token>
KB_ROUTE_TABLE=<table_id>
"""
with open('/home/ubuntu/.hermes/profiles/<profile名>/.env', 'a') as f:
    f.write(additional_env)
```

---

## Phase 6：安装并启动 Gateway

### 6.1 安装 systemd service

```bash
# 会提示 "Start now?" 和 "systemd linger?"，选 Y
yes | <profile名> gateway install
```

或交互式（需要 2 次 Y）：

```bash
echo -e "y\ny" | <profile名> gateway install
```

### 6.2 启动 Gateway

```bash
<profile名> gateway start
# 或如果 install 时已启动：
<profile名> gateway status
```

### 6.3 验证连接

```bash
journalctl --user -u hermes-gateway-<profile名> --no-pager -n 20
```

确认看到 `[Lark] [INFO] connected to wss://msg-frontier.feishu.cn/...`。

如果看到 `app_id or app_secret is invalid`，说明 Phase 3.3 的 .env 写入有问题（secret 被截断），回去修复。

---

## Phase 7：飞书配对

首次启动后，Gateway 会显示 7 位配对码（如 `QHLNC8B3`），在飞书上给机器人发消息触发配对后：

```bash
<profile名> pairing approve feishu <配对码>
```

---

## Phase 8：事件订阅

```bash
# 查看订阅计划
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-init/bin/init.js setup-events

# 启动长驻事件订阅
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-init/bin/init.js setup-events --start
```

---

## Phase 9：配置 Cron

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-init/bin/init.js setup-cron
```

---

## 常见问题排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `app_id or app_secret is invalid` | .env 中 secret 被终端脱敏截断 | 用 Python 解密后直接写文件，不要用终端 heredoc |
| `No user allowlists configured` | .env 缺 `GATEWAY_ALLOW_ALL_USERS=true` | 追加到 .env |
| `No LLM provider configured` | config.yaml 缺 model 配置 | 确认 4 个字段都有：default、provider、base_url、api_key |
| 扫码后显示"没有 XX 助手权限" | device_code 关联了错误公司，或已过期 | 重新生成授权链接 |
| Gateway 退出码 75 | 飞书连接失败 | 检查 .env app_secret 完整性 |
| atoms import 报错 | atoms 目录结构不对（feishu-atoms/ 而非 atoms/） | 确保 `skills/atoms/` 扁平结构 |
| 事件收不到 | 未订阅事件或 setup-events 未运行 | Phase 8 订阅并启动 |

---

## 一句话总结

> **收集信息 → lark-cli init → user 授权 → hermes profile create → 写 .env（用 Python）→ 同步 skills（保持 atoms 扁平）→ 建 Base → gateway install → 配对 → 事件订阅 → cron**
