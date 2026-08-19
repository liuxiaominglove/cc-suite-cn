# 信任边界风险台账

cc-suite-cn 的「输入信任边界」集中记录：哪些输入可信、哪些不可信，以及对应防护措施的状态。

> **单一数据源 = `scripts/known-risks.json`**。本文件是给人读的视图，下面两张表由它渲染。**改动请改 JSON，别手改本表**——`guard.mjs`（`findKnownRiskDrift`）会校验 JSON 的 schema（id 唯一 / resolved 必有 anchor 且指向 verification.md / open 必有 riskLevel+reassessWhen+whyDeferred），并靠 docs-consistency 测试保证本表与 JSON 不漂移。债只许"补证据改 resolved"消失，不许物理删行；**唯一例外**：风险的存在前提被消除（如砍掉整个 B 分身 → 「双通道双额度」债随之消失），可物理删行，但须在 `docs/verification.md` 留痕说明。
> 目的：不让风险项散落在归档 finding 里被遗忘，也不「为了显得安全」过度修低风险项。每条搁置项标「风险等级 + 重新评估条件」。

## 已落地（✅）

| 信任边界项 | 防护 | 位置 |
|-----------|------|------|
| CLI 命令路径 | `resolveCli` 绝对路径（防 PATH 劫持） | `scripts/backends.mjs` |
| 被审文件路径 | `validateFilePath`（限项目目录内） | `scripts/review-source.mjs` |
| 裁决读取的文件路径 | `resolveCode` 白名单（防 LLM 幻觉 file 字段） | `scripts/evaluate-models.mjs` |
| job id | `isValidJobId` 正则校验（防路径穿越） | `scripts/jobs.mjs` |
| 审计基线 commit | `gitChangedFiles` hex 格式校验（防命令注入） | `scripts/audit-baseline.mjs` |

## 已知搁置（⚠️）

| 风险项 | 风险等级 | 为什么搁置 | 重新评估条件 |
|--------|---------|-----------|-------------|
| prompt injection（`buildAdjudicatorPrompt` 里 finding/code 直接插值） | 低 | 攻击者 = 代码作者自己，收益 = 骗过自己的裁决；本地工具无「攻击者→受害者」信任边界 | **当 cc-suite-cn 开始审「不受信任的第三方代码」时，升级为必修**（加 delimiter/转义） |
| argv 泄漏（kimi/qwen 的 prompt 走 `-p` argv，本机 `ps` 可见被审代码） | 低 | 被审代码通常是用户自己的代码，非秘密 | **当被审代码含敏感信息（密钥/私有逻辑）时，升级为必修**（改走 stdin） |

## 说明

- 「已落地」项是经 TDD 修复并落账 `docs/verification.md` 的（SA-6 / SA-15 / SC-11 等）。
- 「搁置」项不是"假装没风险"，而是"显式记录风险 + 明确何时升级"——符合「结论≤证据」：不装模作样修低风险项，也不让风险悄悄烂在记忆里。
