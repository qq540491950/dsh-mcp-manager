/**
 * 记录 ↔ 草稿 ↔ 提交载荷的整理。**纯函数**：不碰 React、不碰 DOM。
 *
 * 这里有一个线上踩过的坑，是整个插件的核心教训之一：
 * 快照里 `env`/`headers` 是**对象**，而宿主 `normalizeRow()` 只认"多行文本 / 字符串数组"。
 * 行内操作（启停/删除）曾经把整个数组回传给宿主重建，于是对象的 `headers` 被静默清空
 * —— context7 的 `Authorization` 就是这么丢的（README 2.4 / AGENTS 2.5）。
 *
 * 所以这里严格分两条路：
 *   · 行内操作 → 只带 `{ serverName, ... }`（宿主定点改，字段不可能丢）；
 *   · 表单提交 → `serverOfExisting()` 把对象**转成宿主认识的文本形状**再回传。
 */
import { asRecord, asText, isRecord } from '../../shared/guards'
import type { ServerSnapshot, Snapshot } from '../../shared/types'

/** 表单里的一份可编辑草稿（全部是字符串，多行字段用换行分隔）。 */
export interface Draft {
  rowId?: string | undefined
  disabled: boolean
  serverName: string
  transport: string
  url: string
  command: string
  args: string
  env: string
  headers: string
  cwd: string
}

/** 表单提交给宿主的服务器对象（`op: "save"`）。 */
export interface ServerPayload {
  rowId?: string | undefined
  disabled: boolean
  serverName: string
  transport: string
  url?: string
  command?: string
  args?: string
  env?: string
  cwd?: string
  headers?: string
}

/** 一行服务器配置 → 目标摘要（URL 或命令行）。 */
export function targetOf(config: Record<string, unknown>): string {
  if (config.transport === 'stdio') {
    const args = Array.isArray(config.args) ? (config.args as unknown[]).map((item) => asText(item)) : []
    const parts = [asText(config.command), ...args].filter((part) => part !== '')
    return parts.join(' ') || '(未填写 command)'
  }
  return asText(config.url) || '(未填写 url)'
}

/** 对象 → `KEY=VALUE` 多行文本。值一律按标量读（对象/数组按"没写"处理）。 */
export function pairsToText(value: unknown): string {
  if (!isRecord(value)) return ''
  return Object.entries(value)
    .map(([key, item]) => `${key}=${asText(item)}`)
    .join('\n')
}

/** 记录 → 可编辑草稿。 */
export function draftOf(server: ServerSnapshot): Draft {
  const config = asRecord(server.config)
  const args = config.args
  return {
    rowId: server.rowId,
    disabled: server.disabled === true,
    serverName: asText(config.serverName),
    transport: config.transport === 'stdio' ? 'stdio' : 'streamable-http',
    url: asText(config.url),
    command: asText(config.command),
    args: Array.isArray(args) ? (args as unknown[]).map((item) => asText(item)).join('\n') : '',
    env: pairsToText(config.env),
    headers: pairsToText(config.headers),
    cwd: asText(config.cwd),
  }
}

/** 草稿 → 服务端契约的服务器对象。 */
export function serverOf(draft: Draft): ServerPayload {
  const base: ServerPayload = {
    rowId: draft.rowId,
    disabled: draft.disabled,
    serverName: draft.serverName.trim(),
    transport: draft.transport,
  }
  if (draft.transport === 'stdio') {
    return { ...base, command: draft.command.trim(), args: draft.args, env: draft.env, cwd: draft.cwd.trim() }
  }
  return { ...base, url: draft.url.trim(), headers: draft.headers }
}

/**
 * 服务器记录 → **旧版宿主**认识的扁平形状（`op: "save"` 用）。
 * 关键：env / headers / args 一律转成宿主认识的「多行文本 / 换行文本」。
 * 快照里它们是对象，直接回传会被旧宿主的解析器当成"非字符串非数组"而**静默清空**
 * ——线上就是这里把 context7 的 Authorization 头弄丢的。
 */
export function serverOfExisting(server: ServerSnapshot): Record<string, unknown> {
  const config = asRecord(server.config)
  const flat: Record<string, unknown> = { ...config, rowId: server.rowId, disabled: server.disabled === true }
  if (config.env !== undefined) flat.env = pairsToText(config.env)
  if (config.headers !== undefined) flat.headers = pairsToText(config.headers)
  if (Array.isArray(config.args)) flat.args = (config.args as unknown[]).map((item) => asText(item)).join('\n')
  return flat
}

/** 能力协商：宿主是否支持某项能力（旧宿主只能退回整数组提交）。 */
export function supports(snapshot: Snapshot | null | undefined, capability: string): boolean {
  return Array.isArray(snapshot?.capabilities) && snapshot.capabilities.includes(capability)
}

/** 新增时给一个不会撞车的默认名。 */
export function suggestName(servers: ServerSnapshot[]): string {
  const taken = new Set(servers.map((server) => asRecord(server.config).serverName))
  for (let index = 1; index < 100; index += 1) {
    const candidate = `server-${String(index)}`
    if (!taken.has(candidate)) return candidate
  }
  return 'server'
}
