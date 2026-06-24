# 新增公司飞书数字员工：完整 Checklist

> 本文档是给 AI 助手和人类操作者的**逐步执行清单**，基于实际部署踩坑经验总结。
> 每一步都有前置条件和验证方法，不要跳步，不要回退重来。

## 前置条件

- [x] lark-cli 已安装（`@larksuite/cli`，**不是** `feishu-cli`）
- [x] Hermes Agent 已安装
- [x] 服务器上已有至少一个正常运行的飞书 worker profile（如 `feishu-worker`）

> ⚠️ **第一件事：先读已有 worker 的 `.env` 作为模板！** `cat ~/.hermes/profiles/feishu-worker/.env`，逐字段对比，确保新 profile 覆盖所有必要字段。**不要凭记忆写 .env。**

---

## Phase 0：信息收集（全部确认后再动手）

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

确认 `appId` 是**新公司的 App ID**。

> 💡 lark-cli 切换 profile 用 `--profile <name>` 参数，**不是** `LARK_PROFILE` 环境变量。

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

将 URL 和二维码图片发给用户，**等待用户完成授权**。

> ⚠️ **踩坑**：
> - device_code 有效期 600 秒
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

---

## Phase 3：创建 Hermes Profile

### 3.1 创建 profile

```bash
hermes profile create <profile名> --description "<公司名>飞书数字员工"
```

### 3.2 配置 config.yaml

```bash
hermes -p <profile名> config set model.default <model>
hermes -p <profile名> config set model.provider <provider>
hermes -p <profile名> config set model.base_url <url>
hermes -p <profile名> config set model.api_key <key>
hermes -p <profile名> config set platforms.feishu.enabled true
hermes -p <profile名> config set platforms.feishu.connection_mode websocket
hermes -p <profile名> config set platforms.weixin.enabled false
```

### 3.3 写入 .env（⚠️ 最容易出错的一步）

> ⚠️ **关键踩坑**：终端/CLI 工具会对 `FEISHU_APP_SECRET` 等 secret 值做脱敏截断。
> **不要用 terminal 的 heredoc/cat/echo 写入 secret 值，必须用 Python 直接写文件。**

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

# ⚠️ 用 Python 直接写文件，不要用终端 heredoc（会被脱敏截断）
env_content = f"""FEISHU_APP_ID=<APP_ID>
FEISHU_APP_SECRET=*** = "*** open(os.path.expanduser(f'~/.hermes/profiles/<profile名>/.env'), 'w') as f:
    f.write(env_content)
```

> ⚠️ **必填字段说明（每一个漏了都会出问题）：**
>
> | 字段 | 不写的后果 |
> |---|---|
> | `GATEWAY_ALLOW_ALL_USERS=true` | Gateway 拒绝所有消息 |
> | `FEISHU_GROUP_POLICY=open` | **群消息全部被拒绝**（默认 `allowlist`，但没配白名单） |
> | `FEISHU_HOME_CHANNEL` | 机器人无处回复群消息（可选） |
>
> `FEISHU_GROUP_POLICY` 可选值：`open` / `allowlist`（需配 `FEISHU_ALLOWED_USERS`）/ `blacklist` / `disabled`

### 3.4 验证 .env

```bash
xxd ~/.hermes/profiles/<profile名>/.env | head -20
```

确认 `FEISHU_APP_SECRET=` 后面是完整的 32 字符，**不是**被截断的 `okpu6X...`。

### 3.5 写入 SOUL.md

```bash
cat > ~/.hermes/profiles/<profile名>/SOUL.md << 'EOF'
你是「<公司名>数字员工」，一个工作在飞书上的 AI 助手。
...
EOF
```

---

## Phase 4：同步 Skills

```bash
WORKER_SKILLS=~/.hermes/profiles/<profile名>/skills
SOURCE_SKILLS=<项目目录>/skills

cp -r $SOURCE_SKILLS/feishu-init $WORKER_SKILLS/
cp -r $SOURCE_SKILLS/feishu-collector $WORKER_SKILLS/
cp -r $SOURCE_SKILLS/feishu-kb-maintainer $WORKER_SKILLS/
cp -r $SOURCE_SKILLS/feishu-shared $WORKER_SKILLS/
cp -r $SOURCE_SKILLS/atoms $WORKER_SKILLS/
```

> ⚠️ atoms 必须是 `skills/atoms/`，不能是 `skills/feishu-atoms/`（相对路径 import 会断）。

---

## Phase 5：创建 Base（状态库）

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-collector/bin/setup-base.js

env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-kb-maintainer/bin/setup-route-base.js
```

将输出的 token 用 Python 追加到 .env（不要用终端 heredoc）。

---

## Phase 6：安装并启动 Gateway

```bash
echo -e "y\ny" | <profile名> gateway install
```

验证连接：

```bash
journalctl --user -u hermes-gateway-<profile名> --no-pager -n 20
```

确认看到 `[Lark] [INFO] connected to wss://msg-frontier.feishu.cn/...`。

---

## Phase 7：飞书配对

```bash
<profile名> pairing approve feishu <配对码>
```

---

## Phase 8：事件订阅

```bash
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
| `app_id or app_secret is invalid` | .env 中 secret 被终端脱敏截断 | 用 Python 解密后直接写文件 |
| `No user allowlists configured` | .env 缺 `GATEWAY_ALLOW_ALL_USERS=true` | 追加到 .env |
| 群消息无反应，私聊正常 | .env 缺 `FEISHU_GROUP_POLICY=open` | 追加到 .env |
| `No LLM provider configured` | config.yaml 缺 model 配置 | 确认 4 个字段 |
| 扫码后"没有 XX 助手权限" | device_code 关联了错误公司 | 重新生成授权链接 |
| atoms import 报错 | atoms 放到了 `feishu-atoms/` | 确保扁平结构 `skills/atoms/` |

---

## 一句话总结

> **先读已有 worker 的 .env → 收集信息 → lark-cli init → user 授权 → hermes profile create → 写 .env（用 Python，含 GROUP_POLICY）→ 同步 skills → 建 Base → gateway install → 配对 → 事件订阅 → cron**
