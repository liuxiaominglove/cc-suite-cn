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
