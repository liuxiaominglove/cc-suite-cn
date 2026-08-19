<!--
# worker-lessons.md —— 工人版口袋书

这是给施工队（glm/kimi 找 bug、qwen 批判、hy3 裁决）的评审教训书。
本文件的**非注释内容**会被注入每次评审 prompt 的 `[评审教训]` 段。

编辑权只归 opencode / hy3。**只收 verdict=true 且已 fix 的教训**（终审确认过的），禁止写入未经裁决的猜测。

追加格式（每条固定三行，直接写到本注释块之后）：
- 规则：一句可执行的评审准则（避免什么误报 / 该注意什么）
- 实例：真实代码片段（来自已修复 bug，附 file:line）
- 来源：finding 一句话 + 裁决证据

示例：
- 规则：报告"路径未展开"前，先确认被调函数是否已做 ~ 展开 / 路径归一化
- 实例：scripts/backends.mjs resolveCli 已用 command -v 解析绝对路径
- 来源：kimi 误报"argv 是相对路径"，hy3 判 false，opencode 终审核实 argv 恒为绝对路径
-->

- 规则：报告"删 export 无 re-export alias 会破外部 importer"前，先确认项目是否采用「单一真值彻底迁移」——若 import 已全部重连且测试全绿，删 export 是有意设计，不是 bug
- 实例：scripts/review-runner.mjs 拆 6 模块后仅剩 review/reviewFile + 错误类门面 re-export，evaluate-models 已改从 review-tools/review-context import，无残留 importer
- 来源：glm/kimi 在 /verify 三轮反复报 re-export 假阳，opencode 实测 grep 全仓无残留 importer + 727 测试全绿
