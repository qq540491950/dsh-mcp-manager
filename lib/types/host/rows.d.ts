import type { EntryRow } from './service-types.ts';
/**
 * 把一个**表单**提交的服务器描述整理成 `cordis:group` 的一份 entryList 行。
 * 注意这只服务表单路径；行内的启停/删除不走这里（见 index.ts 文件头第 4 条）。
 * @param server - 客户端提交的服务器对象（不可信，逐字段收窄）。
 * @returns 可直接写进 YAML 的条目行。
 */
export declare function normalizeRow(server: unknown): EntryRow;
/** 把客户端来的换行分隔文本整理成字符串数组（也接受数组）。 */
export declare function toStringArray(value: unknown): string[];
/**
 * 把客户端来的键值对整理成对象。
 * 三种形状都要认，否则会静默丢字段（踩过）：
 *   - 表单的「每行 KEY=VALUE」多行字符串
 *   - 字符串数组
 *   - **快照回传的原始对象**（行内操作会走到这里）
 * @param value - 任意一种形状。
 * @returns 解析后的对象；空输入返回 undefined。
 */
export declare function toRecord(value: unknown): Record<string, string> | undefined;
