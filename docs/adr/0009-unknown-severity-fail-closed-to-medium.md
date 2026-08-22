# 9. unknown severity 保守判为 medium 避免漏拦

- 状态：已接受
- 日期：2026-08-22

## 上下文

verdictFromFindings 的兜底分支将 unknown/undefined 静默归为 clean，导致评审员输出异常时门禁放行，存在 fail-open 隐患。

## 决策

### 本质
兜底分支把 unknown 静默归 clean = fail-open，会漏拦高危代码；这是「安全」决策，漏拦不可逆。

### 最佳实践
fail-closed——未知值一律保守拦截，宁可误拦不可漏拦。

### 方案
将 unknown/undefined severity 保守判为 medium，而非 clean；确保异常情况不会静默放行，宁可误拦不可漏拦。

## 后果

正面：门禁在异常时仍能拦截，避免高危代码提交；符合安全门禁的 fail-closed 原则。负面：可能误拦正常代码，需用户手动确认；增加少量误报。

## 被拒备选

保持 fail-open（unknown→clean）：会静默漏拦高危代码，门禁形同虚设；直接报错中断：过于激进，影响正常流程。
