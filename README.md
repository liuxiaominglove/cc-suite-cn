# cc-suite-cn — AI 施工队协作系统

> 受 [李笑来 cc-suite](https://github.com/xiaolai/cc-suite) 启发重写的**中国大陆版**——opencode 当总指挥，五个**国产大模型**各司其职，交叉查代码、**谁都不批自己**。

**English TL;DR** — A mainland-China rework of [Li Xiaolai's cc-suite](https://github.com/xiaolai/cc-suite): multi-model code review orchestration running on opencode. DeepSeek orchestrates and fixes; GLM + Kimi find bugs, Qwen critiques, Hy3 verifies — all domestic Chinese models, no VPN needed. Five models, four independent roles, and **nobody reviews their own work**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![Models](https://img.shields.io/badge/Models-5%20国产%20大模型-orange.svg)](#三五个国产大模型)

---

## 目录

- [一、这是什么](#一这是什么)
- [二、与原版 cc-suite 的关系](#二与原版-cc-suite-的关系)
- [三、五个国产大模型](#三五个国产大模型)
- [四、机制（一张图看懂）](#四机制一张图看懂)
- [五、前提条件与安装（新手友好）](#五前提条件与安装新手友好)
- [六、快速上手（命令）](#六快速上手命令)
- [七、实际运行示例](#七实际运行示例)
- [八、常见问题（FAQ）](#八常见问题faq)
- [九、各阶段做了什么（演进史）](#九各阶段做了什么演进史)
- [十、验证纪律](#十验证纪律)
- [十一、安全底线](#十一安全底线)
- [十二、工程健壮性](#十二工程健壮性)
- [十三、环境依赖速查](#十三环境依赖速查)
- [十四、常用路径速查](#十四常用路径速查)

---

## 一、这是什么

一句话：**你当老板，opencode 当工头兼施工队长，GLM/Kimi 负责找 bug，Qwen 当批判员挑毛病，Hy3 当裁判判真假，DeepSeek 亲自修。**

以前用 AI 写代码，你只能指望**一个 AI** 干活，它错了你未必知道。这套系统：

1. **多个 AI 交叉审代码**——一个 AI 漏掉的 bug，另一个能抓到（不同公司、不同训练数据、盲区不同）。
2. **分工明确、各司其职**——找 bug 的、挑毛病的、判真假的、修 bug 的，各干各的，不"自己批自己"。
3. **干活有记录、有账本**——每个任务记一笔账，能查状态、看结果、真取消。
4. **能评估谁靠谱**——累积审计数据后，能算"谁找得多、谁找得准"。

---

## 二、与原版 cc-suite 的关系

原版 [`xiaolai/cc-suite`](https://github.com/xiaolai/cc-suite) 是一个以 **Claude Code 为中心**的插件，把 Claude Code / Codex CLI / Antigravity CLI / Grok / Qwen / Kimi 等多个 AI 编程 CLI 桥接起来、互相委派任务，模型以海外为主（Claude、Grok）。

**cc-suite-cn** 是它的**中国大陆改版**（受启发重写，非 fork）：

| 维度 | 原版 cc-suite | 本版 cc-suite-cn |
|------|---------------|------------------|
| 中心 CLI | Claude Code | **opencode** |
| 模型 | 海外为主（Claude / Grok） | **全国产**（DeepSeek / GLM / Kimi / Qwen / Hy3），大陆直连、无需 VPN |
| 聚焦方向 | 跨 CLI 桥接与互相委派 | **多模型交叉代码审查**（找 bug → 批判 → 裁决 → 修） |

---

## 三、五个国产大模型

| 模型 | 公司 | 角色 | 干什么 | 为什么是它 |
|------|------|------|--------|-----------|
| **DeepSeek V4 Pro** | 深度求索 | 总指挥 + 修 bug | 最懂项目，带 TDD 亲自修 | 逻辑强、代码能力顶尖 |
| **GLM-5.2** | 智谱 AI | 找 bug | 广撒网，报得多 | 覆盖面广 |
| **Kimi K2.7 Code** | 月之暗面 | 找 bug | 报得准，质量高 | 长上下文、代码理解强 |
| **Qwen3 Coder Plus** | 阿里（通义） | 批判员 | 独立第二意见（只读 + 沙箱） | 独立视角挑刺 |
| **Hy3** | 腾讯混元 | 验证审计员 | 逐条判 finding 真假（只读） | 公正裁决 |

> **核心原则：谁都不批自己。** 找 bug 的不判真假，判真假的不找 bug，修 bug 的（opencode/DeepSeek）最了解项目但只负责修。

---

## 四、机制（一张图看懂）

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

### 核心概念（大白话 + 类比）

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

## 五、前提条件与安装（新手友好）

> 一条命令装完。脚本会**自动装** opencode、3 个 worker CLI、clone 代码、装依赖、跑自检；**只检测不硬装** Node.js / git（缺了会提示你）。3 个 API key 会在安装过程中**交互式询问**并写进 shell 配置。

### 方式一：一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/liuxiaominglove/cc-suite-cn/master/install.sh | bash
```

装完按提示 `cd ~/cc-suite-cn && opencode`，进去敲 `/audit src/` 即可。

> 一键安装是**交互式**的（要现场输 3 个 key）。非交互场景（CI/脚本）用 `bash install.sh --skip-keys` 跳过询问，之后手动把 key 写进 `~/.zshrc` 即可。

### 方式二：先看再跑（更稳）

```bash
git clone --depth 1 https://github.com/liuxiaominglove/cc-suite-cn.git
cd cc-suite-cn
# 打开 install.sh 读一遍（就 200 来行，都是安装步骤），确认没问题再跑：
bash install.sh
```

> `install.sh` 幂等，可重复运行；已装的会跳过。想先试水不落盘，用 `bash install.sh --dry-run`。

### 脚本替你干了什么

| 步骤 | 说明 |
|------|------|
| 检测 Node.js（≥18）/ git / npm | 缺了按平台提示安装命令（macOS→brew，Linux→apt），**不硬装** |
| 安装 opencode | `curl -fsSL https://opencode.ai/install \| bash`（已装跳过） |
| 安装 3 个 worker CLI | `npm install -g @tencent-ai/codebuddy-code @moonshot-ai/kimi-code @qwen-code/qwen-code`（已装跳过） |
| 填 3 个 API key | 交互式询问（**不回显**、幂等不重写），写进 `~/.zshrc` 或 `~/.bashrc` |
| 拿代码 | `git clone --depth 1` 到 `~/cc-suite-cn`（已在仓库内则跳过） |
| 装依赖 + 自检 | `npm install` → `npm run preflight`，绿红汇总 |

<details>
<summary>想手动一步步装？展开看原步骤（fallback）</summary>

### 第 1 样：Node.js（≥ 18）

- **怎么装**：打开 https://nodejs.org 下载「LTS」，双击 `.pkg` 一路下一步（自动带上 `npm`）。
- **确认**：`node -v` 看到 `v18.x.x` 或更高。

### 第 2 样：opencode

```bash
curl -fsSL https://opencode.ai/install | bash
```

装完**重开终端**，`opencode --version` 有版本号即可。

### 第 3 样：3 个 worker CLI

```bash
npm install -g @tencent-ai/codebuddy-code @moonshot-ai/kimi-code @qwen-code/qwen-code
```

分别 `codebuddy --version`、`kimi --version`、`qwen --version` 验证。

### 第 4 样：3 个 API key

| Key 名 | 对应模型 | 去哪申请 |
|--------|---------|---------|
| `DASHSCOPE_API_KEY` | Qwen（阿里通义） | https://dashscope.aliyun.com （阿里云百炼控制台 → API-KEY 管理） |
| `MOONSHOT_API_KEY` | Kimi（月之暗面） | https://platform.moonshot.cn （开放平台 → API Keys） |
| `TOKENHUB_API_KEY` | Hy3（腾讯混元） | https://console.cloud.tencent.com/tokenhub/models （右上角「新用户福利」可领 Hy3 免费 tokens） |

写进 `~/.zshrc` 后 `source ~/.zshrc`：

```bash
echo 'export DASHSCOPE_API_KEY=你的阿里百炼key' >> ~/.zshrc
echo 'export MOONSHOT_API_KEY=你的月之暗面key' >> ~/.zshrc
echo 'export TOKENHUB_API_KEY=你的腾讯TokenHub key' >> ~/.zshrc
source ~/.zshrc
```

> `codebuddy` CLI 走**平台账号登录态**（GLM-5.2 + Hy3 网关），第一次跑时按提示登录即可，不需要单独 key。

### 安装本仓库

```bash
git clone --depth 1 https://github.com/liuxiaominglove/cc-suite-cn.git
cd cc-suite-cn
npm install        # ⚠️ 必做，漏了 /audit 报"找不到模块"
npm run preflight  # 期望 3 个 ✅ CLI + 3 个 ✅ key
```

</details>

### 开始用

```bash
cd ~/cc-suite-cn   # 一键安装默认位置；手动安装则 cd 进你 clone 的目录
opencode
```

然后对想审的文件敲 `/audit`（命令见下一节），建议先 `/audit src/` 感受流程。

> 注：npm 即可跑通；习惯 pnpm 也兼容（仓库自带 `pnpm-lock.yaml`）。大陆网络 npm 慢可先 `npm config set registry https://registry.npmmirror.com`。

---

## 六、快速上手（命令）

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
| `/b-qwen` `/b-glm` `/b-kimi` `/b-hy3` | 派活给对应 B 分身（换脑不换身） | 直接点名某个工人干活 |

### B. 终端里敲的命令（在项目目录）

| 命令 | 干什么 |
|------|--------|
| `npm test` | 跑全部测试 + 漂移守卫（会读 `~/.zshrc` 里的 key） |
| `npm run test:unit` | 只跑单元测试（不需联网、不需 key） |
| `npm run test:e2e` | 跑端到端测试 |
| `npm run verify` | 一键重跑 4 评审员只读 + 真后台真取消 |
| `npm run self-audit` | 自审 8 个核心脚本（glm+kimi 找 bug，release 前跑） |
| `npm run preflight` | 检查 CLI 与 key 是否就绪 |
| `node scripts/jobs.mjs --run-audit --file x.js` | glm+kimi 找 bug + 记 1 条账 |
| `node scripts/evaluate-models.mjs [--arbitrate]` | 评估谁找得多、谁找得准 |

---

## 七、实际运行示例

下面是一次 `/audit` 的**示意输出**（简化过，真实格式以实际运行为准），帮你建立"跑起来长啥样"的预期：

```
$ /audit src/utils.ts

🤖 两个监理开始巡楼：GLM-5.2 + Kimi K2.7 Code

[GLM-5.2] 发现 3 处
  - src/utils.ts:42   潜在空指针：getUser().name 未判空
  - src/utils.ts:87   竞态条件：两个协程同时修改 mutableList
  - src/utils.ts:120  拼写错误：recieve → receive

[Kimi K2.7 Code] 发现 2 处
  - src/utils.ts:42   空指针（与 GLM 共识）
  - src/utils.ts:155  资源未关闭：文件流未在 finally 中关闭

📋 共识：1 处（两个模型都报了）
📋 各自独有：GLM 2 处、Kimi 1 处

已记账：job #47 → 输入 /result 47 看详情
```

接着你可以：
- `/audit-full src/utils.ts` → 加上 qwen 批判员 + hy3 裁决，出「真 bug / 假阳」结论；
- `/fix <bug 描述>` → opencode 用 TDD 亲自修。

---

## 八、常见问题（FAQ）

**Q1：明明装了 CLI，`npm run preflight` 还是报 ❌？**
A：装完 CLI 后 PATH 没刷新，**关掉终端重开一次**再试。

**Q2：API key 设了，但系统读不到？**
A：确认是写进了 `~/.zshrc`（不是只在当前终端 `export`），然后 `source ~/.zshrc` 或重开终端。

**Q3：`/audit` 报「找不到模块 jsonrepair」？**
A：漏了 `npm install`，回到安装第 ② 步补上。

**Q4：GitHub 打不开 / clone 很慢？**
A：大陆网络访问 GitHub 不稳定，建议走镜像或代理。

**Q5：`codebuddy` 提示未登录？**
A：GLM/Hy3 走平台账号登录态，第一次跑 `codebuddy` 时按提示完成登录即可。

**Q6：Hy3 没额度了怎么办？**
A：Hy3 有**两条通道、两套额度**，先分清是哪条没额度了：
- **B 分身 hy3**（`/b-hy3`）→ 走腾讯云 TokenHub（`TOKENHUB_API_KEY`），去 https://console.cloud.tencent.com/tokenhub/models 领新用户免费 tokens（右上角「新用户福利」）。
- **施工队裁决 hy3**（`/evaluate --arbitrate`）→ 走 `codebuddy` 平台账号（`codebuddy --model hy3`），用的是 codebuddy 平台额度，跟 TokenHub 那笔不通用。

**Q7：为什么 glm 和 hy3 都有「两条通道、两套额度」？**
A：有意设计——`codebuddy` CLI 是 GLM-5.2 + Hy3 的**官方网关**，所以**施工队**（找 bug 的 glm、裁决的 hy3）走 codebuddy 平台账号；而 **B 分身**（opencode 子代理）的 `model` 字段须指向 opencode 认识的 provider，于是 glm 走阿里百炼（`DASHSCOPE_API_KEY`）、hy3 走 TokenHub（`TOKENHUB_API_KEY`）。后果：同一个 glm 或 hy3，B 分身和施工队**各烧一套额度、互不相通**。kimi/qwen 则 B 分身和施工队走同一 provider，只有一套额度。

**Q8：kimi 明明是月之暗面的，为什么以前见过它走阿里通道？**
A：`alibaba-cn/` 前缀只代表「走阿里 API 通道」，不代表模型归属。本项目 Kimi 已改为 **Moonshot 官方直连**（`moonshotai-cn/kimi-k2.7-code`）。

---

## 九、各阶段做了什么（演进史）

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
| **体检修复** | NLPM 体检出 13 项 finding 全修（模型 ID 统一 / PATH 劫持 / kimi 只读护栏 / 文档修复）+ kimi 渠道修正（alibaba-cn → moonshotai-cn） |

---

## 十、验证纪律

1. **结论 ≤ 证据**：报告的措辞强度，不能超过实际验证到的层次。
2. **能力动词逐个测**：声称"能做 A/B/C"，就分别测 A、B、C。
3. **负向必测**：凡是"能拦住/能禁止"的结论，必须实测"确实拦住了"。
4. **代理 ≠ 目标**：测 echo 只证明 echo 通，不能推出 opencode 往返通。
5. **三色置信度**：🟢 实测通过 / 🟡 机制或部分 / 🔴 未验证。汇报只能按色说。

**验证台账**：`docs/verification.md` 记录每条结论的"证据 + 置信度"。汇报"已验证"必须能在台账里找到对应行。

---

## 十一、安全底线

1. **谁都不批自己**：找 bug 的（glm/kimi）、批判员（qwen）、验证审计员（hy3）互相独立，判真假的人不找 bug。
2. **施工队只读 + 硬隔离**：qwen 批判员用 `--sandbox` + 不传 `-y`（只读）；kimi 用 `--agent-file`（`disallowedTools` 锁写工具）+ 子进程 cwd 隔离双保险，误写也落 temp 而非项目。
3. **修 bug 只由 opencode**：它最了解项目、带 TDD，写后不自动合并，`git diff` 审、`git checkout` 回退。
4. **⚠️ 验证审计员 hy3 的判断是 LLM 判断**：`/evaluate` 的 precision = "hy3 判定为真的比例"，不是客观准确率，报告会如实标注。

---

## 十二、工程健壮性

1. **大文件自动分块**：超过 800 行自动切成块（每块重叠 10 行防漏），逐块审，行号自动偏移回原文件。
2. **超时统一 900s**：找 bug / 批判员 / 验证审计员三个环节都 900 秒，慢 AI（如 kimi）不再被误杀。
3. **finding 统一英文**：施工队输出统一英文，修复了"glm 报英文、kimi 报中文 → 共识率恒 0"的跨语言匹配问题。
4. **验证审计员只看上下文**：hy3 裁决时只传 finding 附近 ±40 行，不整文件塞，更精准、更省 token。

---

## 十三、环境依赖速查

| 依赖 | 用途 |
|------|------|
| opencode | 总指挥 + 修 bug（宿主） |
| CodeBuddy CLI | glm/hy3 的网关（找 bug + 验证审计员） |
| kimi CLI / qwen CLI | 独立评审壳 |
| `DASHSCOPE_API_KEY` | 阿里百炼，通吃 Qwen + GLM |
| `TOKENHUB_API_KEY` | 腾讯云 TokenHub，Hy3 真模型 |
| `MOONSHOT_API_KEY` | 月之暗面 Moonshot，Kimi（走 Moonshot 直连，非阿里） |

---

## 十四、常用路径速查

```
scripts/review-runner.mjs       只读评审（参数化 backend）
scripts/evaluate-models.mjs     finding 归一化/共识/裁决/多维度评估
scripts/models.mjs              4 施工队单一数据源 + 角色常量
scripts/runner-core.mjs         共享 spawn 原语
scripts/jobs.mjs                任务账本
scripts/guard.mjs               漂移守卫
scripts/backends.mjs            backend 定义（codebuddy/kimi/qwen）
scripts/self-audit.mjs          自审核心脚本（dogfooding，release 前跑）
.opencode/agents/*.md           4 个 B 分身子代理
.opencode/skills/cc-review/     评审技能 + 权重
docs/verification.md            验证台账
```

---

## License

[MIT](LICENSE)

*最后更新：2026-08-15。*
