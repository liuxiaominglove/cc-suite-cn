# cc-suite-pe — AI 施工队协作系统

一个让 **opencode（DeepSeek）当总指挥兼修 bug、四个 AI 模型各司其职**、交叉查代码的协作系统。

> 一句话：**你当老板，opencode 当工头兼施工队长，GLM/Kimi 负责找 bug，Qwen 当批判员挑毛病，Hy3 当裁判判真假。**

---

## 一、它解决了什么问题（大白话）

以前用 AI 写代码，你只能指望**一个 AI** 干活，它错了你未必知道。

现在这套系统：

1. **多个 AI 交叉审代码**——一个 AI 漏掉的 bug，另一个能抓到（不同公司、不同训练数据、盲区不同）。
2. **分工明确、各司其职**——找 bug 的、挑毛病的、判真假的、修 bug 的，各干各的，不"自己批自己"。
3. **干活有记录、有账本**——每个任务记一笔账，能查状态、看结果、真取消。
4. **能评估谁靠谱**——累积审计数据后，能算"谁找得多、谁找得准"。

---

## 二、架构（一张图看懂）

```
                     你（老板）
                        │
         ┌──────────────┴──────────────┐
         │  opencode + DeepSeek         │  ← 工头 + 施工队长（总指挥 + 亲自修 bug）
         └──────────────┬──────────────┘
                        │
       ┌────────────────┼────────────────┐
       │                │                │
   找 bug（audit）   批判员（critic）   验证审计员（verifier）
       │                │                │
   GLM + Kimi        Qwen             Hy3
   （只读评审）     （只读 + 沙箱）    （只读，判 finding 真假）
```

### 四个施工队（模型）+ 分工

| 角色 | AI | 公司 | 干什么 |
|------|-----|------|--------|
| 找 bug | **GLM-5.2** | 智谱 | 报得多（广撒网） |
| 找 bug | **Kimi** | 月之暗面 | 报得准（质量高） |
| 批判员 | **Qwen** | 阿里 | 独立第二意见（只读 + `--sandbox`） |
| 验证审计员 | **Hy3** | 腾讯混元 | 逐条判 finding 真假（只读） |
| 总指挥 + 修 bug | **DeepSeek** | 深度求索 | 最了解项目，亲自修（带 TDD） |

> **核心原则：谁都不批自己。** 找 bug 的不判真假，判真假的不找 bug，修 bug 的（opencode）最了解项目但只负责修。

---

## 三、核心概念（大白话 + 类比）

| 概念 | 大白话 | 类比 |
|------|--------|------|
| **找 bug（audit）** | glm+kimi 审代码，报问题清单 | 两个监理一起巡楼，记问题 |
| **批判员（critic）** | qwen 独立挑毛病，给"第二意见" | 另请的第三方顾问，专挑刺 |
| **验证审计员（verifier）** | hy3 逐条判"这条是不是真 bug" | 裁判，只判真假、不找新问题 |
| **B 分身** | opencode 身体里长出的"用施工队脑子"的分身 | 工头多长几只手，每只手用不同脑子 |
| **job 账本** | 每个任务记一笔账（状态+结果） | 外卖订单系统，能查单、退单 |
| **真后台** | 任务在后台独立进程跑，关了终端也不断 | 你下单后不用站店门口干等 |
| **单一数据源** | 脚本/配置只存一份，别处只"指路"不复制 | 原件存保险柜，别处只放快捷方式 |

---

## 四、命令清单

### A. opencode 里敲的斜杠命令（重启 opencode 后生效）

| 命令 | 干什么 | 类比 |
|------|--------|------|
| `/audit <文件/目录>` | glm+kimi 找 bug（记入账本 + audit-log） | 两个监理巡楼 |
| `/audit-full <文件>` | 完整审计：找 bug + 批判员 + 裁决 | 全套体检 |
| `/fix <bug>` | 修复闭环：找 → 裁 → 修(TDD) → 验证 | 看病到治好 |
| `/review-kimi <文件>` | 只叫 Kimi 审 | 单医生看诊 |
| `/review-qwen <文件>` | 只叫 Qwen 审（批判员） | 单医生看诊 |
| `/evaluate` | 评估谁找得多、谁找得准（`--arbitrate` 让 hy3 裁决） | 赛后统计 MVP |
| `/verify` | diff 审查（只发改动区域，省 tokens） | 复查刚改的地方 |
| `/jobs` | 查任务账本（审计自动记账） | 看订单列表 |
| `/result <job-id>` | 看某任务详细结果 | 点进订单看详情 |
| `/cancel <job-id>` | 取消某任务（真杀进程） | 取消订单 |
| `/b-qwen` `/b-glm` `/b-kimi` `/b-hy3` | 派活给对应施工队分身（换脑不换身） | 直接点名某个工人干活 |

### B. 终端里敲的命令（在项目目录）

| 命令 | 干什么 |
|------|--------|
| `pnpm test` | 跑全部测试 + 漂移守卫 |
| `pnpm test:unit` | 只跑单元测试（不需联网） |
| `pnpm verify` | 一键重跑 4 评审员只读 + 真后台真取消 |
| `pnpm preflight` | 检查 codebuddy 是否就绪 |
| `node scripts/jobs.mjs --run-audit --file x.js` | glm+kimi 找 bug + 记 1 条账 |
| `node scripts/evaluate-models.mjs [--arbitrate]` | 评估谁找得多、谁找得准 |

---

## 五、典型工作流（完整闭环）

```
1. 找 bug：  /audit 文件       → glm+kimi 审，出共识 + 各模型报告
2. 批判员：  /review-qwen       → qwen 独立第二意见（沙箱只读）
3. 判真假：  /evaluate --arbitrate → hy3 逐条判 finding 真假，出 precision
4. 修 bug：  /fix               → opencode 用 TDD 修（RED→GREEN→REFACTOR）
5. 验证：    /verify            → 只发改动区域复查
6. 查账：    /jobs → /result <id>
```

> 一步到位：`/audit-full` = 找 bug + 批判员 + 裁决三合一；`/fix` = 找→裁→修→验闭环。

---

## 六、各阶段做了什么（演进史）

| 阶段 | 干了什么 |
|------|---------|
| **P0** | 修"脚本漂移"，建立单一数据源 + 守卫 |
| **P1** | 上线 4 个 B 分身（opencode 子代理） |
| **P2a** | preflight 预检 |
| **Hy3** | 把 Hy3 切到真模型（腾讯云 TokenHub） |
| **验证纪律** | 建立"结论≤证据 + 三色置信度 + 台账" |
| **P3** | 施工队只读评审（review-runner 参数化 backend） |
| **P-verify** | /verify 升级为 diff 审查 |
| **job 状态** | 任务账本 + 命令面 + 真后台 + 真取消 |
| **P0补强** | 抽 runner-core、写锁 cwd 隔离、账本打通、模型 ID 统一、权重接线 |
| **角色重构** | 4 模型 4 角色：找 bug(glm+kimi) / 批判员(qwen+沙箱) / 验证审计员(hy3) / 修 bug(opencode)，废弃 codebuddy 写路径 |

---

## 七、验证纪律（项目的"质量铁律"）

1. **结论 ≤ 证据**：报告的措辞强度，不能超过实际验证到的层次。
2. **能力动词逐个测**：声称"能做 A/B/C"，就分别测 A、B、C。
3. **负向必测**：凡是"能拦住/能禁止"的结论，必须实测"确实拦住了"。
4. **代理 ≠ 目标**：测 echo 只证明 echo 通，不能推出 opencode 往返通。
5. **三色置信度**：🟢 实测通过 / 🟡 机制或部分 / 🔴 未验证。汇报只能按色说。

**验证台账**：`docs/verification.md` 记录每条结论的"证据 + 置信度"。汇报"已验证"必须能在台账里找到对应行。

---

## 八、安全底线（重要）

1. **谁都不批自己**：找 bug 的（glm/kimi）、批判员（qwen）、验证审计员（hy3）互相独立，判真假的人不找 bug。
2. **施工队只读 + 硬隔离**：qwen 批判员用 `--sandbox` + 不传 `-y`（只读）；kimi/qwen 子进程 cwd 设到临时目录，误写也落 temp 而非项目。
3. **修 bug 只由 opencode**：它最了解项目、带 TDD，写后不自动合并，`git diff` 审、`git checkout` 回退。
4. **⚠️ 验证审计员 hy3 的判断是 LLM 判断**：`/evaluate` 的 precision = "hy3 判定为真的比例"，不是客观准确率，报告会如实标注。

---

## 九、工程健壮性（大文件也能扛）

1. **大文件自动分块**：超过 800 行自动切成块（每块重叠 10 行防漏），逐块审，行号自动偏移回原文件。
2. **超时统一 900s**：找 bug / 批判员 / 验证审计员三个环节都 900 秒，慢 AI（如 kimi）不再被误杀。
3. **finding 统一英文**：施工队输出统一英文，修复了"glm 报英文、kimi 报中文 → 共识率恒 0"的跨语言匹配问题。
4. **验证审计员只看上下文**：hy3 裁决时只传 finding 附近 ±40 行，不整文件塞，更精准、更省 token。

---

## 十、环境依赖

| 依赖 | 用途 |
|------|------|
| opencode | 总指挥 + 修 bug（宿主） |
| CodeBuddy CLI | glm/hy3 的网关（找 bug + 验证审计员） |
| kimi CLI / qwen CLI | 独立评审壳 |
| `DASHSCOPE_API_KEY` | 阿里百炼，通吃 Qwen + GLM + Kimi |
| `TOKENHUB_API_KEY` | 腾讯云 TokenHub，Hy3 真模型 |
| `MOONSHOT_API_KEY` | Kimi（可选，备用） |

---

## 十一、常用路径速查

```
scripts/review-runner.mjs       只读评审（参数化 backend）
scripts/evaluate-models.mjs     finding 归一化/共识/裁决/多维度评估
scripts/models.mjs              4 施工队单一数据源 + 角色常量
scripts/runner-core.mjs         共享 spawn 原语
scripts/jobs.mjs                任务账本
scripts/guard.mjs               漂移守卫
scripts/backends.mjs            backend 定义（codebuddy/kimi/qwen）
.opencode/agents/*.md           4 个 B 分身子代理
.opencode/skills/cc-review/     评审技能 + 权重
docs/verification.md            验证台账
```

---

*最后更新：2026-08-14。角色重构完成：找 bug(glm+kimi) / 批判员(qwen) / 验证审计员(hy3) / 修 bug(opencode)。*
