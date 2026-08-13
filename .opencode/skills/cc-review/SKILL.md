---
name: cc-review
description: Multi-model code review — delegates to GLM-5.2, Hy3, Kimi, Qwen via CodeBuddy and their own CLIs, compares findings, and presents a unified report
scope: global
---

## What I Do

I run code reviews using **four worker models** — GLM-5.2, Hy3 (via CodeBuddy gateway), Kimi, Qwen (via their own CLIs) — to get independent perspectives on the same code. Since each model has different training data, they catch different classes of bugs — what one misses, the others often find.

## When to Use Me

Load this skill when the user:
- Types `/audit` or `/review`
- Says "审查这段代码", "review this code", "帮我找bug", "检查一下"
- Mentions a specific file they want reviewed
- Asks "这个代码有没有问题" or similar

## How I Work

1. Identify the target file(s) from the user's request
2. Read the code from those files
3. Generate a **weighted review prompt** per model based on its strengths:
   - Read `/Users/liuxiaoming/project/cc-suite-pe/.opencode/skills/cc-review/weights.json`
   - Each capability has a `weight` (0.0–1.0) converted to effort units (weight × 100)
   - Each capability has a `depth` that controls how thorough the check is
   - Prompts are generated using effort-unit allocation (e.g., "80 units → Security")
   - If weights.json is missing, fall back to a balanced default prompt
4. Run `node /Users/liuxiaoming/project/cc-suite-pe/scripts/review-runner.mjs` **four times in parallel** (each reviewer is read-only):
   - `--backend codebuddy --model glm-5.2 --prompt "<weighted GLM prompt>" [--allow-external]`
   - `--backend codebuddy --model hy3 --prompt "<weighted Hy3 prompt>" [--allow-external]`
   - `--backend kimi --model kimi-k2.7-code --prompt "<weighted Kimi prompt>" [--allow-external]`
   - `--backend qwen --model qwen3-coder-plus --prompt "<weighted Qwen prompt>" [--allow-external]`
   (Add `--allow-external` only when the file is outside the cc-suite-pe project directory)
5. Collect results from all four. If one model times out or errors, still present the others' results with a note about what happened.
6. Log results to `/Users/liuxiaoming/project/cc-suite-pe/.opencode/skills/cc-review/audit-log.json` for future weight analysis.
7. Present a unified report:

```
## Multi-Model Review Report

### Consensus (≥2 models agree)
- issue 1

### Per-model findings
- [glm-5.2] issue 2
- [hy3] issue 3
- [kimi] issue 4
- [qwen] issue 5
```

8. If all models return empty results, state that clearly. Do not fabricate issues.

<example>
  User: "/audit src/auth.ts"
  
  Assistant:
  ## Multi-Model Review Report: `src/auth.ts`

  ### Consensus (both models agree)
  - `login()` function missing rate limiting (line 45)

  ### GLM-5.2 found (Qwen missed)
  - Password hash not using constant-time comparison (line 62)

  ### Qwen Coder Plus found (GLM-5.2 missed)
  - JWT token missing expiration check (line 78)
</example>

<example>
  User: "/review scripts/review-runner.mjs"
  
  Assistant:
  ## Multi-Model Review Report: `scripts/review-runner.mjs`

  ### Consensus (both models agree)
  - `--file` parameter lacks path validation
  - JSON parsing silently swallows errors

  ### GLM-5.2 found (Qwen missed)
  - Argument injection via unvalidated `model` parameter (line 109)
  - Symlink-based path traversal bypass (line 97)
</example>

<example>
  User: "/audit src/"
  
  Assistant:
  Scanning src/ for changed files...
  Reviewing: src/utils.ts, src/api.ts
  
  ## Multi-Model Review Report: `src/utils.ts`
  ...
  
  ## Multi-Model Review Report: `src/api.ts`
  ...
</example>

## Weight System

Each model's review prompt is generated dynamically from `weights.json`. The effort-unit format (e.g., `80 units → Security`) tells the AI to allocate review effort proportionally.

- **depth**: `deep` ("examine every line"), `standard` ("focus on common patterns"), `light` ("quick scan")
- **weight**: `0.0–1.0` — higher value = more effort units in the prompt

Both models review ALL capabilities, but spend more effort on their weighted strengths.

## Weekly Weight Review

Weights are adjusted weekly via a review-and-approval cycle:

1. **`/weight-review`** — analyzes last week's audit data, generates an adjustment proposal with evidence for each change
2. **Wait for user approval** — never apply changes without explicit confirmation
3. Apply approved changes to `weights.json`

If weights have not been reviewed in 7+ days, remind the user at the start of the next `/audit` session.

## Critical Rules

- Generate **weighted prompts per model** — each model gets a prompt tailored to its strengths
- Run all four reviews **in parallel** — they are independent
- If one model fails, **still show the others' results** + a timeout/failure note
- Do not add your own review opinions. Your job is comparing and presenting, not auditing
- Log every audit result to `audit-log.json` for cumulative weight analysis
- **Never adjust weights without user approval** — always present the proposal with evidence and wait for confirmation
