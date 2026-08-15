---
description: 查看任务账本（所有后台/已记录任务的状态列表）
agent: build
---

# 任务状态

列出任务账本里的所有任务。

## Run

用 Bash 运行：

```
node scripts/jobs.mjs --list
```

展示每行：`job id  [状态]  类型  模型  任务描述`（状态：running / completed / failed / cancelled）。

无任务时输出 `(无任务)`。
