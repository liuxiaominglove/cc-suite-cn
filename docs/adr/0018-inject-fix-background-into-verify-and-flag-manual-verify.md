# 18. /verify 注入修复背景 + UI 改动自动打「真机必验」标

- 状态：提议
- 日期：2026-08-28

## 上下文

多轮对 macELTA 跑 `/fix-incremental` 复盘出两条改进：

1. UI/窗口/权限/快捷键类 finding，单测覆盖不到渲染结果与系统授权，却常常「代码写对了、屏幕没显示出来」，只能真机点验。此前只靠一条文字提醒，屡次被漏。
2. `/verify` 复审施工队只看到 `git diff`，不知道「这一轮在修什么 bug」，于是给出「加回 activate」这类会回归的建议（误报）。

## 决策

### 本质

- 改进 1 本质是「提示 vs 机制」：真机验证纪律靠 opencode 自觉（文字）还是靠系统自动打标（机制）。可逆、无损。
- 改进 2 本质是「同源 + 精度」两条不变量：修复背景必须和 diff 指向同一仓库（同源），且只发「确定属于本轮、确定属于本次变更文件」的 finding（精度）。可逆、无损。

### 最佳实践

项目先例一贯「能固化成机制的就不只靠文字」（`verdictFromFindings` fail-closed、`pre-commit` 硬拦），且「结论 ≤ 证据」——背景只发确定的，不发「可能是这轮的」。外部项目是一等场景（`--project-dir` + `git -C` 全程显式），背景与 diff 必须共用同一个仓库解析源。

### 方案

- 改进 1：`detectManualVerify` 纯函数（扫 finding/fix/file 的 token：`NSWindow`/`NSAlert`/`NSScreen`/`NSView`、`permission`/`authorization`/`TCC`/`accessibility`、`CGEvent`/`NSEvent`/`keyDown`/`hotkey`/`shortcut`/`addGlobalMonitor`、`SwiftUI`/`AppKit`/`UIKit` 等），裁决时 `adjudicateLedger` 打 `requiresManualVerify:true`，`appendVerdicts` 透传；`fix.md` 铁律：带标 finding 修完 Step 5 必须真机点验，非 🟢 不 commit。只扫 finding/fix/file 不扫整份 code，避免 AppKit 文件处处 NSWindow 让标退化成噪音。
- 改进 2：`getFixContext`（`auditCommit===HEAD` 且 `file∈变更文件`，`headCommit` 缺失 fail-closed 返回空）+ `buildFixContextSection`/`buildVerifyPrompt`（背景段前置，明示「勿建议改回会回归的方案」）；`runAudit` diff 分支以 `resolvedProjectDir` 为单一源（diff 走 `review` 的 `cwd`，背景走 `gitHead`/`gitDiffNames`/`loadVerdicts`），保证同源。

## 后果

正面：真机验证从「靠自觉」变成「靠打标」，复审误报下降。负面：`detectManualVerify` 可能过打（宁多勿漏，漏拦不可逆）；`/verify` 对外部项目开始真正审对仓库，行为变化需在文档注明。

## 被拒备选

- 改进 2 只按 `auditCommit===HEAD && !fixed` 全量发、不按 `file∈变更文件` 精筛：被拒，会把「其实没修的 finding」也发给复审，制造「遗漏」误报，与本功能「降误报」的目的相悖。
- 改进 1 扫整份 `code` 打标：被拒，AppKit 文件处处 NSWindow，标会退化成「所有 Swift finding 都打」的无用噪音。
