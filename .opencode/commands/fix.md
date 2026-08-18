---
description: 修复闭环 — 找 bug → 批判(qwen) → 裁决(hy3) → 终审修(opencode) → 验证（含 /verify 只审 diff）
argument-hint: <path>
agent: build
---

# 修复闭环（五步）

对 `$ARGUMENTS`（文件或目录路径，同 `/audit`）跑完整闭环：**找 → 批判 → 裁 → 修 → 验**。

> `$ARGUMENTS` 是**路径**：文件用 `--file`，目录用 `--dir`（用 Bash `test -d <path>` 判定是文件还是目录；路径不存在 → 提示用户）。空参数 → 提示用户给路径（同 `/audit` 的对话框模式）。

## Step 1: 找 bug（glm + kimi）

```
node scripts/jobs.mjs --run-audit --file "<path>"     # 文件
node scripts/jobs.mjs --run-audit --dir "<path>" --exts ".js,.ts,.swift,..."   # 目录
```

记下输出的 `<job-id>`。**超时/卡住 → 先 `ps` 核对真实进程；账本「running」可能是超时残留僵尸，用 `node scripts/jobs.mjs --cancel <id>` 清理后重跑。**

## Step 2: 批判（qwen 第二意见）

把 Step 1 的 findings 扁平成一个数组写到 `/tmp/findings.json`（格式 `[{file, line, finding}, ...]`，读 `<job-id>` 的 `result.workers[].issues` 逐个铺平），然后：

```
node scripts/review-runner.mjs --critic --file "<target>" --findings-file /tmp/findings.json --backend qwen --model qwen3-coder-plus
```

输出 `{verdicts:[{index, agree, reason}], missed:[{file, line, finding}]}`：

- **verdicts**：qwen 逐条判「同意/反对」——判「反对」（假阳）的，Step 3 裁决 / Step 4 终审重点复核。
- **missed**：qwen 补漏的真 bug——并入待裁清单，随 Step 4 终审一起核实。

## Step 3: 裁决（hy3，强制前置，不可跳过）

```
node scripts/evaluate-models.mjs --arbitrate
```

（若 hy3 不可用或 `--arbitrate` 报错 → 停下报告用户，**不许静默跳过**——裁决是硬门槛。）

hy3 逐条判 finding 真假，并把每条 verdict 落库到 `.cc-suite-cn/verdict-log.json`（含 codeHash 代码快照）。**裁决的是当前账本里所有已完成的 audit**（累积裁决，按 file+line+finding 去重）。

> **这是硬门槛**：没裁决过的 finding 不在待修清单里，opencode 不能修。跳过本步直接修，就是"先修后验"，会导致 hy3 看到的是修好的代码、误判成假阳。

## Step 4: 终审 + 修 bug（opencode 亲自，严格 TDD）

### 4.1 读待修清单

```
node --input-type=module -e "import('./scripts/verdict-log.mjs').then(async m => console.log(JSON.stringify(m.getActionableFindings(await m.loadVerdicts()), null, 2)))"
```

待修清单 = `verdict === "true"` 的 finding。

- **清单为空** → 报告"未发现真 bug"并**停止**，不进入修复。
- 对每条做**代码级终审**（opencode 亲自读源码核实），因为 hy3 是 LLM 判断、会看走眼——既可能**假阴**（漏真 bug），也可能**假阳**（判 true 实为 by-design 或触发条件写错）。终审要同时兜住这两种。
- **codeHash 校验**：修前确认该文件自裁决后没被改过；若 `isVerdictStale` 为 true（代码已变），须重新 `/evaluate --arbitrate` 再修。
- **修前分级**：对待修清单按影响**分级**——high（安全/崩溃/数据损坏）先修，low（边界/措辞类）可后置并在 `docs/verification.md` 标注"后置"；不必对每条平均用力。

### 4.2 终审写回（全量打标，错题本）

终审对**每条** finding（不只是 verdict=true 的，含 hy3 判 false 的）都给出最终结论 `final=true/false` + 一句 `reason`，落成 JSON 数组跑 `--confirm` 写回裁决账本——这是"每个员工的错题本"，下次 /audit 会自动回灌个人误报、`progress.mjs` 据此算进步。命令：

```
node --input-type=module -e "import('./scripts/verdict-log.mjs').then(async m => console.log(JSON.stringify(await m.loadVerdicts(), null, 2)))"   # 先看全量清单
# opencode 逐条终审后，写 /tmp/confirm.json：[{"file","line","finding","final":"true|false","reason":"一句理由"}, ...]
node scripts/evaluate-models.mjs --confirm /tmp/confirm.json
```

`final` 只认 `true`/`false`；漏写某条 = 该条不进错题本，进步统计会缺样本。

### 4.3 修 bug（TDD）

> **可选**：若 bug 涉及 ≥2 个文件或跨模块，先列 3 行修复计划（改哪些文件 / 核心改法 / 影响面）再动手；单文件单行修复可跳过。

对终审确认的真 bug，opencode 用 TDD 修。**动手前必做两件事（AGENTS.md 铁律 #7）**：

1. **实测触发条件**：finding 可能「bug 是真的，触发条件写错了」（如把"argv 是相对路径"当触发，实测 argv 恒为绝对路径），修前先复现/验证触发条件，不默认 finding 措辞准确。
2. **修复建议放所有调用点验证**：finding 给的 fix 照抄可能引入回归（如"限定项目根目录"会顺带砍掉外部项目审计），落地前把建议放到每个调用方验证，防照抄引入回归。

TDD 五步：

1. **RED 先行**：先列测试清单 → 写失败测试 → 确认红
2. **GREEN 最少代码**：只写让测试通过的代码
3. **REFACTOR**：整理命名/去重，跑测试仍绿
4. **边界必测**：空值、null、极值、错误路径
5. **负向必测**：凡「能拦住/能禁止」的修复，必须实测确实拦住了（如"防止写入项目根目录之外"要实测确实写不进去）

> 优先用**项目自身测试框架**。项目没测试框架时，Node 项目用 `node:test` 搭考场（零 npm）；抽纯逻辑再测，UI/网络类改动测不了就"语法+编译检查 + 手动验证"兜底，并在 `docs/verification.md` 标 🟡。

修完每个 bug，**顺手写一句根因**（几个字，如「边界条件 / 信任边界 / 时序 / 职责」），`markFixed` 时带上 `rootCause`——让 `/trace` 能查到「报 → 裁 → 修 → 根因」四段完整链路。

## Step 5: 验证（编译测试 + /verify 只审 diff + 真机/UI）

1. **编译 + 测试**：跑项目自身测试框架，确认全绿。
2. **/verify 只审 diff（唯一复审，必做）**：
   ```
   node scripts/jobs.mjs --run-audit --diff
   ```
   （glm+kimi 只审 `git diff HEAD` 的改动行，逐处验证「改对 / 回归 / 遗漏」。若已 commit、`git diff HEAD` 为空，用 `git diff <base> HEAD` 抽 diff 再喂给评审员。）
3. **真机/UI 手动点验**（UI 类改动必须）：
   > **UI 类改动（AppKit / SwiftUI / HTML / CSS）附加「真机手动验证清单」**：AI 审计只看代码、看不到渲染结果，「代码写了对、屏幕上没显示出来」这类问题（如控件 frame 容不下文案、负 y 子视图被裁剪、提示文字被裁掉）只有真机点开才抓得到。列出要人工点验的项（哪个界面 / 哪个控件 / 预期看到什么），让用户照着验一遍，结果标 🟡。

## ★ 验证后：问 commit

验证结束后，向用户报告「🟢 已复审」+ 三节汇报，并**显式问「要 commit 吗？」**：
- 用户要 → `git add <明确列出的文件>`（禁 `git add .`）→ `git commit`，提交信息一句话说清改了什么
- 用户不要 → 收尾，改动留在工作区
- 只审 diff 没做成（git diff 空 / 真机需用户）就要求 commit → 可以 commit，但必须显式提醒「⏸️ 尚未复审」，不掩盖

## Critical Rules

- **修 bug 只由 opencode**（最了解项目 + TDD）
- **审计前置两道闸门**：opencode 修代码前，必须通过两道审计——① hy3 裁决（verdict=true）② opencode 代码级终审。未过闸门不得修。
- **裁决前置**：只修 hy3 判 `true` 且 codeHash 未失效的 finding；跳过裁决 = 违规
- **复审门控**：`/verify` 只审 diff 是**唯一复审**，修 bug 后必做；没做成（git diff 空 / 真机需用户）必须显式标「⏸️ 尚未复审」，禁止用「已修复」「全流程完成」掩盖。**评审员空输出/超时/error = 门没关上，必须重试到非空结论（job 内已重试 2 次，仍空就重跑一次），重试耗尽才允许标 ⏸️；非 🟢 一律不 commit。**
- **Override 出口（客观标准）**：仅当 opencode 用**代码级证据**确认「hy3 判 false 但这是真 bug」（假阴）时，可跳过裁决直接修；必须满足两条——① 在 `docs/verification.md` 台账标"未经裁决" ② 附代码级证据 + 🟢 测试。不得以"紧急/小 bug"这类模糊理由跳过。
- hy3 是 LLM 判断，只当**初筛**；opencode 的代码级核实 + 🟢 测试才是 ground truth
- 写后不自动合并；**验证后问 commit，用户同意才 commit**（只审 diff 没做成就要求 commit 时，须显式标「⏸️ 尚未复审」）
- 能力动词逐个测：声称"修好了 A/B/C"，就分别有 A/B/C 的 🟢 证据
