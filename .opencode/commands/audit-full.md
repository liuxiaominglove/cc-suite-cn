---
description: 完整审计 — 找 bug(glm+kimi) + 批判员(qwen) + 验证审计员(hy3 裁决)
argument-hint: <path>
agent: build
---

# 完整审计（找 bug + 批判 + 裁决）

对 `$ARGUMENTS` 跑完整 4 角色流程（三个只读环节）：

> `$ARGUMENTS` 是**路径**（文件或目录）。空参数 → 提示用户「请指定文件或目录，如 `/audit-full src/file.ts`」，不继续。

| 环节 | 角色 | 干什么 |
|------|------|--------|
| 1. 找 bug | glm + kimi | 并行评审，报问题清单 |
| 2. 批判员 | qwen | 独立第二意见（只读 + 沙箱） |
| 3. 验证审计员 | hy3 | 逐条判 finding 真假，算 precision |

## Step 1: 找 bug（在项目目录运行）

```
node scripts/jobs.mjs --run-audit --file "<target>"
```

## Step 2: 批判员

```
node scripts/review-runner.mjs --backend qwen --model qwen3-coder-plus --file "<target>"
```

## Step 3: 验证审计员裁决

```
node scripts/evaluate-models.mjs --arbitrate
```

## Step 4: 汇报

整合三者：
- 找 bug 的 finding（glm+kimi，共识 + 各自独有）
- 批判员的独立意见（qwen）
- 裁决结果（precision = "hy3 判定为真的比例"，样本不足要如实说）

## Critical Rules

- 三环节都在**项目目录**跑（账本按 cwd 记录）
- precision 是"hy3 判定为真的比例"，不是客观准确率，汇报时说明
- 样本 ⚠不足就如实说，不编结论
