---
description: 评估各施工队表现（谁找得多、谁找得准），数据来自任务账本
agent: build
---

# 模型表现评估

对任务账本里累积的 `/audit` 数据做多维度评估：**数量**（谁报得多）+ **质量**（谁报得准）。

## Step 1: Run

用 Bash 运行（在项目目录）：

```
node scripts/evaluate-models.mjs
```

若要精确到"谁找得准"（验证审计员 hy3 逐条裁决独有 finding），加 `--arbitrate`：

```
node scripts/evaluate-models.mjs --arbitrate
```

## Step 2: 汇报

按输出表格向用户解释：

- **run / avg/run**：跑了多少次审计、平均每次报几条（数量维度）
- **共识率**：报的 finding 里有多少也被别的施工队发现（质量维度，免费）
- **precision**（仅 --arbitrate）：验证审计员 hy3 判定为真的比例（质量维度，花钱）
- **独有真**（仅 --arbitrate）：谁抓到了别人漏掉的真 bug（最有含金量）
- **样本 ⚠不足**：该模型不足 5 次 run，结论仅供参考

## Critical Rules

- **precision 是"hy3 判定为真的比例"，不是客观准确率**——汇报时必须说明这一点
- 样本不足（⚠）就如实说"样本不足"，不编结论
- 数据来自任务账本（`/audit` 累积），没数据就提示"先跑 /audit"
