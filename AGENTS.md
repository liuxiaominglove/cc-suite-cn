# CC-Suite PE

Multi-model code review orchestration — the `/audit` command dispatches two external AI models (GLM-5.2 + Qwen Coder Plus) via CodeBuddy CLI in parallel. Since each model has different training data, they catch different classes of bugs — what one misses, the other often finds. Neither model is the same as opencode's core model (DeepSeek V4 Pro), ensuring independent review without bias.

## Architecture

```
opencode (DeepSeek V4 Pro)  →  Your coding assistant
  │
  └─ /audit  →  scripts/review-runner.mjs  →  spawns codebuddy
                   ├─ --model glm-5.2                    (Zhipu AI)
                   └─ --model custom-local:qwen-coder-plus  (Alibaba Cloud)
                                        ↓
                              Unified comparison report
```

- **opencode**: Orchestration hub — your interactive coding assistant (DeepSeek V4 Pro)
- **`/audit`**: Global command (`~/.config/opencode/commands/audit.md`) — works in any project
- **CodeBuddy CLI**: Delegation runner that spawns external model reviews
- **review-runner.mjs**: Manages timeouts, error handling, JSON parsing, and result aggregation
- **cc-review skill**: Defines the review workflow (global: `~/.config/opencode/skills/cc-review/SKILL.md`)

## Prerequisites

| Requirement | Version/Details |
|-------------|-----------------|
| Node.js | >= 18.0 |
| CodeBuddy CLI | `npm install -g @tencent-ai/codebuddy-code` |
| `CODEBUDDY_API_KEY` | Set in `~/.zshrc` — used by CodeBuddy platform + DeepSeek |
| `DASHSCOPE_API_KEY` | Set in `~/.zshrc` — Alibaba Cloud DashScope (for Qwen) |
| GLM-5.2 | Routed through Tencent CodeBuddy platform, no separate key needed |

## Setup

```bash
# Install dependencies
npm install -g @tencent-ai/codebuddy-code

# Set API keys (add to ~/.zshrc for persistence)
export CODEBUDDY_API_KEY=your-tencent-key
export DASHSCOPE_API_KEY=your-aliyun-dashscope-key
```

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm test` | Run full test suite (loads env from `~/.zshrc`) |
| `pnpm test:unit` | Run unit tests only (no env needed) |
| `pnpm test:e2e` | Run end-to-end tests |
| `/audit <path>` | Run multi-model code review (global command) |
| `/review <path>` | Same as `/audit` |

## Usage

```
/audit src/file.ts          →  Run multi-model review on a file
/audit src/                 →  Review all changed files in a directory
/audit                      →  Dialog mode — specify which files
/review <path>              →  Same as /audit
```

After the review, you'll see a comparison report showing what each model found, where they agree, and where they differ.

## TDD Discipline

This project follows test-driven development (RED → GREEN → REFACTOR).

- Test files: `*.test.mjs` alongside source files
- Only mock external boundaries (network, filesystem, child_process) — never mock business logic
- Run tests before committing: `pnpm test`

## Single Source of Truth

Scripts, weights, and skill assets live in **one** canonical location — this git repo. The global `~/.config/opencode/` directory must only hold thin pointers that reference this repo; it must never hold its own copy of `review-runner.mjs`, `weights.json`, or `SKILL.md`.

- Canonical scripts: `scripts/` (git repo)
- Canonical skill + weights: `.opencode/skills/cc-review/` (git repo)
- Global thin pointers: `~/.config/opencode/commands/audit.md` and `~/.config/opencode/opencode.jsonc` (`skills.paths`) reference the repo paths

`scripts/guard.mjs` enforces this. It fails if it finds duplicate copies under `~/.config/opencode/`, missing canonical files, or stale references in the global config. `pnpm test` runs the guard — keep it green.

## Key Files

| Path | Purpose |
|------|---------|
| `AGENTS.md` | This file — project conventions and instructions |
| `~/.config/opencode/commands/audit.md` | Global `/audit` command (thin pointer to this repo) |
| `scripts/review-runner.mjs` | CodeBuddy delegation runner (timeout, error handling, structured parsing) |
| `scripts/review-runner.test.mjs` | Unit tests for the runner (31 tests) |
| `scripts/guard.mjs` | Drift guard — enforces single source of truth |
| `scripts/guard.test.mjs` | Unit tests for the guard |
| `.opencode/skills/cc-review/SKILL.md` | Canonical orchestrator skill + weights |
| `~/.codebuddy/models.json` | Model endpoint configuration (DeepSeek, Qwen) |
