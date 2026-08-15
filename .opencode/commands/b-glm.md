---
description: 派活给 GLM-5.2 B 分身（独立审/改/修，换脑不换身）
argument-hint: <task>
agent: build
---

# GLM-5.2 B 分身

> 空参数 → 提示用户「请描述要派给 B 分身的任务」，不继续。

把 `$ARGUMENTS` 描述的任务派给 **glm** 子代理（用 GLM-5.2 大脑的独立分身）完成。

## Run

用 task 工具：`subagent_type` = `glm`，prompt 写清任务 + 期望产出（审代码给文件+行号+修复建议；实现/修复直接改文件）。

## 注意

- glm 分身是独立大脑，让它独立判断，不要照搬主控意见
- 结果回来后，在对话里简洁汇报"改了什么、为什么、遗留风险"
