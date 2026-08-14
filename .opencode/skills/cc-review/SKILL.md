---
name: cc-review
description: |
  Multi-model code review — glm+kimi 找 bug, qwen 批判员, hy3 验证审计员裁决, opencode 修 bug. Load for /audit, /audit-full, /review-qwen, /evaluate, /fix, /verify.
  <example>
  Context: User runs /audit src/file.ts
  assistant: Run glm+kimi read-only review, produce consensus + per-model findings report.
  </example>
  <example>
  Context: User runs /evaluate --arbitrate
  assistant: hy3 adjudicates each deduplicated finding true/false and computes per-model precision.
  </example>
scope: global
---

## What I Do

I orchestrate a **four-role code review** across multiple models, each with a distinct job (谁都不批自己):

| 角色 | 模型 | 干什么 | 入口 |
|------|------|--------|------|
| 找 bug | glm-5.2 + kimi-k2.7-code | 只读评审，产出 finding | `/audit`（`--run-audit`） |
| 批判员 | qwen3-coder-plus | 独立第二意见（只读 + `--sandbox`） | `/review-qwen` |
| 验证审计员 | hy3 | 逐条裁决 finding 真假 | `/evaluate --arbitrate` |
| 修 bug | opencode（总指挥） | TDD 修 bug | `/fix` |

Different models have different training data, so they catch different classes of bugs — what one misses, the others often find.

## When to Use Me

Load this skill when the user:
- Types `/audit`, `/audit-full`, `/review`, `/review-qwen`, `/evaluate`, `/fix`, `/verify`
- Says "审查这段代码", "review this code", "帮我找 bug", "检查一下"

## How I Work

1. Identify target file(s) from the request.
2. Run the find-bug workers (glm + kimi, read-only, parameterized backend) via:
   `node scripts/jobs.mjs --run-audit --file <path>` (记入任务账本 + audit-log)
   - Large files (>800 lines) are auto-chunked (`chunkCode` + `offsetFindings`).
   - The被审项目's `AGENTS.md` / `CLAUDE.md` rules are injected into the review prompt (project-specific rules avoid false positives).
   - Transient failures auto-retry; worker OK/FAIL is shown in the summary.
3. Optionally get a second opinion: `/review-qwen` (critic, read-only + sandbox).
4. Adjudicate findings: `/evaluate --arbitrate` — hy3 judges each deduplicated finding true/false and computes per-model precision.
5. Fix real bugs: `/fix` — opencode fixes with TDD (RED → GREEN → REFACTOR), never commits automatically.
6. Verify: `/verify` — review `git diff HEAD`.

## Critical Rules

- **谁都不批自己**: 找 bug / 批判 / 裁决 / 修 bug 是四个独立角色，修 bug 只由 opencode（最了解项目 + TDD）亲自做。
- 施工队（glm/kimi/qwen/hy3）全部只读，不写代码。
- 找 bug 的 finding 用英文（`REVIEW_PROMPT` 要求），跨语言共识才能对齐。
- If one worker fails, still show the others' results + a failure note.
- If all models return empty, state that clearly. Do not fabricate issues.
- 汇报「已验证」必须能在 `docs/verification.md` 找到对应行（三色置信度 🟢🟡🔴）。

## Key Scripts (single source of truth in this repo)

- `scripts/review-runner.mjs` — 只读评审（review/reviewFile/chunkCode/offsetFindings/retry/AGENTS.md 注入）
- `scripts/evaluate-models.mjs` — finding 归一化/共识/去重/裁决/多维评估
- `scripts/jobs.mjs` — 任务账本 + runAudit + 后台/取消
- `scripts/models.mjs` — 4 施工队单一数据源（WORKERS / FIND_BUG_WORKERS / CRITIC_MODEL / VERIFIER_MODEL）
- `scripts/guard.mjs` — drift guard（单一数据源守护）
- `.opencode/agents/*.md` — B 分身 subagent 定义
