---
name: cc-review
description: |
  Multi-model code review — glm+kimi 找 bug, qwen 批判员, hy3 验证审计员裁决, opencode 修 bug. Load for /audit, /audit-full, /review, /review-kimi, /review-qwen, /evaluate, /fix, /verify, /trace.
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
- Types `/audit`, `/audit-full`, `/review`, `/review-kimi`, `/review-qwen`, `/evaluate`, `/fix`, `/verify`, `/trace`
- Says "审查这段代码", "review this code", "帮我找 bug", "检查一下"

## How I Work

**四角色五步**（判真假走"裁决初筛 + 终审"，谁都不批自己）：

```
1. 找 bug（glm + kimi）      → 产出 finding 池
2. 批判员（qwen）            → 补充第二意见，追加漏报（可选）
3. 裁决（hy3）              → 初筛：逐条判真假，verdict 落库 + codeHash【修 bug 前置硬门槛】
4. 终审 + 修 bug（opencode） → 对 verdict=true 的做代码级核实 + TDD 修
5. 验证（/verify）          → diff 审查
```

1. Identify target file(s) from the request.
2. Run the find-bug workers (glm + kimi, read-only, parameterized backend) via:
   `node scripts/jobs.mjs --run-audit --file <path>` (记入任务账本 + audit-log)
   - Large files (>800 lines) are auto-chunked (`chunkCode` + `offsetFindings`).
   - The被审项目's `AGENTS.md` / `CLAUDE.md` rules are injected into the review prompt (project-specific rules avoid false positives).
   - Transient failures auto-retry; worker OK/FAIL is shown in the summary.
3. Optionally get a second opinion: `/review-qwen` (critic, read-only + sandbox).
4. Adjudicate findings: `/evaluate --arbitrate` — hy3 judges each deduplicated finding true/false, computes per-model precision, and **persists each verdict (with codeHash) via `scripts/verdict-log.mjs`** (落库到 `.cc-suite-cn/` 裁决账本).
5. Fix real bugs: `/fix` — opencode fixes with TDD (RED → GREEN → REFACTOR), never commits automatically.
6. Verify: `/verify` — review `git diff HEAD`.

## Critical Rules

- **谁都不批自己**: 找 bug / 批判 / 裁决 / 修 bug 是四个独立角色，修 bug 只由 opencode（最了解项目 + TDD）亲自做。
- **审计前置两道闸门**: opencode 修代码前必须通过两道审计——① hy3 裁决（verdict=true）② opencode 代码级终审。未过闸门不得修。修 bug 前必须先 `/evaluate --arbitrate` 落库 verdict；只修 hy3 判 `true` 且 codeHash 未失效的 finding。`codeHash 未失效` = 该文件内容自裁决后没变（裁决时算 sha256，修前重算对比；变了就判 verdict 作废、须重新裁决）。跳过裁决 = "先修后验"，会让 hy3 看到修好的代码、误判成假阳。Override 出口（客观标准）：仅当 opencode 用**代码级证据**确认「hy3 判 false 但这是真 bug」（假阴）时可跳过裁决直接修，须在台账标"未经裁决" + 附代码级证据；不得以"紧急/小 bug"这类模糊理由跳过。
- 施工队（glm/kimi/qwen/hy3）全部只读，不写代码。
- 找 bug 的 finding 用英文（`REVIEW_PROMPT` 要求），跨语言共识才能对齐。
- If one worker fails, still show the others' results + a failure note.
- If all models return empty, state that clearly. Do not fabricate issues.
- 汇报「已验证」必须能在 `docs/verification.md` 找到对应行（三色置信度 🟢🟡🔴）。

## Report Template (每次工作完总结必带两节)

每条 cc-suite-cn 命令的总结，末尾固定附两节（详见 `AGENTS.md`「汇报惯例」）：

```
## 本次各 AI 表现
- 底线（每次必加）：各模型 success / issue 数（读 job result，不编）。
- 加码（仅当本次做了 triage/裁决）：真 bug / 假阳 / 噪音 / 共识 + precision。
  没做 triage 就写"未 triage，仅计数"。

## 本次触达功能
对照 docs/features.md 基线清单逐项标三色；没用的功能标"未触达"，不算 🟢。
```

- 每个 🟢 必须能指向 `docs/verification.md` 对应行或本次命令输出。
- 两节只是追加，不替代原有评审/修复内容汇报。

## Key Scripts (single source of truth in this repo)

- `scripts/review-runner.mjs` — 只读评审（review/reviewFile/chunkCode/offsetFindings/retry/AGENTS.md 注入）
- `scripts/evaluate-models.mjs` — finding 归一化/共识/去重/裁决/多维评估（`--arbitrate` 落库 verdict）
- `scripts/verdict-log.mjs` — 裁决账本（persist/load/getActionableFindings/isVerdictStale + codeHash）
- `scripts/jobs.mjs` — 任务账本 + runAudit + 后台/取消
- `scripts/models.mjs` — 4 施工队单一数据源（WORKERS / FIND_BUG_WORKERS / CRITIC_MODEL / VERIFIER_MODEL）
- `scripts/guard.mjs` — drift guard（单一数据源守护）
- `.opencode/agents/*.md` — B 分身 subagent 定义
