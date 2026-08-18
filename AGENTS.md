# cc-suite-cn

Multi-model code orchestration — opencode (DeepSeek V4 Pro) is the orchestrator (总指挥) and the fixer (修 bug). Four worker models each play a distinct role: glm+kimi **找 bug**（audit）, qwen **批判员**（critic）, hy3 **验证审计员**（verifier）. Different models have different training data, so they catch different classes of bugs.

> 给人看的大白话总览见 **`README.md`**；本文是给 AI/opencode 看的机器指令（保持精简，大白话解释放 README）。

## Architecture

```
opencode (DeepSeek V4 Pro)  →  总指挥 + 修 bug（唯一发起方、最终拍板方、亲自修）
  │
  └─ 施工队（独立第三方 · 只读）
       ├─ 找 bug (audit):     glm(codebuddy CLI) + kimi(Moonshot 直连)（scripts/review-runner.mjs，参数化 backend）
       ├─ 批判员 (critic):    qwen（只读 + --sandbox）
       └─ 验证审计员 (verifier): hy3（scripts/evaluate-models.mjs，裁决 finding 真假）
```

- **opencode**: 总指挥 + 修 bug — interactive coding assistant (DeepSeek V4 Pro)
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
| `DASHSCOPE_API_KEY` | Set in `~/.zshrc` — 阿里云百炼，**Qwen（施工队批判员）** 用（qwen CLI 走阿里百炼通道）；**施工队找 bug 的 glm 走 codebuddy CLI 平台账号，无需此 key** |
| `MOONSHOT_API_KEY` | Set in `~/.zshrc` — 月之暗面 Moonshot，Kimi 用（`kimi-k2.7-code`，走 Moonshot 官方直连） |

## Setup

完整安装步骤见 `README.md` 的 Installation 一节。速查：

```bash
# Install worker CLIs
npm install -g @tencent-ai/codebuddy-code @moonshot-ai/kimi-code @qwen-code/qwen-code

# Set API keys (add to ~/.zshrc for persistence)
export DASHSCOPE_API_KEY=your-dashscope-key   # Qwen（阿里百炼）
export MOONSHOT_API_KEY=your-moonshot-key     # Kimi（月之暗面）

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
| `/fix <path>` | 修复闭环五步：找 → 批判 → 裁 → 修 bug(TDD) → 验证（含 /verify 只审 diff） |
| `/review-kimi <path>` / `/review-qwen <path>` | 单壳只读评审（分机 / 批判员） |
| `/evaluate` | 评估谁找得多、谁找得准（`--arbitrate` 让 hy3 裁决） |
| `/verify` | diff 审查（只发 `git diff HEAD`，记账本） |
| `/jobs` / `/result <id>` / `/cancel <id>` | 查任务账本 / 看结果 / 取消 |
| `/review <path>` | Same as `/audit` |
| `/trace <keyword|file:line>` | 变更追溯（查 finding 的报 → 裁 → 修完整链路） |

### 内循环 vs 门禁

| 改了什么 | 跑 |
|---|---|
| 任一脚本 `.mjs` | `pnpm test:unit`（内循环，秒级离线） |
| guard / 文档 / 规则 | `pnpm test:unit` + `node scripts/guard.mjs` |
| 出 release / 推前 | `pnpm test` + `pnpm verify` + `pnpm self-audit`（门禁，只跑一次） |

铁律：**慢内循环 = 被禁用的门禁**。`pnpm verify` / `pnpm self-audit` 起外部 CLI、联网、计费，只配 release 前跑一次，绝不进编辑循环；gate 挡住正当工作就**修 gate**，别跳过（`--no-verify` / 删 hook 都属于跳过，需显式授权 + 记录理由）。

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
4. **边界必测**：空值、null、undefined、极值、错误路径。**改了哪条语句，就把哪条语句的全部失败路径逐个测**（同步 throw / 异步 reject / 超时 / 正常返回）——尤其移动跨 try/finally/guard、或增删计数器的代码，先核对不变量每条路径都成立（教训：synthai 复审漏 3 个回归，根因就是把 `taskFn()` 挪出 try 块，同步 throw 绕过了 `finally` 里的计数器归还）。
5. **无测试框架的项目**：先用 Node 内置 `node:test` 搭考场（`.mjs` 扩展名天然 ESM，**零 npm**），把纯逻辑抽成模块再测。DOM 类改动无法无 jsdom 单测时，用"语法检查 + 浏览器手动验证"兜底，并在验证台账标 🟡（即验证纪律的「🟡 机制或部分通过」，无单测仅编译/手动验证兜底属此类）。
6. **能力动词逐个测**：声称"修好了 A/B/C"，就分别有 A/B/C 的 🟢 测试证据。
7. **触发条件实测 + 修复建议验证所有调用点**：finding 可能"bug 是真的，触发条件写错了"（如把"argv 是相对路径"当触发，实测 argv 恒为绝对路径），修前先实测触发条件；finding 给的 fix 建议照抄可能引入回归（如"限定项目根目录"会顺带砍掉外部项目审计），落地前把建议放到每个调用方验证。
8. **泛化而非打补丁**：finding 报"X 漏了"，先判断 X 是不是某类问题的个例，按类修，别按个例修（教训：正则量词写 `?`（零或一）只修了"NOT YET FIXED"这一个例，漏了"NOT YET FULLY FIXED"两个修饰词——应写 `*`）。
9. **控制流重构高风险**：移动任何跨 try/finally、guard、计数器增减的代码前，先列全路径核对不变量；响应 review 反馈做的"顺手加固"同样是新修复，独立走 RED→GREEN→REFACTOR，并给被改动语句的失败路径补测。

### 外部依赖改动铁律（配置 / 渠道 / CLI）

改任何 provider / model / 渠道 / 外部 CLI 参数前，**先交叉验证，先验后写**：

1. **模型归属交叉验证**：看到 `provider/model` 配置，先问"这个 provider 真的提供这个 model 吗？"——模型是哪家公司的，用背景知识对照；配置与常识矛盾时，**查官方 API 文档/模型目录（DashScope API 参考、models.dev）交叉验证，不要只信单一来源**。教训：kimi 是月之暗面（Moonshot）的模型，但阿里百炼的 DashScope API 其实也"直供" Kimi（阿里云直供 + 月之暗面直供两种）——而模型广场界面/客服答复可能与 API 文档不一致；"某 provider 有没有某模型"必须以官方 API 文档为准，而不是凭界面、答复或既有配置下结论。`alibaba-cn/` 前缀只代表"走阿里 API 通道"，不代表"模型是阿里的"。
2. **CLI 参数组合先实测**：给外部 CLI 加参数前，先跑一次最小验证（如 `kimi --plan -p "hi"`），确认参数能组合、不冲突，再写进代码。教训：`kimi --plan` 与 `-p` 冲突（`Cannot combine --prompt with --plan`）。
3. **改模型必实测加载**：改完 model/渠道，必须派活实测一次（确认 agent 真的能加载、能响应），不能只改文件就收工。

### 施工队调用纪律（外部 CLI 并发）

- **默认串行**：多文件/多任务批量审（`/audit` 一次审多个文件）时，`--run-audit` 逐个跑；不要一口气并行拉起十几个 codebuddy/kimi 进程（会撞 CLI 限流/超时）。
- **单文件内并行保留**：一个文件内 glm+kimi 双施工队并行是设计内行为，保留。
- **超时后核对真实进程**：超时或账本显示「running」后，用 `ps` 核对真实进程是否还在；「running」可能是超时残留的僵尸记录，不要轻信。

## Verification Discipline

The global rule `~/.config/opencode/rules/verification-discipline.md` applies everywhere. This section defines its project-specific instantiation:

- **能力动词清单**: 审 / 改 / 修 —— 每个动词都要有独立的 🟢 证据，缺一个不许说满。
- **验证台账**: `docs/verification.md` —— 汇报"已验证"的结论必须能在台账里找到对应行。
- **负向必测**: 任何"能拦住/能禁止"的结论（如锁写、防踢皮球），必须实测"确实拦住了"。
- **验证脚本**: `scripts/verify/` + `pnpm verify`（不进 `pnpm test`，因要起外部 CLI）。固化真实往返/锁写/负向三个验证。
- **阶段完成定义**: 每阶段开工前先写一行"本阶段完成 = 哪些验证必须 🟢"，跑完对照，未全绿不算完成。

## 汇报惯例（每次 cc-suite-cn 工作完的总结必带：总体结论 + 行动项 + 三节）

所有**触发评审的命令**（`/audit` `/review` `/review-kimi` `/review-qwen` `/evaluate` `/verify` `/fix` `/audit-full` `pnpm self-audit`）的总结，末尾固定附「总体结论 + 行动项 + 三节」。**纯查询命令**（`/jobs` `/result` `/cancel` `/trace`）不触发评审，不强制：

### 总体结论（必带）

按 actionable findings 的严重度给一句中文结论：
- high > 0 → **需整改**（high = 崩溃/安全/数据损坏）
- medium > 0 → **需关注**
- 否则 → **健康**

无 findings 也写「健康」，不许省略。

### 行动项（必带）

列 verdict=true 的 actionable findings，按 high→medium→low 排序，每条 `[严重度] file:line — finding`。无 actionable 写「无」。

### 第一节：本次各 AI 表现

- **底线（每次必加）**：客观计数——各模型 `success` / `issue 数`（从 `jobs.mjs --get` 的 `result.workers` 读，不编）。
- **加码（仅当本次实际做了 triage 或裁决时）**：升级为「真 bug / 假阳 / 噪音 / 共识」+ `/evaluate` 的 precision。**没做 triage 就写"未 triage，仅计数"，不许编"谁表现好"。**

### 第二节：本次触达功能

对照 `docs/features.md` 基线清单，逐项标三色：🟢 实测通过 / 🟡 机制或部分 / 🔴 失败；**本次没用的功能标"未触达"，不算 🟢**。

### 第三节：本次各 AI 进步（误报率，基于错题本）

跑 `node scripts/progress.mjs` 取数，每模型一行「历史误报率 X% → 本次 Y%」+ 方向（↑进步/↓退步/—持平/无历史/无本次）。**数据源 = opencode 终审写回的 `confirmed.final` 标签**（`/fix` 全量打标），不是编的。**没跑 `/fix` 终审写回就写"无终审数据，不算进步"**。误报率越低越好，↓=退步。

### 必带：复审状态（修 bug 类任务的总结）

凡**修了代码**的任务，总结里必须显式声明复审状态，两种：

- 🟢 **已复审**：/verify 只审 diff（唯一复审）跑过、结论如何。
- ⏸️ **尚未复审**：**卡在哪 + 需要用户做什么**（如"真机验证需你授权/输密码/在场，你回来后跑 X"）。

**只要不是 🟢，必须写「⏸️ 尚未复审」，禁止用「已修复」「全流程完成」掩盖。**（`/verify` 只审 diff 是唯一复审，没做成必须标 ⏸️。）

**评审员空输出/超时/error = 复审门没关上，不是"部分通过"**：必须重试到拿到非空结论（`review`/`criticize`/`adjudicate` 已内置空输出重试；仍空就重跑一次 job），重试耗尽才允许标 ⏸️。**非 🟢 一律不 commit**，不得拿"一个评审员过了、另一个失败了"当半审放行（教训：synthai 那次 glm 空输出，若直接标 🟡 就漏了它事后抓到的 3 个回归）。

### 铁律（防惯例退化成空话）

1. **结论 ≤ 证据**：每个 🟢 必须能指向 `docs/verification.md` 对应行或本次命令输出；查不到就标 🔴 或"未触达"。
2. **负向必测**：凡写"能拦住/能禁止"，必须实测"确实拦住了"。
3. 三节 + 复审状态只是追加，不替代原有的评审/修复内容汇报。

## Single Source of Truth

Scripts and skill assets live in **one** canonical location — this git repo. The global `~/.config/opencode/` directory must only hold thin pointers that reference this repo; it must never hold its own copy of `review-runner.mjs` or `SKILL.md`.

- Canonical scripts: `scripts/` (git repo)
- Canonical skill: `.opencode/skills/cc-review/` (git repo)
- Canonical commands: `.opencode/commands/` (git repo) — 命令本体已全部迁回 repo，全局不再持命令指针
- Global thin pointer: `~/.config/opencode/opencode.jsonc` (`skills.paths`) references the repo skill paths

`scripts/guard.mjs` enforces this. It fails if it finds duplicate copies under `~/.config/opencode/`, missing canonical files, or stale references in the global config. `pnpm test` runs the guard — keep it green.

## Key Files

| Path | Purpose |
|------|---------|
| `AGENTS.md` | This file — project conventions and instructions |
| `.opencode/commands/*.md` | 12 个斜杠命令（audit/fix/evaluate/verify/trace/jobs 等，项目级自动加载） |
| `scripts/review-runner.mjs` | 只读评审 runner（参数化 backend，超时/错误/JSON 解析） |
| `scripts/evaluate-models.mjs` | finding 归一化/共识/裁决/多维度评估（hy3 验证审计员） |
| `scripts/runner-core.mjs` | 共享 spawn 原语（runProcess/collectStream/错误类） |
| `scripts/models.mjs` | 4 施工队单一数据源（WORKERS + 角色常量 FIND_BUG_WORKERS/CRITIC_MODEL/VERIFIER_MODEL + canonicalModel） |
| `scripts/backends.mjs` | 3 个 backend 的 CLI 命令构建（resolveCli 绝对路径防 PATH 劫持 + 只读护栏） |
| `scripts/preflight.mjs` | 环境自检（codebuddy CLI 可用性检查） |
| `scripts/jobs.mjs` | 任务账本（run-audit/后台/取消） |
| `scripts/audit-baseline.mjs` | 增量审计基线（`--detect`/`--save`，git diff 对比变更文件） |
| `scripts/guard.mjs` | Drift guard — enforces single source of truth（含孤儿全局规则检测 + 已知债棘轮） |
| `scripts/known-risks.json` | 信任边界债务单一数据源（resolved/open 清单，guard 校验 schema：id 唯一/resolved 必有 anchor/open 必有风险等级+重新评估条件） |
| `scripts/verdict-log.mjs` | 裁决账本（persist/load/getActionableFindings/isVerdictStale + codeHash + confirmVerdict 终审真值） |
| `scripts/feedback.mjs` | 个人误报回灌（终审标签 → counter-example/正例/根因/漏报 preamble） |
| `scripts/missed-log.mjs` | qwen 批判员漏报账本（原子写 + 去重） |
| `scripts/progress.mjs` | 各 AI 误报率进步（基于终审 confirmed 标签，`node scripts/progress.mjs`） |
| `scripts/benchmark-core.mjs` + `scripts/benchmark.mjs` | 标注基准集（对真值算 precision/recall/f1，prompt A/B） |
| `scripts/worker-lessons.md` | 工人版口袋书（只收终审确认教训，注入 `[评审教训]` 段） |
| `scripts/self-audit.mjs` | 自审 8 个核心脚本（`pnpm self-audit`，release 前跑） |
| `scripts/guard.test.mjs` | Unit tests for the guard |
| `.opencode/skills/cc-review/SKILL.md` | Canonical orchestrator skill |
| `docs/verification.md` | 验证台账（三色置信度 + 证据锚点） |
| `docs/trust-boundary.md` | 信任边界风险台账（人读视图，由 `scripts/known-risks.json` 渲染） |
| `docs/features.md` | 功能基线清单（每次总结"触达功能"对照的单一数据源） |
| `~/.codebuddy/models.json` | codebuddy 自定义 model endpoint（仅 DeepSeek/Qwen；glm-5.2/hy3 走 codebuddy 平台账号，无需本地 endpoint） |
