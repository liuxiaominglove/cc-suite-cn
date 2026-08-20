---
description: 验证修复/实现是否正确（只发 git diff，glm+kimi 双施工队逐处审查，省 tokens，记入账本）
agent: build
---

# 验证（diff 审查）

用 glm + kimi 双施工队验证改动是否正确、有无回归。**只发 `git diff HEAD` 的改动区域（hunk + 上下文），不整个文件重发，省 tokens。** 记入任务账本。

> **硬规则：本命令只自动复审 1 次。** 复审后发现 high/medium，**只列现状（finding 清单 + verdict），不自动修复、不自动重新复审**；修复与再审必须由用户显式发起。跑完 Step 3 即停。

## Step 0: 前置检查（内循环先绿 + 防重复审）

```
pnpm test:unit
node scripts/review-gate.mjs --check-stale
```

- `test:unit` 未全绿 → 停止，先修到绿（内循环），不许起门禁。
- `--check-stale` 输出 `stale=true` → 停止（改动未变，上次复审结论仍有效，别重复审）。
- 输出 `stale=false` → 继续。

## Step 1: Run（glm+kimi 两评审员并行，diff 模式，记入账本）

用 Bash 工具运行（在项目目录）：

```
node scripts/jobs.mjs --run-audit --diff
```

（`--diff` 内部跑 `git diff HEAD`，只发改动 hunk + 上下文给评审员，逐处验证"改得对不对 + 有无回归 + 有无遗漏"）

输出 `<job-id>  [completed]`。

## Step 2: 读结果并列现状

```
node scripts/jobs.mjs --get "<job-id>"
```

列现状：两个 worker 各自的顶层 `severity` + 各自 finding 清单，以及 `result.verdict`（`verdictFromFindings` 已自动算：有 high → high，有 medium → medium，否则 clean）。

## Step 3: 写复审标记（commit 门禁），然后停

按 `result.verdict` 写标记：

```
node scripts/review-gate.mjs --mark --verdict <result.verdict>
```

- verdict=high → hook **硬拦** commit（不给 yes）。
- verdict=medium → hook 拦 + 用户确认后可 commit。
- verdict=clean → hook 放行。

**写标记后即停**——不自动修 high/medium、不自动重新复审。修复与再审由用户显式发起。

## Critical Rules

- 只读验证，不修改任何文件
- **只自动复审 1 次**：Step 3 后停止，不自动修复、不自动再审
- **untracked 新文件不在 `git diff HEAD` 里**——新建文件要先 `git add` 才进入评审；否则会漏审
- 空 diff（无改动）时提示"没有待验证的改动"，不调 AI
- **评审员空输出/超时/失败 → 先重试**（`--run-audit` 内部已对空输出/超时重试 2 次，10s/30s 退避；仍失败就重跑一次 job）——限流型空输出是瞬时故障，不能当"没有结论"直接放行
- 重试耗尽仍拿不到非空结论，才如实报告并标「⏸️ 尚未复审」，不得用"部分通过"掩盖
- 不伪造问题——两评审员都拿到非空结论后，才出对比报告
