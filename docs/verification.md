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

> 说明：上述评审结论固化为 `pnpm verify`（`scripts/verify/verify-review.mjs` + `verify-background.mjs`），一键重跑 4 评审员只读负向 + 真后台真取消。（`verify-bridge.mjs` 已随反向桥删除）

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
| VD-2: `evaluate-models.mjs` 裁决落库 + codeHash | `evaluateModels` 裁决时算文件 sha256 存 codeHash、返回 `verdicts` 数组；`cli --arbitrate` 落库到 `.cc-suite-pe/verdict-log.json`；`evaluate-models.test.mjs` 新增 2 用例（verdicts+codeHash / 无裁决返回空） | 🟢 | 2026-08-15 |
| VD-3: `/fix` 命令裁决前置 + override 出口 | `.opencode/commands/fix.md` 重写：找 bug → **裁决(强制)** → 读待修清单(verdict=true) → 终审+codeHash 校验 → TDD 修 → verify；override 出口须台账标"未经裁决" | 🟢 | 2026-08-15 |
| VD-4: SKILL.md 三层分工 + 裁决前置规则 | How I Work 加三层分工图（找 bug→批判→裁决→终审修）+ Critical Rules 加"裁决前置硬门槛" | 🟢 | 2026-08-15 |
| VD-5: docs-consistency 测试指向 repo 命令 | 产品化删全局命令后，`review.md`/`verify.md` 测试改指 repo `.opencode/commands/`（原指向已删除的 `~/.config/opencode/commands/`，导致 pnpm test 红） | 🟢 | 2026-08-15 |
| VD-6: 端到端真模型验证 | 真 hy3 裁决 2 个 demo audit 25 条 → 落库成功；`getActionableFindings` 筛出 23 条 true；`isVerdictStale` 同内容=false、改后内容=true | 🟢 | 2026-08-15 |

## 结果

- `pnpm test:unit`：325 全绿（新增 verdict-log 12 + evaluate-models 2）+ guard 绿。
- 数据流：`audit-log` → `/evaluate --arbitrate`(hy3 裁决+codeHash) → `.cc-suite-pe/verdict-log.json` → `/fix` 读 `getActionableFindings`（verdict=true 且 codeHash 未失效）→ opencode 终审 + TDD 修。
- verdict-log.json 在 `.cc-suite-pe/`（已 gitignore，运行时数据不进仓库）。

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

## cc-suite-pe（短板 3：qwen 批判员重定位）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| SC-1: `CRITIC_PROMPT` + `buildCriticPrompt` + `criticize()` | 批判员人设（逐条判同意/反对+理由 + 补漏，不重扫代码）；走 qwen backend；`review-runner.test.mjs` +4 用例（prompt 断言/解析 verdicts+missed/容错） | 🟢 | 2026-08-15 |
| SC-2: `review-runner.mjs` CLI 加 `--critic` 模式 | `--critic --file <path> --findings-file <json>` 入口 | 🟢 | 2026-08-15 |
| SC-3: `review-qwen.md` 重写为批判流程 | 必须先 audit 读 finding 清单 → criticize → 展示同意/反对/漏报；不回退独立评审 | 🟢 | 2026-08-15 |

## cc-suite-pe（短板 4：结构化 finding + 去重优化）

| 结论 | 证据 | 置信度 | 日期 |
|------|------|--------|------|
| SC-4: `sameLocation`（同 file+line 完全相等）位置优先归并 | `classifyConsensus`/`dedupFindings` 先按位置归并、文本相似度兜底；line 差 ≠0 不误并；`evaluate-models.test.mjs` +4 用例（同位置归并/差很多不误并） | 🟢 | 2026-08-15 |

## 结果

- cc-suite-pe `pnpm test:unit`：352 全绿 + guard 绿。
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

# cc-suite-pe 自审（增量 + 检测审计生命周期三件套）

**目标**：用刚建的三件套增量审 cc-suite-pe 自己（基线 = 上次完整闭环 dogfooding `b1e6657`），并检测三件套是否工作。

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

- `collectStackContext` 对 learnunk → `Node.js (node >=22.5.0) | test: node --test`；对 cc-suite-pe → `Node.js | deps: jsonrepair, ... | test: ...`（test 脚本超 60 字符截断）✅
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

- `resolveStackContext` 核心逻辑：`collectStackContext(dirname(file))` 对 learnunk → `Node.js (node >=22.5.0)`、对 cc-suite-pe → `Node.js | deps: ...` ✅
- `pnpm test:unit`：408 全绿 + guard 绿。

## 技术栈感知现状（补全后）

| 环节 | 状态 |
|------|------|
| 找 bug（file 模式） | ✅ 已生效 |
| 找 bug（dir 模式） | ✅ 本次补上 |
| 找 bug（diff 模式） | ⏸️ 跳过（价值低，已评估） |
| 裁决（hy3） | ✅ 本次补上（原 gap） |
