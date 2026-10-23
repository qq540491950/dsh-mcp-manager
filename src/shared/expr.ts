/**
 * Loader `!!js` 标量的无损文本表示。
 *
 * 为什么要有这个模块：`cordis-plugin-include` 的 entryList YAML 方言把
 * `Authorization: !!js 'process.env.TOKEN'` 解析成 `{ __jsExpr: "process.env.TOKEN" }`
 * （官方 `dsh-app-boot` 的 `JsExpr`），`configEditor.edit()` 写回时只把**恰好只有
 * `__jsExpr` 一个键**的对象还原成 `!!js` 标量。
 *
 * 历史事故：表单把 headers/env 转成 `KEY=VALUE` 文本时用 `asText()` 读值，遇到
 * `{__jsExpr}` 得到空串，于是保存一次就把凭据表达式清空。这里统一负责
 * 「YAML 值 ↔ 表单文本」的双向转换，两半边共用，避免各写一份再次漂移。
 *
 * 纯函数、零依赖（只依赖 guards），因此自检可以直接 import。
 */
import { isRecord } from './guards.ts'

/** `!!js` 表达式在内存中的唯一合法形状。 */
export interface JsExpr {
  __jsExpr: string
}

/** 表单文本里用来标记表达式的写法；与 YAML 的 `!!js` 标签同名，方便用户阅读。 */
export const JS_EXPR_PREFIX = '!!js '

/** 是否是 `!!js` 标记对象。键必须**恰好**只有 `__jsExpr`（与 configEditor 的还原条件一致）。 */
export function isJsExpr(value: unknown): value is JsExpr {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === '__jsExpr' && typeof value.__jsExpr === 'string'
}

/**
 * YAML 值 → 表单文本。
 * - 字符串/数字按原样；
 * - `!!js` 标记转成 `!!js <expr>`；
 * - 其余对象/数组一律当作"没写"（与 `asText` 的保守语义一致）。
 */
export function textOf(value: unknown): string {
  if (isJsExpr(value)) return `${JS_EXPR_PREFIX}${value.__jsExpr}`
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

/** 表单文本 → YAML 值。`!!js ` 前缀还原成标记对象，其余按去空白的字符串。 */
export function valueOf(text: string): string | JsExpr {
  const trimmed = text.trim()
  if (trimmed.startsWith(JS_EXPR_PREFIX)) {
    return { __jsExpr: trimmed.slice(JS_EXPR_PREFIX.length) }
  }
  return trimmed
}

/**
 * 键值对里的标量值：保留 `!!js` 标记，其余标量转字符串。
 * 非标量对象抛错而不是 `String(value)` —— 后者会写出 `[object Object]`，
 * 属于"文件看着正常、运行时是坏的"那一类静默破坏。
 */
export function scalarOf(value: unknown): string | JsExpr {
  if (isJsExpr(value)) return value
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  throw new Error('值必须是字符串或 !!js 表达式')
}

/** 递归判断一份原始 config 里是否含 `!!js` 标记（用于旧宿主的兼容性拦截）。 */
export function containsJsExpr(value: unknown): boolean {
  if (isJsExpr(value)) return true
  if (Array.isArray(value)) return value.some((item) => containsJsExpr(item))
  if (isRecord(value)) return Object.values(value).some((item) => containsJsExpr(item))
  return false
}
