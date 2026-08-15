---
description: 取消某个任务（需传 job id）
argument-hint: <job-id>
agent: build
---

# 取消任务

取消 `$ARGUMENTS`（job id）对应的任务。

## Run

用 Bash 运行：

```
node scripts/jobs.mjs --cancel "$ARGUMENTS"
```

成功输出 `已取消 <id>`，找不到输出 `(未找到 ...)`。

> 先用 `/jobs` 拿到 job id，再传进来。
