# 4. 将 pnpm verify 改名为 pnpm verify:e2e

- 状态：已接受
- 日期：2026-08-22

## 上下文

斜杠命令 /verify（修 bug 后唯一复审）与终端命令 pnpm verify（release 门禁）命名撞车，规则散落 AGENTS.md 七处，导致误将门禁规则套用到复审上。

## 决策

### 本质
命名撞车（`/verify` 与 `pnpm verify`）导致规则串读；可逆（改名可回退）、无损。

### 最佳实践
命名冲突的根治是「物理消除歧义」（改名），而非「文档提醒」（治标）。

### 方案
将 package.json 中 verify script 改名为 verify:e2e，并同步更新 AGENTS.md、README.md、docs/verification.md 中全部引用。

## 后果

正面：彻底消除命名歧义，从物理上防止再混淆；负面：有损改动，需同步多处引用，但已 grep 核清无外部依赖。

## 被拒备选

不改名仅靠文档提醒：无法根治，下次换个相似名字仍会串。
