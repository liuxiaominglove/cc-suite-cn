# 14. 将install.sh纳入现有安全与质量网

- 状态：已接受
- 日期：2026-08-22

## 上下文

新增install.sh带来4条风险：curl|bash供应链反模式、key写入路径、自动装第三方、脚本自身不在guard.mjs清单和测试内。用户担心影响系统安全性和质量。

## 决策

### 本质
新资产 install.sh 带来供应链/key 落盘/自动装第三方/脱离守卫四类风险；这是「安全」决策。

### 最佳实践
新资产纳入现有守卫和测试网（不裸奔）；key 用 read -s 不回显、不落 log、幂等 append。

### 方案
补强4步：双路径提供（curl|bash和git clone后先读再跑）；install.sh加入guard.mjs canonical清单并新增node:test单测（bash -n语法+临时HOME跑--dry-run验证幂等和key不重复写）；key用read -s不回显、不写log、幂等append；clone前检测git并加--depth 1。

## 后果

正面：新资产纳入现有安全网，安装期执行面被监控，key安全细节提升，下载提速。负面：实施工作量增加，需维护额外测试，Linux分支无法在macOS实测需标🟡。

## 被拒备选

不做补强直接上线：会让install.sh裸奔，风险不可控，不符合仓库处处有守卫的纪律。仅保留curl|bash单一路径：用户无法先看再跑，信任门槛高。
