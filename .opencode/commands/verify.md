---
description: 验证修复/实现是否正确（只发 git diff，glm+kimi 双施工队逐处审查，省 tokens，记入账本）
agent: build
---

# 验证（diff 审查）

用 glm + kimi 双施工队验证改动是否正确、有无回归。**只发 `git diff HEAD` 的改动区域（hunk + 上下文），不整个文件重发，省 tokens。** 记入任务账本。

## Step 1: Run（glm+kimi 两评审员并行，diff 模式，记入账本）

用 Bash 工具运行（在项目目录）：

```
node scripts/jobs.mjs --run-audit --diff
```

（`--diff` 内部跑 `git diff HEAD`，只发改动 hunk + 上下文给评审员，逐处验证"改得对不对 + 有无回归 + 有无遗漏"）

输出 `<job-id>  [completed]`。

## Step 2: 读结果并汇总

```
node scripts/jobs.mjs --get "<job-id>"
```

两模型对比报告：共识（两模型都发现）+ 各模型单独发现。

## Critical Rules

- 只读验证，不修改任何文件
- **untracked 新文件不在 `git diff HEAD` 里**——新建文件要先 `git add` 才进入评审；否则会漏审
- 空 diff（无改动）时提示"没有待验证的改动"，不调 AI
- 不伪造问题——评审员返回空就如实说
