---
description: 找 bug — GLM + Kimi 两个施工队并行只读评审（记入任务账本）
agent: build
---

# 找 bug（代码审计）

对 `$ARGUMENTS` 做**双施工队只读评审**，glm + kimi 并行找 bug（自动记入任务账本，可用 `/jobs` 查）：

| 施工队 | backend | model |
|--------|---------|-------|
| GLM-5.2 | codebuddy | `glm-5.2` |
| Kimi | kimi | `kimi-k2.7-code` |

> 完整 4 角色流程见 `/audit-full`（找 bug + 批判员 qwen + 验证审计员 hy3 裁决）。

## Step 1: Determine Target

| Input | Behavior |
|-------|----------|
| (empty) | "Please specify a file or directory to audit, e.g. `/audit src/file.ts`" |
| file path | Target = that file (relative to cwd, or absolute) |
| directory path | 用 `--dir` 模式（`--exts` 匹配文件类型） |

## Step 2: Run（2 施工队并行，记入账本）

用 Bash 工具运行（在项目目录）：

```
node scripts/jobs.mjs --run-audit --file "<target>"
```

目录模式：

```
node scripts/jobs.mjs --run-audit --dir "<target>" --exts ".js,.ts,.py,.swift,..."
```

输出形如 `<job-id>  [completed]`。记下 job-id。

## Step 3: 读结果并汇总

用 Bash 读结果：

```
node scripts/jobs.mjs --get "<job-id>"
```

`result.workers` 是 2 个模型的评审结果数组。据此产出对比报告：

```
═══════════════════════════════════════
  找 bug 评审 — {file or directory}
═══════════════════════════════════════

## 共识（glm 和 kimi 都发现）
- {issue}

## glm-5.2 单独发现
- {issue}

## kimi 单独发现
- {issue}
```

## Critical Rules

- 2 次评审**并行**（`--run-audit` 内部已并行 + 记 1 条账）
- 某个模型失败/超时，展示其余结果 + 失败说明
- 不伪造问题——全部返回空就如实说
- 只比较、不自己审——你是汇总者，不是评审员
