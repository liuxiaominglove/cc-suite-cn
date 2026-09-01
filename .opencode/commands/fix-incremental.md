---
description: 增量修复闭环 — 只对自上次审计基线以来变更的文件跑 找→批判→裁→修→验，修完自动更新基线
argument-hint: <project-dir>
agent: build
---

# 增量修复闭环

对 `$ARGUMENTS`（**项目根目录，git 仓库**）跑**增量**五步闭环：先用基线检测出「自上次审计以来变更的文件」，再只对这些文件跑 找 → 批判 → 裁 → 修 → 验，最后自动更新基线。

> `$ARGUMENTS` 是**项目根目录**（git 仓库），也可传项目内文件路径（自动归一化到项目根）。空参数 → 提示用户给路径。

## Step 0: 归一化项目根 + 增量检测（核心）

先归一化（文件路径自动转项目根，非 git/无效路径返回空）：

```
node --input-type=module -e "import('./scripts/audit-baseline.mjs').then(m => console.log(m.findProjectRoot('<项目路径>') ?? ''))"
```

输出空 → 非 git 或路径无效 → 提示改用 `/fix <路径>` 全量，停。否则用输出作为 `<项目根目录>` 继续：

```
node scripts/audit-baseline.mjs --detect "<项目根目录>"
```

按输出分支处理：

| 输出 | 处理 |
|------|------|
| `isGit: false` | 非 git 仓库 → 提示改用 `/fix <路径>` 全量，停 |
| `dirty: true` | 工作区有未提交改动 → 提示「未提交改动不在 `git diff <基线>...HEAD` 对比内、不会被审计」，询问「先提交 / 继续（跳过未提交改动）」 |
| `firstAudit: true` | 首次审计（无基线）→ 询问「从哪个 commit/tag 起」，据此 `git -C "<项目根>" diff --name-only <tag>...HEAD` 得文件列表；答不出就全量 `/fix` |
| `changed: false` | 自上次审计无变更 → 提示「无新变更可修」并停 |
| `changed: true` + `files` | 得到变更文件列表，继续 |

把 `files`（相对路径）逐个 resolve 成**绝对路径**：`<项目根>/<file>`。空列表 → 提示无变更停。

## Step 1: 找 bug（只对变更文件，串行）

对每个变更文件（**串行，勿并行拉多进程**），外部项目加 `--allow-external`：

```
node scripts/jobs.mjs --run-audit --file "<绝对路径>" --allow-external --project-dir "<项目根目录>" --background
```

中/大文件用 `--background` 后台跑，`node scripts/jobs.mjs --list` 轮询到 `completed` 再读结果。累积所有文件的 `result.entries`（去重后 findings）。**超时/卡住 → 先 `ps` 核对真实进程；账本「running」僵尸用 `node scripts/jobs.mjs --cancel <id>` 清理。**

## Step 2: 批判（qwen 第二意见）

> **critic 一次只审一个文件**：把 Step 1 累积的 findings 按 `file` 分组，逐文件跑（`--file` 收的是**单个文件的绝对路径**，不是项目根目录）。每组 findings 写成该文件对应的 `/tmp/findings-<序号>.json`，然后对每个有 findings 的变更文件：

```
node scripts/review-runner.mjs --critic --file "<该文件的绝对路径>" --findings-file /tmp/findings-<序号>.json --project-dir "<项目根目录>" --backend qwen --model qwen3.8-max
```

> **`--project-dir` 必传**：否则 qwen 补漏的 missed finding 落账 projectDir 会写成 cc-suite-cn 根目录，Step 3 裁决按项目根过滤时被漏掉。

输出 `{verdicts:[{index, agree, reason}], missed:[...]}`：`verdicts` 判「反对」（假阳）的 Step 4 重点复核；`missed` 自动落账（`source=qwen-critic`）随 Step 3 一起裁决。

## Step 3: 裁决（hy4-preview，只裁本次变更文件）

```
node scripts/evaluate-models.mjs --arbitrate --files "<变更文件绝对路径,逗号分隔>" --project-dir "<项目根目录>"
```

`--files` 用**绝对路径**精确匹配，避免跨项目同名误裁。输出「已裁决 N 条（真/假/不确定）」。

> 硬门槛：没裁决的 finding 不修；`--arbitrate` 报错 → 停下报告，不许静默跳过。

## Step 4: 终审 + 修 bug（opencode 亲自，TDD）

读待修清单（按项目根过滤后，**再按变更文件过滤**——只留 `file` 命中本次变更文件的 finding，不碰未变更文件）：

```
node --input-type=module -e "import('./scripts/verdict-log.mjs').then(async m => { const changed = new Set(JSON.parse(process.argv[1])); const all = m.getActionableFindings(await m.loadVerdicts(), { projectDir: \"<项目根目录>\" }); console.log(JSON.stringify(all.filter(v => changed.has(v.file)), null, 2)); })" '["<变更文件1绝对路径>","<变更文件2绝对路径>", ...]'
```

- 清单为空 → 报告「未发现真 bug」并停（但仍走 Step 收尾更新基线）。
- **不确定清单（别漏）**：`getUncertainFindings`（verdict 非 true/false，含 `uncertain`）也要按变更文件过滤后逐条代码级终审——`uncertain` 是 hy4-preview 拿不准，真 bug 常藏在这里，判真就修、判假就落账 false。过滤方式同待修清单（调用方 `filter(v => changed.has(v.file))`）：

```
node --input-type=module -e "import('./scripts/verdict-log.mjs').then(async m => { const changed = new Set(JSON.parse(process.argv[1])); const all = m.getUncertainFindings(await m.loadVerdicts(), { projectDir: \"<项目根目录>\" }); console.log(JSON.stringify(all.filter(v => changed.has(v.file)), null, 2)); })" '["<变更文件1绝对路径>","<变更文件2绝对路径>", ...]'
```

- 终审两步（盲判 → 对比）、codeHash 校验、修前分级、TDD 五步、根因写回——**全部同 `/fix` Step 4**（见 fix.md 4.1-4.3），逐条执行，不因「增量」而放宽。

## Step 5: 验证（编译测试 + /verify 只审 diff + 真机）

同 `/fix` Step 5：跑项目自身测试全绿 → `/verify` 只审 diff（唯一复审）→ UI 类改动附真机点验清单。

## Step 6: 收尾更新基线（自动）

```
node scripts/audit-baseline.mjs --save "<项目根目录>"
```

修完即存当前 HEAD 为新基线，下次增量从这算起。**若修 bug 改了代码但未 commit，`--save` 存的是 HEAD（不含未提交改动）——先 commit 再 save，否则下次增量会漏掉未提交的修改。**

## Critical Rules

- **只修增量**：只对「自基线以来变更的文件」跑闭环，不碰未变更文件。
- **多文件串行**：Step 1 逐个 `--run-audit`，不并行拉多进程（撞 CLI 限流）。
- **外部项目必带 `--allow-external` + `--project-dir`**：`validateFilePath` 默认限制在 cc-suite-cn 内，漏 `--allow-external` 会报「outside project directory」；漏 `--project-dir` 落账归属记错。
- **裁决用绝对路径 `--files`**：相对路径会靠 `endsWith` 误匹配跨项目同名文件。
- 终审/修 bug/复审门控的纪律**同 `/fix`**（两步终审、裁决前置、`/verify` 唯一复审、非 🟢 不 commit），不因增量而豁免。
- 变更文件为空（`changed: false`）→ 不调 AI，直接提示并停。
