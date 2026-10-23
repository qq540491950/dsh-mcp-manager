import type { ManagedBlockState, ManagedManifest } from '../shared/managed-block.ts';
export interface HmrLike {
    runExclusive?: (<T>(operation: () => Promise<T>) => Promise<T>) | undefined;
}
export interface PatchWriterOptions {
    /** `cordis.patch.yml` 的绝对路径（来自 configEditor.documentPath）。 */
    documentPath: string;
    /** 可选的 HMR 串行化入口；没有就只靠文件锁。 */
    hmr?: HmrLike | undefined;
}
export interface PatchWriteResult {
    documentPath: string;
    backupPath?: string | undefined;
    text: string;
}
/** 读取当前 profile patch 原文。 */
export declare function readPatch(documentPath: string): Promise<string>;
/**
 * 读取并验证当前受控块，返回 manifest 与原文。
 * marker 损坏、manifest 不一致时抛错，调用方必须把错误展示给用户。
 */
export declare function inspectPatch(documentPath: string): Promise<{
    text: string;
    manifest: ManagedManifest | undefined;
}>;
/**
 * 用新的受控块替换 profile patch。
 *
 * 空状态会删除整个块；如果文件因此没有条目，保留合法的 `[]`。
 */
export declare function writeManagedBlock(options: PatchWriterOptions, state: ManagedBlockState): Promise<PatchWriteResult>;
