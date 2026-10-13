import type { ServerSnapshot, Snapshot } from '../../shared/types';
/** 表单里的一份可编辑草稿（全部是字符串，多行字段用换行分隔）。 */
export interface Draft {
    rowId?: string | undefined;
    disabled: boolean;
    serverName: string;
    transport: string;
    url: string;
    command: string;
    args: string;
    env: string;
    headers: string;
    cwd: string;
}
/** 表单提交给宿主的服务器对象（`op: "save"`）。 */
export interface ServerPayload {
    rowId?: string | undefined;
    disabled: boolean;
    serverName: string;
    transport: string;
    url?: string;
    command?: string;
    args?: string;
    env?: string;
    cwd?: string;
    headers?: string;
}
/** 一行服务器配置 → 目标摘要（URL 或命令行）。 */
export declare function targetOf(config: Record<string, unknown>): string;
/** 对象 → `KEY=VALUE` 多行文本。值一律按标量读（对象/数组按"没写"处理）。 */
export declare function pairsToText(value: unknown): string;
/** 记录 → 可编辑草稿。 */
export declare function draftOf(server: ServerSnapshot): Draft;
/** 草稿 → 服务端契约的服务器对象。 */
export declare function serverOf(draft: Draft): ServerPayload;
/**
 * 服务器记录 → **旧版宿主**认识的扁平形状（`op: "save"` 用）。
 * 关键：env / headers / args 一律转成宿主认识的「多行文本 / 换行文本」。
 * 快照里它们是对象，直接回传会被旧宿主的解析器当成"非字符串非数组"而**静默清空**
 * ——线上就是这里把 context7 的 Authorization 头弄丢的。
 */
export declare function serverOfExisting(server: ServerSnapshot): Record<string, unknown>;
/** 能力协商：宿主是否支持某项能力（旧宿主只能退回整数组提交）。 */
export declare function supports(snapshot: Snapshot | null | undefined, capability: string): boolean;
/** 新增时给一个不会撞车的默认名。 */
export declare function suggestName(servers: ServerSnapshot[]): string;
