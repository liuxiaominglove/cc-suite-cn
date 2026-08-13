# CC-Suite PE

Multi-model code orchestration — opencode (DeepSeek V4 Pro) is the orchestrator (总指挥). Four worker models serve as **B-分身** subagents (daily review/fix/implement), while `/audit` additionally dispatches **A-突击员** (independent external reviews via CodeBuddy CLI). Different models have different training data, so they catch different classes of bugs.

## Architecture

```
opencode (DeepSeek V4 Pro)  →  总指挥（唯一发起方、最终拍板方）
  │
  ├─ B 分身（日常 · opencode 子代理，换脑不换身）
  │    ├─ qwen  → alibaba-cn/qwen3-coder-plus
  │    ├─ glm   → alibaba-cn/glm-5.2
  │    ├─ kimi  → alibaba-cn/kimi-k2.6
  │    └─ hy3   → opencode/hy3-free
  │
  └─ A 突击员（独立第三方 · /audit 路径）
       └─ scripts/review-runner.mjs → spawns codebuddy
            ├─ --model glm-5.2
            └─ --model custom-local:qwen-coder-plus
                                   ↓
                         Unified comparison report
```

- **opencode**: 总指挥 — interactive coding assistant (DeepSeek V4 Pro) and orchestrator
- **B 分身** (`.opencode/agents/*.md`): opencode 子代理，用各自模型的大脑做日常审/改/修
- **A 突击员** (`/audit`): 通过 CodeBuddy CLI 起独立第三方进程，做对抗性审查
- **review-runner.mjs**: Manages timeouts, error handling, JSON parsing, and result aggregation
- **cc-review skill**: Defines the review workflow (`~/.config/opencode/skills/cc-review/SKILL.md`)

## Prerequisites

| Requirement | Version/Details |
|-------------|-----------------|
| Node.js | >= 18.0 |
| CodeBuddy CLI | `npm install -g @tencent-ai/codebuddy-code` (A 突击员用) |
| `DASHSCOPE_API_KEY` | Set in `~/.zshrc` — 阿里云百炼，一个 key 通吃 Qwen + GLM + Kimi（B 分身） |
| `CODEBUDDY_API_KEY` | A 突击员走 CodeBuddy 平台账号登录态，无需单独 key |
| `MOONSHOT_API_KEY` | 可选 — 仅当 Kimi 直连 Moonshot 时才需要（B 分身走阿里通道，用不上） |
| Hy3 | B 分身用 `opencode/hy3-free` 免费档；真·Hy3 需腾讯云 TokenHub key（可选） |

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
| `.opencode/agents/*.md` | B 分身 subagent 定义（qwen/glm/kimi/hy3） |
| `~/.codebuddy/models.json` | Model endpoint configuration (DeepSeek, Qwen) |
