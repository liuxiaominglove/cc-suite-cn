---
description: 完整审计 — 找 bug(glm+kimi) + 批判员(qwen) + 验证审计员(hy4-preview 裁决)
argument-hint: <path>
agent: build
---

# 完整审计（找 bug + 批判 + 裁决）

对 `$ARGUMENTS` 跑完整 4 角色流程（三个只读环节）：

> `$ARGUMENTS` 是**路径**（文件或目录）。空参数 → 提示用户「请指定文件或目录，如 `/audit-full src/file.ts`」，不继续。路径不存在/不可读 → 提示用户路径无效，不继续。

> **项目根目录（`--project-dir`）**：先取项目根——目录 → `git -C "<目录>" rev-parse --show-toplevel`；文件 → `git -C "$(dirname "<文件>")" rev-parse --show-toplevel`；非 git 则省略。下面 `--run-audit` / `--arbitrate` 都带 `--project-dir "<项目根>"`。

| 环节 | 角色 | 干什么 |
|------|------|--------|
| 1. 找 bug | glm + kimi | 并行评审，报问题清单 |
| 2. 批判员 | qwen | 独立第二意见（只读 + 沙箱，盲评） |
| 3. 验证审计员 | hy4-preview | 逐条裁决 finding 真假（盲评，只给 finding+代码） |

## Step 1: 找 bug（在项目目录运行）

```
node scripts/jobs.mjs --run-audit --file "<target>" --project-dir "<项目根>"
```

（结果里的 `result.entries` 是**去重后**的 findings，已自动落进统一账本。）

## Step 2: 批判员

从 `<job-id>` 的 `result.entries` 读**去重后**的 findings（含 file/line/finding）。

> **critic 一次只审一个文件**：把 findings 按 `file` 分组，逐文件跑（`--file` 收的是**单个文件的绝对路径**，不是目录）。每组 findings 写成该文件对应的 `/tmp/findings-<序号>.json`，然后对每个有 findings 的文件：

```
node scripts/review-runner.mjs --critic --file "<该文件的绝对路径>" --findings-file /tmp/findings-<序号>.json --project-dir "<项目根目录>" --backend qwen --model qwen3.8-max
```

> **`--project-dir` 必传**：否则 qwen 补漏的 missed finding 落账时 projectDir 会写成 cc-suite-cn 根目录，Step 3 裁决按项目根过滤时被漏掉。

文件模式（`$ARGUMENTS` 是单文件）只有一组；目录模式按文件分组循环。无 findings 的文件跳过。

输出 `{verdicts:[{index, agree, reason}], missed:[{file, line, finding, reason}]}`——qwen 逐条判同意/反对（落账 `critic` 字段）+ 补漏（落账 `source=qwen-critic`）。

## Step 3: 验证审计员裁决

```
node scripts/evaluate-models.mjs --arbitrate --project-dir "<项目根>"
```

（裁决统一账本里尚未裁决的 finding，输出「已裁决 N 条（真/假/不确定）」。）

## Step 4: 汇报

整合三者：
- 找 bug 的 finding（glm+kimi，共识 + 各自独有）
- 批判员的独立意见（qwen）
- 裁决结果（已裁决数 + 真/假/不确定分布）

## Critical Rules

- 三环节都在**项目目录**跑（账本按 cwd 记录）
- 批判、裁决都是**盲评**：下游只拿到 finding + 代码，看不到上游结论和理由
- 样本 ⚠不足就如实说，不编结论
