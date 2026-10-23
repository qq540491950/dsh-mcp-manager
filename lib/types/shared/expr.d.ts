/** `!!js` 表达式在内存中的唯一合法形状。 */
export interface JsExpr {
    __jsExpr: string;
}
/** 表单文本里用来标记表达式的写法；与 YAML 的 `!!js` 标签同名，方便用户阅读。 */
export declare const JS_EXPR_PREFIX = "!!js ";
/** 是否是 `!!js` 标记对象。键必须**恰好**只有 `__jsExpr`（与 configEditor 的还原条件一致）。 */
export declare function isJsExpr(value: unknown): value is JsExpr;
/**
 * YAML 值 → 表单文本。
 * - 字符串/数字按原样；
 * - `!!js` 标记转成 `!!js <expr>`；
 * - 其余对象/数组一律当作"没写"（与 `asText` 的保守语义一致）。
 */
export declare function textOf(value: unknown): string;
/** 表单文本 → YAML 值。`!!js ` 前缀还原成标记对象，其余按去空白的字符串。 */
export declare function valueOf(text: string): string | JsExpr;
/**
 * 键值对里的标量值：保留 `!!js` 标记，其余标量转字符串。
 * 非标量对象抛错而不是 `String(value)` —— 后者会写出 `[object Object]`，
 * 属于"文件看着正常、运行时是坏的"那一类静默破坏。
 */
export declare function scalarOf(value: unknown): string | JsExpr;
/** 递归判断一份原始 config 里是否含 `!!js` 标记（用于旧宿主的兼容性拦截）。 */
export declare function containsJsExpr(value: unknown): boolean;
