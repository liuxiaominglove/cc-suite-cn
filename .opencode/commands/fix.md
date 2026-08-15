---
description: 修复闭环 — 找 bug → 裁决(hy3) → 读待修清单 → 修 bug(TDD) → 验证
agent: build
---

# 修复闭环

对 `$ARGUMENTS`（文件或目录路径，同 `/audit`）跑完整"找 → 裁 → 修 → 验"闭环。

> `$ARGUMENTS` 是**路径**：文件用 `--file`，目录用 `--dir`。空参数 → 提示用户给路径（同 `/audit` 的对话框模式）。

## Step 1: 找 bug（glm + kimi）

```
node scripts/jobs.mjs --run-audit --file "<path>"
```

记下输出的 `<job-id>`。

## Step 2: 裁决（hy3，强制前置，不可跳过）

```
node scripts/evaluate-models.mjs --arbitrate
```

hy3 逐条判 finding 真假，并把每条 verdict 落库到 `.cc-suite-pe/verdict-log.json`（含 codeHash 代码快照）。**裁决的是当前账本里所有已完成的 audit**（累积裁决，按 file+line+finding 去重）。

> **这是硬门槛**：没裁决过的 finding 不在待修清单里，opencode 不能修。跳过本步直接修，就是"先修后验"，会导致 hy3 看到的是修好的代码、误判成假阳。

## Step 3: 读待修清单

```
node --input-type=module -e "import('./scripts/verdict-log.mjs').then(async m => console.log(JSON.stringify(m.getActionableFindings(await m.loadVerdicts()), null, 2)))"
```

待修清单 = `verdict === "true"` 的 finding。

- **清单为空** → 报告"未发现真 bug"并**停止**，不进入 Step 4。
- 对每条做**代码级终审**（opencode 亲自读源码核实），因为 hy3 是 LLM 判断、会看走眼。
- **codeHash 校验**：修前确认该文件自裁决后没被改过；若 `isVerdictStale` 为 true（代码已变），须重新 `/evaluate --arbitrate` 再修。

## Step 4: 修 bug（opencode 亲自，严格 TDD）

对终审确认的真 bug，opencode 用 TDD 修：

1. **RED 先行**：先列测试清单 → 写失败测试 → 确认红
2. **GREEN 最少代码**：只写让测试通过的代码
3. **REFACTOR**：整理命名/去重，跑测试仍绿
4. **边界必测**：空值、null、极值、错误路径

> 优先用**项目自身测试框架**。项目没测试框架时，Node 项目用 `node:test` 搭考场（零 npm）；抽纯逻辑再测，UI/网络类改动测不了就"语法+编译检查 + 手动验证"兜底，并在 `docs/verification.md` 标 🟡。

## Step 5: 验证修复

```
/verify
```

确认修对了、没引入回归。

## Step 6: 汇报

- 修了哪些 bug、每个 bug 的测试证据（🟢）
- 改动不自动 commit，`git diff` 给用户看，用户点头才提交
- **末尾固定附两节**（见 `AGENTS.md` 汇报惯例）：本次各 AI 表现 + 本次触达功能

## Critical Rules

- **修 bug 只由 opencode**（最了解项目 + TDD）
- **裁决前置**：只修 hy3 判 `true` 且 codeHash 未失效的 finding；跳过裁决 = 违规
- **Override 出口（客观标准）**：仅当 opencode 用**代码级证据**确认「hy3 判 false 但这是真 bug」（假阴）时，可跳过裁决直接修；必须满足两条——① 在 `docs/verification.md` 台账标"未经裁决" ② 附代码级证据 + 🟢 测试。不得以"紧急/小 bug"这类模糊理由跳过。
- hy3 是 LLM 判断，只当**初筛**；opencode 的代码级核实 + 🟢 测试才是 ground truth
- 写后不自动合并，绝不自动 commit
- 能力动词逐个测：声称"修好了 A/B/C"，就分别有 A/B/C 的 🟢 证据
