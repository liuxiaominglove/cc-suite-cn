---
description: 找 bug — /audit 别名（glm + kimi 双施工队并行只读评审，记入任务账本）
argument-hint: <path>
agent: build
---

# 找 bug（/audit 别名）

本命令与 `/audit` 完全一致：对 `$ARGUMENTS` 做 glm + kimi **双施工队并行只读评审**，自动记入任务账本（可用 `/jobs` 查）。

| 施工队 | backend | model |
|--------|---------|-------|
| GLM-5.2 | codebuddy | `glm-5.2` |
| Kimi | kimi | `kimi-k2.7-code` |

> 完整 4 角色流程见 `/audit-full`（找 bug + 批判员 qwen + 验证审计员 hy3 裁决）。

## Step 1: Determine Target

| Input | Behavior |
|-------|----------|
| (empty) | "Please specify a file or directory to audit" |
| file path | Target = that file |
| directory path | 用 `--dir` 模式（`--exts` 匹配文件类型） |

## Step 2: Run（2 施工队并行，记入账本）

```
node scripts/jobs.mjs --run-audit --file "<target>"
```

## Step 3: 读结果并汇总

```
node scripts/jobs.mjs --get "<job-id>"
```

产出 glm + kimi 对比报告（共识 / 各模型单独发现）。

## Critical Rules

- 2 次评审并行，某个模型失败/超时展示其余结果 + 失败说明
- 不伪造问题——全部返回空就如实说
- 只比较、不自己审——你是汇总者，不是评审员
