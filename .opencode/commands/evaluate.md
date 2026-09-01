---
description: 评估各施工队表现（谁找得多、谁找得准），数据来自任务账本 + 裁决账本
agent: build
---

# 模型表现评估

对 `/audit` 累积数据做多维度评估：**数量**（谁报得多）+ **质量**（谁报得准）。

## Step 1: Run

用 Bash 运行（在项目目录）：

```
node scripts/evaluate-models.mjs
```

输出一张表：`run / avg/run / 共识率 / precision / 独有真 / 样本`。

- **run / avg/run / 共识率**：来自任务账本（`/audit` 累积），免费。
- **precision / 独有真**：来自裁决账本（`.cc-suite-cn/verdict-log.json` 里 hy4-preview 已裁决的 finding），**免费只读**——裁决结果已落库，不重新花钱。

若账本还有未裁决的 finding，先用 `--arbitrate` 补裁决（见下），再回来算 precision。

## Step 2: 裁决账本（`--arbitrate`，/fix 硬门槛）

```
node scripts/evaluate-models.mjs --arbitrate
```

hy4-preview 逐条裁决账本里**尚未裁决**的 finding（含 `verdict` 为空和 `uncertain` 的），并把 `verdict/evidence/codeHash` 落库。输出「已裁决 N 条（真 X / 假 Y / 不确定 Z）」。

> 这是 `/fix` 的硬门槛：只修 hy4-preview 判 `true` 的 finding。裁决花钱（起 hy4-preview）且耗时（一条一调）。

## Step 3: 汇报

- **run / avg/run**：跑了多少次审计、平均每次报几条（数量）
- **共识率**：报的 finding 里有多少也被别的施工队发现（质量，免费）
- **precision**：hy4-preview 判定为真的比例（质量，从账本免费读）
- **独有真**：谁抓到了别人漏掉的真 bug（最有含金量）
- **样本 ⚠不足**：run 数或已裁决 finding 数不足 5，结论仅供参考

## Critical Rules

- **precision 是"hy4-preview 判定为真的比例"，不是客观准确率**——汇报时必须说明这一点
- precision 只统计**有模型归属且已裁决（true/false）**的 finding；无归属或 uncertain 的不参与
- 样本不足（⚠）就如实说"样本不足"，不编结论
- 数据来自任务账本（`/audit` 累积），没数据就提示"先跑 /audit"
