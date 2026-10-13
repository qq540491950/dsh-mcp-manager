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
import { asRecord, asText, isRecord, readString } from '../shared/guards.ts'
import type { ServerConfig } from '../shared/types.ts'
import type { EntryRow } from './service-types.ts'

/**
 * 把一个**表单**提交的服务器描述整理成 `cordis:group` 的一份 entryList 行。
 * 注意这只服务表单路径；行内的启停/删除不走这里（见 index.ts 文件头第 4 条）。
 * @param server - 客户端提交的服务器对象（不可信，逐字段收窄）。
 * @returns 可直接写进 YAML 的条目行。
 */
export function normalizeRow(server: unknown): EntryRow {
  const source = asRecord(server)
  const transport = source.transport === 'stdio' ? 'stdio' : 'streamable-http'
  const serverName = asText(source.serverName).trim()
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    throw new Error(`serverName "${serverName}" 非法：只允许 1-32 位字母、数字、下划线、连字符`)
  }

  const config: ServerConfig = { serverName, transport }
  if (transport === 'stdio') {
    const command = asText(source.command).trim()
    if (command === '') throw new Error(`服务器 "${serverName}" 使用 stdio，但 command 为空`)
    config.command = command
    const args = toStringArray(source.args)
    if (args.length > 0) config.args = args
    const env = toRecord(source.env)
    if (env !== undefined) config.env = env
    if (typeof source.cwd === 'string' && source.cwd !== '') config.cwd = source.cwd
  } else {
    const url = asText(source.url).trim()
    if (url === '') throw new Error(`服务器 "${serverName}" 使用 streamable-http，但 url 为空`)
    config.url = url
    const headers = toRecord(source.headers)
    if (headers !== undefined) config.headers = headers
  }
  if (typeof source.toolCallTimeoutMs === 'number' && Number.isFinite(source.toolCallTimeoutMs)) {
    config.toolCallTimeoutMs = source.toolCallTimeoutMs
  }

  const row: EntryRow = { name: MCP_PACKAGE, config }
  if (source.disabled === true) row.disabled = true
  // 保留既有 id，让 Loader 认得出是同一个条目（而不是先删后建）。
  const rowId = readString(source, 'rowId')
  if (rowId !== undefined && rowId !== '') row.id = rowId
  return row
}

/** 把客户端来的换行分隔文本整理成字符串数组（也接受数组）。 */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    const list: unknown[] = value
    return list.map((item) => String(item)).filter((item) => item !== '')
  }
  if (typeof value !== 'string') return []
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/**
 * 把客户端来的键值对整理成对象。
 * 三种形状都要认，否则会静默丢字段（踩过）：
 *   - 表单的「每行 KEY=VALUE」多行字符串
 *   - 字符串数组
 *   - **快照回传的原始对象**（行内操作会走到这里）
 * @param value - 任意一种形状。
 * @returns 解析后的对象；空输入返回 undefined。
 */
export function toRecord(value: unknown): Record<string, string> | undefined {
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, String(item)] as const)
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
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const
    })
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}
