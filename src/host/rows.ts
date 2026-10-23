/**
 * 宿主半边的**纯函数**：把不可信的表单/请求值整理成可写进 YAML 的条目行。
 *
 * 为什么单独一个文件（P2 的成果）：这些函数原本埋在 `apply()` 的闭包里，自检只能通过
 * "渲染出某段文字"或"字符串包含"间接覆盖。抽出来之后，自检可以直接 import 它们做表驱动单测
 * （verify 的 F 区），每条分支都能单独钉住——而这里恰恰是**丢字段事故**的历史高发区。
 *
 * 纯：不碰 ctx、不碰 IO、不碰 DOM。
 */
import { MCP_PACKAGE } from '../shared/constants.ts'
import { isJsExpr, scalarOf, textOf, valueOf } from '../shared/expr.ts'
import type { JsExpr } from '../shared/expr.ts'
import { asRecord, asText, isRecord, readString } from '../shared/guards.ts'
import type { EntryRow } from './service-types.ts'

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
export function normalizeRow(server: unknown, base?: unknown): EntryRow {
  const source = asRecord(server)
  const baseConfig = asRecord(base)
  const transport =
    source.transport === 'stdio' || (source.transport === undefined && baseConfig.transport === 'stdio')
      ? 'stdio'
      : 'streamable-http'
  // 部分更新（agent tool）可以省略 serverName / url 等字段：省略表示沿用 base，
  // 显式传空串才表示"清空"。表单始终会带全字段，所以对 UI 路径没有行为变化。
  const serverName = asText(source.serverName).trim() || asText(baseConfig.serverName).trim()
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    throw new Error(`serverName "${serverName}" 非法：只允许 1-32 位字母、数字、下划线、连字符`)
  }

  // 先把两种 transport 的互斥字段清掉；不互斥的（toolCallTimeoutMs / reconnect / ...）
  // 留在 base 里，用户没碰就原样回写。
  // source 里可能带着旧客户端 `serverOfExisting()` 展平出来的额外字段；
  // 与 base 一起并进来，未识别的字段就不会因为"表单没显示"而消失。
  const config: Record<string, unknown> = { ...baseConfig, ...asRecord(server) }
  delete config.rowId
  delete config.entryId
  delete config.disabled
  delete config.id
  delete config.name
  const baseUrl = baseConfig.url
  const baseHeaders = baseConfig.headers
  const baseCommand = baseConfig.command
  const baseArgs = baseConfig.args
  const baseEnv = baseConfig.env
  const baseCwd = baseConfig.cwd
  config.serverName = serverName
  config.transport = transport
  delete config.url
  delete config.headers
  delete config.command
  delete config.args
  delete config.env
  delete config.cwd
  const baseToolCallTimeoutMs = baseConfig.toolCallTimeoutMs
  const baseFailOnStartupError = baseConfig.failOnStartupError
  const baseMaxInstructionBytes = baseConfig.maxInstructionBytes
  const baseReconnect = baseConfig.reconnect
  delete config.toolCallTimeoutMs
  delete config.failOnStartupError
  delete config.maxInstructionBytes
  delete config.reconnect

  if (transport === 'stdio') {
    const command = valueOf(textOf(source.command !== undefined ? source.command : baseCommand))
    if (typeof command === 'string' && command === '') {
      throw new Error(`服务器 "${serverName}" 使用 stdio，但 command 为空`)
    }
    config.command = command
    const args = toStringArray(source.args !== undefined ? source.args : baseArgs)
    if (args.length > 0) config.args = args
    const env = toRecord(source.env !== undefined ? source.env : baseEnv)
    if (env !== undefined) config.env = env
    const cwd = valueOf(textOf(source.cwd !== undefined ? source.cwd : baseCwd))
    if (typeof cwd !== 'string' || cwd !== '') config.cwd = cwd
  } else {
    const url = valueOf(textOf(source.url !== undefined ? source.url : baseUrl))
    if (typeof url === 'string' && url === '') {
      throw new Error(`服务器 "${serverName}" 使用 streamable-http，但 url 为空`)
    }
    config.url = url
    const headers = toRecord(source.headers !== undefined ? source.headers : baseHeaders)
    if (headers !== undefined) config.headers = headers
  }

  const timeout = finiteNumber(source.toolCallTimeoutMs) ?? finiteNumber(baseToolCallTimeoutMs)
  if (timeout !== undefined) config.toolCallTimeoutMs = timeout
  const failOnStartupError =
    typeof source.failOnStartupError === 'boolean'
      ? source.failOnStartupError
      : typeof baseFailOnStartupError === 'boolean'
        ? baseFailOnStartupError
        : undefined
  if (failOnStartupError !== undefined) config.failOnStartupError = failOnStartupError
  const maxInstructionBytes = positiveInteger(source.maxInstructionBytes) ?? positiveInteger(baseMaxInstructionBytes)
  if (maxInstructionBytes !== undefined) config.maxInstructionBytes = maxInstructionBytes
  // 部分更新只覆盖它给的键；base 的其它 reconnect 字段继续保留。
  const reconnect = reconnectOf({ ...asRecord(baseReconnect), ...asRecord(source.reconnect) })
  if (reconnect !== undefined) config.reconnect = reconnect

  const row: EntryRow = { name: MCP_PACKAGE, config }
  if (source.disabled === true) row.disabled = true
  // 保留既有 id，让 Loader 认得出是同一个条目（而不是先删后建）。
  const rowId = readString(source, 'entryId') ?? readString(source, 'rowId')
  if (rowId !== undefined && rowId !== '') row.id = rowId
  return row
}

/** 有限数字；其余返回 undefined（不让 Infinity/NaN 落盘）。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 正整数；其余返回 undefined（maxInstructionBytes）。 */
function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** 只保留 mcp-client 认识的 reconnect 字段；空对象视为"没写"。 */
function reconnectOf(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const next: Record<string, unknown> = {}
  if (typeof value.enabled === 'boolean') next.enabled = value.enabled
  for (const key of ['initialDelayMs', 'maxDelayMs', 'maxAttempts'] as const) {
    const item = value[key]
    if (typeof item === 'number' && Number.isFinite(item)) next[key] = item
  }
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * 直接信任客户端回传的**未修改**行（`op: "saveRows"`）。
 * 这里只做"config 是不是对象"的形状检查；字段本身是用户 YAML 原文，不能被表单重建。
 */
export function rawRow(value: unknown): EntryRow {
  const source = asRecord(value)
  if (!isRecord(source.config)) throw new Error('saveRows 的每一行都必须带 config 对象')
  const row: EntryRow = { name: MCP_PACKAGE, config: source.config }
  const rowId = readString(source, 'rowId')
  if (rowId !== undefined && rowId !== '') row.id = rowId
  if (source.disabled === true) row.disabled = true
  return row
}

/** 同一 group 作用域内 serverName 必须唯一；mcp-client 对重复名字只会让后一条加载失败。 */
export function assertUniqueServerNames(rows: EntryRow[]): void {
  const seen = new Set<string>()
  for (const row of rows) {
    const name = asText(asRecord(row.config).serverName)
    if (name === '') continue
    if (seen.has(name)) {
      throw new Error(`MCP 服务器名重复："${name}"；同一作用域内 serverName 必须唯一`)
    }
    seen.add(name)
  }
}

/** 把客户端来的换行分隔文本整理成字符串数组（也接受数组；每项都可能是 `!!js` 表达式）。 */
export function toStringArray(value: unknown): Array<string | JsExpr> {
  const rawList: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split('\n').map((item) => item.trim())
      : []
  const result: Array<string | JsExpr> = []
  for (const item of rawList) {
    if (isJsExpr(item)) {
      result.push(item)
      continue
    }
    if (typeof item === 'string') {
      const parsed = valueOf(item)
      if (typeof parsed === 'string' && parsed === '') continue
      result.push(parsed)
      continue
    }
    if (typeof item === 'number') {
      result.push(String(item))
      continue
    }
    throw new Error('args 的每一项必须是字符串或 !!js 表达式')
  }
  return result
}

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
export function toRecord(value: unknown): Record<string, string | JsExpr> | undefined {
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, scalarOf(item)] as const)
    return entries.length === 0 ? undefined : Object.fromEntries(entries)
  }
  const pairs = Array.isArray(value)
    ? (value as unknown[]).map((item) => String(item))
    : typeof value === 'string'
      ? value.split('\n')
      : []
  const entries = pairs
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=')
      if (at <= 0) throw new Error(`环境变量/请求头行缺少 "="：${line}`)
      return [line.slice(0, at).trim(), valueOf(line.slice(at + 1))] as const
    })
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}
