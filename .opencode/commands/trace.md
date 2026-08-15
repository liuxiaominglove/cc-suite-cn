---
description: 变更追溯 — 查某个 finding 的报→裁→修完整链路
argument-hint: <keyword|file:line>
agent: build
---

# 变更追溯

查 `$ARGUMENTS`（finding 关键词、或 `file:line`）对应的完整链路：谁报的 → hy3 怎么裁决的 → 是否已修 → 测试证据。

> 空参数 → 提示用户「请给 finding 关键词或 `file:line`，如 `/trace scripts/jobs.mjs:25`」。

## Step 1: 在裁决账本里找条目

用 Bash 读 `.cc-suite-pe/verdict-log.json`，按 `$ARGUMENTS` 匹配 file / finding：

```
node --input-type=module -e "
import { loadVerdicts } from './scripts/verdict-log.mjs';
const log = await loadVerdicts();
const kw = '$ARGUMENTS';
const hits = log.filter(v => (v.file||'').includes(kw) || (v.finding||'').includes(kw));
console.log(JSON.stringify(hits, null, 2));
"
```

## Step 2: 展示链路

对每条命中，展示完整链路：

| 字段 | 含义 |
|------|------|
| `file:line` | bug 位置 |
| `verdict` | hy3 裁决：true（真 bug）/ false（假阳）/ uncertain |
| `evidence` | 裁决理由（一句证据） |
| `codeHash` | 裁决时的代码快照（可对照 `isVerdictStale` 判断代码是否已变） |
| `fixed` | 若已修：`{commit, testEvidence, fixedAt}`；空 = 尚未修复 |

## Critical Rules

- 只读追溯，不改任何文件
- `fixed` 为空 = 该 finding 尚未修复（待 `/fix` 处理）
- 无命中 → 如实说"裁决账本里没有这个 finding"（可能还没跑过 `/evaluate --arbitrate`）
