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
公司简称：____________（如 zhidong）
Hermes profile 名：____________（与公司简称相同）
model：____________
model provider：____________
model base_url：____________
model api_key：____________
飞书域名：feishu（国内）/ lark（海外）
```

> ⚠️ **核心原则：先收集全部信息，再一次性执行，不要迭代式改一步重启一次。**

---

## Phase 1：创建 Hermes Profile + 飞书应用（QR 扫码）

> ⚠️ **顺序严格：先创建 profile，再在 profile 下运行 setup。** `gateway setup` 把凭证写入当前 profile 的 `.env`，profile 不存在就没地方写。

### 1.1 创建 Hermes profile

```bash
hermes profile create <profile名> --description "<公司名>飞书数字员工"
```

### 1.2 在 profile 下运行 Gateway Setup（QR 扫码）

```bash
hermes --profile <profile名> gateway setup
```

交互式流程：

1. **Start gateway now?** → 选 `n`（还没配好，先不启动）
2. **Messaging Platforms** → 选 `Feishu / Lark`
3. **How to set up?** → 选 `Scan QR code to create a new bot automatically`
4. **扫码创建应用** → 发送 QR 码/链接给用户，等待完成
5. **DM authorization** → 选 `Allow all direct messages`
6. **Group chats** → 选 `Respond only when @mentioned`（初始安全选项，后续在 Hermes 侧改为接收全部消息）
7. **Home chat ID** → 直接回车跳过（可选）
8. **Done** → 选 `Done`
9. **Start gateway?** → 选 `n`（后续手动启动，避免反复重启）

> ⚠️ **绝对不要用 `lark-cli config init --new` 创建应用！** 它只创建空壳应用，**不会自动配置事件订阅和版本发布**，导致群消息等事件不推送。这是智洞群消息不工作的根因。

> ✅ `gateway setup` 完成后会自动在 `.env` 中写入：
> - `FEISHU_APP_ID`
> - `FEISHU_APP_SECRET`
> - `FEISHU_DOMAIN`
> - `FEISHU_CONNECTION_MODE`
> - `FEISHU_ALLOW_ALL_USERS=true`
> - `FEISHU_GROUP_POLICY=open`

> ⚠️ **如需接收群里不@机器人的消息**（两步缺一不可）：
> 1. **飞书开放平台**：开通 `im:message.group_msg`（敏感权限，需审批），发布新版本
> 2. **Hermes 配置**：在 `config.yaml` 的 `platforms.feishu` 下加 `require_mention: false`，或在 `.env` 加 `FEISHU_REQUIRE_MENTION=false`

### 1.3 开通应用 API 权限（`?q=` 批量预选 + 发布版本）

> 🔴 **必须做！QR 扫码只自动配了 im + wiki，base/sheets/drive/task/docx/vc/okr 全部没有！**

用 `?q=` URL 参数一条链接预选全部 29 项权限，用户打开后直接确认：

```
https://open.feishu.cn/app/<APP_ID>/auth?q=im:message,im:message:send_as_bot,im:message.p2p_msg:readonly,im:message.group_at_msg:readonly,im:message.group_msg,im:resource,im:chat:readonly,wiki:wiki,wiki:wiki:readonly,docx:document:create,docx:document:readonly,docx:document:write_only,drive:drive:readonly,drive:file:upload,bitable:app,bitable:app:readonly,sheets:spreadsheet,sheets:spreadsheet:readonly,task:task,task:task:readonly,okr:okr,okr:okr:readonly,okr:okr.progress:writeonly,okr:okr.period:readonly,vc:note,vc:note:readonly,vc:video:readonly,contact:user.base:readonly,contact:user.employee:readonly
```

把 `<APP_ID>` 替换为实际 App ID（QR 扫码后从 `.env` 读取）。

开通后**必须发布新版本**才生效：
```
https://open.feishu.cn/app/<APP_ID>/version
```

> ⚠️ 之前的文档说"飞书没有批量开通 API"——那是 REST API 端点（确实不存在），但开放平台网页的 `?q=` 参数是可用的。

### 1.4 配置 model

```bash
hermes -p <profile名> config set model.default <model>
hermes -p <profile名> config set model.provider <provider>
hermes -p <profile名> config set model.base_url <url>
hermes -p <profile名> config set model.api_key <key>
hermes -p <profile名> config set platforms.weixin.enabled false
```

### 1.5 写入 SOUL.md

```bash
cat > ~/.hermes/profiles/<profile名>/SOUL.md << 'EOF'
你是「<公司名>数字员工」，一个工作在飞书上的 AI 助手。
...
EOF
```

---

## Phase 2：同步 lark-cli Profile + User 授权

> ⚠️ Hermes `gateway setup` 只创建了飞书应用，**lark-cli 的 named profile 不会自动更新**。需要手动同步 App ID 到 lark-cli，并做 user 身份授权。

### 2.1 同步 lark-cli named profile

Hermes QR 扫码创建了**新应用**（新 App ID），但 lark-cli profile 如果之前存在，仍指向旧 App ID。必须手动更新：

```python
import json

config_path = "~/.lark-cli/hermes/config.json"
with open(config_path) as f:
    data = json.load(f)

# 读取 Hermes .env 中的新 App ID 和 Secret
with open("~/.hermes/profiles/<profile名>/.env") as f:
    for line in f:
        if line.startswith("FEISHU_APP_ID="):
            new_app_id = line.strip().split("=", 1)[1]
        if line.startswith("FEISHU_APP_SECRET="):
            new_secret = line.strip().split("=", 1)[1]

# 更新 lark-cli profile 的 appId
for app in data["apps"]:
    if app.get("name") == "<profile名>":
        app["appId"] = new_app_id
        app["appSecret"] = {
            "source": "keychain",
            "id": f"appsecret:{new_app_id}"
        }
        break

with open(config_path, "w") as f:
    json.dump(data, f, indent=4, ensure_ascii=False)
```

### 2.2 写入 lark-cli keychain（加密 App Secret）

Hermes `.env` 中的 secret 是明文，lark-cli keychain 需要加密后的二进制文件：

```python
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# 读 master key
with open(os.path.expanduser("~/.local/share/lark-cli/master.key"), "rb") as f:
    key = f.read()

# 加密 secret（输出二进制，不是 hex！）
aesgcm = AESGCM(key)
nonce = os.urandom(12)
ciphertext = aesgcm.encrypt(nonce, new_secret.encode(), None)
enc_path = os.path.expanduser(f"~/.local/share/lark-cli/appsecret_{new_app_id}.enc")
with open(enc_path, "wb") as f:
    f.write(nonce + ciphertext)  # 二进制格式，不是 hex 编码！
```

> ⚠️ **踩坑**：lark-cli keychain 是**二进制格式**（raw bytes），不是 hex 编码。写错格式会报 `cipher: message authentication failed`。

### 2.3 验证 lark-cli profile

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> config show
```

确认 `appId` 是 Hermes `.env` 中的新 App ID。

### 2.4 User 身份授权

知识库、多维表格等操作需要**用户身份**权限（bot 身份权限不足）。

> ⚠️ **必须用 `--recommend` 一次性申请所有推荐 scope！** 包括 `wiki:*`、`base:*`、`im:message`、`drive:*` 等。不带 `--recommend` 会被要求手动指定 scope，很麻烦。

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> auth login --recommend --no-wait --json
```

输出中包含 `verification_url` 和 `device_code`。

#### 生成二维码

```bash
cd /tmp && env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> auth qrcode \
  "<verification_url>" --output ./lark-qrcode.png
```

> ⚠️ `--output` 必须是相对路径！

#### 发给用户 + 等待确认

将 URL 和二维码发给用户，**等待用户回复已完成**。

> ⚠️ **踩坑**：
> - device_code 有效期 600 秒
> - **不要**生成后立刻阻塞等 `--device-code`，**不要**短 timeout 反复重试
> - 每次重新调用 `auth login --no-wait` 会**作废上一个 device code**
> - 正确流程：生成 → 发给用户 → 等用户回复已完成 → 再轮询

#### 完成授权轮询

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> auth login --device-code "<device_code>"
```

成功后输出 `OK: 授权成功! 用户: <名字>`，并显示所有已授权的 scopes。确认包含 `wiki:wiki`、`base:*` 等。

---

## Phase 3：同步 Skills

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

## Phase 4：创建 Base（状态库）

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-collector/bin/setup-base.js

env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-kb-maintainer/bin/setup-route-base.js
```

将输出的 token 用 Python 追加到 .env（不要用终端 heredoc）。

---

## Phase 5：安装并启动 Gateway

```bash
hermes --profile <profile名> gateway start
```

验证连接：

```bash
grep "Connected" ~/.hermes/profiles/<profile名>/logs/gateway.log | tail -1
```

确认看到 `[Feishu] Connected in websocket mode`。

---

## Phase 6：飞书配对

```bash
hermes --profile <profile名> pairing approve feishu <配对码>
```

---

## Phase 7：事件订阅

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-init/bin/init.js setup-events --start
```

---

## Phase 8：配置 Cron

```bash
env -u HERMES_HOME -u HERMES_CONFIG -u HERMES_PROFILE \
  lark-cli --profile <profile名> exec -- node skills/feishu-init/bin/init.js setup-cron
```

---

## 常见问题排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `app_id or app_secret is invalid` | .env 中 secret 被终端脱敏截断 | 用 Python 直接写文件 |
| Gateway 拒绝所有消息 | .env 缺 `GATEWAY_ALLOW_ALL_USERS=true` | 追加到 .env |
| 飞书不推送群消息（gateway.log 无 raw message） | 用了 `lark-cli config init` 而非 QR 扫码创建应用 | 用 `hermes gateway setup` QR 扫码重建 |
| 群消息 raw 到了但没 inbound | `require_mention=true`（默认），Hermes 过滤掉了不@的消息 | `config.yaml` 的 `platforms.feishu` 加 `require_mention: false` |
| 429 时不 fallback | `fallback_model` 用了字符串格式，新版解析器只认字典列表 | 改成 `- provider: / model: / base_url: / api_key:` 列表格式 |
| `cipher: message authentication failed` | lark-cli keychain 文件格式错误（写了 hex 而非 binary） | 用 Python AESGCM 加密后以 `wb` 模式写入 |
| lark-cli `auth scopes` 返回空 | user 授权没做或用了不带 `--recommend` 的授权 | `auth login --recommend --no-wait` |
| lark-cli profile appId 不对 | Hermes QR 扫码创建了新应用但 lark-cli 没更新 | 手动编辑 `~/.lark-cli/hermes/config.json` + 写 keychain |
| atoms import 报错 | atoms 放到了 `feishu-atoms/` | 确保扁平结构 `skills/atoms/` |

---

## 一句话总结

> **创建 profile → QR 扫码（gateway setup）→ `?q=` 批量开通权限 + 发布版本 → 同步 lark-cli（config + keychain）→ user 授权（--recommend）→ 同步 skills → 建 Base → 启动 gateway → 配对 → 事件订阅 → cron**
