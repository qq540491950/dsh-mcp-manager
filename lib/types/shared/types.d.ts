/**
 * 两半边共享的**协议类型** —— 宿主产出、客户端消费的那份快照的形状。
 *
 * 与 `constants.ts` 的分工：那里放"值"，这里放"形"。两个半边都 import type 它，
 * 所以快照字段改名/改形会在编译期同时打到两侧（原本只能靠自检断言发现）。
 *
 * 注意这里**不描述不可信输入**：配置行来自用户手写的 YAML，形状只能用 `unknown` + 类型守卫
 * 去收窄（见 src/host/index.ts 的 isRecord/asRecord）。这些类型只描述**我们自己写出去的**东西。
 */
/**
 * 一台服务器的运行时相位。
 *
 * 前六个是 cordis `FiberState` 的投影（数值见 cordis `lib/types/fiber.js` 的 `_getState`：
 * PENDING=0 / LOADING=1 / ACTIVE=2 / FAILED=3 / DISPOSED=4 / UNLOADING=5），
 * `stopped` 是"条目被 disabled"，`absent` 是"没有活条目"。
 */
export type FiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | 'stopped' | 'absent';
/** 一台服务器最近一次失败的原文（本插件自己从 `ctx.logger` 收的）。 */
export interface FailureRecord {
    message: string;
    level: string;
    at: number;
    count: number;
}
/** 一台服务器最近一次**主动探测**的结果。`connected === null` = 这种传输探不了（stdio）。 */
export interface ProbeRecord {
    connected: boolean | null;
    status: number | null;
    detail: string;
    at: number;
}
/** 一台服务器**当前注册给模型**的工具名单。 */
export interface ToolRecord {
    count: number;
    names: string[];
    truncated: boolean;
}
/** 快照里的一台服务器。 */
export interface ServerSnapshot {
    index: number;
    rowId?: string | undefined;
    disabled: boolean;
    /** 配置行的原始 config（用户手写的，所以是 unknown 值表，客户端按需读）。 */
    config: Record<string, unknown>;
    phase: FiberPhase;
    /** 没有记录时**不写这个键**（JSON.stringify 会丢掉 undefined）。 */
    error?: FailureRecord | undefined;
    probe?: ProbeRecord | undefined;
    tools?: ToolRecord | undefined;
}
/** GET 快照与每个写操作的返回值。 */
export interface Snapshot {
    groupId: string;
    configured: boolean;
    mcpPackage: string;
    /**
     * 能力协商：客户端据此决定用「宿主侧定点操作」还是退回整数组提交。
     * 宿主半边不参与热重载，所以客户端必须能同时说两代协议（AGENTS 1.2）。
     */
    capabilities: string[];
    servers: ServerSnapshot[];
}
/**
 * 一份**要写进** group 条目 config 数组的服务器配置 —— `normalizeRow()` 的产物。
 * 只用于写入方向；读取方向永远走 `unknown` + 守卫。
 */
export interface ServerConfig {
    serverName: string;
    transport: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    cwd?: string;
    toolCallTimeoutMs?: number;
}
