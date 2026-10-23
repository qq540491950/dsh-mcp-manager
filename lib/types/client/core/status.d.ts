/**
 * 运行时状态 → 圆点颜色 / 文案 / 原因行。**纯函数**：不碰 React、不碰 DOM，
 * 所以自检可以直接 import 它做表驱动测试（这是 P2 抽出来的第一个模块）。
 *
 * 判定顺序**就是优先级**：
 *
 *   已停用(灰) → 检测通过(绿) → 检测失败(红) → 日志失败记录(红) → fiber FAILED(红)
 *   → 启动中(琥珀) → 无证据(琥珀「未检测」) → 其余(灰「未启动」)
 *
 * 三个关键点：
 *   1. **fiber ACTIVE 不等于能用**。`mcp-client` 默认 `failOnStartupError:false`，
 *      连接失败也不抛错（它会在后台按退避重试，最多 10 次后放弃并注销全部工具），
 *      所以 `phase` 会一直停在 'active' —— 只读相位就必然误报绿灯（实测过：TCP 拒绝的
 *      服务器显示「运行中」）。因此失败记录与主动检测都优先于 'active'。
 *   2. **检测优先于日志**：日志只能证明"过去失败过"，检测能证明"现在答不答"。
 *   3. **绿灯要有正面证据**。宿主支持探测（能力协商）时，"条目 active 但没有任何探测
 *      记录"只说明 apply 跑完了，不说明连得上 —— 此时报「未检测」而不是绿。写入配置
 *      （启停/删除/保存）会让宿主清掉旧记录，所以那之后必然经过这一态，
 *      由 `recheck` 补一次探测把它推回绿/红（见 section.tsx）。
 */
import type { FailureRecord, OutsideServer, ServerSnapshot, Snapshot } from '../../shared/types.ts';
/** 一条服务器的展示状态。`reason` 只有"红"的三种状态才有。 */
export interface StatusView {
    color: string;
    text: string;
    reason: string | null;
}
/** 状态色：全部走官方 token，十六进制只作 var() fallback（AGENTS 3.1）。 */
export declare const STATUS_IDLE = "var(--dsw-alias-state-idle-primary)";
export declare const STATUS_WARN = "var(--dsw-alias-state-warn-primary, #d8a24a)";
export declare const STATUS_ERROR = "var(--dsw-alias-state-error-primary, #d9534f)";
export declare const STATUS_OK = "var(--dsw-alias-state-success-primary, #2ea043)";
/**
 * @param server - 快照里的一条服务器记录。
 * @param canProbe - 宿主是否声明了 `probe` 能力（旧宿主没有这条通道，只能退回相位判定）。
 */
export declare function statusOf(server: ServerSnapshot, canProbe: boolean): StatusView;
/**
 * **页面外**服务器的状态（顶层 Loader 条目，不在本页容器里）。
 *
 * 与 `statusOf` 的区别在于**证据来源**：它们在容器外，我们既不能探测（`runProbes` 只认容器里的行）
 * 也拿不到写入通道，所以判断"能不能用"只有一条正面证据 —— **mcp-client 已经把工具注册完了**
 * （`outside.tools.count > 0`）。相位 `active` 单独出现不算数：`failOnStartupError: false`
 * 下连不上也是 active（AGENTS 3.10）。所以 active + 0 个工具报琥珀「无工具」，不给绿灯。
 */
export declare function outsideStatus(server: OutsideServer): StatusView;
/**
 * 还有服务器"探通了、但条目没挂上"吗？（相位稳定之前不能报绿）
 * `failed` 是终态，不必再等；其余非 active 的相位（pending/loading）都算没稳定。
 */
export declare function settling(data: Snapshot | null | undefined): boolean;
/**
 * 失败记录 → 一行可读的原因：时间 +（多次时）次数 + mcp-client 的原文。
 * 时间戳是刻意的：那条记录可能来自上一次实例（例如改完配置刚重启、或已放弃重连），
 * 有具体时间才不会被当成"现在正在发生"。
 */
export declare function failureText(error: FailureRecord): string;
