// delegation-boundary.mjs — 阻止被委派的 agent 把活踢回 opencode。
//
// cc-suite-cn 的 B 分身（.opencode/agents/*.md，opencode 子代理）共享 opencode 的
// 工具面，其中含「派活给其他 agent」的能力。一个 B 分身接到「审 src/x.ts」时，
// 完全可能觉得「这活可以让主 opencode 自己做」，于是把它转手回去——独立第二意见
// 就塌缩成「opencode 自己审自己」。施工队（CLI 子进程）目前没有反向通道（反向桥
// 已删），但统一加边界声明，纪律一致、防未来加回通道时失守。
//
// 两条不变量在此定义一次：
//   - backends.mjs 的 READ_ONLY_DECLARATION import 本常量拼装（JS 侧天然单源）；
//   - .opencode/agents/*.md 是 prose 副本（.md 无法 import JS），必须逐字包含，
//     由 delegation-boundary.test.mjs 锁定，防止漂移。
export const BOUNDARY_INVARIANTS = Object.freeze([
  "你是干活的执行者，不是路由或转手者",
  "把任务踢回或转手给 opencode 会摧毁这次独立判断的价值",
]);
