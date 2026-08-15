# 功能基线清单

这是 cc-suite-cn 的**功能对照基线**（单一数据源）。每次 cc-suite-cn 工作完、总结时，按此清单给"本次触达的功能"标三色（🟢 实测通过 / 🟡 机制或部分 / 🔴 未验证或失败）。

> 铁律：**没实测的功能标"未触达"，不算 🟢**。每个 🟢 必须能指向 `docs/verification.md` 对应结论或本次命令输出。

| # | 功能 | 入口 | 怎么验证 | 证据锚点（台账结论主题） |
|---|------|------|----------|--------------------------|
| 1 | 找 bug（glm+kimi 只读评审） | `/audit`、`--run-audit` | 跑一次 `/audit`，两模型各返回 findings | "四施工队并行评审" / "review-e2e 四施工队实跑" |
| 2 | 批判员（qwen 第二意见） | `/review-qwen` | 跑一次，返回独立评审 JSON | "qwen 批判员 --sandbox 不破坏评审" |
| 3 | 验证审计员（hy3 裁决） | `/evaluate --arbitrate` | 跑一次，输出 per-model precision | "验证审计员 hy3 裁决" / "SA-3/SA-4 端到端" |
| 4 | 修 bug（opencode TDD） | `/fix` | 修一个 bug，RED→GREEN→REFACTOR + 测试绿 | "修 5 个真 bug（TDD）" 等 |
| 5 | diff 审查 | `/verify`、`--run-audit --diff` | 有改动时跑，只发 hunk+上下文 | "/verify diff 审查" |
| 6 | 后台任务 + 账本 + 真取消 | `/jobs` `/result` `/cancel`、`--background` | 起后台任务→running→completed；cancel 后进程 ESRCH | "#3 真后台" / "cancel 真 kill worker" |
| 7 | 大文件分块 + 行号偏移 | `chunkCode`+`offsetFindings`（>800 行） | 审 >800 行文件，行号偏移正确 | "大文件自动分块" / "分块后行号偏移正确" |
| 8 | 超时 900s + 重试 | `DEFAULT_TIMEOUT`、`withRetry` | 慢模型不误杀；瞬时失败自动重试 | "超时统一 900s" / "review() 重试" |
| 9 | 规则注入（AGENTS.md/CLAUDE.md） | `collectProjectRules` | 审子目录文件，根 AGENTS.md 被注入 | "WI-1: 注入 AGENTS.md" / "SA-2 向上查找" |
| 10 | NL 工件评审切换 | `NL_REVIEW_PROMPT`、`isNLArtifact` | 审 .md 命令/skill/agent 自动用 NL 维度 | "WI-4: 内置 NL 工件评审维度" / "SA-1 fileName" |
| 11 | finding 归一化/共识/去重 | `normalizeFinding`、`dedupFindings` | 跨模型共识率、去重后唯一数正确 | "finding 归一化/共识/去重" |
| 12 | 裁决并发上限 | `ADJUDICATE_CONCURRENCY=4` | 大批 finding 裁决不卡死、并发≤4 | "SA-4 并发上限" |
| 13 | audit-log 持久化 | `audit-logger.mjs` | `--run-audit` 后 audit-log.json 追加 | "audit-log 接线" |
| 14 | 漂移守卫 | `pnpm test` → `guard.mjs` | 有重复拷贝/缺失 canonical/死引用时 FAIL | "WI-6: guard 内容一致性检查" |
| 15 | 只读安全（写锁） | kimi `--agent-file` / qwen `--sandbox` / cwd 隔离 | 诱导写文件被拒、文件未变 | "M-2 kimi 只读护栏" / "qwen 无 -y 天然只读" / "cwd 隔离" |
| 16 | 自审（dogfooding） | `pnpm self-audit` | 对 8 核心脚本跑 glm+kimi，release 前 | "自审（dogfooding）第一轮" |

## 三色判定

- 🟢 实测通过：本次刚跑过且能指向证据
- 🟡 机制或部分：只测了替代物 / 部分场景 / 仅凭文档推断
- 🔴 未验证或失败：没测过，或测了失败
- **未触达**：本次根本没用到该功能（不算 🟢，也别说"正常"）
