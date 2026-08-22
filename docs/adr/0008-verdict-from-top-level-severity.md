# 8. 用顶层 severity 取最高值计算 verdict

- 状态：已接受
- 日期：2026-08-22

## 上下文

需要将多个评审员的 finding 汇总为单一 verdict，但 review 数据结构复杂，直接修改成本高。需确定汇总算法。

## 决策

### 本质
verdict 汇总算法选型；可逆、无损（只改计算逻辑，不改数据结构）。

### 最佳实践
最严重优先（取最高 severity），最小改动（不改 review 数据结构）。

### 方案
verdict 算法采用每个 worker 的顶层 severity 取最高值：任一 high 则 high，任一 medium 则 medium，否则 clean；不改 review 数据结构。

## 后果

正面：实现简单，不破坏现有结构；能快速反映最严重问题。负面：可能忽略低层级的多个 medium 累积风险；unknown 需特殊处理避免漏拦。

## 被拒备选

修改 review 数据结构存储 verdict：改动大且影响面广；基于 finding 数量加权：复杂且不直观。
