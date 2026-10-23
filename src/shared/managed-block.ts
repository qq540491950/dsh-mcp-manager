/**
 * `cordis.patch.yml` 里的受控块：本插件只改两个 marker 之间的内容。
 *
 * 为什么不用 `yaml.dump(整份文件)`：Loader 的 `Include.write()` 会整份重写 YAML，
 * 把用户手写的 `insert:` 分节、注释和顺序压平（AGENTS 2.3）。这里采用
 * 「marker 之间替换」的写入方式，块外字节原样保留。
 *
 * 块内每行都是 flow 风格的 YAML（JSON 是 YAML 的子集）：
 *
 *   # >>> dsh-mcp-manager:managed
 *   # dsh-mcp-manager:manifest=[{"id":"mcp-ctx","kind":"insert"}]
 *   - {"insert":[{"id":"mcp-ctx","name":"@deepseek-ai/dsh-mcp-client","config":{...}}]}
 *   # <<< dsh-mcp-manager:managed
 *
 * `!!js` 标量写成 `!!js "表达式"`，与 Loader 的 entryList YAML 方言一致。
 *
 * 纯函数：不碰 fs、不碰 ctx，自检可以直接 import。
 */
import { GROUP_ID, MCP_PACKAGE } from './constants.ts'
import { isJsExpr } from './expr.ts'
import { isRecord } from './guards.ts'

export const MANAGED_START = '# >>> dsh-mcp-manager:managed'
export const MANAGED_END = '# <<< dsh-mcp-manager:managed'
export const MANAGED_MANIFEST_PREFIX = '# dsh-mcp-manager:manifest='

export type ManagedKind = 'insert' | 'override'

/** manifest 里的引用；config 不重复存，读取时从 Loader 的原始 config 取。 */
export interface ManagedEntryRef {
  id: string
  kind: ManagedKind
}

export interface ManagedManifest {
  version: 1
  /** 旧版 group 迁移期间需要一条 `config: []` 覆写，把旧容器清空。 */
  legacyGroup?: boolean | undefined
  entries: ManagedEntryRef[]
}

/** 生成块时的一条记录。 */
export interface ManagedRecord extends ManagedEntryRef {
  config: Record<string, unknown>
  disabled?: boolean | undefined
}

export interface ManagedBlockState {
  records: ManagedRecord[]
  legacyGroup?: boolean | undefined
}

export interface LocatedManagedBlock {
  start: number
  end: number
  manifest: ManagedManifest
  body: string
}

function flowScalar(value: unknown): string {
  if (isJsExpr(value)) return `!!js ${JSON.stringify(value.__jsExpr)}`
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('managed block 不支持 NaN/Infinity')
    return String(value)
  }
  if (typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map((item) => flowScalar(item)).join(',')}]`
  if (isRecord(value)) {
    const pairs: string[] = []
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      pairs.push(`${JSON.stringify(key)}:${flowScalar(item)}`)
    }
    return `{${pairs.join(',')}}`
  }
  throw new Error('managed block 不支持的 YAML 值')
}

/** 把一条记录渲染成一行 YAML；override 行显式写 `disabled: false`，才能覆盖原条目的 true。 */
export function renderManagedRow(record: ManagedRecord): string {
  const item: Record<string, unknown> = {
    id: record.id,
    name: MCP_PACKAGE,
    config: record.config,
  }
  if (record.kind === 'override') {
    item.disabled = record.disabled === true
  } else if (record.disabled === true) {
    item.disabled = true
  }
  const row = record.kind === 'insert' ? { insert: [item] } : item
  return `- ${flowScalar(row)}`
}

/** 渲染完整受控块（含 marker 与 manifest 注释）。 */
export function renderManagedBlock(state: ManagedBlockState): string {
  const manifest: ManagedManifest = {
    version: 1,
    ...(state.legacyGroup === true ? { legacyGroup: true } : {}),
    entries: state.records.map((record) => ({ id: record.id, kind: record.kind })),
  }
  const lines = [MANAGED_START, `${MANAGED_MANIFEST_PREFIX}${JSON.stringify(manifest)}`]
  for (const record of state.records) lines.push(renderManagedRow(record))
  if (state.legacyGroup === true) {
    lines.push(`- ${flowScalar({ id: GROUP_ID, name: 'cordis:group', config: [] })}`)
  }
  lines.push(MANAGED_END)
  return `${lines.join('\n')}\n`
}

function validateManifest(value: unknown): ManagedManifest {
  const record = isRecord(value) ? value : {}
  if (record.version !== 1) throw new Error('managed block 的 manifest.version 必须是 1')
  const entries = Array.isArray(record.entries) ? record.entries : undefined
  if (entries === undefined) throw new Error('managed block 缺少 manifest.entries')
  const seen = new Set<string>()
  const result: ManagedEntryRef[] = []
  for (const item of entries) {
    const entry = isRecord(item) ? item : {}
    const id = typeof entry.id === 'string' ? entry.id : ''
    const kind = entry.kind
    if (id === '') throw new Error('managed block 的 manifest 条目缺少 id')
    if (kind !== 'insert' && kind !== 'override') throw new Error(`managed block 的条目 ${id} kind 非法`)
    if (seen.has(id)) throw new Error(`managed block 的 manifest 条目重复：${id}`)
    seen.add(id)
    result.push({ id, kind })
  }
  return {
    version: 1,
    ...(record.legacyGroup === true ? { legacyGroup: true } : {}),
    entries: result,
  }
}

/**
 * 定位受控块。
 * @returns 没有块时返回 undefined；块不完整/重复/marker 外还有 marker 时抛错。
 */
export function locateManagedBlock(text: string): LocatedManagedBlock | undefined {
  const starts: number[] = []
  const ends: number[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(MANAGED_START, from)
    if (at < 0) break
    starts.push(at)
    from = at + MANAGED_START.length
  }
  from = 0
  for (;;) {
    const at = text.indexOf(MANAGED_END, from)
    if (at < 0) break
    ends.push(at)
    from = at + MANAGED_END.length
  }
  if (starts.length === 0 && ends.length === 0) return undefined
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error('managed block marker 必须恰好各出现一次；请手工修复 cordis.patch.yml')
  }
  const start = starts[0] ?? -1
  const end = ends[0] ?? -1
  if (start < 0 || end < start) throw new Error('managed block marker 顺序错误')
  const endInclusive = end + MANAGED_END.length
  const body = text.slice(start, endInclusive)
  const manifestLine = body
    .split('\n')
    .map((line) => line.trimEnd())
    .find((line) => line.startsWith(MANAGED_MANIFEST_PREFIX))
  if (manifestLine === undefined) throw new Error('managed block 缺少 manifest 注释')
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestLine.slice(MANAGED_MANIFEST_PREFIX.length))
  } catch (error) {
    throw new Error(`managed block manifest 不是合法 JSON：${String(error)}`)
  }
  const manifest = validateManifest(parsed)
  const rowCount = body
    .split('\n')
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith('- ')).length
  const expected = manifest.entries.length + (manifest.legacyGroup === true ? 1 : 0)
  if (rowCount !== expected) {
    throw new Error(
      `managed block 行数与 manifest 不一致（manifest ${String(manifest.entries.length)} 条，块内 ${String(rowCount)} 行）；请手工修复`,
    )
  }
  return { start, end: endInclusive, manifest, body }
}

/** 只判断文件是否"除了注释/空行之外只有 `[]` 或什么都没有"。 */
function lacksSequenceRows(text: string): boolean {
  const stripped = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .trim()
  return stripped === '' || stripped === '[]'
}

/** 替换/追加受控块，块外内容原样保留。 */
export function replaceManagedBlock(text: string, block: string): string {
  const existing = locateManagedBlock(text)
  if (existing !== undefined) {
    return `${text.slice(0, existing.start)}${block}${text.slice(existing.end)}`
  }
  if (lacksSequenceRows(text)) {
    // 空 profile 的模板是 `[]\n`；直接在它后面追加 `-` 项会变成非法 YAML。
    // 只替换那一行 `[]`，保留文件里的注释。
    const lines = text.split('\n')
    const index = lines.findIndex((line) => line.trim() === '[]')
    if (index >= 0) {
      lines[index] = block.trimEnd()
      return lines.join('\n')
    }
    const prefix = text === '' || text.endsWith('\n') ? text : `${text}\n`
    return `${prefix}${block}`
  }
  const prefix = text.endsWith('\n') ? text : `${text}\n`
  return `${prefix}${block}`
}

/** 删除受控块；如果文件因此没有任何条目，保留一个合法的空序列 `[]`。 */
export function removeManagedBlock(text: string): string {
  const existing = locateManagedBlock(text)
  if (existing === undefined) return text
  const outside = `${text.slice(0, existing.start)}${text.slice(existing.end)}`
  if (!lacksSequenceRows(outside)) return outside
  const comments = outside
    .split('\n')
    .filter((line) => line.trimStart().startsWith('#'))
    .join('\n')
    .trimEnd()
  return comments === '' ? '[]\n' : `${comments}\n[]\n`
}

/** 解析文件里的受控块状态；没有块时返回空状态。 */
export function readManagedState(text: string): { manifest: ManagedManifest; block: LocatedManagedBlock | undefined } {
  const block = locateManagedBlock(text)
  return {
    manifest: block?.manifest ?? { version: 1, entries: [] },
    block,
  }
}
