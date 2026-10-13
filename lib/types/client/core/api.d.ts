import type { Snapshot } from '../../shared/types.ts';
/**
 * 请求超时。没有它的话，一旦宿主侧的 reconcile 卡住，`fetch` 永不 settle，
 * `busy` 永远为 true → **按钮永久发灰、状态也不变**（正是"点击停用置灰但状态不变"
 * 最可能的一种成因）。有了它，超时会走 catch 把原因显示出来，按钮恢复可点。
 */
export declare const REQUEST_TIMEOUT_MS = 20000;
/**
 * 写入之后等"条目重新挂上"的节奏：Loader 重建子条目是异步的（相位会走
 * pending → loading → active），而绿灯要求"探测通过 **且** 条目 active"。
 * 所以探通之后还要重读快照，直到相位稳定 —— 有界（约 2s），不是轮询。
 */
export declare const SETTLE_INTERVAL_MS = 200;
export declare const SETTLE_ATTEMPTS = 10;
/**
 * 工具名单**折叠前**最多同时显示几个名字。
 *
 * 一台服务器动辄几十个工具，全部铺开会把卡片撑得看不见别的行；6 个刚好能看出
 * 命名风格又不占地方。超过这个数就在末尾给「+N 个」和「显示全部 / 收起」。
 */
export declare const TOOL_PREVIEW_LIMIT = 6;
/** 等下一轮快照（只用在写入之后的相位稳定上；平时不轮询，避免敲服务器）。 */
export declare function sleep(ms: number): Promise<void>;
/**
 * 请求超时信号。老浏览器可能没有 `AbortSignal.timeout` —— 按**运行时事实**收窄，
 * 而不是按 lib.dom 的声明（声明说它一定在，实际不一定）。
 */
export declare function signalOf(): AbortSignal | undefined;
/** 把任意异常整理成给用户看的一句话。 */
export declare function describeError(error: unknown): string;
/** 读一次快照（GET）。 */
export declare function getSnapshot(): Promise<Snapshot>;
/** 发一次写操作（POST）。 */
export declare function postOp(payload: Record<string, unknown>): Promise<Snapshot>;
