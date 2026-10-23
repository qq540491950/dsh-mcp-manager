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
/**
 * 一台服务器最近一次失败的原文（本插件自己从 `ctx.logger` 收的）。
 *
 * 字段**全部可选**：这是跨半边传输的 JSON，客户端读到的可能来自旧宿主、也可能被人为改坏。
 * 类型只描述"我们期望的形状"，客户端那些防御性判断（`typeof x === 'string'`）是刻意的，
 * 所以这里必须允许字段缺失，否则那些判断会被类型系统判成"多余"。
 */
export interface FailureRecord {
    message?: string | undefined;
    level?: string | undefined;
    at?: number | undefined;
    count?: number | undefined;
}
/**
 * 一台服务器最近一次**主动探测**的结果。
 * `connected === null` = 这种传输探不了（stdio 走子进程）；`status`/`detail` 同理允许缺失。
 */
export interface ProbeRecord {
    connected: boolean | null;
    status?: number | null | undefined;
    detail?: string | undefined;
    at?: number | undefined;
}
/** 一台服务器**当前注册给模型**的工具名单。 */
export interface ToolRecord {
    count: number;
    names: string[];
    /** 同样允许缺失：客户端按 `=== true` 判断"名单被截过"。 */
    truncated?: boolean | undefined;
}
/** 快照里的一台服务器。 */
export interface ServerSnapshot {
    index: number;
    rowId?: string | undefined;
    /** 允许缺失：客户端读的是 JSON，`=== true` / `!== true` 是刻意的防御式写法。 */
    disabled?: boolean | undefined;
    /** 配置行的原始 config（用户手写的，所以是 unknown 值表，客户端按需读）。 */
    config: Record<string, unknown>;
    phase: FiberPhase;
    /** 没有记录时**不写这个键**（JSON.stringify 会丢掉 undefined）。 */
    error?: FailureRecord | undefined;
    probe?: ProbeRecord | undefined;
    tools?: ToolRecord | undefined;
}
/** 容器的声明状态：`missing` = 一行都没有；`duplicated` = 同 id 声明了两次（写操作会全挂）。 */
export type ContainerState = 'ok' | 'missing' | 'duplicated';
/**
 * **页面外**的一台 MCP 服务器：顶层 Loader 条目（`@deepseek-ai/dsh-mcp-client`），
 * 但不在本插件的容器里 —— 例如插件市场替你写进 profile 补丁层的那一行。
 *
 * 之所以要单独报出来：它不是本插件的数据，本页既不能探测也不能启停（容器里没有它），
 * 但它**确实在跑**、工具也确实注册给了模型。旧版本页面在这种情况下显示
 * 「还没有配置任何 MCP 服务器」，让人以为配置丢了（真实案例：`magpie-mcp-context7`）。
 */
export interface OutsideServer {
    /** Loader 条目 id（profile 补丁里的 `id:`），也是页面上唯一能指认它出处的线索。 */
    id: string;
    /** `config.serverName`；畸形条目允许为空串（此时页面上退回显示 id）。 */
    serverName: string;
    config: Record<string, unknown>;
    phase: FiberPhase;
    disabled?: boolean | undefined;
    error?: FailureRecord | undefined;
    tools?: ToolRecord | undefined;
}
/** GET 快照与每个写操作的返回值。 */
export interface Snapshot {
    groupId: string;
    /** 允许缺失：客户端把"没写"当成已配置（`!== false`）。 */
    configured?: boolean | undefined;
    /** 容器状态；旧宿主不报这个字段，客户端退回只看 `configured`。 */
    container?: ContainerState | undefined;
    /**
     * 页面外的 MCP 服务器（顶层 Loader 条目）。
     * 允许缺失：旧宿主不报这个字段 —— 客户端按空数组渲染，天然向前兼容。
     */
    outside?: OutsideServer[] | undefined;
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
