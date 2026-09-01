---
description: 修复闭环 — 找 bug → 批判(qwen) → 裁决(hy4-preview) → 终审修(opencode) → 验证（含 /verify 只审 diff）
argument-hint: <path>
agent: build
---

# 修复闭环（五步）

对 `$ARGUMENTS`（文件或目录路径，同 `/audit`）跑完整闭环：**找 → 批判 → 裁 → 修 → 验**。

> `$ARGUMENTS` 是**路径**：文件用 `--file`，目录用 `--dir`（用 Bash `test -d <path>` 判定是文件还是目录；路径不存在 → 提示用户）。空参数 → 提示用户给路径（同 `/audit` 的对话框模式）。

> **项目根目录（`--project-dir`）**：落账时按项目根隔离，否则外部项目审计的 finding 会记错归属。先取项目根：目录 → `git -C "<目录>" rev-parse --show-toplevel`；文件 → `git -C "$(dirname "<文件>")" rev-parse --show-toplevel`；非 git 仓库则省略 `--project-dir`。下面所有 `--run-audit` / `--arbitrate` 都带 `--project-dir "<项目根>"`。

## Step 0: 防坑声明（开工前）

跑 `node scripts/evaluate-models.mjs --preflight --project-dir "<项目根>"` 拿防坑清单，写一行「本阶段要防的教训 X/Y/Z + 完成验证 A/B/C」（见 AGENTS.md「阶段完成定义」），收尾对照。

## 断点续跑（fix-state 状态机）

`/fix` 五步结果落两个账本：Step 1 落 job 账本（`.cc-suite-cn/jobs/`）、Step 2-4 落裁决账本（`.cc-suite-cn/verdict-log.json`），天然幂等可续。opencode 用 `.cc-suite-cn/fix-state/` 状态机记住「哪步做过」：

```bash
# 读当前状态（每步 done 否）
node --input-type=module -e "import('./scripts/fix-state.mjs').then(async m => console.log(JSON.stringify(await m.loadState('.cc-suite-cn/fix-state', '<项目根>'), null, 2)))"

# 标记某步完成（step1~step5）
node --input-type=module -e "import('./scripts/fix-state.mjs').then(async m => { const s = await m.loadState('.cc-suite-cn/fix-state', '<项目根>'); await m.saveState('.cc-suite-cn/fix-state', m.markStepDone(s, '<stepN>')); })"
```

**每步开头先读状态**：该步 `done: true` → 跳过执行、复用已有结果；`done` 缺失 → 执行并在完成后标记 done。中断重跑时从第一个未 done 的步骤继续；Step 3/4/5 本就幂等（`--arbitrate` 只裁未裁决、`getActionableFindings` 只筛 verdict=true），Step 1/2 靠状态跳过。

## Step 1: 找 bug（glm + kimi）

```
node scripts/jobs.mjs --run-audit --file "<path>" --project-dir "<项目根>"     # 文件
node scripts/jobs.mjs --run-audit --dir "<path>" --exts ".js,.ts,.swift,..." --project-dir "<项目根>"   # 目录
```

记下输出的 `<job-id>`。**超时/卡住 → 先 `ps` 核对真实进程；账本「running」可能是超时残留僵尸，用 `node scripts/jobs.mjs --cancel <id>` 清理后重跑。**

## Step 2: 批判（qwen 第二意见）

从 Step 1 的 `<job-id>` 结果里读 `result.entries`（**去重后的 findings**，含 file/line/finding）。

> **critic 一次只审一个文件**：把 findings 按 `file` 分组，逐文件跑（`--file` 收的是**单个文件的绝对路径**，不是目录）。每组 findings 写成该文件对应的 `/tmp/findings-<序号>.json`，然后对每个有 findings 的文件：

```
node scripts/review-runner.mjs --critic --file "<该文件的绝对路径>" --findings-file /tmp/findings-<序号>.json --project-dir "<项目根目录>" --backend qwen --model qwen3.8-max
```

> **`--project-dir` 必传**：否则 qwen 补漏的 missed finding 落账时 projectDir 会写成 cc-suite-cn 根目录，Step 3 裁决按项目根过滤时被漏掉。

文件模式（`$ARGUMENTS` 是单文件）只有一组；目录模式按文件分组循环。无 findings 的文件跳过。

输出 `{verdicts:[{index, agree, reason}], missed:[{file, line, finding, reason}]}`：

- **verdicts**：qwen 逐条判「同意/反对」——判「反对」（假阳）的，Step 4 终审重点复核。
- **missed**：qwen 补漏的真 bug（含 reason）——自动落进统一账本（`source=qwen-critic`），随 Step 3 裁决一起被 hy4-preview 判真假。

> **批判是盲评**：qwen 拿到的清单只有 file/line/finding（不给 fix/chain_analysis/上游结论），必须只凭代码独立判断。

## Step 3: 裁决（hy4-preview，强制前置，不可跳过）

```
node scripts/evaluate-models.mjs --arbitrate --project-dir "<项目根>"
```

（若 hy4-preview 不可用或 `--arbitrate` 报错 → 停下报告用户，**不许静默跳过**——裁决是硬门槛。）

hy4-preview 逐条裁决统一账本里**尚未裁决**的 finding（含 `source=audit` 和 `source=qwen-critic`），并把每条 `verdict/evidence/codeHash` 追加到 `.cc-suite-cn/verdict-log.json`。输出「已裁决 N 条（真 X / 假 Y / 不确定 Z）」。

> **这是硬门槛**：没裁决过的 finding 不在待修清单里，opencode 不能修。跳过本步直接修，就是"先修后验"，会导致 hy4-preview 看到的是修好的代码、误判成假阳。
> **盲评**：hy4-preview 裁决时只拿到 finding + 代码，不给 qwen 的批判结论、不给 glm/kimi 的 fix/chain_analysis，独立判真假。

## Step 4: 终审 + 修 bug（opencode 亲自，严格 TDD）

### 4.1 读待修清单

```
node --input-type=module -e "import('./scripts/verdict-log.mjs').then(async m => console.log(JSON.stringify(m.getActionableFindings(await m.loadVerdicts(), { projectDir: \"<项目根>\" }), null, 2)))"
```

待修清单 = `verdict === "true"` 且 `projectDir === "<项目根>"` 的 finding。

> **真机打标（requiresManualVerify）**：裁决时 hy4-preview 对 UI/窗口/权限/快捷键类 finding 自动打 `requiresManualVerify: true`（扫描 finding/fix/file 的 token：`NSWindow`/`NSAlert`/`NSScreen`/`NSView`、`permission`/`authorization`/`TCC`/`accessibility`、`CGEvent`/`NSEvent`/`keyDown`/`hotkey`/`shortcut`/`addGlobalMonitor`、`SwiftUI`/`AppKit`/`UIKit` 等）。带此标记的 finding，修完 Step 5 必须真机点验（🟢），非 🟢 不 commit。

**不确定清单（别漏）**：`--arbitrate` 判 `uncertain`（及账本里 `verdict` 非 true/false 的）finding 也要逐条代码级终审，用：

```
node --input-type=module -e "import('./scripts/verdict-log.mjs').then(async m => console.log(JSON.stringify(m.getUncertainFindings(await m.loadVerdicts(), { projectDir: \"<项目根>\" }), null, 2)))"
```

`uncertain` 不是"没事"——它是 hy4-preview 拿不准（错误上下文/大文件截断），真 bug 常藏在这里，必须 opencode 亲自核实，判真就修、判假就落账 false。

- **按轮次隔离（auditCommit）**：每条 finding 落库时带 `auditCommit`（审计时的 git HEAD）。想只看本轮 finding，读取账本后调用方手动 `.filter(v => v.auditCommit === "<本次 git HEAD>")`，避免历史残留混入（暂无内置 helper，需调用方自行过滤）。

- **清单为空** → 报告"未发现真 bug"并**停止**，不进入修复。
- 对每条做**代码级终审**（opencode 亲自读源码核实），因为 hy4-preview 是 LLM 判断、会看走眼——既可能**假阴**（漏真 bug），也可能**假阳**（判 true 实为 by-design 或触发条件写错）。终审要同时兜住这两种。
- **codeHash 校验**：修前确认该文件自裁决后没被改过；若 `isVerdictStale` 为 true（代码已变），须重新 `/evaluate --arbitrate` 再修。
- **修前分级**：对待修清单按影响**分级**——high（安全/崩溃/数据损坏）先修，low（边界/措辞类）可后置并在 `docs/verification.md` 标注"后置"；不必对每条平均用力。

### 4.2 终审写回（两步终审，全量打标，错题本）

终审对**每条** finding（不只是 verdict=true 的，含 hy4-preview 判 false 的）分**两步**独立判断，最后落成 JSON 数组跑 `--confirm` 写回裁决账本——这是"每个员工的错题本"，下次 /audit 会自动回灌个人误报、`progress.mjs` 据此算进步。

**两步终审（盲判 → 对比）**：

1. **步骤 1 盲判**：先**不看**裁决账本里 hy4-preview 的 `verdict/evidence`、qwen 的 `agree/reason`、glm/kimi 的 `chain_analysis`——只读源码本身，独立判断这条 finding 是真是假，写下你自己的依据。
2. **步骤 2 对比终判**：再打开 `.cc-suite-cn/verdict-log.json` 翻出上游所有理由，跟步骤 1 自己的依据对照，确认「一致」或「分歧」，做最终 `final=true/false` 判定。

**`reason` 是终判依据，必须非空**（`--confirm` 会拒绝空 reason）。总结报告里显式写清两步：「步骤 1 独立判 X / 步骤 2 对比后终判 Y / 与上游一致或分歧」。

命令：

```
node --input-type=module -e "import('./scripts/verdict-log.mjs').then(async m => console.log(JSON.stringify(await m.loadVerdicts(), null, 2)))"   # 步骤 2 才看；步骤 1 先只读源码
# opencode 两步终审后，写 /tmp/confirm.json：[{"file","line","finding","final":"true|false","reason":"终判依据（非空）","independent":{"final":"true|false","reason":"步骤1独立判依据"},"comparison":"与上游一致/分歧"}, ...]
node scripts/evaluate-models.mjs --confirm /tmp/confirm.json
```

`final` 只认 `true`/`false`；`reason` / `independent.final` / `independent.reason` / `comparison` 全部非空（缺一个 `--confirm` 拒绝写回）；漏写某条 = 该条不进错题本，进步统计会缺样本。

### 4.3 修 bug（TDD）

> **可选**：若 bug 涉及 ≥2 个文件或跨模块，先列 3 行修复计划（改哪些文件 / 核心改法 / 影响面）再动手；单文件单行修复可跳过。

对终审确认的真 bug，opencode 用 TDD 修。**动手前必做三件事（AGENTS.md 铁律 #7 + 本轮教训）**：

1. **实测触发条件**：finding 可能「bug 是真的，触发条件写错了」（如把"argv 是相对路径"当触发，实测 argv 恒为绝对路径），修前先复现/验证触发条件，不默认 finding 措辞准确。
2. **修复建议放所有调用点验证**：finding 给的 fix 照抄可能引入回归（如"限定项目根目录"会顺带砍掉外部项目审计），落地前把建议放到每个调用方验证，防照抄引入回归。
3. **fix 建议是参考方向，非完整方案**：finding 的 `fix` 字段常省略细节（如"mirror showError"漏了 window.level / collectionBehavior，照抄一半导致全屏遮挡没修好）。照抄前先 grep 同类已有实现，逐项对照补齐。

TDD 五步：

1. **RED 先行**：先列测试清单 → 写失败测试 → 确认红
2. **GREEN 最少代码**：只写让测试通过的代码
3. **REFACTOR**：整理命名/去重，跑测试仍绿
4. **边界必测**：空值、null、极值、错误路径
5. **负向必测**：凡「能拦住/能禁止」的修复，必须实测确实拦住了（如"防止写入项目根目录之外"要实测确实写不进去）

> 优先用**项目自身测试框架**。项目没测试框架时，Node 项目用 `node:test` 搭考场（零 npm）；抽纯逻辑再测，UI/网络类改动测不了就"语法+编译检查 + 手动验证"兜底，并在 `docs/verification.md` 标 🟡。

修完每个 bug，**顺手写一句根因**（一个短语，如「边界条件 / 信任边界 / 时序 / 职责」），`markFixed` 时带上 `rootCause`——让 `/trace` 能查到「报 → 裁 → 修 → 根因」四段完整链路。

## Step 5: 验证（编译测试 + /verify 只审 diff + 真机/UI）

1. **编译 + 测试**：跑项目自身测试框架，确认全绿。
2. **/verify 只审 diff（唯一复审，必做）**：
   ```
   node scripts/jobs.mjs --run-audit --diff
   ```
   （qwen+kimi 只审 `git diff HEAD` 的改动行，逐处验证「改对 / 回归 / 遗漏」。若已 commit、`git diff HEAD` 为空，用 `git diff <base> HEAD` 抽 diff 再喂给施工队。**外部项目带 `--project-dir "<项目根>"`**，否则审的是 cc-suite-cn 自己的 diff；复审施工队会自动拿到「本轮正在修的 bug」修复背景。）
3. **真机/UI 手动点验**（UI 类改动必须）：
   > **UI 类改动（AppKit / SwiftUI / HTML / CSS）附加「真机手动验证清单」**：AI 审计只看代码、看不到渲染结果，「代码写对了、屏幕上没显示出来」这类问题（如控件 frame 容不下文案、负 y 子视图被裁剪、提示文字被裁掉）只有真机点开才抓得到。列出要人工点验的项（哪个界面 / 哪个控件 / 预期看到什么），让用户照着验一遍，结果标 🟡。
   > **铁律（窗口 / 权限 / 快捷键）**：凡改动涉及**窗口**（`NSWindow`/`NSPanel`/`NSScreen`/`NSView`/窗口层级）、**权限**（权限请求 / `TCC` / 辅助功能 / 屏幕录制 / 摄像头 / 输入监控）、**快捷键 / 全局事件**（`CGEvent`/`NSEvent`/`keyDown`/`addGlobalMonitor`/`CGEventTap`）的，单测覆盖不到、只能真机点验。**Step 5 必须真机点验通过（🟢），非 🟢 一律不 commit**——编译/单测通过不能替代，只能标「⏸️ 尚未复审」并写明卡点。

## ★ 验证后：问 commit

验证结束后，向用户报告「🟢 已复审」+ 三节汇报，并**显式问「要 commit 吗？」**：
- 用户要 → `git add <明确列出的文件>`（禁 `git add .`）→ `git commit`，提交信息一句话说清改了什么
- 用户不要 → 收尾，改动留在工作区
- 只审 diff 没做成（git diff 空 / 真机需用户）就要求 commit → 可以 commit，但必须显式提醒「⏸️ 尚未复审」，不掩盖

## Critical Rules

- **修 bug 只由 opencode**（最了解项目 + TDD）
- **审计前置两道闸门**：opencode 修代码前，必须通过两道审计——① hy4-preview 裁决（verdict=true）② opencode 代码级终审。未过闸门不得修。
- **裁决前置**：只修 hy4-preview 判 `true` 且 codeHash 未失效的 finding；跳过裁决 = 违规
- **复审门控**：`/verify` 只审 diff 是**唯一复审**，修 bug 后必做；没做成（git diff 空 / 真机需用户）必须显式标「⏸️ 尚未复审」，禁止用「已修复」「全流程完成」掩盖。**施工队空输出/超时/error = 门没关上，必须重试到非空结论（job 内已重试 2 次，仍空就重跑一次），重试耗尽才允许标 ⏸️；非 🟢 一律不 commit。**
- **Override 出口（客观标准）**：仅当 opencode 用**代码级证据**确认「hy4-preview 判 false 但这是真 bug」（假阴）时，可跳过裁决直接修；必须满足两条——① 在 `docs/verification.md` 台账标"未经裁决" ② 附代码级证据 + 🟢 测试。不得以"紧急/小 bug"这类模糊理由跳过。
- hy4-preview 是 LLM 判断，只当**初筛**；opencode 的代码级核实 + 🟢 测试才是 ground truth
- 写后不自动合并；**验证后问 commit，用户同意才 commit**（只审 diff 没做成就要求 commit 时，须显式标「⏸️ 尚未复审」）
- 能力动词逐个测：声称"修好了 A/B/C"，就分别有 A/B/C 的 🟢 证据
- **窗口/权限/快捷键改动真机必验**：涉及 `NSWindow`/`NSPanel`/`NSScreen`/`NSView`、权限请求（`TCC`/辅助功能/屏幕录制/摄像头/输入监控）、`CGEvent`/`NSEvent`/`keyDown`/`addGlobalMonitor`/`CGEventTap` 的改动，单测覆盖不到，Step 5 必须真机点验（🟢），非 🟢 不 commit；编译/单测通过不算数。
