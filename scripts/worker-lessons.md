<!--
# worker-lessons.md —— 工人版口袋书

这是给施工队（glm/kimi 找 bug、qwen 批判、hy3 裁决）的评审教训书。
本文件的**非注释内容**会被注入每次评审 prompt 的 `[评审教训]` 段。

编辑权只归 opencode / hy3。**只收终审确认过的教训（真 bug 已修 或 假阳误报）**，禁止写入未经终审的猜测。

追加格式（每条固定三行，直接写到本注释块之后）：
- 规则：一句可执行的评审准则（避免什么误报 / 该注意什么）
- 实例：真实代码片段（来自已修复 bug，附 file:line）
- 来源：finding 一句话 + 裁决证据

示例：
- 规则：报告"路径未展开"前，先确认被调函数是否已做 ~ 展开 / 路径归一化
- 实例：scripts/backends.mjs resolveCli 已用 command -v 解析绝对路径
- 来源：kimi 误报"argv 是相对路径"，hy3 判 false，opencode 终审核实 argv 恒为绝对路径
-->

- 规则：报告环境/部署依赖的 bug 前，先确认触发条件在真实环境成立（默认分支名、文件 exec bit、symlink 调用链），不要报"理论上可能但不实际发生"的
- 实例：xiaolaigithub/bin/learn.sh 硬编码 refs/heads/main —— 实测默认分支均 main，触发条件不成立
- 来源：kimi 误报默认分支硬编码/exec bit/symlink，opencode 终审实测触发条件不成立（confirmed=false）

- 规则：报告"行为 bug"前，先查项目文档/设计是否有意为之（by-design），不要把文档化的设计当 bug
- 实例：scratch/merge.mjs 同行号无条件合并 —— RESULT.md A2 文档化设计
- 来源：kimi 误报同行号合并，opencode 终审判 by-design（confirmed=false）

- 规则：报告"某参数缺失"前，先核对参数是否在 buildCommand/别处已拼装（参数拼装可能分散在多处）
- 实例：codebuddy review FLAGS 缺 --print —— 实际 --print 已在 backends.mjs cmd.args
- 来源：glm 误报缺 --print，opencode 终审判假阳（confirmed=false）

- 规则：报告"路径未展开/相对路径"前，先确认被调函数是否已做 ~ 展开 / 路径归一化
- 实例：scripts/backends.mjs resolveCli 已用 command -v 解析绝对路径
- 来源：kimi 误报 argv 相对路径，hy3 判 false，opencode 终审核实 argv 恒为绝对路径

- 规则：报告"删 export 无 re-export alias 会破外部 importer"前，先确认项目是否采用「单一真值彻底迁移」——若 import 已全部重连且测试全绿，删 export 是有意设计，不是 bug
- 实例：scripts/review-runner.mjs 拆 6 模块后仅剩 review/reviewFile + 错误类门面 re-export，evaluate-models 已改从 review-tools/review-context import，无残留 importer
- 来源：glm/kimi 在 /verify 三轮反复报 re-export 假阳，opencode 实测 grep 全仓无残留 importer + 727 测试全绿

- 规则：报告 prompt injection 前，先核对注入内容来源——仓库内受控文件（如 worker-lessons.md）不是攻击面；真攻击面是「来自不受信源码的 finding」和「来自外部项目文件的 rules」（见 known-risks KR-01）
- 实例：scripts/evaluate-models.mjs buildAdjudicatorPrompt 注入 lessons 段，collectWorkerLessons 读仓库 worker-lessons.md（编辑权只归 opencode/hy3）
- 来源：qwen 误报「lessons 未 sanitize 可能 prompt injection」，opencode 终审判假阳（confirmed=false，mistakeType=prompt-injection-misattributed），真风险是 KR-01 的 finding/rules

- 规则：报告路径遍历/zip-slip 前，先核对守卫是否真的允许越界——带斜杠的 `hasPrefix(base + "/")` 前缀检查已挡住兄弟目录（`/base` 不会匹配 `/base2`），别把「正确拦截越界」当 bug
- 实例：ios-elta Elta/Models/Book.swift chapterFileURL 用 `resolvedPath.hasPrefix(basePath + "/")`；Elta/Services/EPUBParser.swift extract 用 `targetPath.hasPrefix(destPath + "/")`
- 来源：qwen 两轮误报「hasPrefix 会误拒合法兄弟路径 / 仍允许兄弟目录访问」，opencode 终审用 swift 实测 URL 解析判假阳（confirmed=false）

- 规则：报告并发竞态前，先核对代际守卫（generation guard）写法——「发起时自增 + 回调里比对代际号」是正确失效旧回调的标准模式，别把「自增在异步回调前」当竞态 bug
- 实例：ios-elta Elta/Views/ChapterWebView.swift applyScroll 的 `scrollGeneration += 1` 配 `guard scrollGeneration == generation`
- 来源：qwen 两轮误报「generation 自增在 JS eval 前致竞态 / 新回调被忽略」，opencode 终审判假阳（confirmed=false）

- 规则：报告「加枚举 case 会破坏穷举 switch」前，先 grep 全仓有没有别处 switch 该枚举，没有就别报
- 实例：ios-elta Elta/Services/TranslationError.swift 新增 `.rateLimited`，全项目仅 userMessage 一处 switch，已补 case
- 来源：kimi 误报「加 .rateLimited 会破坏别处穷举 switch」，opencode 终审 grep 全仓 + 编译通过判假阳（confirmed=false）
