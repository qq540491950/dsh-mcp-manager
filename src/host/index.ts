/**
 * 宿主半边（Host half）——MCP 管理器的数据面。
 *
 * 数据模型（v0.4.0 起）：**profile 补丁文件就是数据库**。
 *   - 每台 MCP 是 profile `cordis.patch.yml` 里的一条**普通顶层 Loader 条目**，与手写、
 *     市场插件写的完全同形——没有受控块、没有 manifest、没有"接管"概念；
 *   - 本插件按 **id 寻址**直接增删改那些行（`patch-doc.ts` 找字节区间，
 *     `patch-writer.ts` 在文件锁 + 原子替换下只重写目标行，其余字节逐字保留）；
 *   - 声明在**别的层**（其他 bundle / home patch）的条目：保存/启停时自动追加一条
 *     顶层覆写行（`- id: X`），原始声明无法由本插件删除——这是分层配置的边界。
 *
 * 读路径：`configEditor.entries()/configuration()` 拿顶层条目和原始 config
 * （保留 `!!js` 标记）；写路径：`patch-writer.ts` + `patch-doc.ts`；
 * 写完不调用任何 Loader API——`dsh-hmr` 监听该文件，秒级重组合，这里只轮询等它生效。
 */
import { GROUP_ID, MCP_PACKAGE, ROUTE } from '../shared/constants.ts'
import { isJsExpr } from '../shared/expr.ts'
import { asRecord, asText, isRecord, readString } from '../shared/guards.ts'
import { stripManagedMarkers } from '../shared/managed-block.ts'
import {
  entryItemOf,
  flowScalar,
  renderEntryItem,
  renderInsertLine,
  renderKillLine,
  scanPatchDoc,
} from '../shared/patch-doc.ts'
import type { AddressedEntry, PatchEdit, ScanResult } from '../shared/patch-doc.ts'
import { normalizeRow } from './rows.ts'
import { editPatch, readPatch } from './patch-writer.ts'
import type { HmrLike } from './patch-writer.ts'
import type { ConfigLayer, EntryRow, HostContext, LoaderEntry, LogMessage, ToolsService } from './service-types.ts'
import type {
  FailureRecord,
  FiberPhase,
  LegacyState,
  ProbeRecord,
  ServerSnapshot,
  ServerSource,
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
/**
 * 能力协商。`patchInsert` 保留给 v0.3 客户端做版本探测（它的写操作会得到明确的
 * "已移除"错误）；`nativeRows` 是 v0.4 客户端的启用门槛。
 */
const CAPABILITIES = [
  'patchInsert',
  'nativeRows',
  'add',
  'update',
  'remove',
  'setEnabled',
  'probe',
  'tools',
  'legacyMigration',
]

export const name = 'dsh-mcp-manager'
/** 依赖在 apply 内用 ctx.inject 声明，便于缺失服务时优雅降级。 */
export const inject: string[] = []

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

    /** 读 profile 补丁文件并扫描条目声明；读不到/扫描异常时降级为"全部外部 + 禁写"。 */
    const readDoc = async (): Promise<{ scan: ScanResult; patchError?: string }> => {
      try {
        const text = await readPatch(documentPath)
        return { scan: scanPatchDoc(text) }
      } catch (error) {
        return { scan: { entries: [], unaddressable: 0 }, patchError: reasonOf(error) }
      }
    }

    /** 写操作的前置：文件必须可读可扫，否则拒绝写入（安全失败）。 */
    const requireDoc = async (): Promise<ScanResult> => {
      const doc = await readDoc()
      if (doc.patchError !== undefined) {
        throw new Error(`无法读取 profile 补丁文件，写入已禁用：${doc.patchError}`)
      }
      return doc.scan
    }

    const snapshot = async (): Promise<Snapshot> => {
      const doc = await readDoc()
      const entries = topLevelEntries()
      const layers = layersOf()
      const declared = new Map<string, AddressedEntry[]>()
      if (doc.patchError === undefined) {
        for (const item of doc.scan.entries) {
          if (item.id === undefined) continue
          const list = declared.get(item.id)
          if (list === undefined) declared.set(item.id, [item])
          else list.push(item)
        }
      }
      const servers: ServerSnapshot[] = entries.map((entry, index) => {
        const id = entry.options.id ?? ''
        const config = rawConfigOf(entry, layers)
        const serverName = asText(config.serverName)
        const ranges = declared.get(id) ?? []
        const source: ServerSource =
          doc.patchError !== undefined
            ? 'external'
            : ranges.some((item) => item.style === 'insert')
              ? 'profile'
              : ranges.length > 0
                ? 'overridden'
                : 'external'
        const server: ServerSnapshot = {
          index,
          id,
          serverName,
          source,
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
      return {
        servers,
        legacy: legacyState(),
        profilePath: documentPath,
        ...(doc.patchError === undefined ? {} : { patchError: doc.patchError }),
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

    const applyEdits = async (edits: PatchEdit[]): Promise<void> => {
      await editPatch({ documentPath, hmr }, edits)
      failures.clear()
      probes.clear()
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

    /** 收集"已占用"的条目 id：Loader 里的 + 文件里声明过的（后者可能是被 warn 丢弃的死行）。 */
    const takenIds = (scan: ScanResult): Set<string> => {
      const taken = new Set<string>()
      for (const entry of topLevelEntries()) {
        const id = entry.options.id
        if (typeof id === 'string' && id !== '') taken.add(id)
      }
      for (const item of scan.entries) if (item.id !== undefined) taken.add(item.id)
      return taken
    }

    const uniqueId = (serverName: string, taken: Set<string>): string => {
      const base = `mcp-${serverName}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48) || 'mcp-server'
      let candidate = base
      for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${String(suffix)}`
      return candidate
    }

    /** 条目的**规范化文本**（键按名排序、递归），只用于"两份声明内容是否一致"的比较。 */
    const canonicalText = (value: unknown): string => {
      if (value === undefined) return 'undefined'
      if (Array.isArray(value)) return `[${value.map((item) => canonicalText(item)).join(',')}]`
      if (isRecord(value)) {
        return `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalText(value[key])}`)
          .join(',')}}`
      }
      return JSON.stringify(value)
    }

    /**
     * 「把 entryId 写成 config + disabled」所需的编辑。
     * 声明在文件里 → 原地重写那个区间；不在 → 追加一条顶层覆写行（外部条目的隐式接管）。
     * 同 id 多份声明：若恰是一条创建行 + 若干**同内容**的覆写行（扫描器还不认多行 flow
     * 的年代，官方美化整份文件后启停走了"追加覆写行"兜底留下的），合并结果是确定的——
     * 就地收拢为一份：改创建行、删多余覆写行；内容有任何差异仍然是歧义，拒绝写入。
     */
    const entryWriteEdit = (
      scan: ScanResult,
      entryId: string,
      config: Record<string, unknown>,
      disabled: boolean,
    ): PatchEdit[] => {
      const ranges = scan.entries.filter((item) => item.id === entryId)
      if (ranges.length > 1) {
        const inserts = ranges.filter((item) => item.style === 'insert')
        const overrides = ranges.filter((item) => item.style === 'override')
        const insert = inserts[0]
        const comparable = ranges.every((item) => item.flow?.value !== undefined)
        if (
          inserts.length === 1 &&
          insert !== undefined &&
          overrides.length >= 1 &&
          comparable &&
          ranges.every((item) => {
            const value = item.flow?.value
            return value?.name === MCP_PACKAGE && canonicalText(value.config) === canonicalText(config)
          })
        ) {
          const line = renderEntryItem({ id: entryId, config, disabled }, insert.style)
          return [
            {
              op: 'replace',
              start: insert.start,
              end: insert.end,
              line: insert.indent > 0 ? `${' '.repeat(insert.indent)}${line}` : line,
            },
            ...overrides.map((item): PatchEdit => ({ op: 'delete', start: item.start, end: item.end })),
          ]
        }
        throw new Error(
          `条目 "${entryId}" 在 profile 里被声明了 ${String(ranges.length)} 次；请先手工清理 cordis.patch.yml（每台 MCP 只保留一行声明）`,
        )
      }
      const target = ranges[0]
      if (target === undefined) {
        return [{ op: 'append', lines: [renderEntryItem({ id: entryId, config, disabled }, 'override')] }]
      }
      if (target.flow !== undefined) {
        if (target.flow.index === undefined) {
          // 整行就是这条条目（顶层 flow 裸行 = override；insert 分节里的 flow 裸行 = insert）。
          const line = renderEntryItem({ id: entryId, config, disabled }, target.style)
          return [
            {
              op: 'replace',
              start: target.start,
              end: target.end,
              line: target.indent > 0 ? `${' '.repeat(target.indent)}${line}` : line,
            },
          ]
        }
        // 单行 flow 的 insert 数组里的一个元素：整行重写，其余元素原样保留。
        const container = target.flow.value
        const list = Array.isArray(container.insert) ? [...(container.insert as unknown[])] : []
        list[target.flow.index] = entryItemOf({ id: entryId, config, disabled }, 'insert')
        return [{ op: 'replace', start: target.start, end: target.end, line: `- ${flowScalar({ insert: list })}` }]
      }
      const line = renderEntryItem({ id: entryId, config, disabled }, target.style)
      return [
        {
          op: 'replace',
          start: target.start,
          end: target.end,
          line: target.indent > 0 ? `${' '.repeat(target.indent)}${line}` : line,
        },
      ]
    }

    /** 删除 entryId 在本文件里的全部声明；嵌套条目删空父分节时连父分节一起删。 */
    const removalEdits = (scan: ScanResult, entryId: string): PatchEdit[] => {
      const ranges = scan.entries.filter((item) => item.id === entryId)
      if (ranges.length === 0) {
        throw new Error(
          `条目 "${entryId}" 的原始声明不在 profile 补丁文件里（由其他插件或补丁层声明），本插件无法删除；可以停用它`,
        )
      }
      const edits: PatchEdit[] = []
      const done = new Set<string>()
      for (const range of ranges) {
        if (range.flow !== undefined && range.flow.index !== undefined) {
          const container = range.flow.value
          const list = (Array.isArray(container.insert) ? [...(container.insert as unknown[])] : []).filter(
            (_item, index) => index !== range.flow?.index,
          )
          if (list.length === 0) edits.push({ op: 'delete', start: range.start, end: range.end })
          else
            edits.push({ op: 'replace', start: range.start, end: range.end, line: `- ${flowScalar({ insert: list })}` })
          done.add(String(range.start))
          continue
        }
        if (range.parent !== undefined && range.siblings <= 1) {
          const key = `parent-${String(range.parent.start)}`
          if (!done.has(key)) {
            done.add(key)
            edits.push({ op: 'delete', start: range.parent.start, end: range.parent.end })
          }
          continue
        }
        const key = String(range.start)
        if (!done.has(key)) {
          done.add(key)
          edits.push({ op: 'delete', start: range.start, end: range.end })
        }
      }
      return edits
    }

    const addServer = async (server: unknown): Promise<Snapshot> => {
      const scan = await requireDoc()
      const row = normalizeRow(server)
      const config = asRecord(row.config)
      assertNameFree(asText(config.serverName))
      const id = uniqueId(asText(config.serverName), takenIds(scan))
      await applyEdits([{ op: 'append', lines: [renderInsertLine({ id, config, disabled: row.disabled === true })] }])
      await waitFor(() => topLevelEntries().some((entry) => entry.options.id === id))
      return snapshot()
    }

    const updateServer = async (entryId: string, server: unknown): Promise<Snapshot> => {
      const scan = await requireDoc()
      const entries = topLevelEntries()
      const layers = layersOf()
      const entry = entries.find((item) => item.options.id === entryId)
      if (entry === undefined) throw new Error(`找不到 MCP 条目 "${entryId}"；请刷新页面后重试`)
      const row = normalizeRow({ ...asRecord(server), entryId }, rawConfigOf(entry, layers))
      const config = asRecord(row.config)
      assertNameFree(asText(config.serverName), entryId)
      await applyEdits(entryWriteEdit(scan, entryId, config, row.disabled === true))
      await waitFor(() => topLevelEntries().some((item) => item.options.id === entryId))
      return snapshot()
    }

    const setEnabled = async (entryId: string, enabled: boolean): Promise<Snapshot> => {
      const scan = await requireDoc()
      const entries = topLevelEntries()
      const layers = layersOf()
      const entry = entries.find((item) => item.options.id === entryId)
      if (entry === undefined) throw new Error(`找不到条目 "${entryId}"`)
      const config = rawConfigOf(entry, layers)
      await applyEdits(entryWriteEdit(scan, entryId, config, !enabled))
      await waitFor(() => topLevelEntries().some((item) => item.options.id === entryId))
      return snapshot()
    }

    const removeServer = async (entryId: string): Promise<Snapshot> => {
      const scan = await requireDoc()
      await applyEdits(removalEdits(scan, entryId))
      await waitFor(() => !topLevelEntries().some((entry) => entry.options.id === entryId))
      return snapshot()
    }

    const migrateLegacy = async (): Promise<Snapshot> => {
      const scan = await requireDoc()
      const groups = groupEntries()
      if (groups.length > 1) throw new Error(`旧版 group 条目「${GROUP_ID}」被声明了两次；请先删掉 profile 里那一行`)
      if (groups.length === 0) return snapshot()
      const rows = groupRows()
      if (rows.length === 0) return snapshot()
      const entries = topLevelEntries()
      const layers = layersOf()
      const usedNames = new Set(entries.map((entry) => nameOf(entry, layers)))
      const taken = takenIds(scan)
      const lines: string[] = []
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
        const id = preferred !== undefined && !taken.has(preferred) ? preferred : uniqueId(serverName, taken)
        taken.add(id)
        lines.push(renderInsertLine({ id, config, disabled: row.disabled === true }))
        expected.push(id)
      }
      const edits: PatchEdit[] = [{ op: 'append', lines }]
      // group 声明在本文件里 → 直接删掉声明行；在别的层 → 追加一条清空容器 config 的覆写行兜底。
      if (scan.entries.some((item) => item.id === GROUP_ID)) edits.push(...removalEdits(scan, GROUP_ID))
      else lines.push(renderKillLine())
      await applyEdits(edits)
      await waitFor(
        () =>
          expected.every((id) => topLevelEntries().some((entry) => entry.options.id === id)) &&
          groupRows().length === 0,
      )
      return snapshot()
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
              clientInfo: { name: 'dsh-mcp-manager', version: '0.4.1' },
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
          case 'migrate':
            return respond(200, { ok: true, data: await serialized(migrateLegacy) })
          case 'probe': {
            const target = readString(payload, 'entryId') ?? readString(payload, 'serverName')
            return respond(200, { ok: true, data: await runProbes(target) })
          }
          case 'adopt':
          case 'release':
            throw new Error(
              'v0.4.0 已移除「接管 / 取消接管」：profile 里的条目可直接编辑删除；外部条目保存或启停时会自动追加覆写行',
            )
          case 'save':
          case 'saveRows':
            throw new Error('客户端与宿主版本不一致：v0.4.0 已改用条目寻址协议；请刷新页面并重启 DSH')
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

    // 一次性清理 v0.3 遗留的 marker 注释行（纯美化）：寻址器把注释当透明，不清理也能正常
    // 读写，所以失败静默——最坏情况是文件里多三行没人看的注释。
    void serialized(async () => {
      try {
        await editPatch({ documentPath, hmr }, [{ op: 'transform', transform: stripManagedMarkers }])
      } catch {
        // 纯清理，不打扰用户。
      }
    }).catch(() => {})
  })
}
