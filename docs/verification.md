# 验证台账

汇报"已验证"的结论必须能在这里找到对应行；查不到 = 未验证（标 🔴 或说"假设"）。

**置信度**：🟢 实测通过（有可重跑证据）｜🟡 机制/部分通过｜🔴 未验证或失败

| 结论 | 证据（可复现命令/方式） | 置信度 | 日期 |
|------|----------------------|--------|------|
| worker → opencode 真实往返可行（codebuddy/kimi/qwen 三壳） | 临时 MCP 桥 `delegate_to_opencode` 工具跑 `opencode run <task>`，三壳各自调用后拿到 opencode 回复 | 🟢 | 2026-08-13 |
| codebuddy 能锁死写（只放行桥） | `codebuddy -p --permission-mode bypassPermissions --disallowedTools "Edit,Bash"` 下写文件被拦、桥仍可用 | 🟢 | 2026-08-13 |
| kimi 无头锁写 | `[[permission.rules]] deny Write/Bash` + `[tools] disabled` 均未拦住写（`-p` 模式自动放行） | 🔴 | 2026-08-13 |
| qwen 无头锁写（带 `-y` 时） | `qwen -p -y --sandbox`（默认 permissive-open）仍能写临时目录 | 🔴 | 2026-08-13 |
| qwen 无 `-y` 时天然只读 | `qwen -p`（无 `-y`）下写文件被拒（写工具需审批，headless 无法批准） | 🟢 | 2026-08-13 |
| kimi session 续跑 | `kimi -r <session_id> -p "..."` 正确答出上一个会话创建的文件名 | 🟢 | 2026-08-13 |
| kimi CLI 只读评审返回合法 JSON | `review-runner.mjs --backend kimi --file demos/quick-demo.js` → severity/issues/summary 齐全 | 🟢 | 2026-08-13 |
| qwen CLI 只读评审返回合法 JSON | `review-runner.mjs --backend qwen --file demos/quick-demo.js` → severity/issues/summary 齐全 | 🟢 | 2026-08-13 |
| 四施工队并行评审（glm/hy3/kimi/qwen） | 4 backend 并行审 demo 文件，全部 success=true 且各有 findings | 🟢 | 2026-08-13 |
| 只读负向：评审后文件未改动 | 4 评审跑完 `git status demos/` 无改动（代码走 stdin，评审员碰不到文件） | 🟢 | 2026-08-13 |
| codebuddy 能写（且可精细锁） | `--permission-mode acceptEdits` 成功写文件；`--disallowedTools "Edit,Bash"` 能锁写 | 🟢 | 2026-08-13 |
| qwen 写权限是两档、无中间档 | 无 `-y` 写被拒（只读）、`-y` 写成功；`--help` 无 `--permission-mode` 档 | 🟡 | 2026-08-13 |
| codebuddy `acceptEdits` 拦 Bash（安全写） | `whoami` 被拒（"Bash 工具被权限策略拒绝"）；写文件走 Write 工具成功 | 🟢 | 2026-08-13 |
| implement() 真实实现（写代码） | `implement-runner.mjs --model glm-5.2` 把 `add` 函数写进 math.js、`subtract` 不变 | 🟢 | 2026-08-13 |
| 写后不自动合并 | implement 只改工作区文件、未 commit，`git diff` 可审、`git checkout` 可回退 | 🟢 | 2026-08-13 |
| /verify diff 审查（只发改动区域） | `review-runner.mjs --diff` 跑 `git diff HEAD`，只发 hunk+上下文；空 diff 早退不调 AI | 🟢 | 2026-08-13 |
| getDiff 异步 ENOENT 包装为 RunnerError | 补测 async ENOENT（真实 spawn 路径）通过 | 🟢 | 2026-08-13 |
| untracked 新文件不进 `git diff HEAD` | `git diff HEAD` 只含已跟踪改动；新文件需 `git add` 才入评审 | 🔴（已知局限，/verify 命令已注明） | 2026-08-13 |
| 反向桥（opencode-mcp-bridge）真实往返 | codebuddy 经 `delegate_to_opencode` 调 opencode，闸门开时拿到真实回复 | 🟢 | 2026-08-13 |
| 桥闸门负向（关时拒绝回派） | `OPC_BRIDGE_GATE` 未设为 open 时，`delegate_to_opencode` 返回"禁止回派"、不调 opencode | 🟢 | 2026-08-13 |
| 桥单测（InMemoryTransport + checkGate） | `createServer` 用 InMemoryTransport 连 client，闸门正负向 + 缺参校验全过 | 🟢 | 2026-08-13 |
| #3 真后台（detached worker） | `run-review --background` 1 秒返回，任务在独立进程继续跑，30 秒后 running→completed | 🟢 | 2026-08-13 |
| cancel 真 kill worker | cancel 后 35 秒任务仍 `cancelled`（未被 worker 覆盖成 completed），证明 worker 进程被真杀 | 🟢 | 2026-08-13 |
| worker 日志（决策 B） | 后台任务产出 `.cc-suite-pe/jobs/<id>.log`（stdout/stderr 重定向） | 🟢 | 2026-08-13 |
| P6-0: acceptEdits 拦 MCP 工具（命门） | `acceptEdits --mcp-config` 下调 `delegate_to_opencode` 被拒（DeferExecuteTool 需授权） | 🟢 | 2026-08-13 |
| P6-0: 解决方案 = bypassPermissions + 禁 Bash | `bypassPermissions --disallowedTools Bash` 下：能写文件 ✅、能调桥 ✅、拦 Bash ✅（codebuddy 明说 "Bash tool isn't available"） | 🟢 | 2026-08-13 |
| P6-0 gotcha: --disallowedTools 贪婪参数 | 放 prompt 前会吞掉 prompt 导致空输出，须放 prompt 后 | 🟡 | 2026-08-13 |

> 说明：上述评审结论已固化为 `pnpm verify`（`scripts/verify/verify-review.mjs`），一键重跑 4 评审员 + 只读负向。

> 写能力分工（已落地 P4）：qwen / kimi 只做**只读评审**；写代码 / 实现 / 修复走 **codebuddy**（`acceptEdits` = 能写文件、拦 Bash，是"安全写"）。写后不自动合并。qwen / kimi 若要开写，需先上 OS 级沙箱（`sandbox-exec`）硬隔离。
