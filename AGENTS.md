# CC-Suite PE

Multi-model code orchestration — opencode (DeepSeek V4 Pro) is the orchestrator (总指挥) and the fixer (修 bug). Four worker models each play a distinct role: glm+kimi **找 bug**（audit）, qwen **批判员**（critic）, hy3 **验证审计员**（verifier）. Different models have different training data, so they catch different classes of bugs.

> 给人看的大白话总览见 **`README.md`**；本文是给 AI/opencode 看的机器指令（保持精简，大白话解释放 README）。

## Architecture

```
opencode (DeepSeek V4 Pro)  →  总指挥 + 修 bug（唯一发起方、最终拍板方、亲自修）
  │
  ├─ B 分身（日常 · opencode 子代理，换脑不换身）
  │    ├─ qwen  → alibaba-cn/qwen3-coder-plus
  │    ├─ glm   → alibaba-cn/glm-5.2
  │    ├─ kimi  → moonshotai-cn/kimi-k2.7-code（Moonshot，非阿里）
  │    └─ hy3   → tencent/hy3（真 Hy3，TokenHub）
  │
  └─ 施工队（独立第三方 · 只读）
       ├─ 找 bug (audit):     glm + kimi（scripts/review-runner.mjs，参数化 backend）
       ├─ 批判员 (critic):    qwen（只读 + --sandbox）
       └─ 验证审计员 (verifier): hy3（scripts/evaluate-models.mjs，裁决 finding 真假）
```

- **opencode**: 总指挥 + 修 bug — interactive coding assistant (DeepSeek V4 Pro)
- **B 分身** (`.opencode/agents/*.md`): opencode 子代理，用各自模型的大脑做日常审/改/修
- **找 bug** (`/audit`): glm + kimi 只读评审，产出 finding
- **批判员** (`/review-qwen`): qwen 独立第二意见（只读 + `--sandbox`）
- **验证审计员** (`/evaluate`): hy3 逐条裁决 finding 真假，聚合"谁找得多、谁找得准"
- **review-runner.mjs**: 只读评审（参数化 backend，超时/错误/JSON 解析/结果聚合）
- **evaluate-models.mjs**: finding 归一化/共识分类/裁决/多维度评估
- **cc-review skill**: Defines the review workflow (`.opencode/skills/cc-review/SKILL.md`)

## Prerequisites

| Requirement | Version/Details |
|-------------|-----------------|
| Node.js | >= 18.0 |
| CodeBuddy CLI | `npm install -g @tencent-ai/codebuddy-code`（glm-5.2 + hy3 网关，走平台账号登录态） |
| `DASHSCOPE_API_KEY` | Set in `~/.zshrc` — 阿里云百炼，Qwen 用 |
| `MOONSHOT_API_KEY` | Set in `~/.zshrc` — 月之暗面 Moonshot，Kimi 用（`moonshotai-cn/kimi-k2.7-code`，走 Moonshot 官方直连） |
| `TOKENHUB_API_KEY` | Set in `~/.zshrc` — 腾讯云 TokenHub，Hy3 用（真 `hy3`，端点 `tokenhub.tencentmaas.com`） |

## Setup

完整安装步骤见 `README.md` 的 Installation 一节。速查：

```bash
# Install worker CLIs
npm install -g @tencent-ai/codebuddy-code @moonshot-ai/kimi-code @qwen-code/qwen-code

# Set API keys (add to ~/.zshrc for persistence)
export DASHSCOPE_API_KEY=your-dashscope-key   # Qwen（阿里百炼）
export MOONSHOT_API_KEY=your-moonshot-key     # Kimi（月之暗面）
export TOKENHUB_API_KEY=your-tokenhub-key     # Hy3（腾讯 TokenHub）

# codebuddy CLI 走平台账号登录态（GLM-5.2 + Hy3 网关），无需单独 key
# 自检：pnpm preflight
```

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm test` | Run full test suite (loads env from `~/.zshrc`) |
| `pnpm test:unit` | Run unit tests only (no env needed) |
| `pnpm test:e2e` | Run end-to-end tests |
| `pnpm verify` | 一键重跑 4 评审员只读 + 真后台真取消 |
| `/audit <path>` | glm+kimi 找 bug（`--run-audit`，记入任务账本 + audit-log） |
| `/audit-full <path>` | 完整审计：找 bug(glm+kimi) + 批判员(qwen) + 裁决(hy3) |
| `/fix <bug>` | 修复闭环：找 → 裁 → 修 bug(TDD) → 验证 |
| `/review-kimi <path>` / `/review-qwen <path>` | 单壳只读评审（分机 / 批判员） |
| `/evaluate` | 评估谁找得多、谁找得准（`--arbitrate` 让 hy3 裁决） |
| `/verify` | diff 审查（只发 `git diff HEAD`，记账本） |
| `/jobs` / `/result <id>` / `/cancel <id>` | 查任务账本 / 看结果 / 取消 |
| `/b-qwen` `/b-glm` `/b-kimi` `/b-hy3` | 派活给对应 B 分身 subagent（task 工具） |
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

### 修 bug 铁律（适用于 opencode 修任何项目，包括被审项目）

修 bug 时**必须走 TDD，禁止跳过 RED**：

1. **RED 先行**：先列测试清单（场景 / 输入 / 期望输出），再写失败测试，确认测试红，才准写实现。
2. **GREEN 最少代码**：只写让测试通过的代码，不加额外功能、不提前优化。
3. **REFACTOR**：整理命名/去重，跑全部测试仍绿。
4. **边界必测**：空值、null、undefined、极值、错误路径。
5. **无测试框架的项目**：先用 Node 内置 `node:test` 搭考场（`.mjs` 扩展名天然 ESM，**零 npm**），把纯逻辑抽成模块再测。DOM 类改动无法无 jsdom 单测时，用"语法检查 + 浏览器手动验证"兜底，并在验证台账标 🟡。
6. **能力动词逐个测**：声称"修好了 A/B/C"，就分别有 A/B/C 的 🟢 测试证据。

### 外部依赖改动铁律（配置 / 渠道 / CLI）

改任何 provider / model / 渠道 / 外部 CLI 参数前，**先交叉验证，先验后写**：

1. **模型归属交叉验证**：看到 `provider/model` 配置，先问"这个 provider 真的提供这个 model 吗？"——模型是哪家公司的，用背景知识对照；配置与常识矛盾时，**查官方 API 文档/模型目录（DashScope API 参考、models.dev）交叉验证，不要只信单一来源**。教训：kimi 是月之暗面（Moonshot）的模型，但阿里百炼的 DashScope API 其实也"直供" Kimi（阿里云直供 + 月之暗面直供两种）——而模型广场界面/客服答复可能与 API 文档不一致；"某 provider 有没有某模型"必须以官方 API 文档为准，而不是凭界面、答复或既有配置下结论。`alibaba-cn/` 前缀只代表"走阿里 API 通道"，不代表"模型是阿里的"。
2. **CLI 参数组合先实测**：给外部 CLI 加参数前，先跑一次最小验证（如 `kimi --plan -p "hi"`），确认参数能组合、不冲突，再写进代码。教训：`kimi --plan` 与 `-p` 冲突（`Cannot combine --prompt with --plan`）。
3. **改模型必实测加载**：改完 model/渠道，必须派活实测一次（确认 agent 真的能加载、能响应），不能只改文件就收工。

## Verification Discipline

The global rule `~/.config/opencode/rules/verification-discipline.md` applies everywhere. This section defines its project-specific instantiation:

- **能力动词清单**: 审 / 改 / 修 —— 每个动词都要有独立的 🟢 证据，缺一个不许说满。
- **验证台账**: `docs/verification.md` —— 汇报"已验证"的结论必须能在台账里找到对应行。
- **负向必测**: 任何"能拦住/能禁止"的结论（如锁写、防踢皮球），必须实测"确实拦住了"。
- **验证脚本**: `scripts/verify/` + `pnpm verify`（不进 `pnpm test`，因要起外部 CLI）。P3 之后固化真实往返/锁写/负向三个验证。
- **阶段完成定义**: 每阶段开工前先写一行"本阶段完成 = 哪些验证必须 🟢"，跑完对照，未全绿不算完成。

## 汇报惯例（每次 cc-suite-pe 工作完的总结必带两节）

所有 cc-suite-pe 命令（`/audit` `/review-*` `/evaluate` `/verify` `/fix` `/audit-full` `pnpm self-audit`）的总结，末尾固定附两节：

### 第一节：本次各 AI 表现

- **底线（每次必加）**：客观计数——各模型 `success` / `issue 数`（从 `jobs.mjs --get` 的 `result.workers` 读，不编）。
- **加码（仅当本次实际做了 triage 或裁决时）**：升级为「真 bug / 假阳 / 噪音 / 共识」+ `/evaluate` 的 precision。**没做 triage 就写"未 triage，仅计数"，不许编"谁表现好"。**

### 第二节：本次触达功能

对照 `docs/features.md` 基线清单，逐项标三色：🟢 实测通过 / 🟡 机制或部分 / 🔴 失败；**本次没用的功能标"未触达"，不算 🟢**。

### 铁律（防惯例退化成空话）

1. **结论 ≤ 证据**：每个 🟢 必须能指向 `docs/verification.md` 对应行或本次命令输出；查不到就标 🔴 或"未触达"。
2. **负向必测**：凡写"能拦住/能禁止"，必须实测"确实拦住了"。
3. 两节只是追加，不替代原有的评审/修复内容汇报。

## Single Source of Truth

Scripts and skill assets live in **one** canonical location — this git repo. The global `~/.config/opencode/` directory must only hold thin pointers that reference this repo; it must never hold its own copy of `review-runner.mjs` or `SKILL.md`.

- Canonical scripts: `scripts/` (git repo)
- Canonical skill: `.opencode/skills/cc-review/` (git repo)
- Global thin pointers: `~/.config/opencode/commands/audit.md` and `~/.config/opencode/opencode.jsonc` (`skills.paths`) reference the repo paths

`scripts/guard.mjs` enforces this. It fails if it finds duplicate copies under `~/.config/opencode/`, missing canonical files, or stale references in the global config. `pnpm test` runs the guard — keep it green.

## Key Files

| Path | Purpose |
|------|---------|
| `AGENTS.md` | This file — project conventions and instructions |
| `~/.config/opencode/commands/audit.md` | Global `/audit` command (thin pointer to this repo) |
| `scripts/review-runner.mjs` | 只读评审 runner（参数化 backend，超时/错误/JSON 解析） |
| `scripts/evaluate-models.mjs` | finding 归一化/共识/裁决/多维度评估（hy3 验证审计员） |
| `scripts/runner-core.mjs` | 共享 spawn 原语（runProcess/collectStream/错误类） |
| `scripts/models.mjs` | 4 施工队单一数据源（WORKERS + 角色常量 FIND_BUG_WORKERS/CRITIC_MODEL/VERIFIER_MODEL + canonicalModel） |
| `scripts/backends.mjs` | 3 个 backend 的 CLI 命令构建（resolveCli 绝对路径防 PATH 劫持 + 只读护栏） |
| `scripts/preflight.mjs` | 环境自检（codebuddy CLI 可用性检查） |
| `scripts/jobs.mjs` | 任务账本（run-audit/后台/取消） |
| `scripts/guard.mjs` | Drift guard — enforces single source of truth |
| `scripts/self-audit.mjs` | 自审 8 个核心脚本（`pnpm self-audit`，release 前跑） |
| `scripts/guard.test.mjs` | Unit tests for the guard |
| `.opencode/skills/cc-review/SKILL.md` | Canonical orchestrator skill |
| `.opencode/agents/*.md` | B 分身 subagent 定义（qwen/glm/kimi/hy3） |
| `docs/verification.md` | 验证台账（三色置信度 + 证据锚点） |
| `docs/features.md` | 功能基线清单（每次总结"触达功能"对照的单一数据源） |
| `~/.codebuddy/models.json` | codebuddy 自定义 model endpoint（仅 DeepSeek/Qwen；glm-5.2/hy3 走 codebuddy 平台账号，无需本地 endpoint） |
