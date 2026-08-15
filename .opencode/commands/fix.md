---
description: 修复闭环 — 找 bug → 裁决 → 修 bug(TDD) → 验证
agent: build
---

# 修复闭环

对 `$ARGUMENTS` 跑完整"找 → 裁 → 修 → 验"闭环：

## Step 1: 找 bug + 裁决

先用 `/audit-full`（或 `/audit` + `/evaluate --arbitrate`）找出问题、由 hy3 裁决出"真 bug"清单。

## Step 2: 修 bug（opencode 亲自，严格 TDD）

对 hy3 判为 true 的 bug，opencode 用 TDD 修：

1. **RED 先行**：先列测试清单 → 写失败测试 → 确认红
2. **GREEN 最少代码**：只写让测试通过的代码
3. **REFACTOR**：整理命名/去重，跑测试仍绿
4. **边界必测**：空值、null、极值、错误路径

> 优先用**项目自身测试框架**（如 Swift 的 `run_tests.sh`/XCTest、Node 的 `node:test`）。项目没测试框架时，Node 项目用 `node:test` 搭考场（零 npm），其他语言用内置测试工具；抽纯逻辑再测，UI/网络/Keychain 类改动测不了就"语法+编译检查 + 手动验证"兜底并标 🟡。

## Step 3: 验证修复

```
/verify
```

确认修对了、没引入回归。

## Step 4: 汇报

- 修了哪些 bug、每个 bug 的测试证据（🟢）
- 改动不自动 commit，`git diff` 给用户看，用户点头才提交

## Critical Rules

- **修 bug 只由 opencode**（最了解项目 + TDD）
- 写后不自动合并，绝不自动 commit
- 能力动词逐个测：声称"修好了 A/B/C"，就分别有 A/B/C 的 🟢 证据
