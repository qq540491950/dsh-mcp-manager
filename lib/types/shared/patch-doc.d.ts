/**
 * 一条可寻址的条目声明。
 *
 * `style` 是这一行的**写入语义**（决定渲染形状），不是运行时来源：
 *   · 'insert'   —— 顶层 insert 分节里的内嵌条目（或 flow 行 insert 数组里的元素），
 *                  能**创建**条目；
 *   · 'override' —— 顶层裸行（`- id: X` 或 flow 裸对象），目标已存在时整键覆写。
 */
export interface AddressedEntry {
    /** 条目 id；首行识别不出 id 时为 undefined（不可寻址，不参与按 id 的写入）。 */
    id: string | undefined;
    /** 声明在文件中的字节区间 [start, end)；end 停在行边界（含行尾换行，若不是文件末行）。 */
    start: number;
    end: number;
    style: 'insert' | 'override';
    /** 首行的前导空格数；内嵌条目替换时要按它补缩进。 */
    indent: number;
    /** 所在顶层 insert 分节的字节区间（仅块式内嵌条目有）。 */
    parent?: {
        start: number;
        end: number;
    } | undefined;
    /** 父 insert 分节里的内嵌条目总数（含不可寻址的）；父块清理时用它判断是否变空。 */
    siblings: number;
    /** flow 行的解析值；块式条目为 undefined。`index` 是该条目在 insert 数组里的下标。 */
    flow?: {
        value: Record<string, unknown>;
        index: number | undefined;
    } | undefined;
}
export interface ScanResult {
    entries: AddressedEntry[];
    /** 无法寻址的条目行数（解析失败 / 首行没有 id）。 */
    unaddressable: number;
}
/** 一次写入的编辑列表；所有区间都相对**同一份原文**。 */
export type PatchEdit = {
    op: 'append';
    lines: string[];
} | {
    op: 'replace';
    start: number;
    end: number;
    line: string;
} | {
    op: 'delete';
    start: number;
    end: number;
}
/** 只能单独使用的整体变换（如剥离 v0.3 marker；在文件锁内拿到最新原文后执行）。 */
 | {
    op: 'transform';
    transform: (text: string) => string;
};
export declare function parseFlowLine(content: string): Record<string, unknown> | undefined;
/**
 * 扫描整份 patch 文件，找出所有可寻址的条目声明。
 * 结构异常（不可能走到这里——结构异常只会让个别条目不可寻址）不抛错；
 * 抛错的是 composeEdit 阶段的区间校验。
 */
export declare function scanPatchDoc(text: string): ScanResult;
/** flow 风格标量序列化（JSON 是 YAML 的子集；`!!js` 值写成 `!!js "表达式"`）。 */
export declare function flowScalar(value: unknown): string;
/**
 * 一条条目的**裸对象**：`{ id, name, config, disabled? }`。
 * override 行**始终**显式写 `disabled`（false 才能压过原条目的 true）；
 * insert 条目只在停用时写。
 */
export declare function entryItemOf(entry: {
    id: string;
    config: Record<string, unknown>;
    disabled?: boolean | undefined;
}, style: 'insert' | 'override'): Record<string, unknown>;
/** 渲染一条**裸**条目行：顶层覆写行，或 insert 分节里的内嵌条目（调用方按 indent 补缩进）。 */
export declare function renderEntryItem(entry: {
    id: string;
    config: Record<string, unknown>;
    disabled?: boolean | undefined;
}, style: 'insert' | 'override'): string;
/** 渲染一条**创建**行：顶层 `- {"insert":[{…}]}`（新条目必须走 insert，裸行目标不存在会被丢弃）。 */
export declare function renderInsertLine(entry: {
    id: string;
    config: Record<string, unknown>;
    disabled?: boolean | undefined;
}): string;
/** 渲染清空旧 group 容器的覆写行（迁移路径专用；group 声明不在本文件里时的兜底）。 */
export declare function renderKillLine(): string;
/**
 * 把编辑列表合成出新文件内容。所有区间相对**同一份原文**；重叠 / 越界一律抛错。
 * 区间替换保持行结构：原区间以换行结尾（或后面还有内容）时，替换行也以换行结尾。
 * 删空兜底：原文有条目、编辑后一条不剩时，保留注释 + `[]`——空字符串/纯注释在部分
 * YAML 加载器上是"没有文档"，宁可留一个显式的空序列。
 */
export declare function composeEdit(text: string, edits: PatchEdit[]): string;
