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
| P6: 双向工作流 e2e | codebuddy 实现排序函数时回调 1 次问 opencode"快排还是归并"，opencode 拍板"归并"，codebuddy 继续写完 | 🟢 | 2026-08-13 |
| P6: 回调记录 + 统计 + 警告阈值 | 回调写入 JSONL、implement 返回 `callbackCount/callbacks/warnCallbacks`（≥3 警告）；单测覆盖 | 🟢 | 2026-08-13 |
| P6: 回调上限 5 次（硬限制） | 桥内计数，第 6 次返回"已达回调上限"；单测覆盖 | 🟢 | 2026-08-13 |
| bridge 默认超时常量化（bridge 300s / 非 bridge 120s） | `resolveTimeout` 单测 5 用例；`implement()` 签名改 `timeout=null`，桥模式不再被 120s 误杀 | 🟢 | 2026-08-14 |
| P6 双向回调 e2e 固化 | `pnpm verify` → `verify-bridge.mjs`：callbackCount≥1 + opencode 答案 42 传回 + 闸门关 callbackCount=0 | 🟢 | 2026-08-14 |
| #3 真后台 + 真取消 e2e 固化 | `pnpm verify` → `verify-background.mjs`：后台 running→completed + pid + 日志 + cancel 后进程 ESRCH | 🟢 | 2026-08-14 |
| review-e2e 四施工队实跑 | `pnpm test:e2e` 5/5：glm/hy3/kimi/qwen 均 success + 视角差异 | 🟢 | 2026-08-14 |
| kimi 卡死在 base64"脑内解码"提示 → 已修复 | `frameCode` 自适应反引号围栏替代 base64；kimi 评审含 ``` 的 review-runner.mjs 81s 完成（原挂死 >5min）；e2e 加回归守卫 | 🟢 | 2026-08-14 |
| isAuthError 误报 → 已修复 | 只在进程真正失败（非零退出）时判 AuthError；exit 0 时 stderr 的 "401"/"unauthorized"（如 kimi reasoning 引用）不再误报；单测覆盖正负向 | 🟢 | 2026-08-14 |
| kimi/qwen 写锁硬防护（cwd 隔离） | `review()` 对 kimi/qwen 用 `resolveReviewCwd` 把子进程 cwd 设到 temp（`os.tmpdir()`）；即使误写也落 temp 而非项目；单测覆盖 kimi/qwen/codebuddy/未知 backend | 🟢 | 2026-08-14 |
| codebuddy bypassPermissions+禁Bash 下**能联网** | 实测：任务"访问 httpbin.org/get?marker=随机token 回报 marker"——返回了真实随机 token（非训练数据） | 🟢 | 2026-08-14 |
| 工具级禁 WebFetch/WebSearch **拦不住**联网 | 实测：`--disallowedTools "WebFetch"` / `"WebSearch"` 下仍能取到随机 token → 怀疑 glm-5.2 模型级原生联网，非 WebFetch 工具通道 | 🔴（已知局限，写代码 agent 有只读联网，暂无工具级开关） | 2026-08-14 |
| 共享 spawn 逻辑（runner-core） | `runProcess`/`collectStream`/`RunnerError`/`TimeoutError`/`setSpawn` 抽到 `runner-core.mjs`，review/implement 复用；8 单测 + 回归 178 全绿 | 🟢 | 2026-08-14 |
| /audit 记入账本（--run-audit） | `jobs.mjs --run-audit --file` 4 模型并行 + 聚合 1 条 job；实测冒烟 4 worker 均 success | 🟢 | 2026-08-14 |
| /implement 记入账本（--run-implement --bridge） | `jobs.mjs --run-implement` 支持 --bridge/--timeout，实测冒烟记账 completed | 🟢 | 2026-08-14 |
| B 分身命令（/b-qwen /b-glm /b-kimi /b-hy3） | 4 个薄命令派活给对应 subagent | 🟡（命令已建，待人工跑一次验证派活） | 2026-08-14 |
| 反向桥 = 权限放大通道（已知风险） | codebuddy 禁了 Bash，但能经 `delegate_to_opencode` 让 opencode（高权限）代劳；现有缓解：桥闸门默认关 + 上限 5 + 边界声明 + 回调记录，**无硬隔离** | 🟡（软缓解，硬隔离未做；⚠️ 角色重构后已删除反向桥） | 2026-08-14 |
| 角色重构：4 模型 4 角色 | 找 bug=glm+kimi、批判员=qwen、验证审计员=hy3、修 bug=opencode；`models.mjs` 角色常量 + 互斥单测 | 🟢 | 2026-08-14 |
| 找 bug 精简（4→2） | `runAudit` 用 FIND_BUG_WORKERS（glm+kimi），单测 mock 断言只调 2 次 | 🟢 | 2026-08-14 |
| qwen 批判员 --sandbox 不破坏评审 | `backends.mjs` qwen 加 `--sandbox`（不传 -y 保持只读）；实测评审 13.7s 出正常 JSON | 🟢 | 2026-08-14 |
| 验证审计员 hy3 裁决 | `evaluate-models.mjs`：finding 归一化/相似度(Dice)/共识分类/裁决(hy3)/多维度聚合；26 单测 | 🟢 | 2026-08-14 |
| 废弃 /implement /fix + 反向桥 | 命令+代码全删（implement-runner/opencode-mcp-bridge/bridge-config/verify-bridge），jobs.mjs 移除 implement 路径，249 单测 + guard 绿 | 🟢 | 2026-08-14 |
| 超时 900s | run-audit 默认超时 900s；44KB 文件实测 kimi 300s 超时、600s 勉强，提到 900s 留余量 | 🟢 | 2026-08-14 |
| 大文件自动分块 | `chunkCode`(800行/块+10行重叠) + `offsetFindings`(行号偏移) + `reviewFile`(读→切→逐块审→合并)；12 单测；实测 1461 行 index.html 切成 2 块(800+671,startLine 1/791) | 🟢 | 2026-08-14 |
| 分块后行号偏移正确 | 块2(startLine=791) finding line 15 → 偏移后 805；单测覆盖 | 🟢 | 2026-08-14 |
| 某块失败不拖垮 | reviewFile 单块失败，其余块结果仍返回；单测覆盖 | 🟢 | 2026-08-14 |
| TDD 铁律入 AGENTS.md | 修 bug 必须 RED→GREEN→REFACTOR；无测试框架先用 node:test 搭；DOM 类改动标 🟡 | 🟢 | 2026-08-14 |

> 说明：上述评审结论固化为 `pnpm verify`（`scripts/verify/verify-review.mjs` + `verify-background.mjs`），一键重跑 4 评审员只读负向 + 真后台真取消。（`verify-bridge.mjs` 已随反向桥删除）

> 写能力分工（角色重构后）：**修 bug 只由 opencode（总指挥）亲自做**（最了解项目 + TDD）。施工队（glm/kimi/qwen/hy3）全部只读——找 bug / 批判 / 验证。写后不自动合并。
