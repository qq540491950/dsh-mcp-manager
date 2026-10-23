/**
 * 宿主半边（Host half）——MCP 管理器的数据面。
 *
 * 数据模型（v0.3.0 起）：
 *   - 每台 MCP 是 profile `cordis.patch.yml` 里的一条**顶层** Loader 条目；
 *   - 本插件新增的条目写成 `- insert: [ { id, name, config } ]`；
 *   - 本插件管理的外部条目写成 `- id: X, name, config` 覆写行；
 *   - 所有受控行放在一个 marker 块里，由 `patch-writer.ts` 只替换块内内容。
 *
 * 为什么不再用 `cordis:group`：`configEditor.edit()` 只能改已存在条目，不能新增/删除；
 * `loader.create()/remove()` 会整份重写 YAML。旧方案用一个 group 数组绕开限制，
 * 但用户要求每台 MCP 都像官方模板一样以 `insert` 出现。v0.3.0 只保留一个版本用于
 * 迁移旧 group（清空它的 config），之后会删除 group 声明。
 *
 * 读路径：`configEditor.entries()/configuration()` 拿顶层条目和原始 config
 * （保留 `!!js` 标记）；写路径：`patch-writer.ts` + `managed-block.ts`。
 */
import { GROUP_ID, MCP_PACKAGE, ROUTE } from '../shared/constants.ts'
import { isJsExpr } from '../shared/expr.ts'
import { asRecord, asText, isRecord, readString } from '../shared/guards.ts'
import { locateManagedBlock } from '../shared/managed-block.ts'
import type { ManagedManifest, ManagedRecord } from '../shared/managed-block.ts'
import { normalizeRow } from './rows.ts'
import { readPatch, writeManagedBlock } from './patch-writer.ts'
import type { HmrLike } from './patch-writer.ts'
import type { ConfigLayer, EntryRow, HostContext, LoaderEntry, LogMessage, ToolsService } from './service-types.ts'
import type {
  FailureRecord,
  FiberPhase,
  LegacyState,
  ProbeRecord,
  ServerSnapshot,
  Snapshot,
  ToolRecord,
} from '../shared/types.ts'

/** 单条失败原文的最大长度。 */
const FAILURE_MESSAGE_LIMIT = 500
/** 最多跟踪多少台服务器的失败记录。 */
const FAILURE_SERVER_LIMIT = 64
/** mcp-client 的日志前缀：`mcp-client(<serverName>): <detail>`。 */
const MCP_LOG_LINE = /^mcp-client\(([^)]+)\):\s*([\s\S]*)$/
/** 恢复信号：同一条连接实例重连成功后 mcp-client 会打印这一行。 */
const MCP_RECOVERED = /^reconnected and re-synced tools\b/
/** 主动探测的冷连接预算。 */
const PROBE_TIMEOUT_MS = 8000
/** 探测结果里附带的服务端响应片段上限。 */
const PROBE_BODY_LIMIT = 160
/** 官方 SDK 的 legacy 协议首选；modern era 走 server/discover，本探测不覆盖。 */
const PROBE_PROTOCOL_VERSION = '2025-11-25'
const PROBE_BODY_LIMIT_BYTES = 64 * 1024
const PROBE_MAX_CHUNKS = 4
/** 快照里每台服务器最多列出多少个工具名。 */
const TOOL_NAME_LIMIT = 200
/** mcp-client 注册给模型的工具名前缀。 */
const MCP_TOOL_PREFIX = 'mcp__'
/** cordis FiberState → 本插件相位。 */
const FIBER_PHASE: readonly FiberPhase[] = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const CAPABILITIES = [
  'patchInsert',
  'add',
  'update',
  'remove',
  'setEnabled',
  'adopt',
  'release',
  'probe',
  'tools',
  'legacyMigration',
]

export const name = 'dsh-mcp-manager'
/** 依赖在 apply 内用 ctx.inject 声明，便于缺失服务时优雅降级。 */
export const inject: string[] = []

function emptyManifest(): ManagedManifest {
  return { version: 1, entries: [] }
}

/** 把任意抛出物整理成一句话。Node 的 fetch 把网络层原因包在 cause 里。 */
function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    const cause: unknown = error.cause
    if (cause instanceof Error && cause.message !== '') return cause.message
    return error.message
  }
  return String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function apply(ctx: HostContext): void {
  ctx.inject(['connection', 'configEditor', 'loader'], (scope) => {
    const documentPath = scope.configEditor.documentPath
    const hmr = (typeof scope.get === 'function' ? scope.get('hmr') : undefined) as HmrLike | undefined

    /** 每台服务器最近一次失败的原文（按 serverName）。 */
    const failures = new Map<string, FailureRecord>()
    /** 每台服务器最近一次主动探测（按 Loader entry id，避免同名冲突）。 */
    const probes = new Map<string, ProbeRecord>()

    const captureLog = (message: LogMessage): void => {
      const line = message.args?.[0]
      if (typeof line !== 'string') return
      const matched = MCP_LOG_LINE.exec(line)
      if (matched === null) return
      const serverName = matched[1] ?? ''
      if (serverName === '') return
      const detail = (matched[2] ?? '').trim()
      if (message.type === 'error' || message.type === 'warn') {
        const previous = failures.get(serverName)
        failures.delete(serverName)
        failures.set(serverName, {
          message: detail.slice(0, FAILURE_MESSAGE_LIMIT),
          level: message.type,
          at: typeof message.ts === 'number' ? message.ts : Date.now(),
          count: (previous?.count ?? 0) + 1,
        })
        while (failures.size > FAILURE_SERVER_LIMIT) {
          const oldest = failures.keys().next().value
          if (oldest === undefined) break
          failures.delete(oldest)
        }
        return
      }
      if (message.type === 'info' && MCP_RECOVERED.test(detail)) failures.delete(serverName)
    }

    if (typeof scope.logger?.exporter === 'function') {
      scope.logger.exporter({ levels: { default: 3 }, export: captureLog })
    }

    const toolsService = (typeof scope.get === 'function' ? scope.get('tools') : scope.tools) as
      ToolsService | undefined

    const toolsOf = (serverName: string): ToolRecord | undefined => {
      if (typeof toolsService?.schemas !== 'function' || serverName === '') return undefined
      const prefix = `${MCP_TOOL_PREFIX}${serverName}__`
      const matched: string[] = []
      for (const schema of toolsService.schemas()) {
        const raw = schema?.name
        const toolName = typeof raw === 'string' ? raw : ''
        if (toolName.startsWith(prefix)) matched.push(toolName)
      }
      matched.sort()
      const truncated = matched.length > TOOL_NAME_LIMIT
      return { count: matched.length, names: truncated ? matched.slice(0, TOOL_NAME_LIMIT) : matched, truncated }
    }

    const phaseOf = (entry: LoaderEntry): FiberPhase =>
      entry.options.disabled === true
        ? 'stopped'
        : entry.fiber === undefined
          ? 'pending'
          : (FIBER_PHASE[entry.fiber.state] ?? 'pending')

    /** 顶层、可寻址的 MCP 条目。`configEditor.entries()` 已过滤重复 id。 */
    const topLevelEntries = (): LoaderEntry[] =>
      scope.configEditor.entries().filter((entry) => {
        if (entry.options.name !== MCP_PACKAGE) return false
        const id = entry.options.id
        return typeof id === 'string' && id !== ''
      })

    const layersOf = (): Map<string, ConfigLayer> =>
      new Map(scope.configEditor.configuration().map((layer) => [layer.entry.options.id ?? '', layer]))

    /**
     * 取条目的**原始** config（保留 `!!js` 标记）。
     * 覆写层非空时以覆写为准；否则用组合后的 inherited；最后才退回 entry.options.config。
     */
    const rawConfigOf = (entry: LoaderEntry, layers: Map<string, ConfigLayer>): Record<string, unknown> => {
      const layer = layers.get(entry.options.id ?? '')
      const override = layer?.override
      if (isRecord(override) && Object.keys(override).length > 0) return override
      if (isRecord(layer?.inherited)) return layer.inherited
      return asRecord(entry.options.config)
    }

    const groupEntries = (): LoaderEntry[] =>
      [...scope.loader.entries()].filter((entry) => entry.options.id === GROUP_ID)

    const groupRows = (): EntryRow[] => {
      const groups = groupEntries()
      if (groups.length !== 1) return []
      const entry = groups[0]
      if (entry === undefined) return []
      const layer = scope.configEditor.configuration().find((item) => item.entry.options.id === GROUP_ID)
      const raw = Array.isArray(layer?.override)
        ? layer.override
        : Array.isArray(layer?.inherited)
          ? layer.inherited
          : Array.isArray(entry.options.config)
            ? entry.options.config
            : []
      return raw.map((item) => asRecord(item))
    }

    const legacyState = (): LegacyState => {
      const groups = groupEntries()
      if (groups.length > 1) return { state: 'duplicated', count: groupRows().length }
      if (groups.length === 0) return { state: 'none', count: 0 }
      const count = groupRows().length
      return count > 0 ? { state: 'needs-migration', count } : { state: 'none', count: 0 }
    }

    /** 迁移后的一个版本里要保留一条 `- id: mcp-manager, config: []` 覆写，防止旧列表复活。 */
    const legacyFlag = (manifest: ManagedManifest): boolean => {
      const groups = groupEntries()
      if (groups.length !== 1) return false
      return manifest.legacyGroup === true || groupRows().length > 0
    }

    const readManifest = async (): Promise<{ manifest: ManagedManifest; patchError?: string }> => {
      try {
        const text = await readPatch(documentPath)
        const block = locateManagedBlock(text)
        return { manifest: block?.manifest ?? emptyManifest() }
      } catch (error) {
        return { manifest: emptyManifest(), patchError: reasonOf(error) }
      }
    }

    const recordsFrom = (
      manifest: ManagedManifest,
      entries: LoaderEntry[],
      layers: Map<string, ConfigLayer>,
    ): ManagedRecord[] => {
      const byId = new Map(entries.map((entry) => [entry.options.id ?? '', entry]))
      const records: ManagedRecord[] = []
      for (const ref of manifest.entries) {
        const entry = byId.get(ref.id)
        if (entry === undefined) continue
        records.push({
          id: ref.id,
          kind: ref.kind,
          config: rawConfigOf(entry, layers),
          disabled: entry.options.disabled === true,
        })
      }
      return records
    }

    const snapshot = async (): Promise<Snapshot> => {
      const { manifest, patchError } = await readManifest()
      const entries = topLevelEntries()
      const layers = layersOf()
      const byId = new Map(entries.map((entry) => [entry.options.id ?? '', entry]))
      const refs = new Map(manifest.entries.map((ref) => [ref.id, ref]))
      const ordered: Array<{ entry: LoaderEntry; ref?: (typeof manifest.entries)[number] }> = []
      for (const ref of manifest.entries) {
        const entry = byId.get(ref.id)
        if (entry !== undefined) ordered.push({ entry, ref })
      }
      for (const entry of entries) {
        const id = entry.options.id ?? ''
        if (!refs.has(id)) ordered.push({ entry })
      }
      const servers: ServerSnapshot[] = ordered.map(({ entry, ref }, index) => {
        const id = entry.options.id ?? ''
        const config = rawConfigOf(entry, layers)
        const serverName = asText(config.serverName)
        const server: ServerSnapshot = {
          index,
          id,
          serverName,
          source: ref?.kind ?? 'external',
          config,
          disabled: entry.options.disabled === true,
          phase: phaseOf(entry),
        }
        const failure = failures.get(serverName)
        if (failure !== undefined) server.error = { ...failure }
        const probe = probes.get(id)
        if (probe !== undefined) server.probe = { ...probe }
        const tools = toolsOf(serverName)
        if (tools !== undefined) server.tools = tools
        return server
      })
      const missing = manifest.entries.filter((ref) => !byId.has(ref.id)).map((ref) => ref.id)
      return {
        servers,
        ...(missing.length > 0 ? { missing } : {}),
        legacy: legacyState(),
        profilePath: documentPath,
        ...(patchError === undefined ? {} : { patchError }),
        mcpPackage: MCP_PACKAGE,
        capabilities: CAPABILITIES,
      }
    }

    const waitFor = async (predicate: () => boolean): Promise<void> => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (predicate()) return
        await sleep(100)
      }
    }

    const commit = async (
      records: ManagedRecord[],
      legacyGroup: boolean,
      predicate: () => boolean,
    ): Promise<Snapshot> => {
      await writeManagedBlock({ documentPath, hmr }, { records, legacyGroup })
      failures.clear()
      probes.clear()
      await waitFor(predicate)
      return snapshot()
    }

    let writeQueue: Promise<void> = Promise.resolve()
    const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
      const run = writeQueue.then(operation, operation)
      writeQueue = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    }

    const nameOf = (entry: LoaderEntry, layers: Map<string, ConfigLayer>): string =>
      asText(rawConfigOf(entry, layers).serverName)

    const assertNameFree = (name: string, excludeId?: string): void => {
      const layers = layersOf()
      for (const entry of topLevelEntries()) {
        const id = entry.options.id ?? ''
        if (id === excludeId) continue
        if (nameOf(entry, layers) === name) {
          throw new Error(`MCP 服务器名重复："${name}"；同一作用域内 serverName 必须唯一`)
        }
      }
    }

    const uniqueId = (serverName: string, entries: LoaderEntry[], records: ManagedRecord[]): string => {
      const taken = new Set<string>()
      for (const entry of entries) {
        const id = entry.options.id
        if (typeof id === 'string' && id !== '') taken.add(id)
      }
      for (const record of records) taken.add(record.id)
      const base = `mcp-${serverName}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48) || 'mcp-server'
      let candidate = base
      for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${String(suffix)}`
      return candidate
    }

    const addServer = async (server: unknown): Promise<Snapshot> => {
      const { manifest, patchError } = await readManifest()
      if (patchError !== undefined) throw new Error(patchError)
      const row = normalizeRow(server)
      const config = asRecord(row.config)
      const serverName = asText(config.serverName)
      assertNameFree(serverName)
      const entries = topLevelEntries()
      const records = recordsFrom(manifest, entries, layersOf())
      const id = uniqueId(serverName, entries, records)
      row.id = id
      records.push({ id, kind: 'insert', config, disabled: row.disabled === true })
      return commit(records, legacyFlag(manifest), () => topLevelEntries().some((entry) => entry.options.id === id))
    }

    const updateServer = async (entryId: string, server: unknown): Promise<Snapshot> => {
      const { manifest, patchError } = await readManifest()
      if (patchError !== undefined) throw new Error(patchError)
      const ref = manifest.entries.find((item) => item.id === entryId)
      if (ref === undefined) throw new Error('这是外部 MCP；请先“接管”再修改')
      const entries = topLevelEntries()
      const layers = layersOf()
      const entry = entries.find((item) => item.options.id === entryId)
      const records = recordsFrom(manifest, entries, layers)
      const record = records.find((item) => item.id === entryId)
      if (record === undefined) throw new Error(`找不到受管条目 "${entryId}"；请刷新页面或先移除`)
      const row = normalizeRow(
        { ...asRecord(server), entryId },
        entry === undefined ? record.config : rawConfigOf(entry, layers),
      )
      const config = asRecord(row.config)
      const serverName = asText(config.serverName)
      assertNameFree(serverName, entryId)
      record.config = config
      record.disabled = row.disabled === true
      return commit(records, legacyFlag(manifest), () => topLevelEntries().some((item) => item.options.id === entryId))
    }

    const removeServer = async (entryId: string): Promise<Snapshot> => {
      const { manifest, patchError } = await readManifest()
      if (patchError !== undefined) throw new Error(patchError)
      const ref = manifest.entries.find((item) => item.id === entryId)
      if (ref === undefined) throw new Error('外部 MCP 不能由本插件删除；可先“接管”再取消接管')
      if (ref.kind !== 'insert') throw new Error('覆写行不能删除原条目；请用“取消接管”恢复原配置')
      const records = recordsFrom(manifest, topLevelEntries(), layersOf()).filter((item) => item.id !== entryId)
      return commit(
        records,
        legacyFlag(manifest),
        () => !topLevelEntries().some((entry) => entry.options.id === entryId),
      )
    }

    const setEnabled = async (entryId: string, enabled: boolean): Promise<Snapshot> => {
      const { manifest, patchError } = await readManifest()
      if (patchError !== undefined) throw new Error(patchError)
      const entries = topLevelEntries()
      const layers = layersOf()
      const records = recordsFrom(manifest, entries, layers)
      let record = records.find((item) => item.id === entryId)
      if (record === undefined) {
        const entry = entries.find((item) => item.options.id === entryId)
        if (entry === undefined) throw new Error(`找不到条目 "${entryId}"`)
        record = {
          id: entryId,
          kind: 'override',
          config: rawConfigOf(entry, layers),
          disabled: !enabled,
        }
        records.push(record)
      } else {
        record.disabled = !enabled
      }
      return commit(records, legacyFlag(manifest), () =>
        topLevelEntries().some((entry) => entry.options.id === entryId),
      )
    }

    const adoptServer = async (entryId: string): Promise<Snapshot> => {
      const { manifest, patchError } = await readManifest()
      if (patchError !== undefined) throw new Error(patchError)
      if (manifest.entries.some((item) => item.id === entryId)) throw new Error('这台 MCP 已经被接管')
      const entries = topLevelEntries()
      const entry = entries.find((item) => item.options.id === entryId)
      if (entry === undefined) throw new Error(`找不到 MCP 条目 "${entryId}"`)
      const records = recordsFrom(manifest, entries, layersOf())
      records.push({
        id: entryId,
        kind: 'override',
        config: rawConfigOf(entry, layersOf()),
        disabled: entry.options.disabled === true,
      })
      return commit(records, legacyFlag(manifest), () => manifest.entries.some((item) => item.id === entryId))
    }

    const releaseServer = async (entryId: string): Promise<Snapshot> => {
      const { manifest, patchError } = await readManifest()
      if (patchError !== undefined) throw new Error(patchError)
      const ref = manifest.entries.find((item) => item.id === entryId)
      if (ref === undefined) throw new Error('这台 MCP 没有被本插件接管')
      if (ref.kind !== 'override') throw new Error('insert 条目不能“取消接管”；请直接删除')
      const records = recordsFrom(manifest, topLevelEntries(), layersOf()).filter((item) => item.id !== entryId)
      return commit(records, legacyFlag(manifest), () => true)
    }

    const migrateLegacy = async (): Promise<Snapshot> => {
      const { manifest, patchError } = await readManifest()
      if (patchError !== undefined) throw new Error(patchError)
      const groups = groupEntries()
      if (groups.length > 1) throw new Error(`旧版 group 条目「${GROUP_ID}」被声明了两次；请先删掉 profile 里那一行`)
      if (groups.length === 0) return snapshot()
      const rows = groupRows()
      if (rows.length === 0) return snapshot()
      const entries = topLevelEntries()
      const layers = layersOf()
      const records = recordsFrom(manifest, entries, layers)
      const usedNames = new Set(entries.map((entry) => nameOf(entry, layers)))
      const expected: string[] = []
      for (const row of rows) {
        if (row.name !== MCP_PACKAGE) {
          throw new Error('旧 group 里含有非 MCP 条目，无法自动迁移；请先手动处理')
        }
        const config = asRecord(row.config)
        const serverName = asText(config.serverName)
        if (!SERVER_NAME_PATTERN.test(serverName)) throw new Error(`旧容器里有非法 serverName：${serverName}`)
        if (usedNames.has(serverName)) throw new Error(`迁移时发现重复 serverName：${serverName}`)
        usedNames.add(serverName)
        const preferred = typeof row.id === 'string' && row.id !== '' ? row.id : undefined
        const id =
          preferred !== undefined && !records.some((record) => record.id === preferred)
            ? preferred
            : uniqueId(serverName, entries, records)
        records.push({ id, kind: 'insert', config, disabled: row.disabled === true })
        expected.push(id)
      }
      return commit(
        records,
        true,
        () =>
          expected.every((id) => topLevelEntries().some((entry) => entry.options.id === id)) &&
          groupRows().length === 0,
      )
    }

    const jsonRpcMessage = (text: string): Record<string, unknown> | undefined => {
      const candidates: string[] = []
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) candidates.push(trimmed.slice(5).trim())
        else if (trimmed !== '') candidates.push(trimmed)
      }
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
      for (const candidate of candidates) {
        try {
          const value: unknown = JSON.parse(candidate)
          if (isRecord(value) && value.jsonrpc === '2.0') return value
        } catch {
          // 不是完整 JSON 的块继续看下一块。
        }
      }
      return undefined
    }

    const readProbeBody = async (response: Response): Promise<string> => {
      if (response.body === null) return ''
      const reader = response.body.getReader() as {
        read(): Promise<{ value?: Uint8Array | undefined; done?: boolean | undefined }>
        cancel(): Promise<void>
      }
      const decoder = new TextDecoder()
      let text = ''
      try {
        for (let index = 0; index < PROBE_MAX_CHUNKS && text.length < PROBE_BODY_LIMIT_BYTES; index += 1) {
          const { value, done } = await reader.read()
          if (done === true) break
          if (value !== undefined) text += decoder.decode(value, { stream: true })
          if (jsonRpcMessage(text) !== undefined) break
        }
        text += decoder.decode()
        return text.slice(0, PROBE_BODY_LIMIT_BYTES)
      } finally {
        try {
          void reader.cancel().catch(() => {})
        } catch {
          // 取消失败不影响判定。
        }
      }
    }

    const shortenBody = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, PROBE_BODY_LIMIT)

    const probeConfig = async (config: Record<string, unknown>): Promise<ProbeRecord> => {
      const at = Date.now()
      if (isJsExpr(config.url)) {
        return { connected: null, status: null, detail: 'url 是 !!js 表达式：条目激活前无法求值，暂不能探测', at }
      }
      const url = readString(config, 'url')
      if (readString(config, 'transport') !== 'streamable-http' || url === undefined || url === '') {
        return {
          connected: null,
          status: null,
          detail: '仅能探测 streamable-http（stdio 走子进程，无法从宿主探测）',
          at,
        }
      }
      const extraHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(asRecord(config.headers))) {
        if (isJsExpr(value)) {
          return {
            connected: null,
            status: null,
            detail: `请求头 ${key} 是 !!js 表达式：条目激活前无法求值，暂不能探测`,
            at,
          }
        }
        extraHeaders[key] = String(value)
      }
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, PROBE_TIMEOUT_MS)
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            ...extraHeaders,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: PROBE_PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: 'dsh-mcp-manager', version: '0.3.0' },
            },
          }),
          signal: controller.signal,
        })
        const body = await readProbeBody(response)
        const status = response.status
        if (!response.ok) {
          return {
            connected: false,
            status,
            detail: `HTTP ${String(status)}${body === '' ? '' : `：${shortenBody(body)}`}`,
            at,
          }
        }
        const message = jsonRpcMessage(body)
        if (message !== undefined) {
          if ('error' in message) {
            const error = asRecord(message.error)
            const detail = [error.code, error.message].filter((item) => item !== undefined && item !== '').join('：')
            return {
              connected: false,
              status,
              detail: `HTTP ${String(status)}，MCP initialize 被拒绝${detail === '' ? '' : `：${detail}`}`,
              at,
            }
          }
          if ('result' in message) {
            const version = readString(asRecord(message.result), 'protocolVersion')
            return {
              connected: true,
              status,
              detail: version === undefined ? `HTTP ${String(status)}` : `HTTP ${String(status)}，MCP ${version}`,
              at,
            }
          }
        }
        const type = response.headers.get('content-type') ?? '未知 content-type'
        return { connected: false, status, detail: `HTTP ${String(status)}，但响应不是 MCP（${type}）`, at }
      } catch (error) {
        return {
          connected: false,
          status: null,
          detail: controller.signal.aborted
            ? `超时（${String(PROBE_TIMEOUT_MS / 1000)}s）：服务器没有响应`
            : `请求失败：${reasonOf(error)}`,
          at,
        }
      } finally {
        clearTimeout(timer)
      }
    }

    const runProbes = async (only?: string): Promise<Snapshot> => {
      const layers = layersOf()
      const targets = topLevelEntries().filter((entry) => {
        const id = entry.options.id ?? ''
        const name = nameOf(entry, layers)
        return entry.options.disabled !== true && (only === undefined || id === only || name === only)
      })
      if (only !== undefined && targets.length === 0) {
        throw new Error(`找不到启用中的 MCP 条目 "${only}"；配置可能已被外部修改，请刷新页面后重试`)
      }
      const results = await Promise.all(
        targets.map(async (entry) => {
          const id = entry.options.id ?? ''
          const evaluated = entry.fiber === undefined ? rawConfigOf(entry, layers) : asRecord(entry.fiber.config)
          return [id, await probeConfig(evaluated)] as const
        }),
      )
      for (const [id, result] of results) probes.set(id, result)
      return snapshot()
    }

    const respond = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })

    const resolveEntryId = (payload: Record<string, unknown>): string => {
      const id = readString(payload, 'entryId')
      if (id !== undefined && id !== '') return id
      const serverName = readString(payload, 'serverName')
      if (serverName !== undefined && serverName !== '') {
        const layers = layersOf()
        const entry = topLevelEntries().find((item) => nameOf(item, layers) === serverName)
        if (entry?.options.id) return entry.options.id
      }
      throw new Error('entryId 或 serverName 不能为空')
    }

    const handler = async (request: Request): Promise<Response> => {
      try {
        if (request.method === 'GET') return respond(200, { ok: true, data: await snapshot() })
        const payload = asRecord(await request.json())
        switch (readString(payload, 'op')) {
          case 'add':
            return respond(200, { ok: true, data: await serialized(() => addServer(payload.server)) })
          case 'update':
            return respond(200, {
              ok: true,
              data: await serialized(() => updateServer(resolveEntryId(payload), payload.server)),
            })
          case 'remove':
            return respond(200, { ok: true, data: await serialized(() => removeServer(resolveEntryId(payload))) })
          case 'setEnabled':
            return respond(200, {
              ok: true,
              data: await serialized(() => setEnabled(resolveEntryId(payload), payload.enabled === true)),
            })
          case 'adopt':
            return respond(200, { ok: true, data: await serialized(() => adoptServer(resolveEntryId(payload))) })
          case 'release':
            return respond(200, { ok: true, data: await serialized(() => releaseServer(resolveEntryId(payload))) })
          case 'migrate':
            return respond(200, { ok: true, data: await serialized(migrateLegacy) })
          case 'probe': {
            const target = readString(payload, 'entryId') ?? readString(payload, 'serverName')
            return respond(200, { ok: true, data: await runProbes(target) })
          }
          case 'save':
          case 'saveRows':
            throw new Error('客户端与宿主版本不一致：v0.3.0 已改用顶层 insert/override 协议；请刷新页面并重启 DSH')
          default:
            return respond(400, { ok: false, error: `未知操作：${String(payload.op)}` })
        }
      } catch (error) {
        return respond(409, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }

    scope.connection.fetch.register({
      path: ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: handler,
    })
  })
}
