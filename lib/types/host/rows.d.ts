import type { JsExpr } from '../shared/expr.ts';
import type { EntryRow } from './service-types.ts';
/**
 * 把一个**表单**提交的服务器描述整理成 `cordis:group` 的一份 entryList 行。
 *
 * `base` 是该行原来的原始 config（覆写层）。以它为底再覆盖表单字段，原因有两个：
 *   1. `failOnStartupError` / `maxInstructionBytes` / `reconnect` 以及未来 schema 新增的
 *      字段不会因为"表单没显示"而被静默删除；
 *   2. `!!js` 标记对象可以原样保留（表单只改它认识的那几个字段）。
 * 注意这只服务表单/agent 的写路径；行内启停/删除不走这里（见 index.ts 文件头第 4 条）。
 * @param server - 客户端提交的服务器对象（不可信，逐字段收窄）。
 * @param base - 该行原来的原始 config；新增行省略。
 * @returns 可直接写进 YAML 的条目行。
 */
export declare function normalizeRow(server: unknown, base?: unknown): EntryRow;
/** 把客户端来的换行分隔文本整理成字符串数组（也接受数组；每项都可能是 `!!js` 表达式）。 */
export declare function toStringArray(value: unknown): Array<string | JsExpr>;
/**
 * 把客户端来的键值对整理成对象。
 * 三种形状都要认，否则会静默丢字段（踩过）：
 *   - 表单的「每行 KEY=VALUE」多行字符串
 *   - 字符串数组
 *   - **快照回传的原始对象**（行内操作会走到这里）
 *
 * 值里的 `!!js ` 前缀会还原成 `{__jsExpr}` 标记，保证凭据表达式不会在保存时被清空。
 * @param value - 任意一种形状。
 * @returns 解析后的对象；空输入返回 undefined。
 */
export declare function toRecord(value: unknown): Record<string, string | JsExpr> | undefined;
