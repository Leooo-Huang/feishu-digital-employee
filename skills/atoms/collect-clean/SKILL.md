---
name: collect-clean
description: 原子·清洗归一化。把人的脏输入归一化并校验：身份证、T恤尺码、邮箱、日期；不合格返回追问话术。纯函数，无 I/O。供收集线"清洗确认"环节调用。
---

# collect-clean · 清洗归一化（原子）

`src/clean.js`，纯函数。每个返回 `{ ok:true, value }` 或 `{ ok:false, followup }`。

- `cleanIdCard(raw)` — 18 位校验（含末位 X）。
- `cleanSize(raw)` — 归一到 XS/S/M/L/XL/XXL/XXXL。
- `cleanEmail(raw)` — 格式校验。
- `cleanDate(raw)` — 归一到 YYYY-MM-DD，并**校验日期真实存在**（拒 13 月 / 2 月 30 日）。

不在内置类型里的字段，由宿主 LLM 按字段语义自行校验。
