import type { PatchEdit } from '../shared/patch-doc.ts';
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
 * 在文件锁内执行一批编辑：锁内重读原文 → `composeEdit` 合成 → 有变化才备份 + 原子写。
 * 合成抛错（区间越界/重叠）时什么都不写。
 */
export declare function editPatch(options: PatchWriterOptions, edits: PatchEdit[]): Promise<PatchWriteResult>;
