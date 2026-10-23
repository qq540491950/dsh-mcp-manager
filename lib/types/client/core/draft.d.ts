import type { ServerSnapshot, Snapshot } from '../../shared/types.ts';
/** 表单里的一份可编辑草稿（全部是字符串，多行字段用换行分隔）。 */
export interface Draft {
    entryId?: string | undefined;
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
    entryId?: string | undefined;
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
/**
 * 对象 → `KEY=VALUE` 多行文本。
 * `!!js` 值写成 `KEY=!!js <expr>`，宿主会把它还原成标记对象；其他对象按"没写"处理。
 */
export declare function pairsToText(value: unknown): string;
/** 记录 → 可编辑草稿。 */
export declare function draftOf(server: ServerSnapshot): Draft;
/** 草稿 → 服务端契约的服务器对象。 */
export declare function serverOf(draft: Draft): ServerPayload;
/** 能力协商：宿主是否支持某项能力（旧宿主只能退回整数组提交）。 */
export declare function supports(snapshot: Snapshot | null | undefined, capability: string): boolean;
/** 新增时给一个不会撞车的默认名。 */
export declare function suggestName(servers: ServerSnapshot[]): string;
