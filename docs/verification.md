# 验证台账

汇报"已验证"的结论必须能在这里找到对应行；查不到 = 未验证（标 🔴 或说"假设"）。

**置信度**：🟢 实测通过（有可重跑证据）｜🟡 机制/部分通过｜🔴 未验证或失败

| 结论 | 证据（可复现命令/方式） | 置信度 | 日期 |
|------|----------------------|--------|------|
| worker → opencode 真实往返可行（codebuddy/kimi/qwen 三壳） | 临时 MCP 桥 `delegate_to_opencode` 工具跑 `opencode run <task>`，三壳各自调用后拿到 opencode 回复 | 🟢 | 2026-08-13 |
| codebuddy 能锁死写（只放行桥） | `codebuddy -p --permission-mode bypassPermissions --disallowedTools "Edit,Bash"` 下写文件被拦、桥仍可用 | 🟢 | 2026-08-13 |
| kimi 无头锁写 | `[[permission.rules]] deny Write/Bash` + `[tools] disabled` 均未拦住写（`-p` 模式自动放行） | 🔴（→ 已由 M-2 的 `--agent-file` + `disallowedTools` 解决） | 2026-08-13 |
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
| worker 日志（决策 B） | 后台任务产出 `.cc-suite-cn/jobs/<id>.log`（stdout/stderr 重定向） | 🟢 | 2026-08-13 |
| P6-0: acceptEdits 拦 MCP 工具（命门） | `acceptEdits --mcp-config` 下调 `delegate_to_opencode` 被拒（DeferExecuteTool 需授权） | 🟢 | 2026-08-13 |
| P6-0: 解决方案 = bypassPermissions + 禁 Bash | `bypassPermissions --disallowedTools Bash` 下：能写文件 ✅、能调桥 ✅、拦 Bash ✅（codebuddy 明说 "Bash tool isn't available"） | 🟢 | 2026-08-13 |
| P6-0 gotcha: --disallowedTools 贪婪参数 | 放 prompt 前会吞掉 prompt 导致空输出，须放 prompt 后 | 🟡 | 2026-08-13 |
| P6: 双向工作流 e2e | codebuddy 实现排序函数时回调 1 次问 opencode"快排还是归并"，opencode 拍板"归并"，codebuddy 继续写完 | 🟢 | 2026-08-13 |
| P6: 回调记录 + 统计 + 警告阈值 | 回调写入 JSONL、implement 返回 `callbackCount/callbacks/warnCallbacks`（≥3 警告）；单测覆盖 | 🟢 | 2026-08-13 |
| P6: 回调上限 5 次（硬限制） | 桥内计数，第 6 次返回"已达回调上限"；单测覆盖 | 🟢 | 2026-08-13 |
| bridge 默认超时常量化（bridge 300s / 非 bridge 120s） | `resolveTimeout` 单测 5 用例；`implement()` 签名改 `timeout=null`，桥模式不再被 120s 误杀 | 🟢 | 2026-08-14 |
| P6 双向回调 e2e 固化 | `pnpm verify:e2e` → `verify-bridge.mjs`：callbackCount≥1 + opencode 答案 42 传回 + 闸门关 callbackCount=0 | 🟢 | 2026-08-14 |
| #3 真后台 + 真取消 e2e 固化 | `pnpm verify:e2e` → `verify-background.mjs`：后台 running→completed + pid + 日志 + cancel 后进程 ESRCH | 🟢 | 2026-08-14 |
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
| 外部 Swift 项目实战：找 bug | 19 个 Swift 文件 glm+kimi 各 19/19 全覆盖（306 finding → 去重 283）；大文件分块正常 | 🟢 | 2026-08-14 |
| 外部 Swift 项目实战：hy3 裁决纠错 | top 10 候选 → hy3 判 5 真 5 假，并纠正 opencode 3 个误判（shortName 是硬编码字面量非用户输入 / sRGB 恒可用 / UTF-8 编码永不失败） | 🟢 | 2026-08-14 |
| 外部 Swift 项目实战：修 5 个真 bug（TDD） | 迁移写失败丢key + setApiKey明文残留 + keychain先删后加丢key + 401/403误报成功 + keyCode=0哨兵丢Cmd+A；新增 8 测试，176 全绿 | 🟢 | 2026-08-14 |
| 外部 Swift 项目实战第二轮：裁决 12 候选（7 真 5 假） | hy3 又纠正 5 个误判（SWC:320 已返回自定义endpoint / RWC:69 passRetained 是契约 / TP:80 仅日志用 / RWC:96 CFMachPort 自动释放 / SWC:801 主线程无竞态） | 🟢 | 2026-08-14 |
| 外部 Swift 项目实战第二轮：修 7 个真 bug（TDD） | substringInRange UTF-16偏移(emoji) + 划词日志隐私 + 剪贴板restore先清后写 + NSRegularExpression缓存 + loadKey可见性复位 + providerChanged顺序 + reset完整复位；179 全绿 | 🟢 | 2026-08-14 |
| review() 重试（瞬时限速自动恢复） | `withRetry`（maxRetries=2 退避 10s/30s），只对 TimeoutError/RunnerError 重试、AuthError 不重试；runAudit 传 retries=2 | 🟢 | 2026-08-14 |
| 失败醒目化（--run-audit 显示 worker OK/FAIL） | `summarizeWorkers` 输出 `glm-5.2: OK(8) \| kimi-k2.7-code: FAIL(...)`；实测 kimi 失败时前台立刻可见 | 🟢 | 2026-08-14 |
| ⚠ 评审员缺项目 AGENTS.md 上下文 → 误报 | qwen/kimi 把「CFTypeRef 强转」当 bug 报，但被审项目 AGENTS.md 明确此为正确做法（typeID 判断会 SIGSEGV）；review() 未把项目 AGENTS.md 注入 prompt | 🟢（已修 WI-1） | 2026-08-14 |
| ⚠ 双模型共识率极低 | 外部 Swift 项目 283 唯一 finding 仅 21 共识（7%）；glm/kimi 抓的 bug 几乎不重叠，导致"全修"成本高 | 🟡（观察中） | 2026-08-14 |
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
| 体检 13 finding 修复（TDD） | `docs-consistency.test.mjs`（14 用例：模型一致性/幽灵路径/Key Files/常量名/角色概念/命令规格/打分 finding）+ `backends.test.mjs` 更新；全量 288 全绿 + guard 通过 | 🟢 | 2026-08-14 |
| M-1: resolveCli 绝对路径防 PATH 劫持 | `backends.mjs` 加 `resolveCli`（`command -v` 解析绝对路径，`which` 可注入测试），buildCommand 三后端统一走它；2 单测 | 🟢 | 2026-08-14 |
| M-2: kimi `--agent-file` 只读护栏（disallowedTools 锁写） | 初版 `--plan` 与 `-p` 冲突（`Cannot combine --prompt with --plan`，评审会坏）已废弃；改用 `--agent-file` 加载 `scripts/kimi-readonly-agent.md`（`disallowedTools: [Bash, Write, Edit]`）；实测诱导写文件被拒（kimi 明说"只读审查者禁止创建/修改/删除文件"）、文件未创建；`verify-kimi-sandbox.mjs` 固化。**两层纵深防御**：① `--agent-file` 硬锁工具（写/执行都禁）② 第 45 行 cwd 隔离兜底（即使误写也落 temp 不污染项目） | 🟢 | 2026-08-15 |
| kimi 渠道错误修正（alibaba-cn → moonshotai-cn） | 阿里百炼**无 Kimi**（用户从阿里官方确认）；B 分身 kimi 原本 `alibaba-cn/kimi-k2.6` 从始至终是坏的（opencode 从未连 Moonshot，分身从未真正跑过）；修正 `kimi.md` model → `moonshotai-cn/kimi-k2.7-code`（models.dev 权威）+ AGENTS.md 三处（架构图 / DASHSCOPE 去掉"通吃 Kimi" / MOONSHOT_API_KEY 从可选改必需）；重启 opencode 后实测 @kimi 分身自报 `moonshotai-cn/kimi-k2.7-code`（渠道+版本号均生效） | 🟢 | 2026-08-15 |
| TB-1: 被审文件路径 `validateFilePath` 限项目目录内 | `review-runner.mjs` 加 `validateFilePath`（默认限 `baseDir` 内，`allowExternal` 显式放行外部）；`review-runner.test.mjs` 5 用例（含 `../../etc/passwd` 拒绝、`/` 根放行） | 🟢 | 2026-08-17 |
| VF-1: /verify 复审 guard 棘轮改动（glm+kimi 找 3 真 bug + 1 假阳，TDD 修） | ① `findKnownRiskDrift` 对缺失/损坏 known-risks.json 改 fail-closed（原静默 `[]`，silent-pass）；② `findOrphanGlobalRules` 改 JSONC 解析 instructions（字符串感知去注释，URL `//` 不误删）+ anchor 校验改词边界（`M-1` 不误匹配 `M-10`）；③ docs-consistency 加反向检查（trust-boundary.md 已落地位置必须都在 JSON）。假阳：`CC-1`/`SA-6`/`SA-15`「不在 diff」——实际早已存在 verification.md。guard.test.mjs 43 用例 + 全量 669 绿 | 🟢 | 2026-08-17 |
| 复审（diff）评审员 glm → qwen（VERIFY_WORKERS 分流） | `models.mjs` 加 `VERIFY_WORKERS=[qwen3-coder-plus,kimi-k2.7-code]`；`jobs.mjs runAudit` 按 `diff` 分流（diff→qwen+kimi，非 diff→glm+kimi，`workerList` 命名消歧）；`jobs.test.mjs` 新增分流用例（diff 走 qwen+kimi backend/model、非 diff 走 glm+kimi），787 单测 + guard 绿；真实 `--run-audit --diff` 24 文件大 payload 实测 qwen OK(3)+kimi OK(3) 均非空（历史依据：glm 11/32=34.4% diff 空输出、kimi 0 次） | 🟢 | 2026-08-20 |
| 账本清理批A（130 条 actionable-unconfirmed 终审写回） | 备份 verdict-log.json → 代码级两步终审 130 条（假阳/陈旧 120 final=false + 真 bug 9 final=true + 真已修 1 final=true+fixed）→ `--confirm` 写回 130 条 + `markFixed` 1 条；终审暴露并 TDD 修复真 bug：`getActionableFindings` 忽略 `confirmed.final`（终审判假的假阳仍在待修清单），加 `v.confirmed?.final !== "false"` 过滤 + 专测，789 单测绿；成效：actionable 批A 130→9、全账本 212→89，confirmed 44→174，progress 出现各模型误报率 | 🟢 | 2026-08-20 |

> 说明：上述评审结论固化为 `pnpm verify:e2e`（`scripts/verify/verify-review.mjs` + `verify-background.mjs`），一键重跑 4 评审员只读负向 + 真后台真取消。（`verify-bridge.mjs` 已随反向桥删除）

> 写能力分工（角色重构后）：**修 bug 只由 opencode（总指挥）亲自做**（最了解项目 + TDD）。施工队（glm/kimi/qwen/hy3）全部只读——找 bug / 批判 / 验证。写后不自动合并。

---

# 自审（dogfooding）第一轮：审自己的引擎代码

**范围**：8 个核心非测试脚本（约 1500 行）= `review-runner / evaluate-models / jobs / backends / runner-core / guard / models / preflight`。**排除**：所有 `*.test.mjs`（测试是 oracle）、demos、docs、node_modules。
**流程**：`--run-audit --file`（glm+kimi 找 bug，16/16 worker 成功，合计 115 条 finding）→ opencode 逐条用代码级证据 triage → TDD 修真 bug → qwen 批判员修后复查。

## Triage 结果（opencode 逐条用源码核实）

- **真 bug 修复 12 项**（下表），全部 TDD（RED→GREEN）+ 全量 303 测试绿 + guard 绿。
- **确认假阳 3 项**（模型幻觉，源码里是对的）：① kimi 报 `runner-core` 用 `SIGSIGKILL`（实际是 `SIGKILL`）② glm 报 `adjudicate` 解构漏 `rules`（实际有 `rules=""`）③ kimi 报 `READ_ONLY_DECLARATION` 是死代码（实际在 review-runner:328 使用）。
- **归档（不修）**：约 40 项噪音/设计取舍/潜在但未触发的缺陷，代表性：`resolveCli` 裸名回退（backends.test.mjs:10 明确"让 spawn 报 ENOENT"，有意为之）、`--disallowedTools "Edit Write Bash"` 空格格式（台账 90 行已实测生效）、`import.meta.url === file://...` 入口守卫（macOS 正常路径下实测 MATCH，仅 Windows/空格路径/symlink 才失效）、`isWorkerModel` 不归一化别名（死代码，零调用方，models.test.mjs:40 固化其行为）。

## 真 bug 修复台账

| 结论 | 证据（测试用例） | 置信度 | 日期 |
|------|------------------|--------|------|
| SA-1: `reviewFile` 走 `fileName` 而非 `file`，导致 `.md` NL 工件评审永不触发 `NL_REVIEW_PROMPT`（isNLArtifact(file) 恒 false） | `review()` 改 `isNLArtifact(fileName ?? file)`；新增"review NL prompt selection"2 用例（fileName 指向 SKILL.md → NL prompt；.js → code prompt） | 🟢 | 2026-08-15 |
| SA-2: `collectProjectRules` 只查当前目录，子目录文件（如 `scripts/*.mjs`）拿不到根 `AGENTS.md` → 误报 | 改为向上一级目录查找直至文件系统根；新增"walks up to find AGENTS.md in an ancestor directory"用例 | 🟢 | 2026-08-15 |
| SA-3: `parseVerdict` 严格 `===` 只认字符串，hy3 输出 JSON 布尔 `{"verdict":true}` 会被静默判 `uncertain`，污染 precision | 改为 `String(parsed.verdict).trim().toLowerCase()`；新增布尔/大小写/空格 3 用例 | 🟢 | 2026-08-15 |
| SA-4: `evaluateModels` 裁决用 `Promise.all` 无并发上限，大 finding 集会并发 spawn 数百进程（台账 81 行已知 15 并发就卡死） | 新增 `mapLimit` + `ADJUDICATE_CONCURRENCY=4`；新增"caps adjudication concurrency"用例（20 finding 断言 maxRunning≤4） | 🟢 | 2026-08-15 |
| SA-5: `spawnWorker` 用裸 `node`（PATH 劫持风险，与项目自身 resolveCli 纪律矛盾） | 改 `process.execPath`；jobs.test.mjs 断言 `captured.cmd === process.execPath` | 🟢 | 2026-08-15 |
| SA-6: `jobFile(id)` 不校验 id，`--get/--cancel/--job-id` 可路径穿越读/写 jobs 目录外文件 | 新增 `isValidJobId`（`/^job-\d+-[a-f0-9]+$/`），`get/update/cancel` 对非法 id 返回 null；新增"rejects path-traversal ids"用例（含 existsSync 断言不外写） | 🟢 | 2026-08-15 |
| SA-7: `runProcess` timeout 缺省时 `setTimeout(fn, undefined)` ≈1ms 就 SIGTERM（共享 spawn 原语潜在缺陷） | 只在 `Number.isFinite(timeout) && timeout>0` 才 arm timer；新增"does not arm timer when timeout is undefined"用例 | 🟢 | 2026-08-15 |
| SA-8: `reviewFile` 聚合 severity 取第一块而非最高，可能低估整体风险 | 改 reduce 取 high>medium>low；新增"takes the highest severity across chunks"用例 | 🟢 | 2026-08-15 |
| SA-9: `chunkCode` 当 `overlap >= chunkSize` 时 `start = end - overlap` 无前进 → 死循环 | 顶部校验 chunkSize/overlap，非法抛错；新增 2 用例断言抛 /overlap/ | 🟢 | 2026-08-15 |
| SA-10: `withRetry` 负 `maxRetries` 时循环体不执行 → `throw undefined`（无信息错误） | clamp 到 0 + `throw lastErr ?? new Error(...)`；新增"clamps negative maxRetries"用例 | 🟢 | 2026-08-15 |
| SA-11: `guard.findStaleReferences` `readFileSync` 无存在性检查，fresh 机器（无全局 opencode 配置）`pnpm test` 直接 ENOENT 崩溃 | 读失败时 `continue` 跳过；新增"skips missing reference files instead of crashing"用例 | 🟢 | 2026-08-15 |
| SA-12: `updateJobWithResult` 捕获非 Error（如抛字符串）时 `err.message` 为 undefined，失败原因丢失 | 改 `err?.message ?? String(err)` | 🟢 | 2026-08-15 |

## 修后交叉验证（qwen 批判员只读复查 3 个改动最大的文件）

- 结论：**未发现新真 bug，也未否定上述 12 项修复**；仅产出噪音/设计取舍（timeout 15min 过长 / SKIP_DIRS 不全 / busy-wait CPU / SIGTERM 平台差异 / parseArgs 重复等）。其 `evaluateModels` 报"`m` used without defined"为幻觉（`m` 经 `member.m` 引用，mapLimit 改动未触及该作用域）。 | 🟢 | 2026-08-15 |
- SA-3/SA-4 端到端真模型验证：hy3 裁决 2 个 demo 审计（25 条 finding 去重后裁决）80.6s 完成，并发上限 4 生效未卡死，glm precision 0.87 / kimi 1.00（demo 是教学坏代码，precision 偏高属预期） | 🟢 | 2026-08-15 |

## 固化

- 新增 `scripts/self-audit.mjs`（`selfAudit()` 依次对 8 核心脚本跑 glm+kimi 找 bug）+ `scripts/self-audit.test.mjs`（2 用例）+ `pnpm self-audit`。**每次 release 前跑一次**。
- 自审结论定义（破循环三步）：**AI 报 → opencode 用代码级证据确认 → 🟢 测试落账**，缺一不宣称"质量提升"；单测是 ground truth，AI 审只找"测试没盖到的"。

---

# 外部项目实战：learnunk 审核（dogfooding 第二实例）

**范围**：`learnunk/src/*.js` 8 个文件（893 行，Node ESM + `node:sqlite`）。**流程**：glm+kimi 找 bug（16/16 worker 成功，约 130 条 finding）→ opencode 逐条代码级 triage → TDD 修复。**未单独跑 hy3 裁决**（triage 用代码级证据替代，且修后代码已变，再裁会误判）。

## triage 结果

- **真 bug 修复 7 项**（下表，全部 TDD + learnunk `npm test` 71 绿）。
- **确认假阳（关键）**：① glm+kimi 均报「`~` 路径不展开」——实际 `db.js resolveDbPath` 已处理（`openDb` 内部展开），假阳；② collector「getMessages/match 没 await」——两者是 sync 回调（`getRecentTextParts`/`matchConcepts` 均 sync），假阳；③ kimi 报 `resolveDbPath` 的 `path.join` 重置到根——混淆了 join/resolve，假阳。
- **归档（设计/噪音）**：SSRF、prompt-injection（本地工具，输入是用户自己的对话，非不可信）；`readJsonSafe` 吞 JSON 错误（有测试固化，对外部项目容错合理）；`stop()` 调 `process.exit`、temperature/model 硬编码、retry、null 防御、keywordRegex 性能、`__proto__` 污染（本地概念库）等。

## 真 bug 修复台账

| 结论 | 证据（learnunk 测试） | 置信度 | 日期 |
|------|----------------------|--------|------|
| LB-1: `parseConcept` frontmatter `---` 状态机——body 里的水平线会重新触发 meta 解析，丢弃后续内容 | `test/concepts.test.js` 新增"--- 水平线不重新触发"用例（10 绿） | 🟢 | 2026-08-15 |
| LB-2: `project.js` `tailwind` 包名错误（实际 npm 包是 `tailwindcss`）+ Python 框架 fastapi/django/flask 死代码（`deps` 只在 Node 分支填充） | `FRAMEWORK_PACKAGES` 别名映射 + `readRequirementsDeps` 解析 requirements.txt；`test/project.test.js` 新增 2 用例（7 绿） | 🟢 | 2026-08-15 |
| LB-3: `db.js` `LIKE '%"type":"text"%'` 漏带空格的 JSON（`{"type": "text"}`），文本消息静默丢失 | 改 `json_extract(p.data, '$.type') = 'text'`；新建 `test/db.test.js`（node:sqlite 内存库，5 用例） | 🟢 | 2026-08-15 |
| LB-4: `ui.js` down 箭头空列表时 `selected`/`sessionIdx` 变 -1（`Math.min(-1, ...)`），后续 `matched[-1]` 崩溃 | `Math.max(0, len-1)` 兜底；`test/ui.test.js` 新增 2 用例（29 绿） | 🟢 | 2026-08-15 |
| LB-5: `explainer.js`/`extractor.js` `fetch` 无超时（AI 挂起永久阻塞）+ `baseUrl` 无校验 | 加 `AbortController` + `timeoutMs`（默认 30s）+ `fetchFn` 注入 + baseUrl 校验；两个 test 各新增超时/正常用例 | 🟢 | 2026-08-15 |
| LB-6: `index.js` `loadConfig` bare catch 吞 JSON 语法错误（配置写错无反馈）+ 缺 ESM 入口保护（import 会触发 main()） | 区分 ENOENT（静默）/其他（warn）+ `pathToFileURL` 入口保护 + `maxSessions` 默认值归位；新建 `test/index.test.js`（3 用例） | 🟢 | 2026-08-15 |
| LB-7: `ui.js` footer 不提 `f` 键（功能不可见）+ `extractConceptsWithAI` 不限制 6 个概念 | footer 加「f 找更多」+ `.slice(0, 6)`；`test/ui.test.js` 新增 footer 用例 | 🟢 | 2026-08-15 |

## 结果

- learnunk `npm test`：71 全绿（新增 19 用例：concepts+1 / project+2 / db+5 / ui+3 / explainer+3 / extractor+2 / index+3）。
- 改动 12 文件（7 src + 5 test 改 + 2 新 test），**未 commit**，`git diff` 由用户审。

---

# 裁决前置：把 hy3 变成修 bug 的硬门槛

**起因**：learnunk 审核暴露「先修后验」——opencode 跳过 hy3 裁决直接 triage+修，等 hy3 上场时代码已变、误判成假阳。根因：hy3 裁决结果（verdict）算完即丢、不落库，也没有"修前必须裁决"的约束。

## 改动

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| VD-1: 新增 `scripts/verdict-log.mjs`（裁决账本） | `hashContent`(sha256) / `persistVerdicts`(原子写+按 file:line:finding 去重) / `loadVerdicts`(容错) / `getActionableFindings`(筛 true) / `isVerdictStale`(codeHash 校验)；`verdict-log.test.mjs` 12 用例 | 🟢 | 2026-08-15 |
| VD-2: `evaluate-models.mjs` 裁决落库 + codeHash | `evaluateModels` 裁决时算文件 sha256 存 codeHash、返回 `verdicts` 数组；`cli --arbitrate` 落库到 `.cc-suite-cn/verdict-log.json`；`evaluate-models.test.mjs` 新增 2 用例（verdicts+codeHash / 无裁决返回空） | 🟢 | 2026-08-15 |
| VD-3: `/fix` 命令裁决前置 + override 出口 | `.opencode/commands/fix.md` 重写：找 bug → **裁决(强制)** → 读待修清单(verdict=true) → 终审+codeHash 校验 → TDD 修 → verify；override 出口须台账标"未经裁决" | 🟢 | 2026-08-15 |
| VD-4: SKILL.md 三层分工 + 裁决前置规则 | How I Work 加三层分工图（找 bug→批判→裁决→终审修）+ Critical Rules 加"裁决前置硬门槛" | 🟢 | 2026-08-15 |
| VD-5: docs-consistency 测试指向 repo 命令 | 产品化删全局命令后，`review.md`/`verify.md` 测试改指 repo `.opencode/commands/`（原指向已删除的 `~/.config/opencode/commands/`，导致 pnpm test 红） | 🟢 | 2026-08-15 |
| VD-6: 端到端真模型验证 | 真 hy3 裁决 2 个 demo audit 25 条 → 落库成功；`getActionableFindings` 筛出 23 条 true；`isVerdictStale` 同内容=false、改后内容=true | 🟢 | 2026-08-15 |

## 结果

- `pnpm test:unit`：325 全绿（新增 verdict-log 12 + evaluate-models 2）+ guard 绿。
- 数据流：`audit-log` → `/evaluate --arbitrate`(hy3 裁决+codeHash) → `.cc-suite-cn/verdict-log.json` → `/fix` 读 `getActionableFindings`（verdict=true 且 codeHash 未失效）→ opencode 终审 + TDD 修。
- verdict-log.json 在 `.cc-suite-cn/`（已 gitignore，运行时数据不进仓库）。

---

# 完整闭环 dogfooding：审裁决前置机制本身

**对象**：刚写的裁决前置代码（`verdict-log.mjs` + `evaluate-models.mjs`）+ NL 工件（`fix.md` + `SKILL.md`）。**流程**：找 bug(glm+kimi) → 批判员(qwen) → 裁决(hy3 落库) → 终审(opencode) → TDD 修。首次走通完整闭环（不再跳过任何角色）。

## 四角色表现（本次真跑通）

| 环节 | 结果 |
|------|------|
| 找 bug（glm+kimi） | 4 文件 × 2 模型 = 8/8 成功，约 85 条 finding |
| 批判员（qwen） | 4 文件全审，补第二意见（verdictKey/loadVerdicts/uniqueTrue 等） |
| 裁决（hy3） | 69 条落库 verdict-log.json（真 hy3），45 条 verdict=true |
| 终审（opencode） | 代码级核实，发现 **hy3 假阴**（见下） |

## 关键发现：hy3 假阴（验证"初筛 + 终审"必要性）

- glm 报的真安全 bug「`resolveCode` 路径遍历——LLM 幻觉的 file 字段可读任意文件」被 hy3 判 false 漏掉；opencode 终审用代码级证据确认是真 bug，补回修复清单。
- 同理 glm 报的「`verdict-log.mjs` 未同步 `AGENTS.md` Key Files（单一数据源）」也被 hy3 判 false，终审补回。
- **结论**：hy3 裁决只能当初筛，opencode 终审兜假阴，正是设计预期。

## 修复台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| CC-1: `evaluate-models` `resolveCode` 白名单（防 LLM 幻觉 file 字段读任意文件） | 新增 `makeResolveCode(allowedFiles)`，只读 audit 明确记录的 file；`evaluate-models.test.mjs` +4 用例（拒绝 /etc/passwd、~/.ssh、空白名单） | 🟢 | 2026-08-15 |
| CC-2: `verdict-log` `persistVerdicts` 并发安全 + tmp 随机名 + finally 清理 + 去死绑定 | 模块级写队列串行化 + `randomBytes` tmp 名 + `unlink` 清理；`verdict-log.test.mjs` +2 用例（并发 3 写不丢失、无 .tmp 残留） | 🟢 | 2026-08-15 |
| CC-3: `fix.md` 重写 | $ARGUMENTS 明确为路径、零 actionable 停止条件、override 改客观标准（仅 hy3 假阴 + 代码级证据）、Step 6 补两节总结、job-id 关联说明 | 🟢 | 2026-08-15 |
| CC-4: `SKILL.md` 修正 | description 补 `/review`、"三层分工"改"四角色五步"、codeHash 失效定义、override 客观标准 | 🟢 | 2026-08-15 |
| CC-5: `AGENTS.md` 同步 | `/fix <bug>` → `/fix <path>`、Key Files 补 `verdict-log.mjs`（单一数据源） | 🟢 | 2026-08-15 |

## 结果

- `pnpm test:unit`：331 全绿（新增 makeResolveCode 4 + persistVerdicts 并发 2）+ guard 绿。
- 完整闭环四角色全跑通；verdict-log.json 由真 hy3 落库（非 mock）。
- 改动 10 文件（3 新 verdict-log 相关 + 7 改），**未 commit**。

---

# 改进：评审上下文注入 + prompt 收紧（grill 后第一轮）

**目标**：降低噪音率 + 消除「~ 不展开」类跨文件误报。

## 改动

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| IM-1: `collectImportContext` 注入被审文件的本地模块上下文 | 小模块(≤80 行)注入完整源码、大模块注入导出名；`review()` 在 file 模式注入 `[项目上下文]` 段；`review-runner.test.mjs` +5 用例（提取/过滤/容错/注入） | 🟢 | 2026-08-15 |
| IM-2: `adjudicate` 传整文件（≤800 行，>800 才截断 ±40） | `ADJUDICATE_MAX_CTX_LINES=800`；`evaluate-models.test.mjs` 新增"≤800 传整文件"用例 + 更新"context extraction"用例为 900 行截断 | 🟢 | 2026-08-15 |
| IM-3: `REVIEW_PROMPT` 收紧（只报具体 bug + 触发条件/影响） | 去掉"code quality problems"、加"trigger condition/impact"约束 + "Do NOT report 风格/性能/防御性建议"；测试断言 | 🟢 | 2026-08-15 |

## 验收结果（关键）

- **降噪达成**：复跑 learnunk `index.js` 审计，finding 从 **12 条（glm 7 + kimi 5）降到 4 条（glm 2 + kimi 2）**，噪音率约降 75%。
- **「~ 不展开」误报未消除**：即使把 `db.js` 完整源码（含 `resolveDbPath` 展开 `~` 的逻辑）注入 prompt，glm/kimi 仍报「`~` 没展开」——**这是 LLM 跨文件因果推理的固有局限**（评审员聚焦在 `index.js` 的 `~` 字面量，不跳转到 `db.js` 确认 `openDb` 内部调 `resolveDbPath`）。引导语也未消除且拖慢 kimi，已回退。
- **结论**：跨文件误报**不能靠 prompt 工程清零**，正确应对是"裁决 + opencode 终审兜底"——这恰印证了多角色架构的必要性（单 LLM 的局限靠多角色补）。

## 结果

- `pnpm test:unit`：338 全绿 + guard 绿。
- 改动：`review-runner.mjs`（+collectImportContext +prompt 收紧）、`evaluate-models.mjs`（裁决传整文件）+ 两个测试文件。

---

# 改进：两段式调用链核查 + 裁决跨文件上下文（grill 第二轮）

**目标**：消除「~ 不展开」跨文件误报（上一轮"注入源码"失败后，改用"强制推理 + 挪责任到裁决"）。

## 改动

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| IM-4: `REVIEW_PROMPT` 两段式（强制 trace call chain + `chain_analysis` 字段） | prompt 加"报 bug 前先定位函数→查实现→确认 bug 存在"，JSON 加 `chain_analysis`（每条 issue 写清函数名+真实行为）；`review-runner.test.mjs` 断言 + 解析含 chain_analysis 输出的集成测试 | 🟢 | 2026-08-15 |
| IM-5: 裁决注入跨文件上下文（`relatedCode`） | `buildAdjudicatorPrompt`/`adjudicate` 加 `relatedCode` 段（被 import 模块完整源码）；`evaluateModels` 加 `resolveImportContext`（复用 `collectImportContext`，白名单校验）；`evaluate-models.test.mjs` +3 用例 | 🟢 | 2026-08-15 |

## 验收结果（关键突破）

复跑 learnunk `index.js` 审计：
- **glm-5.2：0 issues**，summary 明确说 "No confirmed high/medium bugs found"——**「~ 不展开」误报彻底消除**。
- **kimi：2 issues，均非「~ 不展开」**，且报了**新的真 bug**：`config.json` 内容为合法 JSON 原语 `null`（或非对象）时，`loadConfig` 的 `...(cfg.ai \|\| {})` 抛 TypeError（触发条件+影响写清楚）。
- **结论**：两段式 + chain_analysis + 上下文注入的组合**有效**——不仅消除误报，还让"只报具体 bug"的收紧 prompt 逼出了之前被噪音淹没的真问题。

## 结果

- `pnpm test:unit`：344 全绿 + guard 绿。
- 改动：`review-runner.mjs`（两段式 prompt）、`evaluate-models.mjs`（relatedCode + resolveImportContext）+ 两个测试文件。

---

# 短板 3 + 4 落地 + learnunk 真 bug 修复

## learnunk（外部项目）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| learnunk `loadConfig` 容错：config.json 为 `null`/数组（合法 JSON 非对象）时崩溃 | kimi 在两段式 prompt 后报的真 bug；`src/index.js` 加「解析后验证非 null 非数组对象」；`test/index.test.js` +2 用例；learnunk `npm test` 108 全绿 | 🟢 | 2026-08-15 |

## cc-suite-cn（短板 3：qwen 批判员重定位）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| SC-1: `CRITIC_PROMPT` + `buildCriticPrompt` + `criticize()` | 批判员人设（逐条判同意/反对+理由 + 补漏，不重扫代码）；走 qwen backend；`review-runner.test.mjs` +4 用例（prompt 断言/解析 verdicts+missed/容错） | 🟢 | 2026-08-15 |
| SC-2: `review-runner.mjs` CLI 加 `--critic` 模式 | `--critic --file <path> --findings-file <json>` 入口 | 🟢 | 2026-08-15 |
| SC-3: `review-qwen.md` 重写为批判流程 | 必须先 audit 读 finding 清单 → criticize → 展示同意/反对/漏报；不回退独立评审 | 🟢 | 2026-08-15 |

## cc-suite-cn（短板 4：结构化 finding + 去重优化）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| SC-4: `sameLocation`（同 file+line 完全相等）位置优先归并 | `classifyConsensus`/`dedupFindings` 先按位置归并、文本相似度兜底；line 差 ≠0 不误并；`evaluate-models.test.mjs` +4 用例（同位置归并/差很多不误并） | 🟢 | 2026-08-15 |

## 结果

- cc-suite-cn `pnpm test:unit`：352 全绿 + guard 绿。
- learnunk `npm test`：108 全绿。
- 四角色流程补齐：找 bug → **批判（qwen 复核清单）** → 裁决（hy3）→ 终审（opencode）。

---

# learnunk 增量审核（批判员重定位后首次实战）

**检测**：git 精确识别「上次审核后的新增代码」= `ui.js`（computeSessionViewport 滚动视窗 + allConcepts/viewHeight 概念选择合并 + 会话滚动渲染）+ `explainer.js`（三段式讲解 prompt）。**范围**：只审这 2 文件，triage 聚焦新增行。

## 四环节实战（首次全流程跑通含批判员）

| 环节 | 结果 |
|------|------|
| 找 bug（glm+kimi） | 2 文件 6 finding |
| 批判（qwen criticize） | ui.js 4 条判 agree；**explainer prompt injection 判 disagree（过滤假阳）** |
| 裁决（hy3） | 6 条落库：4 true / 2 false；**识破 kimi 的「renderContext 未识别」假阳**（`[].join()` 返回 "" 是 falsy，`||` 实际生效） |
| 终审（opencode） | 确认 3 真 bug + 3 假阳 |

## 三层判断互补（关键发现）

- qwen 批判「同意」了 renderContext 假阳（没识破），hy3 裁决「反对」（识破了）——**两层互相纠错**，正是多角色价值。
- qwen 批判 + hy3 裁决都正确识别 prompt injection 为假阳（本地工具无信任边界）。

## 真 bug 修复台账（learnunk，TDD）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| LB-8: `pickSession` 切会话不清 `extraConcepts`（AI 概念残留到下一会话） | 加 `this.extraConcepts = []`；`ui.test.js` +1 用例 | 🟢 | 2026-08-15 |
| LB-9: `refresh` 对 collect 返回 null 无守卫（snapshot 从有效变 null 时 TypeError） | 加 `if (!snapshot)` 优雅降级；`ui.test.js` +1 用例 | 🟢 | 2026-08-15 |
| LB-10: `explainWithAI`/`extractConceptsWithAI` 无效 timeoutMs 立即超时 | `Number.isFinite(ms) && ms>0 ? ms : 30000`；`explainer.test.js` +1 用例（慢 fetch 验证不立即 abort） | 🟢 | 2026-08-15 |

## 结果

- learnunk `npm test`：111 全绿（+3 用例）。
- 3 假阳归档：prompt injection、renderContext「未识别」优先级、wrap 缩进（视觉噪音）。

---

# 审计生命周期三件套：基线 + 审计前置 + 变更追溯

**动机**：审已审项目靠手动 git diff（痛点）；opencode 修代码的审计前置缺明确声明；修复链路分散无统一追溯。

## 改动

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| LC-1: `scripts/audit-baseline.mjs`（增量审查基线） | `gitHead`/`gitChangedFiles`(diff+untracked)/`loadBaseline`/`saveBaseline`/`detectAuditScope`(四分支) + CLI `--detect/--save`；`audit-baseline.test.mjs` 15 用例 | 🟢 | 2026-08-15 |
| LC-2: `audit.md` 集成 Step 0 基线检测 | 主动询问「检测到 N 个文件变更，是否增量审查」；审完 `--save` 更新基线；docs-consistency +1 用例 | 🟢 | 2026-08-15 |
| LC-3: `fix.md`/`SKILL.md` 审计前置两道闸门声明 | 「opencode 修代码前必须过 ① hy3 裁决 ② opencode 终审，未过闸门不得修」；docs-consistency +2 用例 | 🟢 | 2026-08-15 |
| LC-4: `verdict-log.mjs` markFixed + getTrace | 修完 bug 追加 `fixed:{commit,testEvidence,fixedAt}`；`getTrace` 返回完整链路；`verdict-log.test.mjs` +5 用例 | 🟢 | 2026-08-15 |
| LC-5: `/trace` 命令（变更追溯） | `.opencode/commands/trace.md`：查报→裁→修链路；docs-consistency +1 用例 | 🟢 | 2026-08-15 |

## 实测

- 基线流程：`--detect` learnunk（首次 firstAudit=true）→ `--save`（记 fd18c94）→ 再 `--detect`（changed=false）✅
- `pnpm test:unit`：376 全绿 + guard 绿。

## 数据流（审计生命周期闭环）

```
审前：audit-baseline.mjs --detect（基线对比，主动问增量审查）
审中：hy3 裁决 → opencode 终审（审计前置两道闸门，修 bug 硬门槛）
审后：markFixed（修复 commit + 测试证据）→ /trace 追溯完整链路
      + audit-baseline.mjs --save（更新基线，供下次增量对比）
```

---

# cc-suite-cn 自审（增量 + 检测审计生命周期三件套）

**目标**：用刚建的三件套增量审 cc-suite-cn 自己（基线 = 上次完整闭环 dogfooding `b1e6657`），并检测三件套是否工作。

## 三件套检测结果（全通过）

| 机制 | 结果 |
|------|------|
| 增量审查 | `--detect` 正确报出 b1e6657 后 16 个变更文件（含 4 核心脚本）✅ |
| 审计前置 | 修 bug 前走完整闭环：找 bug(18 finding) → 批判(qwen) → 裁决(hy3 落库) → 终审(只修 verdict=true) ✅ |
| 变更追溯 | `markFixed` 标记修复（commit+测试证据）→ `/trace` 查完整链路 ✅ |

## 真 bug 修复（本次自审抓到 6 个，TDD）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| SA-13: `review-runner` --critic CLI 缺参数越界（args[indexOf+1] 返回 args[0]） | `parseCriticArgs` 抽取 + null 判断；+2 用例 | 🟢 | 2026-08-15 |
| SA-14: `review-runner` reviewFile 单块路径不传 file（空文件抛错） | 单块路径补传 `file`；+1 用例 | 🟢 | 2026-08-15 |
| SA-15: `audit-baseline` 命令注入（baseCommit 未校验拼进 execSync） | `gitChangedFiles` 校验 hex 格式；+2 用例 | 🟢 | 2026-08-15 |
| SA-16: `audit-baseline` --commit 无值静默用 HEAD | `parseSaveArgs` 加 hasCommitFlag；+2 用例 | 🟢 | 2026-08-15 |
| SA-17: `audit-baseline` saveBaseline 非原子 RMW | 写队列串行化；+1 用例 | 🟢 | 2026-08-15 |
| SA-18: `verdict-log` markFixed 读在写队列外 | markFixed 纳入写队列（enqueue + writeVerdictFile）；+1 用例 | 🟢 | 2026-08-15 |

## 结果

- `pnpm test:unit`：388 全绿 + guard 绿。
- 三件套闭环数据流全部实测通过。
- 基线已更新至 `1a6154e`（本次审完状态，供下次增量对比）。

---

# 技术栈感知 + 工作区确认 + 修复计划（三个改进）

## 改动

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| SC-5: `collectStackContext`（技术栈感知） | 读 package.json（engines/deps/test）/requirements.txt/pyproject.toml/go.mod/Cargo.toml，向上查找；`review-runner.test.mjs` +7 用例 | 🟢 | 2026-08-15 |
| SC-6: review 注入 `[技术栈]` 段 | file 模式 collectStackContext → fullPrompt 加 stackSection；+2 集成用例 | 🟢 | 2026-08-15 |
| SC-7: adjudicate 注入技术栈 | buildAdjudicatorPrompt/adjudicate 加 stackContext，evaluateModels 加 resolveStackContext；+3 用例 | 🟢 | 2026-08-15 |
| SC-8: `gitDirty` + detectAuditScope 返回 dirty | `git status --porcelain` 检测工作区；+4 用例 | 🟢 | 2026-08-15 |
| SC-9: audit.md Step 0 工作区未提交提示 | dirty=true 时提示「未提交改动不在 git diff 内，增量可能不完整」 | 🟢 | 2026-08-15 |
| SC-10: fix.md 可选修复计划 | ≥2 文件时先列 3 行计划，单文件跳过（轻量） | 🟢 | 2026-08-15 |

## 实测

- `collectStackContext` 对 learnunk → `Node.js (node >=22.5.0) | test: node --test`；对 cc-suite-cn → `Node.js | deps: jsonrepair, ... | test: ...`（test 脚本超 60 字符截断）✅
- `pnpm test:unit`：404 全绿 + guard 绿。

## 依据（为什么做技术栈感知）

台账历史误报根因：learnunk 的 `node:sqlite`（评审员误报缺依赖）、`~ 展开`（不懂 os.homedir）、`tailwind` vs `tailwindcss`——都是"评审员不懂技术栈"。技术栈感知是"上下文注入"思路的根本性延伸，从源头降误报/假阴。

---

# NLPM 全量审核 + 修复（23 工件）

**范围**：16 命令 + 4 agent + 1 skill + opencode.json + AGENTS.md（23 工件）。**执行**：派只读 NLPM agent（scanner/scorer/vague-scanner/checker）收集 finding → opencode triage + 修复。

## 审核结果（修复前）

| 维度 | 结果 |
|------|------|
| 打分 | 无 <70；最低 85（4 agent + 6 命令）；SKILL 97 / AGENTS 100 未退化 |
| 模糊量词 R01 | 0 需修命中（历史已清理干净） |
| 一致性 | 5 finding：F1 引用断裂 / F2 provider 软断裂 / F3 矛盾 / F4 命令表漏列 / F5 触发词漏列 |

## 修复台账

| 结论 | 修复 | 置信度 |
|------|------|--------|
| F1: AGENTS.md/guard 残留幽灵薄指针 `~/.config/opencode/commands/audit.md`（产品化已删） | AGENTS.md 措辞改「命令已迁回 repo」；Key Files 改指 `.opencode/commands/*.md`；guard `GLOBAL_REF_FILES` 移除 audit.md | 🟢 |
| F3: b-*.md 把「B 分身」误标「施工队分身」（与"施工队只读"矛盾）+ README 残留 | 4 命令 + README 的「施工队分身」→「B 分身」 | 🟢 |
| R09: 4 agent 零 `<example>` 块（-15） | 4 agent description 加 `<example>` 触发块 | 🟢 |
| R15: 6 命令无空输入处理（-10） | audit-full/review-qwen/trace/4×b-* 加空参数提示 | 🟢 |
| R18: 13 命令缺 argument-hint（-5） | 13 命令 frontmatter 加 `argument-hint` | 🟢 |
| F2: 3 agent provider 未在仓库 opencode.json 定义 | AGENTS.md Key Files 加「glm/qwen/kimi 走 models.dev 内置 provider」说明 | 🟢 |
| F4: /trace 不在 AGENTS.md Commands 表 | 补一行 `/trace` | 🟢 |
| F5: SKILL 触发词漏 /review-kimi、/trace | description + When to Use Me 补两词 | 🟢 |

## 结果

- 修复后：16 命令 + 4 agent + opencode.json + AGENTS.md 全 100，SKILL 97（R07 scope note 未动，历史稳定值）。
- `pnpm test:unit`：404 全绿 + guard 绿。
- 趋势快照已更新（overall 81→95→100→99→**100**，本次首次覆盖全 23 工件）。

---

# 技术栈感知补全：裁决接线 + dir 模式

**背景**：NLPM 审核后发现技术栈感知「找 bug 环节已生效，裁决环节函数支持但 CLI 漏接线」的 gap。

## 修复

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| SC-11: 裁决环节 `resolveStackContext` 接线 | `evaluate-models.mjs` cli() 加 `resolveStackContext`（白名单校验 + `collectStackContext(dirname(file))`），传给 `evaluateModels`；+2 回归测试 | 🟢 | 2026-08-15 |
| SC-12: dir 模式技术栈采集 | `review-runner.mjs` dir 分支加 `stackContext = collectStackContext(resolvedDir)`；+2 用例 | 🟢 | 2026-08-15 |
| SC-13: 测试夹具脆弱性修复 | `review-runner.test.mjs` 的 FIXTURES 从硬编码 `/var/folders/...` 改为 `before` 钩子 mkdtemp 自建（原来目录清理后 8 个测试红） | 🟢 | 2026-08-15 |

## 实测

- `resolveStackContext` 核心逻辑：`collectStackContext(dirname(file))` 对 learnunk → `Node.js (node >=22.5.0)`、对 cc-suite-cn → `Node.js | deps: ...` ✅
- `pnpm test:unit`：408 全绿 + guard 绿。

## 技术栈感知现状（补全后）

| 环节 | 状态 |
|------|------|
| 找 bug（file 模式） | ✅ 已生效 |
| 找 bug（dir 模式） | ✅ 本次补上 |
| 找 bug（diff 模式） | ⏸️ 跳过（价值低，已评估） |
| 裁决（hy3） | ✅ 本次补上（原 gap） |

---

# 短板修复：挖根因轻量化 + 信任边界显式化

**背景**：7 工程思维自评后发现 3 短板（挖根因没工具化 / 信任边界债散落 / 增量未实战）。增量实战用户自排，本轮做前两件（克制版，防过度工程）。

## 改动

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| RC-1: `markFixed` 加可选 `rootCause` 字段（写入 fixed，getTrace 透传） | `verdict-log.test.mjs` +3 用例（传/不传/透传） | 🟢 | 2026-08-15 |
| RC-2: `fix.md` Step 6 加「顺手写根因」提示 | docs-consistency 断言 /根因/ | 🟢 | 2026-08-15 |
| RC-3: 新增 `docs/trust-boundary.md`（已落地 ✅ + 已知搁置 ⚠️ 风险等级+重新评估条件） | docs-consistency 断言存在 + 含 resolveCli/prompt injection/重新评估 | 🟢 | 2026-08-15 |

## 实测

- `/trace` 四段链路：报(hy3 裁决) → 裁(evidence) → 修(commit+测试) → **根因(信任边界)** ✅
- `pnpm test:unit`：412 全绿 + guard 绿。

## 明确不做（防过度工程）

- ❌ 根因分类报告/趋势图（无受众，死数据）
- ❌ 现在修 prompt injection / argv 泄漏（威胁模型里攻击者=用户自己，收益低）
- ❌ rootCause 枚举约束（自由文本几字够用）

---

# cc-suite-cn 增量自审（第三轮：dc5ba3e..HEAD 全量闭环）

**范围**：`dc5ba3e..HEAD` 变更 21 文件（3 commit：`ddb356e` 自审修复 + `4fa1f05` 自审第二轮 + `fb92031` verdict projectDir）。审 8 生产 `.mjs` + 4 文档 `.md`，跳过 9 个 `.test.mjs`（测试是 oracle，已 486 全绿）。
**流程**：找 bug（glm+kimi 12 文件 95 finding）→ 批判（qwen）→ 裁决（hy3 落库 88 条）→ opencode 终审（26 条 verdict=true 全判真，无假阳）→ TDD 修。

## 关键发现

- **glm 归属矛盾实测坐实**（文档类 #11）：施工队 glm 走 codebuddy CLI（`env -u DASHSCOPE_API_KEY` 实测仍响应，不依赖 key）；B 分身 glm 走 alibaba-cn（子代理自报 `alibaba-cn/glm-5.2`）。文档 DASHSCOPE 归属据此修正。
- **代码类 7 条全判真、无假阳**，但都是低严重性（竞态/边界/健壮性），无安全/崩溃/数据损坏类；结论：`ddb356e`/`4fa1f05`/`fb92031` 三批代码未引入高严重性 bug。

## 修复台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| 文档类 19 条（一致性/歧义/错误路径/铁律未固化） | 4 文件：AGENTS.md 5 处 + fix.md 5 处 + audit.md 7 处 + SKILL.md 2 处；`pnpm test:unit` + guard 绿 | 🟢 | 2026-08-16 |
| `verdictKey` 用 `:` 拼接可碰撞 | 改 `JSON.stringify`；+3 用例（冒号碰撞/空分量/稳定） | 🟢 | 2026-08-16 |
| `gitChangedFiles` 漏「已跟踪但未提交」的改动 | 追加 `git diff --name-only HEAD`；+2 用例（未提交纳入/三路去重） | 🟢 | 2026-08-16 |
| `detectAuditScope` 基线==HEAD 时无视 dirty | dirty 时算未提交 files、`changed: dirty`；+1 用例 | 🟢 | 2026-08-16 |
| `updateJobWithResult` 覆盖 cancelled（状态机缺终态保护） | 写 completed/failed 前重读 status，非 running 跳过；+2 用例 | 🟢 | 2026-08-16 |
| `acquireSlot` TOCTOU（检查与创建非原子，并发可超 maxConcurrent） | 改内存信号量（检查+占位同步原子）+ release；`runJobBackground` 在 exit/失败时 release；重写 4 + 并发 1 用例 | 🟢 | 2026-08-16 |

## 结果

- `pnpm test:unit`：495 全绿（原 486 + 新增 9）+ guard 绿。
- 提交：`83e0f95`（docs 19 处）+ `3748551`（fix 7 条 TDD），已 push `origin/master`。
- 基线：本次审完状态 `3748551`（供下次增量对比）。

---

# 员工培训（Worker Training）：给 4 个施工队装"能力提升"闭环

**动机**：只有 opencode 装了 TDD + nlpm 能自我提升；glm/kimi/qwen/hy3 无权重更新、无记忆，只能靠上下文工程 + 路由 + 测量"喂养"。
**核心**：把 verdict-log 已有的裁决数据**闭环**——终审标签喂回工人 prompt，而不是只用于 /trace。

## 改动台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| WT-1: 落库 verdict 补 model/models 字段（归属到具体工人） | `evaluate-models.mjs` verdicts.map 补 `model`+`models`（cluster 全成员去重）；+1 用例（共识 finding 归属两模型） | 🟢 | 2026-08-16 |
| WT-2: `confirmVerdict` 终审真值（opencode 终审写 final，区分 hy3 初筛） | `verdict-log.mjs` 新增 confirmVerdict（final 限 true/false）+ getTrace 透传 confirmed；+4 用例 | 🟢 | 2026-08-16 |
| WT-3: `scripts/feedback.mjs` 个人误报回灌（counter-example + 正例） | `buildFeedbackPreamble`/`pickCounterExamples`/`pickExemplars`；**只消费 confirmed（终审）标签**，未经终审的 false 不进回灌（负向用例）；17 用例 | 🟢 | 2026-08-16 |
| WT-4: `review()` 接 `feedbackPreamble` + `reviewFile` 透传 | fullPrompt 在只读声明后注入 feedback 段；+2 集成用例（注入/默认不注入） | 🟢 | 2026-08-16 |
| WT-5: `runAudit` 接 `getFeedback` + CLI 接线 | `createFeedbackResolver`（读 verdict-log + missed-log，返回 (model,file)=>preamble）；run-audit/worker-audit 前后台都接；+2 用例（透传/默认 null） | 🟢 | 2026-08-16 |
| WT-6: 工人版口袋书 `scripts/worker-lessons.md` + 注入 | `collectWorkerLessons`（去 HTML 注释）+ `buildLessonsSection` 拼 `[评审教训]` 段；纯注释文件返回空（不注入噪音）；+6 用例 | 🟢 | 2026-08-16 |
| WT-7: 根因叙事注入（`fixed.rootCause` → `[本项目曾修复过的 bug]`） | `pickRootCauses`/`buildRootCausePreamble` 按 file/projectDir 匹配 + resolver 拼接；+6 用例 | 🟢 | 2026-08-16 |
| WT-8: 标注基准集 `benchmark-core.mjs` + fixtures | `matchFindings`（行号±容忍）→ precision/recall/f1；`aggregateByModel`；`parseManifest`；3 fixtures（2 buggy + 1 clean）+ manifest.json；18 用例 | 🟢 | 2026-08-16 |
| WT-9: `benchmark.mjs` 跑分器（对真值算 precision/recall） | `runBenchmark`（可注入 reviewFn/readFileFn）；CLI 打印 per-model 表；2 用例 | 🟢 | 2026-08-16 |
| WT-10: 自校验回路（chain-of-verification） | `SELF_CHECK_PROMPT` + `selfCheck()` + `applySelfCheck()`（只留 keep=true）；6 用例 | 🟢 | 2026-08-16 |
| WT-11: 漏报回灌（qwen missed → 下次注入 glm/kimi） | `scripts/missed-log.mjs`（原子写+去重）+ critic CLI 落库 missed + `pickMissed`/`buildMissedPreamble` + resolver 拼接；8 用例 | 🟢 | 2026-08-16 |

## 未做（诚实标注）

- **类级路由（P3c）**：按 bug 类别记各模型命中率并路由——需 finding 类别分类器，本轮未实现，仅留设计文档（`docs/worker-training.md`）。
- **回灌 e2e 真模型验证**：WT-3~WT-11 均为单测（mock spawn）级别 🟢；**真实 CLI 闭环（跑一次 /audit → 裁决 → 终审 → 回灌 → 再 /audit 看误报是否下降）尚未跑**，标 🟡。历史数据缺 model 字段，回灌从现在开始积累，暂无历史样本可回灌。

## 结果

- `pnpm test:unit`：**579 全绿**（原 495 + 新增 84）+ guard 绿。
- 新增文件：`feedback.mjs`、`missed-log.mjs`、`benchmark-core.mjs`、`benchmark.mjs`、`worker-lessons.md`、`benchmark/fixtures/*`、`benchmark/manifest.json` + 各 `.test.mjs`。
- 数据流闭环：`/evaluate --arbitrate`（verdict+model 落库）→ `/fix` 终审 `confirmVerdict`（final 真值）→ 下次 `/audit` 经 `createFeedbackResolver` 注入个人误报 + 根因 + 漏报 + 口袋书。

---

# 基准集基线（第一次真模型跑分）

**对象**：4 模型（glm/hy3/kimi/qwen）× 10 fixture（7 buggy + 3 clean），`pnpm benchmark`（`--workers all`，并发 4，保留 AGENTS.md/lessons 注入测整条流水线）。**40/40 成功**。

## 基线结果（对标注真值）

| 模型 | precision | recall | f1 | TP/FP/FN |
|------|-----------|--------|-----|----------|
| glm-5.2 | 0.78 | 1.00 | 0.88 | 7/2/0 |
| hy3 | 0.88 | 1.00 | 0.93 | 7/1/0 |
| kimi-k2.7-code | 0.78 | 1.00 | 0.88 | 7/2/0 |
| qwen3-coder-plus | 0.67 | 0.86 | 0.75 | 6/3/1 |

## 关键观察

- **hy3 假阳最低（precision 0.88）**，且是唯一没踩 `clean-normalize.js`「~ 展开」经典陷阱的（0 FP），印证其裁决角色对跨文件误报的抵抗力。
- **qwen3-coder-plus 最弱（precision 0.67、漏 1）**：`buggy-rejection.js` 报了但行号错（fp=1+fn=1 记 0/0），且 `buggy-null` 多报 1 条假阳。qwen 本职是批判员不是找 bug，作为 finder 能力偏弱属预期。
- **glm/kimi 并列**（0.88）：都踩了 `clean-normalize.js`「~ 展开」假阳（各 1 FP）——这正是台账历史反复出现的跨文件误报，与「IM-6 结论：跨文件误报不能靠 prompt 清零」一致。
- **天花板效应部分显现**：7 个注入 bug 几乎全被 4 模型找到（recall 1.00，除 qwen），说明 fixture 对强模型仍偏简单；区分度主要在**假阳率**（clean 文件的 FP）。

## 结论（置信度）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| 基准集可跑、跑分器对真值算 precision/recall/f1 | `pnpm benchmark` 40/40 成功，`benchmark-baseline.json` 落库 | 🟢 | 2026-08-16 |
| 4 模型裸 find-bug 基线已建立 | 上表；hy3 0.93 > glm/kimi 0.88 > qwen 0.75 | 🟢 | 2026-08-16 |
| 假阳率是主要区分维度（recall 接近饱和） | 7 真 bug 几乎全找到；区分在 clean 文件 FP（hy3=1, glm/kimi=2, qwen=3） | 🟢 | 2026-08-16 |
| 非确定性噪声 | 每模型每 fixture 仅 1 跑，未重复采样 | 🟡 | 2026-08-16 |
| fixture 偏简单（天花板） | recall 1.00（qwen 除外）；后续需加更 subtle 的 bug 才更有区分度 | 🟡 | 2026-08-16 |

## 后续用途

此基线 = 「训练（回灌/口袋书/自检）是否有效」的对照锚点。回灌数据积累后重跑 `pnpm benchmark`，对比 `benchmark-baseline.json` 的 precision/recall 变化。

---

# 员工培训闭环：终审写回 + 进步统计 + 报告第三节

**动机**：让建议 1（错题本）自动跑起来——每次真实任务 `/fix` 终审后，把每条 finding 的 `final` 结论写回错题本，下次 `/audit` 自动回灌个人误报；任务总结里加「本次各 AI 进步」（误报率历史 vs 本次）。

## 改动台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| WT-12: `--confirm` 终审写回模式（全量打标） | `evaluate-models.mjs` 加 `confirmFindings`（单一批次时间戳 `batchAt` 统一）+ `confirmCli`（`--confirm <json>` 读数组逐条写 final）；`evaluate-models.test.mjs` +9 用例（批次时间戳一致/非法 final 不抛错/空数组/未匹配 ok=false/CLI 分支） | 🟢 | 2026-08-16 |
| WT-13: `progress.mjs` 进步统计（只看误报率） | `splitByBatch`（按最大 confirmedAt 切历史/本次）+ `fpRate` + `computeProgress`（↑进步/↓退步/—持平/无历史/无本次）；`progress.test.mjs` 14 用例 + CLI 打印 | 🟢 | 2026-08-16 |
| WT-14: `fix.md` Step 3 加「终审写回（全量打标）」 | 终审对每条 finding（含 hy3 判 false 的）写 final + reason，跑 `--confirm` 落错题本；漏写某条=不进错题本 | 🟢 | 2026-08-16 |
| WT-15: 报告惯例「两节」→「三节」 | AGENTS.md 汇报惯例 + SKILL.md Report Template + fix.md Step 6 加「本次各 AI 进步」（`node scripts/progress.mjs` 取数，基于终审错题本） | 🟢 | 2026-08-16 |
| progress.mjs 空账本安全退出 | `node scripts/progress.mjs` 实测输出「暂无终审数据」exit 0（当前错题本为空） | 🟢 | 2026-08-16 |

## 结果

- `pnpm test:unit`：**612 全绿**（原 586 + 新增 26）+ guard 绿。
- 新增文件：`scripts/progress.mjs` + `scripts/progress.test.mjs`。
- 闭环：`/fix` 终审 `--confirm`（写错题本）→ 下次 `/audit` 回灌 → `progress.mjs` 算「历史→本次」误报率 → 报告第三节。

## 已知注意（如实标注）

- **错题本目前为空**：`confirmVerdict` 此前无调用方，历史 verdict 也缺 `models` 字段，进步曲线从下一次真实 `/fix` 终审写回后才开始积累。
- **不加样本门槛**：前几次任务样本少（如 0/1 → 1/2 就"翻倍"），进步方向噪声大——尊重用户选择，报告会标注样本数。

---

# macELTA 增量审计（v5.2.0 → v5.2.1）——新闭环首次实战

**范围**：`macELTA/EnglishTranslator`（macOS Swift 翻译 App「ELTA」），增量 = `git diff v5.2.0 HEAD` 的 14 个 Swift 文件（8 Sources + 6 Tests）。**流程**：找 bug(glm+kimi) → 裁决(hy3) → 终审全量打标(--confirm，首次点亮错题本) → TDD 修 → 落基线。

## 四角色表现（真跑通）

| 环节 | 结果 |
|------|------|
| 找 bug（glm+kimi） | 14 文件 × 2 模型 = 28/28 成功，glm 15 + kimi 21 = 36 条 finding |
| 裁决（hy3） | 34 条落库；glm precision 0.93 / kimi 0.71 |
| 终审（opencode） | 代码级核实 34 条：**28 true / 6 false**（含纠正 hy3 两处误判，见下） |
| 修 bug（opencode） | 修 15+ 个真 bug，`swiftc` 编译通过 + 纯逻辑测试子集 **150/150 绿** |

## 终审纠正 hy3 的两处误判（验证「初筛+终审」必要性）

- **HotkeyHelpers [30]**：hy3 判 false（认为 kVK_ANSI_5=0x16），实际 kVK_ANSI_5=**0x17**，代码把「⇧⌘5」写成 0x16 确是真 bug → 终审改判 true。
- **HotkeyHelpers [27]** 的 ⌘7/⌘8 漏报、[28] ⇧⌘5、[29] ⇧⌘M——keyNames 字典自证 0x16=6/0x17=5/0x26=J/0x2E=M，三处键码全错。

## 修复台账（TDD / 编译+测试证据）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| EL-1: `isPrivateOrLocalhost` 192.168 分支无数字 IP 校验，`192.168.evil.com` 绕过 HTTP 校验泄露 API Key（安全） | AIProvider.swift 加 `192.168.` 分支数字校验；EndpointValidationTests +2 用例；独立验证 12/12 绿 | 🟢 | 2026-08-17 |
| EL-2: `checkSystemHotkeyConflict` 三处键码错（⌘1-9 误含 ⌘=漏⌘7/8、⇧⌘5 写成 0x16、⇧⌘M 写成 0x26） | HotkeyHelpers.swift 三处键码修正；独立验证 7/7 绿 | 🟢 | 2026-08-17 |
| EL-3: ResultWebView `f == .command` 严格相等，Caps Lock 开启时 Cmd+C/V/A/X 失效 | 改 `f.intersection(realModifiers) == .command`；**验证中又发现 ⌘C 报错音（复制落空）**——浮动非激活面板下 `sendAction(to: nil)` 未命中响应链，加 `tryToPerform` 转发兜底 | 🟢（真机验证：大写锁定时复制/粘贴/全选均正常） | 2026-08-17 |
| EL-4: ESC/toggle tap `if expectedModifiers != 0` 守卫，无修饰键时吞任意修饰组合 | 移除守卫，始终比对 actualModifiers | 🟡（AppKit/CGEvent，编译通过） | 2026-08-17 |
| EL-5: `translate` completion 在 URLSession 后台队列回调（UI 触达非主线程） | dataTask 回调统一切主线程 | 🟡（线程，编译通过） | 2026-08-17 |
| EL-6: 打开偏好设置后无条件 `NSApp.deactivate()` | 仅取消分支才 deactivate | 🟡（AppKit） | 2026-08-17 |
| EL-7: `setApiKey` Keychain 写失败静默丢弃新 key | 返回 Bool + `loge` 醒目 | 🟡（Keychain 环境无法单测，编译通过） | 2026-08-17 |
| EL-8: 旧 `apiKey` 属性 getter/setter 读写不一致（死代码） | 移除死代码 | 🟢 | 2026-08-17 |
| EL-9: 连接测试 body 硬编码 OpenAI messages，Gemini 需 contents | 按 provider 构造 body | 🟡（网络） | 2026-08-17 |
| EL-10: 自定义 endpoint 清空不写回/字段残留/重置不刷模板/切换清空 key 不删旧 key | SettingsWindowController 4 处修正 | 🟡（AppKit UI） | 2026-08-17 |
| EL-11: `InstallEventHandler` OSStatus 丢弃 | 捕获并追加到失败汇总 | 🟢 | 2026-08-17 |
| EL-12: `flatText` 只按 minY 排序无 minX 次级排序 | 加 minX 次级排序 | 🟢 | 2026-08-17 |
| EL-13: `assertNil(Any?)` 双可选包装 + 测试弱断言 mod>=0 | assertNil 改泛型 + mod!=0 | 🟢（150/150 测试绿） | 2026-08-17 |

## 结果

- macELTA 修复：8 Sources + 3 Tests 共 11 文件（+109/-62），**未 commit**（`git diff` 供用户审）。
- 落基线：macELTA → `c34cb3f`（v5.2.1）。
- 错题本首次点亮：34 条终审 `confirmed` 标签落库（含 model 归属），下次 `/audit` 起自动回灌个人误报。
- **环境性 blocker 已解除**：真机（正常终端）跑 `./run_tests.sh` 全量 **277/277 全绿**（`All tests passed!`），无签名测试二进制在真机 Keychain 授权正常、不再挂起。EL-1~EL-13 全部无回归，编译+链接+测试全通过。注：EL-3(capsLock)/EL-4(CGEvent)/EL-5(线程)/EL-6(deactivate)/EL-9(连接测试 body)/EL-10(UI) 仍无**直接**单元测试覆盖（AppKit 事件模拟难），「全绿」证明的是无回归 + 编译正确，具体行为仍需真机手动点验，保持 🟡。

---

# /fix 六步闭环升级 + macELTA 复审（只审 diff）

**动机**：复盘发现两个流程缺口——① `/fix` 缺「批判(qwen)」环节 ② 修完 bug 后无「复审」硬门控，导致"已修复"盖过"未复审"。本轮补齐。

## 一、工作流升级（cc-suite-cn 自身）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| FX-1: `/fix` 升级为六步闭环 | `fix.md` 重写：找 bug → **批判(qwen)** → 裁决 → 终审修 → 验证 → **复审(门控)**；Step 5 后硬暂停 + 问用户；复审 = 拿修完代码重跑 1-5（无第 6 步） | 🟢 | 2026-08-17 |
| FX-2: 复审门控铁律内化 | SKILL.md Critical Rules + AGENTS.md 汇报惯例加「必带复审状态」；「修完≠走完」、复审未做必须显式标「⏸️ 尚未复审」 | 🟢 | 2026-08-17 |
| FX-3: 同步 4 文件 + 自检 | SKILL.md 命令映射/AGENTS.md Commands 表/features.md 功能基线同步；`pnpm test:unit` 612 全绿 + guard 过（docs-consistency 关键词保留） | 🟢 | 2026-08-17 |
| FX-4: 删除重量复审，只留只审 diff | `/fix` 六步→五步，删 Step 6「重跑 1-5 全流程复审」+「硬暂停问复审」；`/verify` 只审 diff 升级为**唯一复审**（必做）；同步 fix.md/SKILL.md/AGENTS.md/features.md（删功能 26「门控复审」） | 🟢 | 2026-08-17 |

## 二、macELTA 复审（只审 diff，glm+kimi）

**对象**：修复提交 `70b0301` 的 diff（`git diff c34cb3f 70b0301`，11 文件 +111/-62，407 行 diff）。**流程**：glm+kimi 用 VERIFY_PROMPT 只审 diff → opencode triage → 修真实问题 → 真机验证。

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| 复审发现真问题 4 处（修，TDD） | ① TranslationEngine 早退路径 completion 不在主线程（kimi 报）② setApiKey 删除分支丢 delete 结果（glm+kimi）③ 192.168 校验太松（glm+kimi，改严格 IPv4）④ flatText 浮点 epsilon（glm）；6 文件 +33/-17，编译 + 153 纯逻辑测试绿 | 🟢 | 2026-08-17 |
| 复审假阳/非问题 6 处 | apiKey 删除无调用方（grep 核实+全量编译过）、anthropic case 冗余、capsLock/修饰键行为变化（有意修复，用户已确认） | 🟢 | 2026-08-17 |
| 真机验证 | 用户真机 `./run_tests.sh` **280/280 全绿**（原 277 + 新增 3 畸形 IP 测试） | 🟢 | 2026-08-17 |

## 复审状态

- **模型 diff 审查（复审）**：🟢 已复审——glm+kimi 审 diff，4 真问题已修，6 假阳/有意改动已核实。
- **真机验证**：🟢 280/280 全绿。

## 三、xiaolaigithub 修复闭环（/fix 全闭环，仅 bin/ 5 文件）

**对象**：`/Users/liuxiaoming/project/xiaolaigithub` 的 `bin/`（config.sh/collect.sh/track.sh/learn.sh/report.py）。**流程**：glm+kimi 找 bug → qwen 批判 → hy3 裁决（13 条 verdict 落库）→ opencode 终审 + TDD 修 → /verify 只审 diff。**排除** seeds/（第三方克隆）、data/、reports/、notes/（产物）。

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| config.sh PATH 尾冒号修复 | 实测 `env PATH= bash -c 'source config.sh'` 修复前尾字节 `3a`(:)、修复后无尾冒号；`tests/test_shell.sh` PASS1 | 🟢 | 2026-08-17 |
| collect.sh 快照原子写（repos+events） | 临时文件+`mv` 原子改名；`tests/test_shell.sh` PASS4（mock 上游失败，最终快照保持旧内容不被污染） | 🟡（机制验证，未 mock 真 gh） | 2026-08-17 |
| learn.sh while read 丢末行 | 实测 bash 3.2 `while read` 读无尾换行文件丢 `cc-suite`；修复 `\|\| [[ -n ]]`+末尾清空后读到 3 行；PASS2 | 🟢 | 2026-08-17 |
| learn.sh 路径穿越校验（负向） | `read_seed_repos` 白名单 `^[A-Za-z0-9_.-]+$`；实测 `../evil` 被拒、CRLF 正确 trim、末行无换行读到；PASS3 | 🟢 | 2026-08-17 |
| learn.sh 非原子更新→.new staging | 先 `mv src→.new` 再删旧再改名，mv 失败时旧目录仍在或 .new 可恢复（代码走查） | 🟡（逻辑走查，未 mock mv 失败） | 2026-08-17 |
| report.py events/repos 日期错配 | 重构 `resolve_snapshot_paths` 保证同日；`tests/test_report.py` 4 用例（含"events 采失败时 None"负向）；真机复跑报告正常（250 仓库/95 事件） | 🟢 | 2026-08-17 |
| report.py markdown 竖线/换行/反斜杠转义 | `escape_md` + 先截断后转义；`test_escape_md` 5 用例 | 🟢 | 2026-08-17 |
| 终审假阳 3 处（不修） | learn.sh:17 硬编码 main（实测 3 仓库默认分支均 main）、track.sh:8 直执 report.py（实测有 exec bit+shebang）、collect.sh:3 symlink（plist 绝对路径调用）；均有实测依据 | 🟢 | 2026-08-17 |
| same-day 覆盖（设计冲突，未修） | plist 实测每天 9:00/21:00 两次，collect.sh 用 `date +%F` 互相覆盖；README 又明示"同一天会覆盖当天快照"；命名方案需用户拍板 | 🟢（bug 属实，修复方案待定） | 2026-08-17 |
| /verify 只审 diff（复审） | glm+kimi 审 `git diff HEAD`（4 bin 文件 +113/-46），无 high/medium 回归，6 条 low polish 采纳 4 条修掉 | 🟢 | 2026-08-17 |

## 四、xiaolaigithub same-day 覆盖修复（选 A：加时间戳）+ 第二轮只审 diff

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| collect.sh 快照文件名加时间戳 | `date +%F` → `date +%FT%H%M%S`，一天两次互不覆盖；`bash -n` 通过 | 🟢 | 2026-08-17 |
| report.py 兼容带时间戳快照 | `snapshot_stem()` + `resolve_snapshot_paths` 改同 stem 配对；`tests/test_report.py` 21/21（含带时间戳解析/指定日期找当天最新/events 同 stem/旧格式回归） | 🟢 | 2026-08-17 |
| report.py date_key 归一化（复审修） | 传时间戳 date_key 也归一化为 YYYY-MM-DD；`test_timestamp_arg_normalized` + `test_missing_timestamp_date_normalized` | 🟢 | 2026-08-17 |
| learn.sh 原子更新消除空窗（复审修） | 旧目录先 `mv → .old` 保留恢复点，新落位 `.new` 后再删 `.old`（glm 复审建议） | 🟡（逻辑走查） | 2026-08-17 |
| report.py events 缺失 stderr 警告（复审修） | `target_events is None` 时 `print(..., file=sys.stderr)` | 🟢 | 2026-08-17 |
| kimi 同秒碰撞（未修） | `%FT%H%M%S` 秒级精度，同秒重跑覆盖；macOS `date` 无 `%N`，launchd 9:00/21:00 绝不同秒 | 🟡（已知边界，不修） | 2026-08-17 |

## 复审状态（xiaolaigithub）

- **模型 diff 审查（复审）**：🟢 已复审——glm+kimi 审 diff，4 条 low polish 已修，2 条假阳未采纳。
- **单测/真机**：🟢 `python3 tests/test_report.py` 21/21 + `bash tests/test_shell.sh` 5/5 + report.py 真机复跑正常。
- **same-day 覆盖**：🟢 已修复（选 A 加时间戳，已 commit `c1d675d`）。

---

# 抄作业落地：defense-in-depth 只读加固（动作 0/1/2）

**动机**：借鉴 xiaolai/cc-suite 的 defense-in-depth——把施工队"只读"从「一次性人工实测（`pnpm verify:e2e`）」升级为「每次评审自动 fail-closed」。对照差距：① codebuddy cwd 未隔离（唯一 cwd 落在被审项目的 backend）② 哈希验证只在 verify 脚本一次性做，没进 `review()` ③ qwen 没用 `--safe-mode`（可禁 MCP 防评审员调外援）。

## 改动台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| 动作 2: 运行时源文件哈希验证（每次评审自动 fail-closed） | `review-runner.mjs` 新增 `hashFileContent`(sha256)/`snapshotSourceHashes`/`hashesDiffer` + `SourceTamperedError`；`review()` 评审前后对「被审文件集合」（file 模式 1 个、dir 模式全部 source）hash 对比，变了抛 `SourceTamperedError`；读不到文件容错跳过（向后兼容）；9 单测（含 file/dir 正负向 + 容错） | 🟢 | 2026-08-17 |
| 动作 1: codebuddy cwd 隔离到 tmpdir | `resolveReviewCwd` 从「kimi/qwen 才 tmpdir、codebuddy undefined（继承项目目录）」改为「所有 backend 统一 tmpdir」，堵住「codebuddy 子进程 cwd 落在被审项目」最大暴露面；code 已内联、AGENTS.md 已内联进 prompt，codebuddy 无需项目 cwd；2 单测（resolveReviewCwd + review 传 tmpdir cwd）+ 真实评审实测正常 | 🟢 | 2026-08-17 |
| 动作 0: qwen 加 `--safe-mode` | `backends.mjs` qwen 命令加 `--safe-mode`（禁 hooks/extensions/skills/MCP）；前置实测 `qwen --safe-mode --sandbox -p` 组合不冲突（输出 OK + seatbelt sandbox 生效标志）；真实评审成功 | 🟢 | 2026-08-17 |

## 真实评审实测（hash 校验负向 + 不误报）

- **qwen（--safe-mode）审 `demos/quick-demo.js`**：成功，找到 2 真 bug（`pass = "admin123"` 赋值 vs 比较、SQL 注入），hash 校验不误报 ✅
- **kimi 审 `demos/quick-demo.js`**：成功，同样 2 真 bug，hash 校验不误报 ✅
- **codebuddy 审**：✅ 额度恢复后实测成功，找到同样 2 真 bug，hash 校验不误报（cwd 隔离后不退化）

## 结果

- `pnpm test:unit`：632 全绿（新增 defense-in-depth 10 测试）+ guard 绿。

## 复审状态

- 🟢 **已复审**：`/verify` 只审 diff（glm+kimi）跑过。glm 4 条 + kimi 2 条，**无 high/medium 真 bug**，全部 low 设计局限/假阳，结论如下：
  - glm 4 条：① `hashesDiffer` 只迭代 before 不检测新文件 → 设计取舍（新文件风险由 cwd 隔离兜底，已加注释固化）② dir+file 同时传 sourcePaths 覆盖 → 假阳（review() 已校验 dir/file 互斥抛错）③ afterHashes 只在成功路径算 → 设计取舍（失败路径本就不信任结果，符合 fail-closed）④ `String(content)` 隐式转换 → 不采纳（String() 刻意统一 Buffer/String 的 hash 语义，去掉反而引入不一致）。
  - kimi 2 条：① `resolveReviewCwd` 死参数 → 半对（函数已无参，调用方传 backend 被忽略），已加 JSDoc 固化意图 ② cwd 双用途误读 → 假阳（把 review 的 `cwd` 参数=路径解析基址 与 `resolveReviewCwd()`=spawn 子进程 cwd 混为一谈，前者仍 process.cwd() 未变）。

---

# 抄作业第二批：防委派边界 + frontmatter 校验 + preflight 补全 + 发布纪律

**动机**：按抄作业清单优先级 2/3/5 落地三件「小改防漂移」任务。任务 F（git 增量 hash）已砍。

## 改动台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| A: 防循环委派边界 | 新建 `scripts/delegation-boundary.mjs`（`BOUNDARY_INVARIANTS` 两条不变量单源）；`backends.mjs` 的 `READ_ONLY_DECLARATION` import 常量拼装（JS 侧天然单源）；4 个 `.opencode/agents/*.md` 正文逐字含不变量（prose 副本）；`delegation-boundary.test.mjs` 2 用例锁漂移 | 🟢 | 2026-08-17 |
| B: command frontmatter 校验 | 新建 `scripts/commands.test.mjs`：16 命令 description 非空 / `$ARGUMENTS` 命令必有 argument-hint（evaluate/jobs/verify 无参豁免）/ 命令名与 AGENTS.md 对齐 / description 无模糊量词；4 用例（当前 16 命令已全合规，测试作防漂移守护） | 🟢 | 2026-08-17 |
| C: preflight 泛化 + 发布纪律 | `preflight.mjs` 抽 `checkVersion(command)`，kimi/qwen 复用 codebuddy 的 `--version` 实测（原只 codebuddy 实测）；CLI 入口三 CLI 均版本实测；新建 `scripts/release-check.mjs`（`checkRelease` 纯函数 + `readCurrentTag`，校验 tag==package.json version）+ `release` script；preflight +4 用例、release-check 3 用例 | 🟢 | 2026-08-17 |

## 实测

- `npm run preflight`：三 CLI 版本实测全过（codebuddy 2.134.0 / kimi 0.35.0 / qwen 0.21.10）✅
- `node scripts/release-check.mjs`：HEAD 无 tag → 正确报「release 未完成」exit 1（当前未打 tag，符合预期）✅

## 结果

- `pnpm test:unit`：**645 全绿**（原 632 + 新增 13）+ guard 绿。
- 新增文件：`delegation-boundary.mjs` + `.test.mjs`、`commands.test.mjs`、`release-check.mjs` + `.test.mjs`；改动 `backends.mjs`、`preflight.mjs`、4 个 agent、`package.json`。

---

# 抄作业第二批续：哨兵块 + provenance（任务 D）

**动机**：抄作业清单优先级 4——`install.sh` 写 rc 从「裸 append」升级为「哨兵块包裹 + provenance sidecar」，可精确卸载、不误伤手动条目。

## 改动台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| D-1: write_key 哨兵块包裹 | 写 key 用 `# cc-suite-cn:managed:begin/end` marker 包裹（3 行/块），替代裸 append；幂等逻辑不变（`grep ^export name=` 命中即跳过） | 🟢 | 2026-08-17 |
| D-2: `--uninstall` 只删哨兵块 | 新增 `--uninstall` 参数 + `uninstall_keys()`（`sed "/begin/,/end/d"` 删 marker 内内容，跨平台用临时文件+mv 而非 sed -i）；`install.test.mjs` +3 用例（uninstall 只删哨兵块保留手动条目（负向）/ provenance 记录 / uninstall 删 sidecar） | 🟢 | 2026-08-17 |
| D-3: provenance sidecar | 新增 `record_managed_key()`：写 key 后把 key 名 append 到 `~/.cc-suite-cn-provenance.txt`（`CC_PROVENANCE_FILE` 可覆盖，去重）；uninstall 读它报告删除的 key 并删除 sidecar | 🟢 | 2026-08-17 |

## 结果

- `pnpm test:unit`：**648 全绿**（原 645 + 新增 3）+ guard 绿。
- 改动：`install.sh`（+哨兵块 +--uninstall +provenance）、`install.test.mjs`（+3 用例，更新幂等用例为哨兵块断言）。

---

# 任务 E 探查 + 砍掉（stream-json 工具面 fail-closed）

**动机**：抄作业清单优先级 1 的动作 3——读 stream-json init 事件校验工具面（写工具 fail-closed）。原计划假设"三 CLI 统一做"，WI-0 探查后**推翻假设，任务整体砍掉**。

## 探查结果（三 CLI 实测 `--output-format stream-json`）

| CLI | init 事件 | tools 字段 | 写工具在 tools 里 | 工具面校验可行性 |
|-----|----------|-----------|----------------|----------------|
| qwen | `system/init` | 有（60+ 工具） | 无（`--sandbox` 已过滤 Bash/Edit/Write） | ✅ 可做 |
| codebuddy | `system/init` | 有（40+ 工具） | 有（`--disallowedTools` 是运行时 deny，init 仍列出 Write/Edit/Bash） | ❌ denylist 会永远误杀 |
| kimi | 无 init（仅 `system.version` 握手 + `assistant` 结果 + `resume_hint`） | 无 | N/A | ❌ 无字段 |

## 砍掉理由

- qwen：`--sandbox` 已在 init 层过滤写工具（实测 tools 无 Bash/Edit/Write），再加 denylist 是"第三层锦上添花"，增量收益边际。
- codebuddy：`--disallowedTools` 运行时 deny，init tools 列全部工具，denylist 校验会永远误杀。
- kimi：stream-json 无 tools 字段，无法做。

## 决定

- **任务 E 整体砍掉**（与任务 F 一致）。三 CLI 写保护现状：qwen 靠 `--sandbox`（init 过滤）、codebuddy 靠 `--disallowedTools`（运行时 deny，台账 90 行已实测）、kimi 靠 `--agent-file`（disallowedTools 锁写，台账 102 行已实测），三者均叠加 cwd 隔离 + 运行时 hash 验证（动作 1/2）。
- 结论置信度：🟢（三 CLI 探查为实测；砍掉为决策，非验证结论）。

## 留痕：synthai 复审漏 3 回归（教训）

- **事件**：opencode 修 synthai 核心底座时，为响应 kimi 复审意见做「顺手加固」，把 `taskFn()` 挪出 try 块，引入同步 throw 泄漏并发槽的回归；另修正则量词只认单修饰词（`?` 而非 `*`）。
- **根因**：① 对 review 反馈的加固没当独立 TDD 修复、没给被改动语句的失败路径补测；② 复审员 glm 空输出（限流型瞬时故障）被降级成「部分复审」就 commit。
- **处理**：glm 重试后抓到 3 回归 → 已修（`synthai@d72a80c`，379 单测全绿）。机制（空输出自动重试）+ 规则（AGENTS.md 铁律 #4/#8/#9 + 复审门控「空输出必须重试」）已固化。
- **证据锚点**：`synthai@d72a80c`（379 单测）；空输出重试单测见 `review-runner.test.mjs` / `evaluate-models.test.mjs`。

---

# 任务 G：砍掉 B 分身（承认冗余）

**动机**：B 分身（opencode 子代理，4 个 agent + 4 个 `/b-*` 命令）定位尴尬——独立不如施工队（外部只读第三方）、动手不如 opencode（唯一拍板方）。历史 8 次触发全是模型加载/通道验证，从未真实上工。承认冗余，砍掉。

## 改动台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| G-1: 删 4 个 B 分身 agent | 删 `.opencode/agents/{glm,kimi,qwen,hy3}.md`；`docs-consistency.test.mjs` 移除 kimi.md / 架构图 kimi / 4-agent 检查 | 🟢 | 2026-08-19 |
| G-2: 删 4 个 `/b-*` 命令 | 删 `.opencode/commands/b-{glm,kimi,qwen,hy3}.md`；AGENTS.md 命令表 + 纯查询清单同步移除 | 🟢 | 2026-08-19 |
| G-3: 删防踢皮球边界 | 删 `delegation-boundary.mjs` + `.test.mjs`；`backends.mjs` 的 `READ_ONLY_DECLARATION` 去掉 `BOUNDARY_INVARIANTS` 拼接（B 分身是唯一真实消费者，施工队 CLI 无反向通道） | 🟢 | 2026-08-19 |
| G-4: 删 TokenHub 通道 | 删 `opencode.json`（仅 tencent/hy3 provider，专给 B 分身 hy3）；`install.sh` 移除 TOKENHUB_API_KEY；`known-risks.json` 删 KR-03（双通道双额度债，前提消除）+ `trust-boundary.md` 同步 | 🟢 | 2026-08-19 |
| G-5: TokenHub 残留收尾（preflight/package.json） | `preflight.mjs` 的 `REQUIRED_KEYS` 去 TOKENHUB_API_KEY；`preflight.test.mjs` 断言同步（checkEnvKeys/preflightAll 去 TOKENHUB）；`install.test.mjs` 的 base64 风格 key 用例 TOKENHUB→DASHSCOPE；`package.json` test/test:unit 移除 `delegation-boundary.test.mjs` | 🟢 | 2026-08-19 |

## 结果

- `pnpm test:unit`：**669 全绿** + guard 绿。
- `/verify` diff 审查（glm+kimi）：glm 4 finding（3 假阳：self-audit 审计列表无 delegation-boundary / commands.test 动态枚举 / features.md 本就无 B 分身；1 真：台账遗漏，已补 G-5），kimi 0 finding。改动行内无回归。

---

# 任务 H：依据对齐 + 盲评 + 两步终审 + 统一账本（阶段 2）

**动机**：三个环节（找 bug/批判/裁决）的"依据"原先断裂——chain_analysis 被丢、qwen 批判不落账、missed 无依据、裁决闭眼判；终审是糊涂账；账本分散三处。目标是"一条 finding 从被报到被修，每一步谁判了什么、为什么、依据是什么，全可追溯"。

## 改动台账

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| H-1: 保留 chain_analysis（找 bug 推理链） | `review()` 返回 `chainAnalysis`；`reviewFile()` 分块聚合（过滤空块）；`runAudit` worker 带 chainAnalysis | 🟢 | 2026-08-19 |
| H-2: 统一账本（finding 全生命周期） | `upsertFindings`（fill-missing-only 幂等）/ `appendCritic` / `appendVerdicts` / `confirmVerdict` 两步；一条 finding 从找 bug 落账到修复全链路字段 | 🟢 | 2026-08-19 |
| H-3: 去重前移 + 稳定主键 | `buildFindingEntries` 在 runAudit 落账时 dedup，`models`=去重簇所有模型；批判输入 = 去重后 entries | 🟢 | 2026-08-19 |
| H-4: 盲评纪律（下游连结论都不给） | qwen/hy3 prompt 加「上游结论与理由均未附，只凭代码独立判」；裁决只给 finding+代码 | 🟢 | 2026-08-19 |
| H-5: 两步终审强制落实 | `confirmVerdict`/`confirmFindings` 强制 `independent.final/reason` + `comparison` + `reason` 全非空，缺一拒绝写回 | 🟢 | 2026-08-19 |
| H-6: missed 进统一账本 + 进裁决 | qwen 补漏落账 `source=qwen-critic`（reason 存 chainAnalysis），裁决统一裁 pending（含 qwen-critic）；废弃 missed-log | 🟢 | 2026-08-19 |
| H-7: 跨进程租约锁 | `acquireLock`/`releaseLock`（PID 探活 + TTL 过期接管），写操作全部包锁 | 🟢 | 2026-08-19 |
| H-8: getTrace 全链路 | 报→批→裁→终审(两步)→修，缺失环节显式 null | 🟢 | 2026-08-19 |

## 结果

- `pnpm test:unit`：**696 全绿** + guard 绿。
- 关键改动：`verdict-log.mjs`（账本核心）、`jobs.mjs`（runAudit 落账）、`review-runner.mjs`（批判落账）、`evaluate-models.mjs`（裁决读账本 + 两步终审）、`feedback.mjs`（从统一账本读 missed）；删 `missed-log.mjs` + test。
- 迁移：missed-log.json 为空（`[]`），无历史数据，直接删除。

## 复审（/verify diff 审查，三轮）

- **第一轮**：kimi 6 finding（4 真已修：runAudit 落账失败吞 entries / feedback 回灌未过滤 / buildMissedFindings 硬编码模型 / releaseLock 无条件删锁；2 假阳：REVIEW_PROMPT 缺 chain_analysis / collectProjectRules 签名）；glm 空输出（限流）。
- **第二轮**：kimi 3 finding（--arbitrate 忽略 --file 已修 / 锁 stale 清理 race 缩小窗口 / adjudicateLedger 锁外加载 = 有意设计不修）；glm 空输出。
- **第三轮**：glm+kimi 共识 **corrupt 锁文件不被删除会卡死 30s** → 已修；feedback 只回灌确认为真的补漏 → 已修；其余（--arbitrate 迁移缺口 / appendCritic 静默丢弃 / chainAnalysis 只留第一个 / buildMissedFindings 未校验 file）记录为已知低优先级。
- 结论：glm+kimi 均拿到非空结论，复审门关上，改动行内无 high 回归。🟢 已复审。

---

# 汇报纪律反例：漏带「总体结论 + 行动项」

- **事件**：`e825c7e` 刚把汇报惯例从「三节」升级为「总体结论 + 行动项 + 三节」（`SKILL.md` Report Template + `AGENTS.md` 汇报惯例），但任务 H（依据对齐 + 统一账本）完成后的总结只写了三节 + 复审状态，**漏了「总体结论」和「行动项」两节**，靠用户事后提醒才补上。
- **根因**：模板改了，但执行时没对照新模板逐项核对——「必带项」靠自觉，没有强制锚点。
- **教训**：总结前先读一遍 `SKILL.md` Report Template 的必带项清单，写完逐项打勾；「总体结论 + 行动项 + 三节 + 复审状态」一个都不能少。
- **证据锚点**：`e825c7e`（模板升级 commit）；本次会话总结（已补）。

<!-- report-required: begin -->
