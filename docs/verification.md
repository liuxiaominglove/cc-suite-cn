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
| 超时统一 900s | review/adjudicate 默认都 900s（抽 DEFAULT_TIMEOUT/ADJUDICATE_TIMEOUT 常量），qwen 批判员/hy3 裁判大文件不超时 | 🟢 | 2026-08-14 |
| 批判员 qwen 也分块 | review-runner CLI 文件模式走 reviewFile（分块），customPrompt/allowExternal 透传 | 🟢 | 2026-08-14 |
| hy3 裁决只传上下文（不整文件） | `extractContext(code,line,±40行)`；adjudicate 有 line 时只传 finding 附近代码段；evaluateModels 传 finding 行号 | 🟢 | 2026-08-14 |
| audit-log 接线（run-audit 顺带写） | `persistAuditEntries`(原子写) + run-audit 把 worker 结果经 fromReviewResult 追加到 audit-log.json；实测 14→16 条 | 🟢 | 2026-08-14 |
| /audit-full + /fix 闭环命令 | 命令 .md：/audit-full=找bug+批判员+裁决三合一；/fix=找→裁→修(TDD)→验闭环 | 🟡（命令已建，待真实跑一次验证） | 2026-08-14 |
| 抽检 hy3 准确性（5/5 判对） | 3 真 bug（空值崩溃/原型污染/逐次舍入）+ 2 假 finding（SQL注入/死循环）→ hy3 全判对，evidence 还指出 removeItem 该用可选链 | 🟢 | 2026-08-14 |
| 样本达标（glm/kimi 各 ≥5 run） | `/evaluate` 显示 glm/kimi 各 5 run，不再标 ⚠不足 | 🟢 | 2026-08-14 |
| ELTA 实战：找 bug（Swift 项目） | 19 个 Swift 文件 glm+kimi 各 19/19 全覆盖（306 finding → 去重 283）；大文件分块正常 | 🟢 | 2026-08-14 |
| ELTA 实战：hy3 裁决纠错 | top 10 候选 → hy3 判 5 真 5 假，并纠正 opencode 3 个误判（shortName 是硬编码字面量非用户输入 / sRGB 恒可用 / UTF-8 编码永不失败） | 🟢 | 2026-08-14 |
| ELTA 实战：修 5 个真 bug（TDD） | 迁移写失败丢key + setApiKey明文残留 + keychain先删后加丢key + 401/403误报成功 + keyCode=0哨兵丢Cmd+A；新增 8 测试，176 全绿 | 🟢 | 2026-08-14 |
| ELTA 实战第二轮：裁决 12 候选（7 真 5 假） | hy3 又纠正 5 个误判（SWC:320 已返回自定义endpoint / RWC:69 passRetained 是契约 / TP:80 仅日志用 / RWC:96 CFMachPort 自动释放 / SWC:801 主线程无竞态） | 🟢 | 2026-08-14 |
| ELTA 实战第二轮：修 7 个真 bug（TDD） | substringInRange UTF-16偏移(emoji) + 划词日志隐私 + 剪贴板restore先清后写 + NSRegularExpression缓存 + loadKey可见性复位 + providerChanged顺序 + reset完整复位；179 全绿 | 🟢 | 2026-08-14 |
| review() 重试（瞬时限速自动恢复） | `withRetry`（maxRetries=2 退避 10s/30s），只对 TimeoutError/RunnerError 重试、AuthError 不重试；runAudit 传 retries=2 | 🟢 | 2026-08-14 |
| 失败醒目化（--run-audit 显示 worker OK/FAIL） | `summarizeWorkers` 输出 `glm-5.2: OK(8) \| kimi-k2.7-code: FAIL(...)`；实测 kimi 失败时前台立刻可见 | 🟢 | 2026-08-14 |
| ⚠ 评审员缺项目 AGENTS.md 上下文 → 误报 | qwen/kimi 把「CFTypeRef 强转」当 bug 报，但被审项目 AGENTS.md 明确此为正确做法（typeID 判断会 SIGSEGV）；review() 未把项目 AGENTS.md 注入 prompt | 🟢（已修 WI-1） | 2026-08-14 |
| ⚠ 双模型共识率极低 | ELTA 283 唯一 finding 仅 21 共识（7%）；glm/kimi 抓的 bug 几乎不重叠，导致"全修"成本高 | 🟡（观察中） | 2026-08-14 |
| ⚠ 严重度虚高 | 283 finding 中 94 标 high，但大量是"注释中英混写/未用import/魔法数字"噪音 | 🟡（观察中） | 2026-08-14 |
| ⚠ kimi 余额<50 触发限速 | Moonshot 余额<50 时 kimi exit code 1（并发放大）；充值后恢复；重试机制已兜底 | 🟡（环境依赖，非代码缺陷） | 2026-08-14 |
| ⚠ 15 并发后台 worker 卡死 | 一次投 15 个 `--background`，spawnWorker(detached+unref) 大多死/卡，job 卡 running 无兜底；≤6 并发正常 | 🟢（已修 WI-7：acquireSlot 并发上限 + --max-concurrent 默认4） | 2026-08-14 |
| kimi `-y` 与 `-p` 不兼容（教训） | `kimi -y -p` 报 "Cannot combine --prompt with --yolo"；且 `-p` 模式本就不等工具审批。曾误加 -y 后回滚 | 🟢 | 2026-08-14 |
| WI-1: review() 注入 AGENTS.md/CLAUDE.md | `collectProjectRules`（全文，超400行截断）+ `buildRulesSection` 拼进 prompt；9 单测（含截断/读失败容错/注入集成） | 🟢 | 2026-08-14 |
| WI-2: loadAudits 按 task 去重 | `dedupJobsByTask` 每个文件只留最新 job，run 数按唯一文件算（修复 glm 35 vs kimi 19 虚高）；4 单测 | 🟢 | 2026-08-14 |
| WI-3: dedupFindings + arbitrate 去重 | 跨文件按 (file+相似度0.6) 聚类，`--arbitrate` 只裁唯一 finding、verdict 回填 cluster 全成员；5 单测 + 集成（near-identical 只裁1次） | 🟢 | 2026-08-14 |
| WI-4: 删死代码 | 删 prompt-builder/weight-analyzer/weekly-sync/weights-validator(+test)+weights.json（1081行），清理 package.json/guard/AGENTS.md；全量 246 绿 | 🟢 | 2026-08-14 |
| WI-5: 重写 SKILL.md 为 4 角色 | SKILL.md 描述 find-bug(glm+kimi)/critic(qwen)/verifier(hy3)/fixer(opencode) + AGENTS.md 注入 | 🟢 | 2026-08-14 |
| WI-6: guard 内容一致性检查 | `findDeadReferences` 扫描 SKILL.md 引用的 .mjs/.json 是否存在，防再漂移；2 单测 + 真实 guard 过 | 🟢 | 2026-08-14 |
| WI-7: runJobBackground 并发上限 | `acquireSlot` 轮询等空位 + CLI `--max-concurrent`（默认4）；4 单测 + 集成（满员等位） | 🟢 | 2026-08-14 |
| 风险1: codebuddy 只读不设防 → 修复 | 负向实测：`--print` 非交互默认拒 Edit/Write，但 Bash 会挂起等审批；加 `--disallowedTools "Edit Write Bash"` 后 25s 内明确拒绝且不挂起（文件未变）。所有后端统一加 READ_ONLY_DECLARATION | 🟢 | 2026-08-14 |
| 风险2: hy3 裁决注入项目规则 | `buildAdjudicatorPrompt` 加 rules 段 + `adjudicate` 透传 + `evaluateModels` 加 resolveRules（CLI 从 cwd 读 AGENTS.md）；3 单测 | 🟢 | 2026-08-14 |
| 风险3: adjudicate 加重试 | `adjudicate` 用 withRetry（retries 默认0，CLI 传2），transient 失败重试而非直接 uncertain；2 单测 | 🟢 | 2026-08-14 |
| 审查 NL 工件反思 WI-1: reviewFile 单块/每块评审传 fileName | `review()` 加 `fileName` 参数（prompt 加 `FILE:` 标注）+ `reviewFile` 透传；修 qwen 把 file 字段标错的根因；3 单测 | 🟢 | 2026-08-14 |
| 审查 NL 工件反思 WI-2: extractJson 用 jsonrepair 兜底 | 引 `jsonrepair`；候选列表 + 严格/宽松双解析；修 glm 非法 JSON（尾随逗号/单引号）丢 finding；2 单测 | 🟢 | 2026-08-14 |
| 审查 NL 工件反思 WI-6: allowExternal 规则跟被审文件目录 | `review()` `ruleCwd` = file 目录（或 dir）；`collectProjectRules` 从被审目录收 AGENTS.md；1 单测 | 🟢 | 2026-08-14 |
| 审查 NL 工件反思 WI-3: run-audit/run-review 支持 --allow-external + --prompt | `jobs.mjs` parseArgs/runAudit/spawnWorker/CLI 全链路透传，外部文件评审可记账本；3 单测 | 🟢 | 2026-08-14 |
| 审查 NL 工件反思 WI-4: 内置 NL 工件评审维度 | `NL_REVIEW_PROMPT` + `isNLArtifact`（.md 命令/技能/agent 自动切换，--prompt 可覆盖）；3 单测 | 🟢 | 2026-08-14 |
| 审查 NL 工件反思 WI-5: adjudicate 防幻觉声明 | `buildAdjudicatorPrompt` 加"不要声称搜索仓库（无权访问）"；消除 hy3 对文档 finding 的"全仓搜索零匹配"假阴；1 单测 | 🟢 | 2026-08-14 |
| 本轮 6 WI 全绿 | `pnpm test:unit` 272 全绿 + guard 通过 | 🟢 | 2026-08-14 |

> 说明：上述评审结论固化为 `pnpm verify`（`scripts/verify/verify-review.mjs` + `verify-background.mjs`），一键重跑 4 评审员只读负向 + 真后台真取消。（`verify-bridge.mjs` 已随反向桥删除）

> 写能力分工（角色重构后）：**修 bug 只由 opencode（总指挥）亲自做**（最了解项目 + TDD）。施工队（glm/kimi/qwen/hy3）全部只读——找 bug / 批判 / 验证。写后不自动合并。
