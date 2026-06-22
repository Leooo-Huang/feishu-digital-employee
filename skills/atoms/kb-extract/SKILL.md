---
name: kb-extract
description: 原子·知识抽取归类。把要点归一为决策/结论/待办/FAQ，去重并生成小节指纹。纯函数（语言抽取由宿主 LLM 先做，本原子做归一/分组/指纹）。供知识库线沉淀前调用。
---

# kb-extract · 抽取归类（原子）

`src/extract.js`，纯函数。

- `normalizeItem` / `normalizeItems(items)` — 把 LLM 抽出的要点归一（kind ∈ 决策/结论/待办/FAQ，非法归 conclusion）。
- `groupByKind(items)` — 按 kind 分组。
- `sectionFingerprint(items)` — 算小节内容指纹（配合 kb-route 幂等去重）。

语言层"从原文抽要点、丢闲聊"由宿主 LLM 完成；本原子负责确定性的归一、分组、指纹。
