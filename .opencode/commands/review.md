---
description: 找 bug — /audit 别名（glm + kimi 双施工队并行只读评审，记入任务账本）
argument-hint: <path>
agent: build
---

# 找 bug（/audit 别名）

本命令是 `/audit` 的**薄别名**：先用 Read 读取 `.opencode/commands/audit.md` 全文，然后**逐步照它执行**——包括 Step 0 基线检测、Determine Target（空参数/路径无效分支）、`--project-dir` 项目根、后台模式、大文件分块、审完更新基线，全部以 audit.md 最新内容为准。`$ARGUMENTS` 原样透传。

> 禁止凭本文件记忆执行——audit.md 是唯一事实来源，保证 /review 与 /audit 行为恒一致。
> 完整 4 角色流程见 `/audit-full`（找 bug + 批判员 qwen + 验证审计员 hy4-preview 裁决）。

## Critical Rules

- audit.md 的 Critical Rules 同样适用（不伪造问题；某施工队失败/超时展示其余结果 + 失败说明）
- 只比较、不自己审——你是汇总者，不是施工队
