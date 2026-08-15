---
description: 用 Qwen CLI（独立壳）只读评审文件或目录
agent: build
---

# Qwen 只读评审

用 **Qwen CLI**（独立壳，非 codebuddy 网关）对 `$ARGUMENTS` 指定的文件或目录做只读代码评审。

## Step 1: Determine Target

| Input | Behavior |
|-------|----------|
| (empty) | "请指定文件或目录，例如 `/review-qwen src/file.ts`" |
| file path | Target = 该文件（相对 cwd 或绝对） |
| directory path | 用 `--dir` 模式批量评审目录下所有源文件 |

## Step 2: Run Review

用 Bash 运行（单壳、只读）：

```
node scripts/review-runner.mjs --backend qwen --model qwen3-coder-plus --file "<target>"
```

目录模式：

```
node scripts/review-runner.mjs --backend qwen --model qwen3-coder-plus --dir "<target>" --exts ".js,.ts,.py,.swift,..."
```

（`--exts` 列表匹配目录里发现的文件类型；默认超时 900s，超大文件会自动分块）

## Step 3: Present

展示评审结果：`severity`、`issues`（逐条 finding + fix）、`summary`。

## Critical Rules

- Qwen 是**只读评审**（headless 无 `-y` 时写工具被拒），代码走 stdin；不要让它修改任何文件
- 不伪造问题——评审员返回空就如实说
