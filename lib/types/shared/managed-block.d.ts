export declare const MANAGED_START = "# >>> dsh-mcp-manager:managed";
export declare const MANAGED_END = "# <<< dsh-mcp-manager:managed";
export declare const MANAGED_MANIFEST_PREFIX = "# dsh-mcp-manager:manifest=";
export type ManagedKind = 'insert' | 'override';
/** manifest 里的引用；config 不重复存，读取时从 Loader 的原始 config 取。 */
export interface ManagedEntryRef {
    id: string;
    kind: ManagedKind;
}
export interface ManagedManifest {
    version: 1;
    /** 旧版 group 迁移期间需要一条 `config: []` 覆写，把旧容器清空。 */
    legacyGroup?: boolean | undefined;
    entries: ManagedEntryRef[];
}
/** 生成块时的一条记录。 */
export interface ManagedRecord extends ManagedEntryRef {
    config: Record<string, unknown>;
    disabled?: boolean | undefined;
}
export interface ManagedBlockState {
    records: ManagedRecord[];
    legacyGroup?: boolean | undefined;
}
export interface LocatedManagedBlock {
    start: number;
    end: number;
    manifest: ManagedManifest;
    body: string;
}
/** 把一条记录渲染成一行 YAML；override 行显式写 `disabled: false`，才能覆盖原条目的 true。 */
export declare function renderManagedRow(record: ManagedRecord): string;
/** 渲染完整受控块（含 marker 与 manifest 注释）。 */
export declare function renderManagedBlock(state: ManagedBlockState): string;
/**
 * 定位受控块。
 * @returns 没有块时返回 undefined；块不完整/重复/marker 外还有 marker 时抛错。
 */
export declare function locateManagedBlock(text: string): LocatedManagedBlock | undefined;
/** 替换/追加受控块，块外内容原样保留。 */
export declare function replaceManagedBlock(text: string, block: string): string;
/** 删除受控块；如果文件因此没有任何条目，保留一个合法的空序列 `[]`。 */
export declare function removeManagedBlock(text: string): string;
/** 解析文件里的受控块状态；没有块时返回空状态。 */
export declare function readManagedState(text: string): {
    manifest: ManagedManifest;
    block: LocatedManagedBlock | undefined;
};
