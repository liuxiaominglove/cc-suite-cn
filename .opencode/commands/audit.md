---
description: 找 bug — GLM + Kimi 两个施工队并行只读评审（记入任务账本）
argument-hint: <path>
agent: build
---

# 找 bug（代码审计）

对 `$ARGUMENTS` 做**双施工队只读评审**，glm + kimi 并行找 bug（结果记入任务账本（`/jobs` 查）+ audit-log）：

| 施工队 | backend | model |
|--------|---------|-------|
| GLM-5.2 | codebuddy | `glm-5.2` |
| Kimi | kimi | `kimi-k2.7-code` |

> 完整 4 角色流程见 `/audit-full`（找 bug + 批判员 qwen + 验证审计员 hy3 裁决）。

## Step 0: 基线检测（增量审查，若项目是 git 仓库）

若 `$ARGUMENTS` 是**项目根目录**（git 仓库），先用 Bash 检测是否审过、有无变更：

```
node scripts/audit-baseline.mjs --detect "<项目根目录>"
```

按输出分支处理：

| 输出 | 处理 |
|------|------|
| `isGit: false` | 非 git 仓库，跳过本步，直接全量审 |
| `dirty: true` | **工作区有未提交改动**——提示用户「工作区未提交改动不在 `git diff` 对比内，增量结果可能不完整」，询问「先提交再增量审 / 继续全量审」；选「先提交」→ 等用户 commit 后重跑 `--detect` 再增量审 |
| `firstAudit: true` | 首次审计（无历史基线）——**先询问用户「增量基线」**：从哪个 commit/tag 起算（如「自 vX.Y.Z 以来的改动」），据此人工切 `git diff <tag>...HEAD` 得到变更文件列表；用户答不出基线时再全量审。得到的文件列表，逐个 `--run-audit --file`（串行） |
| `changed: false` | 自上次审计无变更，提示用户并询问是否仍要审 |
| `changed: true` + `files` 非空 | **主动询问用户：「检测到上次审计后 N 个文件变更，是否增量审查（只审变更文件）？」** |

- 用户选**增量**：只对 `files` 列表里的每个文件跑 `--run-audit --file <file>`（**多文件串行**，逐个跑，勿并行拉起多进程）
- 用户选**全量**：照常审整个目录

## Step 1: Determine Target

| Input | Behavior |
|-------|----------|
| (empty) | "Please specify a file or directory to audit, e.g. `/audit src/file.ts`" |
| file path | Target = that file (relative to cwd, or absolute) |
| directory path | 用 `--dir` 模式（`--exts` 匹配文件类型） |
| 路径不存在/不可读 | 提示用户路径无效，不继续 |

> **项目根目录（`--project-dir`）**：先取项目根——目录 → `git -C "<目录>" rev-parse --show-toplevel`；文件 → `git -C "$(dirname "<文件>")" rev-parse --show-toplevel`；非 git 则省略。落账时按项目根隔离，外部项目审计必须带上，否则 finding 归属记错。

## Step 2: Run（2 施工队并行，记入账本）

用 Bash 工具运行（在项目目录）：

```
node scripts/jobs.mjs --run-audit --file "<target>" --project-dir "<项目根>"
```

目录模式：

```
node scripts/jobs.mjs --run-audit --dir "<target>" --exts ".js,.ts,.py,.swift,..." --project-dir "<项目根>"
```

输出形如 `<job-id>  [completed]`。记下 job-id。

### 运行方式（重要：防 shell 超时误杀）

- **中/大文件（几百行以上，或单个文件可能审 >7 分钟）一律用后台模式**，避免前台 shell 超时掐断：
  ```
  node scripts/jobs.mjs --run-audit --file "<target>" --background
  ```
  后台任务用 `node scripts/jobs.mjs --list` 轮询到 `completed` 再读结果。
- 若用前台模式，shell 超时**必须 ≥ 960s**（review-runner 内部单 worker 超时是 900s，shell 要留余量）。
- 内容分块阈值是 **800 行**（超过自动分块，与超时无关）；几百行的文件虽不分块，也可能审得慢，照样建议后台。
- **超时/卡住后**：先 `ps` 核对真实进程是否还在；账本残留的「running」僵尸记录用 `node scripts/jobs.mjs --cancel <id>` 清理，不要轻信。

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

## 失败/超时（如有）
- {model}: {失败说明}

## 本次各 AI 表现
（见 AGENTS.md「汇报惯例」第一节：各模型 success / issue 数）

## 本次触达功能
（见 AGENTS.md「汇报惯例」第二节：对照 docs/features.md 标三色）
```

## Critical Rules

- 2 次评审**并行**（`--run-audit` 内部已并行 + 记 1 条账）
- 某个模型失败/超时，展示其余结果 + 失败说明
- 不伪造问题——全部返回空就如实说
- 只比较、不自己审——你是汇总者，不是施工队
- **审完更新基线**（若做了 Step 0 且项目是 git 仓库）：`node scripts/audit-baseline.mjs --save "<项目根目录>"`，下次审计才能增量对比
