---
description: 批判员 — qwen 复核 glm/kimi 的 finding 清单（同意/反对/补漏），必须先 /audit
argument-hint: <path>
agent: build
---

# 批判员（qwen 第二意见）

对最近一次 `/audit` 报的 finding 清单做独立批判：逐条判「同意/反对 + 理由」，并指出漏报。

> **前置：必须先 `/audit`**。批判员吃的是 glm/kimi 报的 finding 清单，没有清单就无料可批。若还没 audit，先跑 `/audit <path>` 再回来。
> `$ARGUMENTS` 是**路径**（被审文件）。空参数 → 提示用户给路径。路径不存在/不可读 → 提示用户路径无效，不继续。

## Step 1: 读最近 audit 的 findings

用 Bash（在项目目录）：

```
node scripts/jobs.mjs --list
```

找最近的 `audit` 任务，记下 `<job-id>`，然后读结果：

```
node scripts/jobs.mjs --get <job-id>
```

`result.workers` 是 glm+kimi 的评审结果，把每个 worker 的 `issues` 扁平成一个数组，写成 `/tmp/findings.json`（格式 `[{file, line, finding}, ...]`）。

## Step 2: 调 criticize 批判

用 Bash：

```
node scripts/review-runner.mjs --critic --file "<target>" --findings-file /tmp/findings.json --backend qwen --model qwen3-coder-plus
```

## Step 3: 展示批判结果

输出 `{ verdicts: [{index, agree, reason}], missed: [{file, line, finding}] }`：

- **verdicts**：逐条 `agree`（真 bug）/ `disagree`（假阳，附理由）——disagree 的供裁决/终审直接过滤
- **missed**：qwen 补漏的真 bug——并入待裁清单

## Critical Rules

- **必须先 audit**：没有 finding 清单不批判（不回退成独立评审）
- 批判员只批判清单，不重新扫代码
- 批判员只读 + sandbox，不修代码
- 批判结果供 hy3 裁决和 opencode 终审参考，本身不是终审
