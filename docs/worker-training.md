# 员工培训方案（Worker Training）

> 目标：给四个施工队 AI（glm/kimi 找 bug、qwen 批判、hy3 裁决）做"能力提升"。
> 现状：只有 opencode（DeepSeek）装了 TDD + nlpm 能自我提升，其他四个工人无权重更新、无记忆，无法被真正"训练"。

## 核心认知

工人是无状态的 API/CLI 调用，能用的杠杆只有三个：

1. **上下文工程** —— prompt 里装什么（few-shot、规则、个人误报档案）
2. **路由** —— 谁干哪类活
3. **测量** —— 标注基准，让"培训有没有用"可测

**"培训"的本质 = 把反馈回路闭环。** 系统已经在生成训练数据（`verdict-log.json` 存了 verdict + evidence + codeHash，`markFixed` 存了 rootCause + testEvidence），但裁决落库后只用于 `/trace`，从没喂回工人。

## 真值定义（最重要的设计决策）

回灌用的标签必须是**真值**，不是中间产物：

| 标签来源 | 性质 | 能否当训练真值 |
|----------|------|----------------|
| hy3 裁决 `verdict` | 初筛（hy3 自己也会判错） | ❌ 不能 |
| opencode 终审 `confirmVerdict` | 代码级核实结论 | ✅ 唯一真值来源 |

若把 hy3 的错误裁决喂回去 = "把错题当标准答案教工人"，反而污染。因此新增 `confirmVerdict`（opencode 在 `/fix` 终审时写最终真假），训练只消费终审确认过的样本。

## 数据流

```
/audit          → glm+kimi finding → audit-log.json
/evaluate --arb → hy3 裁决 verdict → verdict-log.json（补 model 字段）
/fix            → opencode 终审 confirmVerdict → verdict-log.json（final 字段）
                    └─ 修 bug → markFixed(rootCause, testEvidence)
                            │
                            ▼
              feedback.mjs 读 final 标签 → 按 model 生成"个人误报/正例" preamble
                            │
                            ▼
              下一次 /audit 的 review() 注入 prompt 头（回路闭环）
```

## 9 个机制（分四档）

### P0 — 个人误报回灌（最高杠杆）

1. **个人误报档案注入**：从 verdict-log 按 model 分组，抽"该模型报过、终审判 false"的 finding + reason，注入 prompt 头。
2. **正例示范（few-shot）**：抽终审判 true 的高质量 finding 当格式/严谨度标杆。
3. **误报画像**：统计每个模型误报模式，注入一句"你历史误报主要是 X 类"。

### P1 — 工人版规则书 + 根因注入

4. **worker-lessons.md**：只收 verdict=true && fixed 的教训，每条 = 规则 + 真实代码片段。编辑权只归 opencode/hy3（防垃圾污染），类比"工人版 nlpm"。
5. **根因叙事注入**：从 `fixed.rootCause` 抽"本项目曾在此文件犯过 <finding>（根因 <rootCause>）"注入。

### P2 — 标注基准集（让效果可测）

6. **标注基准集**：带已知 bug 的小文件 + 干净文件 + manifest（file/line/isBug），对真值算真 precision/recall。
7. **prompt A/B 调优**：用基准集当目标函数，测 few-shot 数量/措辞/注入顺序。

### P3 — 过程改进

8. **自校验回路**：两段式（生成 → 对被调函数自检 → 输出），复用 `chain_analysis` 字段。
9. **漏报回灌**：持久化 qwen 的 `missed`，下次注入 glm/kimi。
10. **类级路由**：按 bug 类别记各模型历史命中率，细化路由。

## 风险 / 约束

- **Token 成本**：注入 exemplar/lessons 抬高每次评审成本 → top-N 截断 + 按类别注入。
- **陈旧教训**：`codeHash` 已存在，注入前过滤"代码已变"的旧教训。
- **垃圾污染**：只有终审确认（final=true/false）的样本才进回灌；lessons 只有 verdict=true && fixed 才进。
- **历史数据缺 model 字段**：旧 verdict 无法归属到具体模型 → 回灌只能从现在开始积累，不强行回填。

## 关键文件

| 文件 | 作用 |
|------|------|
| `docs/worker-training.md` | 本文（设计文档） |
| `scripts/feedback.mjs` | 个人误报/正例 preamble 生成（P0） |
| `scripts/verdict-log.mjs` | 新增 `confirmVerdict`（终审真值） |
| `scripts/evaluate-models.mjs` | 落库 verdict 补 model 字段 |
| `scripts/review-runner.mjs` | `review()` 接线回灌 + `collectWorkerLessons` |
| `scripts/worker-lessons.md` | 工人版口袋书（P1） |
| `scripts/benchmark/` + `scripts/benchmark.mjs` | 标注基准集（P2） |
