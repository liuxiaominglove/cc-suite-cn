---
description: 查看某个任务的详细结果（需传 job id）
argument-hint: <job-id>
agent: build
---

# 任务结果

查看 `$ARGUMENTS`（job id）对应任务的完整结果。

## Run

用 Bash 运行：

```
node scripts/jobs.mjs --get "$ARGUMENTS"
```

展示该任务的完整 JSON（状态、结果 result、错误 error）。找不到时输出 `(未找到 ...)`。

> 先用 `/jobs` 拿到 job id，再传进来。
