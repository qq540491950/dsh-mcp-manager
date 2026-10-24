/**
 * 两半边共享的**协议类型** —— 宿主产出、客户端消费的那份快照的形状。
 *
 * 与 `constants.ts` 的分工：那里放"值"，这里放"形"。两个半边都 import type 它，
 * 所以快照字段改名/改形会在编译期同时打到两侧（原本只能靠自检断言发现）。
 *
 * 注意这里**不描述不可信输入**：配置行来自用户手写的 YAML，形状只能用 `unknown` + 类型守卫
 * 去收窄（见 src/host/index.ts 的 isRecord/asRecord）。这些类型只描述**我们自己写出去的**东西。
 */
import type { JsExpr } from './expr.ts';
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
/**
 * 一台顶层 MCP 条目的**声明来源**（v0.4.0）：
 *   · 'profile'    —— 声明在 profile 补丁文件里（insert 创建行），可原地编辑/删除；
 *   · 'overridden' —— 原始声明在别的层（其他 bundle / home patch），profile 里已有
 *                     本插件或手写的覆写行；可编辑覆写行、可"还原"（删覆写行）；
 *   · 'external'   —— 声明在别的层且还没有覆写行；保存/启停会自动追加覆写行，
 *                     原始声明无法由本插件删除。
 */
export type ServerSource = 'profile' | 'overridden' | 'external';
/** 快照里的一台服务器。 */
export interface ServerSnapshot {
    index: number;
    /** 顶层 Loader 条目 id（profile patch 里的 `id:`）；也是所有写操作的定位键。 */
    id: string;
    /** `config.serverName`；畸形条目允许为空串（页面上退回显示 id）。 */
    serverName: string;
    source: ServerSource;
    /** 配置行的原始 config（用户手写的，所以是 unknown 值表，客户端按需读）。 */
    config: Record<string, unknown>;
    /** 允许缺失：客户端读的是 JSON，`=== true` / `!== true` 是刻意的防御式写法。 */
    disabled?: boolean | undefined;
    phase: FiberPhase;
    /** 没有记录时**不写这个键**（JSON.stringify 会丢掉 undefined）。 */
    error?: FailureRecord | undefined;
    probe?: ProbeRecord | undefined;
    tools?: ToolRecord | undefined;
}
/** 旧版 `cordis:group` 容器的迁移状态。 */
export interface LegacyState {
    state: 'none' | 'needs-migration' | 'duplicated';
    /** 旧容器里还有几台 MCP。 */
    count: number;
}
/** GET 快照与每个写操作的返回值。 */
export interface Snapshot {
    /** 所有顶层 MCP 条目：profile 声明的 + 外部层的（含已覆写的）。 */
    servers: ServerSnapshot[];
    /** 旧版 group 迁移提示。 */
    legacy?: LegacyState | undefined;
    /** profile 的 `cordis.patch.yml` 绝对路径，仅用于诊断。 */
    profilePath?: string | undefined;
    /** profile 补丁文件读取/解析失败时的原文错误；此时写操作必须拒绝。 */
    patchError?: string | undefined;
    mcpPackage: string;
    /**
     * 能力协商：新客户端看到 `patchInsert` 才启用写操作；旧宿主没有这个能力时
     * 页面必须提示重启 DSH，而不是按旧 group 协议误写。
     */
    capabilities: string[];
}
/**
 * 一份**要写进** group 条目 config 数组的服务器配置 —— `normalizeRow()` 的产物。
 * 只用于写入方向；读取方向永远走 `unknown` + 守卫。
 */
export interface ServerConfig {
    serverName: string;
    transport: string;
    /** `!!js` 表达式在写回 YAML 时是标记对象，不能被当成普通字符串。 */
    url?: string | JsExpr;
    command?: string | JsExpr;
    args?: Array<string | JsExpr>;
    env?: Record<string, string | JsExpr>;
    headers?: Record<string, string | JsExpr>;
    cwd?: string | JsExpr;
    toolCallTimeoutMs?: number;
    failOnStartupError?: boolean;
    maxInstructionBytes?: number;
    reconnect?: ReconnectConfig;
}
/** mcp-client 的 `reconnect` 配置（只列我们写回时保留的字段）。 */
export interface ReconnectConfig {
    enabled?: boolean;
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxAttempts?: number;
}
