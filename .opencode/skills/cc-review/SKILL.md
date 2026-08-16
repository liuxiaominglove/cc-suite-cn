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

**四角色六步**（判真假走"裁决初筛 + 终审"，谁都不批自己）：

```
1. 找 bug（glm + kimi）      → 产出 finding 池
2. 批判员（qwen）            → 独立第二意见，追加漏报
3. 裁决（hy3）              → 初筛：逐条判真假，verdict 落库 + codeHash【修 bug 前置硬门槛】
4. 终审 + 修 bug（opencode） → 对 verdict=true 的做代码级核实 + TDD 修
5. 验证                     → 编译测试 + /verify 只审 diff + 真机/UI
6. 复审（门控）             → 重跑 1-5，独立确认无回归
```

**命令 → 步骤映射**（不是所有命令都跑全六步）：
- `/audit` / `/review`：步骤 1（找 bug）
- `/audit-full`：步骤 1 + 2 + 3（找 bug + 批判 + 裁决，不修）
- `/review-kimi` / `/review-qwen`：单壳评审（只一个模型，非双施工队）
- `/evaluate --arbitrate`：步骤 3（裁决）
- `/fix`：步骤 1-5 + 门控复审（完整六步闭环）
- `/verify`：步骤 5 里的「只审 diff」（glm+kimi 审改动行）
- `/trace`：只查「报 → 裁 → 修」链路，不评审

1. Identify target file(s) from the request.
2. Run the find-bug workers (glm + kimi, read-only, parameterized backend) via:
   `node scripts/jobs.mjs --run-audit --file <path>` (记入任务账本 + audit-log)
   - Large files (>800 lines) are auto-chunked (`chunkCode` + `offsetFindings`).
   - The被审项目's `AGENTS.md` / `CLAUDE.md` rules are injected into the review prompt (project-specific rules avoid false positives).
   - Transient failures auto-retry; worker OK/FAIL is shown in the summary.
3. Critic (qwen) second opinion: `/review-qwen` — judge each finding 同意/反对 + 补漏（read-only + sandbox）.
4. Adjudicate findings: `/evaluate --arbitrate` — hy3 judges each deduplicated finding true/false, computes per-model precision, and **persists each verdict (with codeHash) via `scripts/verdict-log.mjs`** (落库到 `.cc-suite-cn/` 裁决账本).
5. Fix real bugs: `/fix` — opencode fixes with TDD (RED → GREEN → REFACTOR), never commits automatically.
6. Verify: `/verify` — compile+test + review `git diff HEAD`（只审 diff）+ 真机/UI 点验.
7. 复审（门控）: `/fix` Step 6 — 拿修完的代码重跑 1-5，独立确认无回归；Step 5 后必须硬暂停 + 问用户。

## Critical Rules

- **谁都不批自己**: 找 bug / 批判 / 裁决 / 修 bug 是四个独立角色，修 bug 只由 opencode（最了解项目 + TDD）亲自做。
- **审计前置两道闸门**: opencode 修代码前必须通过两道审计——① hy3 裁决（verdict=true）② opencode 代码级终审。未过闸门不得修。修 bug 前必须先 `/evaluate --arbitrate` 落库 verdict；只修 hy3 判 `true` 且 codeHash 未失效的 finding。`codeHash 未失效` = 该文件内容自裁决后没变（裁决时算 sha256，修前重算对比；变了就判 verdict 作废、须重新裁决）。跳过裁决 = "先修后验"，会让 hy3 看到修好的代码、误判成假阳。**终审既补假阴、也滤假阳**：hy3 判 false 的真 bug（假阴）和 hy3 判 true 实为 by-design 或触发条件错的 finding（假阳）都要靠 opencode 代码级核实兜住，不默认 hy3 结论或 finding 措辞准确。Override 出口（客观标准）：仅当 opencode 用**代码级证据**确认「hy3 判 false 但这是真 bug」（假阴）时可跳过裁决直接修，须在台账标"未经裁决" + 附代码级证据；不得以"紧急/小 bug"这类模糊理由跳过。
- 施工队（glm/kimi/qwen/hy3）全部只读，不写代码。
- **复审门控**: 修 bug 后必须独立复审（重跑 1-5）；Step 5 后硬暂停 + 问用户；复审未做（或用户说跳过）必须显式标「⏸️ 尚未复审」，禁止用「已修复」「全流程完成」掩盖。
- 找 bug 的 finding 用英文（`REVIEW_PROMPT` 要求），跨语言共识才能对齐。
- If one worker fails, still show the others' results + a failure note.
- If all models return empty, state that clearly. Do not fabricate issues.
- 汇报「已验证」必须能在 `docs/verification.md` 找到对应行（三色置信度 🟢🟡🔴）。
- 错误路径：文件不存在/空输入 → 提示用户给路径；缺 CLI/API key → 先跑 `pnpm preflight` 自检，别硬跑。

## Report Template (每次工作完总结必带三节)

每条 cc-suite-cn 命令的总结，末尾固定附三节（详见 `AGENTS.md`「汇报惯例」）：

```
## 本次各 AI 表现
- 底线（每次必加）：各模型 success / issue 数（读 job result，不编）。
- 加码（仅当本次做了 triage/裁决）：真 bug / 假阳 / 噪音 / 共识 + precision。
  没做 triage 就写"未 triage，仅计数"。

## 本次触达功能
对照 docs/features.md 基线清单逐项标三色；没用的功能标"未触达"，不算 🟢。

## 本次各 AI 进步（误报率）
跑 node scripts/progress.mjs 取数；每模型「历史 X% → 本次 Y%」+ 方向。
没跑 /fix 终审写回就写"无终审数据，不算进步"。
```

- 每个 🟢 必须能指向 `docs/verification.md` 对应行或本次命令输出。
- 三节只是追加，不替代原有评审/修复内容汇报。

## Key Scripts (single source of truth in this repo)

- `scripts/review-runner.mjs` — 只读评审（review/reviewFile/chunkCode/offsetFindings/retry/AGENTS.md 注入/自检 selfCheck/口袋书注入）
- `scripts/evaluate-models.mjs` — finding 归一化/共识/去重/裁决/多维评估（`--arbitrate` 落库 verdict 含 model）
- `scripts/verdict-log.mjs` — 裁决账本（persist/load/getActionableFindings/isVerdictStale + codeHash + confirmVerdict 终审真值 + markFixed）
- `scripts/feedback.mjs` — 个人误报回灌（终审标签 → counter-example/正例/根因/漏报 preamble）
- `scripts/missed-log.mjs` — qwen 批判员漏报账本（persist/load 原子写去重）
- `scripts/benchmark.mjs` + `scripts/benchmark-core.mjs` — 标注基准集跑分（对真值算 precision/recall/f1）
- `scripts/worker-lessons.md` — 工人版口袋书（只收终审确认教训，注入 [评审教训] 段）
- `scripts/jobs.mjs` — 任务账本 + runAudit（getFeedback 回灌）+ 后台/取消
- `scripts/models.mjs` — 4 施工队单一数据源（WORKERS / FIND_BUG_WORKERS / CRITIC_MODEL / VERIFIER_MODEL）
- `scripts/guard.mjs` — drift guard（单一数据源守护）
- `.opencode/agents/*.md` — B 分身 subagent 定义
