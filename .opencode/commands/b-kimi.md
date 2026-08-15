---
description: 派活给 Kimi 施工队分身（B 身份，独立审/改/修，换脑不换身）
agent: build
---

# Kimi 施工队分身

把 `$ARGUMENTS` 描述的任务派给 **kimi** 子代理（用 Kimi 大脑的独立分身）完成。

## Run

用 task 工具：`subagent_type` = `kimi`，prompt 写清任务 + 期望产出（审代码给文件+行号+修复建议；实现/修复直接改文件）。

## 注意

- kimi 分身是独立大脑，让它独立判断，不要照搬主控意见
- 结果回来后，在对话里简洁汇报"改了什么、为什么、遗留风险"
