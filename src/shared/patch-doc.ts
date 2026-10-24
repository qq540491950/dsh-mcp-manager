/**
 * profile `cordis.patch.yml` 的**条目寻址**模型（v0.4.0 起）。
 *
 * v0.3 的受控块把本插件写的行圈在两个 marker 之间；v0.4 改为**直接寻址文件里的普通
 * 顶层条目**：每台 MCP（无论手写、市场插件写还是本插件写）都在文件里有自己的字节区间，
 * 编辑 = 只重写那几行，其余字节逐字保留。这需要一个轻量的行扫描器：
 *
 *   · 顶层条目 = 第 0 列以 `- ` 开头的行；条目区间延伸到下一个顶层条目之前，
 *     并去掉尾部的空行 / 第 0 列注释（它们属于"条目之间"，不跟着条目走）；
 *   · 块式条目：首行是 `键:` —— `- id: x` 裸行是**覆写语义**（override），
 *     `- insert:` 分节里的**内嵌条目**（缩进的 `- ` 行）各自独立寻址、是**创建语义**；
 *   · flow 单行条目：首行以 `{` / `[` 开头，按 JSON 解析（`!!js "…"` 先预处理成
 *     `{__jsExpr}` 标记对象——与 include 方言的内存表示一致，往返无损）。
 *
 * 解析不了的行（多行 flow、首行没有 id、JSON 语法错误）记入 `unaddressable`——
 * 不阻塞其它条目；对它自己的写操作走「外部条目」路径（追加覆写行）或安全失败。
 *
 * 写入通过 `composeEdit` 表达为「替换 / 删除某个字节区间 + 末尾追加」，由
 * `patch-writer.ts` 在文件锁与原子替换的保护下执行。**任何歧义都抛错**（同 id 多份
 * 声明、区间越界、区间重叠），宁可拒绝写入也不猜用户意图。
 *
 * 纯函数：不碰 fs、不碰 ctx，自检可以直接 import。
 */
import { GROUP_ID, MCP_PACKAGE } from './constants.ts'
import { isJsExpr } from './expr.ts'
import { isRecord } from './guards.ts'

/**
 * 一条可寻址的条目声明。
 *
 * `style` 是这一行的**写入语义**（决定渲染形状），不是运行时来源：
 *   · 'insert'   —— 顶层 insert 分节里的内嵌条目（或 flow 行 insert 数组里的元素），
 *                  能**创建**条目；
 *   · 'override' —— 顶层裸行（`- id: X` 或 flow 裸对象），目标已存在时整键覆写。
 */
export interface AddressedEntry {
  /** 条目 id；首行识别不出 id 时为 undefined（不可寻址，不参与按 id 的写入）。 */
  id: string | undefined
  /** 声明在文件中的字节区间 [start, end)；end 停在行边界（含行尾换行，若不是文件末行）。 */
  start: number
  end: number
  style: 'insert' | 'override'
  /** 首行的前导空格数；内嵌条目替换时要按它补缩进。 */
  indent: number
  /** 所在顶层 insert 分节的字节区间（仅块式内嵌条目有）。 */
  parent?: { start: number; end: number } | undefined
  /** 父 insert 分节里的内嵌条目总数（含不可寻址的）；父块清理时用它判断是否变空。 */
  siblings: number
  /** flow 行的解析值；块式条目为 undefined。`index` 是该条目在 insert 数组里的下标。 */
  flow?: { value: Record<string, unknown>; index: number | undefined } | undefined
}

export interface ScanResult {
  entries: AddressedEntry[]
  /** 无法寻址的条目行数（解析失败 / 首行没有 id）。 */
  unaddressable: number
}

/** 一次写入的编辑列表；所有区间都相对**同一份原文**。 */
export type PatchEdit =
  | { op: 'append'; lines: string[] }
  | { op: 'replace'; start: number; end: number; line: string }
  | { op: 'delete'; start: number; end: number }
  /** 只能单独使用的整体变换（如剥离 v0.3 marker；在文件锁内拿到最新原文后执行）。 */
  | { op: 'transform'; transform: (text: string) => string }

interface Line {
  /** 行内容（不含行尾换行与 \r）。 */
  body: string
  /** 行首字节偏移。 */
  start: number
  /** 行尾字节偏移（含换行；文件末行没有换行时等于 text.length）。 */
  end: number
  /** 前导空格数。 */
  indent: number
  /** 空行或纯注释行（结构扫描时透明）。 */
  blank: boolean
}

function splitLines(text: string): Line[] {
  const lines: Line[] = []
  let offset = 0
  for (const raw of text.split('\n')) {
    const body = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const start = offset
    const end = offset + raw.length + 1
    const trimmed = body.trimStart()
    lines.push({
      body,
      start,
      end: Math.min(end, text.length),
      indent: body.length - trimmed.length,
      blank: trimmed === '' || trimmed.startsWith('#'),
    })
    offset += raw.length + 1
  }
  return lines
}

/** 顶层条目行：第 0 列的 `- `（`-foo` 是普通标量，不算）。 */
function isTopItem(line: Line): boolean {
  return line.indent === 0 && (line.body === '-' || line.body.startsWith('- ') || line.body.startsWith('-\t'))
}

/** 首行 `- ` 之后的键部分；不是 `键:` 形状返回 undefined（内嵌条目要先去缩进）。 */
function keyOf(line: Line): { key: string; rest: string } | undefined {
  const content = line.body.trimStart().slice(1).trim()
  const matched = /^([^:\s]+)\s*:(.*)$/.exec(content)
  if (matched === null) return undefined
  return { key: matched[1] ?? '', rest: (matched[2] ?? '').trim() }
}

/** 去掉引号与行尾注释，取出标量文本。 */
function scalarText(raw: string): string | undefined {
  let value = raw.trim()
  if (value === '') return undefined
  const quote = value[0]
  if ((quote === "'" || quote === '"') && value.length >= 2) {
    const end = value.lastIndexOf(quote)
    return end > 0 ? value.slice(1, end) : undefined
  }
  const hash = value.indexOf(' #')
  if (hash >= 0) value = value.slice(0, hash).trim()
  return value === '' ? undefined : value
}

/**
 * flow 行解析：`!!js "…"` 预处理成 `{"__jsExpr":"…"}` 后按 JSON 解析。
 * 只接受单行完整解析；语法错误 / 多行 flow 返回 undefined（不可寻址）。
 */
const JS_TAG_IN_FLOW = /(^|[{,[:]\s*)!!js\s*("(?:[^"\\]|\\.)*")/g

export function parseFlowLine(content: string): Record<string, unknown> | undefined {
  const preprocessed = content.replace(
    JS_TAG_IN_FLOW,
    (_match, head: string, expr: string) => `${head}{"__jsExpr":${expr}}`,
  )
  try {
    const value: unknown = JSON.parse(preprocessed)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * 扫描整份 patch 文件，找出所有可寻址的条目声明。
 * 结构异常（不可能走到这里——结构异常只会让个别条目不可寻址）不抛错；
 * 抛错的是 composeEdit 阶段的区间校验。
 */
export function scanPatchDoc(text: string): ScanResult {
  const lines = splitLines(text)
  const entries: AddressedEntry[] = []
  let unaddressable = 0

  const idOfFirstLine = (line: Line): string | undefined => {
    const key = keyOf(line)
    if (key === undefined || key.key !== 'id') return undefined
    return scalarText(key.rest)
  }

  for (let i = 0; i < lines.length;) {
    const head = lines[i]
    if (head === undefined || !isTopItem(head)) {
      i += 1
      continue
    }
    // 原始区间：到下一个顶层条目之前；再去掉尾部的空行 / 第 0 列注释。
    let extent = i + 1
    while (extent < lines.length && !isTopItem(lines[extent] as Line)) extent += 1
    while (extent > i + 1) {
      const last = lines[extent - 1]
      if (last !== undefined && last.blank && last.indent === 0) extent -= 1
      else break
    }
    const rawEnd = extent < lines.length ? (lines[extent] as Line).start : text.length
    const first = head
    const content = first.body.slice(1).trim()

    if (content.startsWith('{') || content.startsWith('[')) {
      // flow 单行条目。
      const parsed = parseFlowLine(content)
      if (parsed === undefined) {
        unaddressable += 1
      } else if (Array.isArray(parsed.insert)) {
        const list = parsed.insert as unknown[]
        let indexed = 0
        for (let index = 0; index < list.length; index += 1) {
          const item = list[index]
          const id = isRecord(item) && typeof item.id === 'string' ? item.id : undefined
          if (id === undefined || id === '') unaddressable += 1
          else {
            entries.push({
              id,
              start: first.start,
              end: rawEnd,
              style: 'insert',
              indent: 0,
              siblings: list.length,
              flow: { value: parsed, index },
            })
            indexed += 1
          }
        }
        if (indexed === 0 && list.length === 0) {
          // `insert: []` 的 flow 行：不是条目，也不算失败。
        }
      } else {
        const id = typeof parsed.id === 'string' ? parsed.id : undefined
        if (id === undefined || id === '') unaddressable += 1
        else {
          entries.push({
            id,
            start: first.start,
            end: rawEnd,
            style: 'override',
            indent: 0,
            siblings: 1,
            flow: { value: parsed, index: undefined },
          })
        }
      }
      i = extent
      continue
    }

    const key = keyOf(first)
    if (key !== undefined && key.key === 'insert' && (key.rest === '' || key.rest === '[]')) {
      // 顶层 insert 分节：内嵌条目各自寻址。
      const nested: number[] = []
      let nestedIndent: number | null = null
      for (let m = i + 1; m < extent; m += 1) {
        const line = lines[m]
        if (line === undefined || line.blank) continue
        if (nestedIndent === null) {
          const inner = line.body.trimStart()
          if (line.indent > 0 && (inner.startsWith('- ') || inner === '-')) {
            nestedIndent = line.indent
            nested.push(m)
          } else if (line.indent > 0) {
            break // insert: 之后的同级键——这一分节没有内嵌序列
          }
          continue
        }
        if (line.indent === nestedIndent) {
          const inner = line.body.trimStart()
          if (inner.startsWith('- ') || inner === '-') nested.push(m)
          else break
        } else if (line.indent > nestedIndent) {
          continue // 内嵌条目的续行
        } else {
          break // 缩进回落：分节结束
        }
      }
      for (let index = 0; index < nested.length; index += 1) {
        const startIndex = nested[index]
        const nextIndex = index + 1 < nested.length ? nested[index + 1] : undefined
        const startLine = startIndex !== undefined ? lines[startIndex] : undefined
        if (startIndex === undefined || startLine === undefined) continue
        // 区间到下一个内嵌条目（或分节末尾）；再把尾部的空行 / 注释行让给后面。
        let endLine = nextIndex === undefined ? extent : nextIndex
        while (endLine > startIndex + 1) {
          const last = lines[endLine - 1]
          if (last !== undefined && last.blank) endLine -= 1
          else break
        }
        const lastKept = lines[endLine - 1]
        const itemEnd = lastKept === undefined ? startLine.end : lastKept.end
        // 内嵌条目也有两种形状：块式（- id: x）与 flow 单行（- {"id":"x",…}，本插件重写后的产物）。
        const nestedContent = startLine.body.trimStart().slice(1).trim()
        if (nestedContent.startsWith('{')) {
          const parsed = parseFlowLine(nestedContent)
          const id = parsed !== undefined && typeof parsed.id === 'string' ? parsed.id : undefined
          if (id === undefined || id === '' || parsed === undefined) unaddressable += 1
          else {
            entries.push({
              id,
              start: startLine.start,
              end: itemEnd,
              style: 'insert',
              indent: startLine.indent,
              parent: { start: first.start, end: rawEnd },
              siblings: nested.length,
              flow: { value: parsed, index: undefined },
            })
          }
          continue
        }
        const id = idOfFirstLine(startLine)
        if (id === undefined) unaddressable += 1
        else {
          entries.push({
            id,
            start: startLine.start,
            end: itemEnd,
            style: 'insert',
            indent: startLine.indent,
            parent: { start: first.start, end: rawEnd },
            siblings: nested.length,
            flow: undefined,
          })
        }
      }
      i = extent
      continue
    }

    if (key !== undefined && key.key === 'id') {
      const id = scalarText(key.rest)
      if (id === undefined || id === '') unaddressable += 1
      else {
        entries.push({
          id,
          start: first.start,
          end: rawEnd,
          style: 'override',
          indent: 0,
          siblings: 1,
          flow: undefined,
        })
      }
    } else {
      // 顶层标量 / 首行不是 id 的键：不可寻址。
      unaddressable += 1
    }
    i = extent
  }

  return { entries, unaddressable }
}

// —— 渲染 ——

/** flow 风格标量序列化（JSON 是 YAML 的子集；`!!js` 值写成 `!!js "表达式"`）。 */
export function flowScalar(value: unknown): string {
  if (isJsExpr(value)) return `!!js ${JSON.stringify(value.__jsExpr)}`
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('patch 行不支持 NaN/Infinity')
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
  throw new Error('patch 行不支持的 YAML 值')
}

/**
 * 一条条目的**裸对象**：`{ id, name, config, disabled? }`。
 * override 行**始终**显式写 `disabled`（false 才能压过原条目的 true）；
 * insert 条目只在停用时写。
 */
export function entryItemOf(
  entry: { id: string; config: Record<string, unknown>; disabled?: boolean | undefined },
  style: 'insert' | 'override',
): Record<string, unknown> {
  const item: Record<string, unknown> = { id: entry.id, name: MCP_PACKAGE, config: entry.config }
  if (style === 'override') item.disabled = entry.disabled === true
  else if (entry.disabled === true) item.disabled = true
  return item
}

/** 渲染一条**裸**条目行：顶层覆写行，或 insert 分节里的内嵌条目（调用方按 indent 补缩进）。 */
export function renderEntryItem(
  entry: { id: string; config: Record<string, unknown>; disabled?: boolean | undefined },
  style: 'insert' | 'override',
): string {
  return `- ${flowScalar(entryItemOf(entry, style))}`
}

/** 渲染一条**创建**行：顶层 `- {"insert":[{…}]}`（新条目必须走 insert，裸行目标不存在会被丢弃）。 */
export function renderInsertLine(entry: {
  id: string
  config: Record<string, unknown>
  disabled?: boolean | undefined
}): string {
  return `- ${flowScalar({ insert: [entryItemOf(entry, 'insert')] })}`
}

/** 渲染清空旧 group 容器的覆写行（迁移路径专用；group 声明不在本文件里时的兜底）。 */
export function renderKillLine(): string {
  return `- ${flowScalar({ id: GROUP_ID, name: 'cordis:group', config: [] })}`
}

// —— 编辑合成 ——

/** 文件是否"除了注释/空行之外只有 `[]` 或什么都没有"（空 profile 的追加特例）。 */
function lacksSequenceRows(text: string): boolean {
  const stripped = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .trim()
  return stripped === '' || stripped === '[]'
}

function appendLines(text: string, lines: string[]): string {
  const joined = lines.join('\n')
  if (lacksSequenceRows(text)) {
    // 空 profile 的模板是 `[]\n`；直接在它后面追加 `-` 项会变成非法 YAML，只替换那一行。
    const existing = text.split('\n')
    const index = existing.findIndex((line) => line.trim() === '[]')
    if (index >= 0) {
      existing[index] = joined
      return existing.join('\n')
    }
  }
  const prefix = text === '' || text.endsWith('\n') ? text : `${text}\n`
  return `${prefix}${joined}\n`
}

/**
 * 把编辑列表合成出新文件内容。所有区间相对**同一份原文**；重叠 / 越界一律抛错。
 * 区间替换保持行结构：原区间以换行结尾（或后面还有内容）时，替换行也以换行结尾。
 * 删空兜底：原文有条目、编辑后一条不剩时，保留注释 + `[]`——空字符串/纯注释在部分
 * YAML 加载器上是"没有文档"，宁可留一个显式的空序列。
 */
export function composeEdit(text: string, edits: PatchEdit[]): string {
  if (edits.length === 0) return text
  if (edits.some((edit) => edit.op === 'transform')) {
    if (edits.length !== 1) throw new Error('transform 不能与其他编辑混用')
    const only = edits[0]
    return only !== undefined && only.op === 'transform' ? only.transform(text) : text
  }
  const appends = edits.filter((edit) => edit.op === 'append')
  if (appends.length > 1) throw new Error('一次只允许一个 append')
  const hadRows = !lacksSequenceRows(text)
  const ranged = edits.filter(
    (edit): edit is Exclude<PatchEdit, { op: 'append' } | { op: 'transform' }> =>
      edit.op === 'replace' || edit.op === 'delete',
  )
  const sorted = [...ranged].sort((a, b) => a.start - b.start)
  let previousEnd = -1
  for (const edit of sorted) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      throw new Error('patch 编辑的区间必须是整数偏移')
    }
    if (edit.start < 0 || edit.end < edit.start || edit.end > text.length) {
      throw new Error(
        `patch 编辑区间越界：[${String(edit.start)}, ${String(edit.end)})，文件长度 ${String(text.length)}`,
      )
    }
    if (edit.start < previousEnd) throw new Error('patch 编辑区间重叠；请刷新页面后重试')
    previousEnd = edit.end
  }
  let next = text
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const edit = sorted[index]
    if (edit === undefined) continue
    const chunk = next.slice(edit.start, edit.end)
    const replacement = edit.op === 'delete' ? '' : `${edit.line}${chunk.endsWith('\n') ? '\n' : ''}`
    next = `${next.slice(0, edit.start)}${replacement}${next.slice(edit.end)}`
  }
  if (appends.length === 1) {
    const only = appends[0]
    if (only !== undefined && only.lines.length > 0) next = appendLines(next, only.lines)
  }
  if (hadRows && ranged.length > 0 && lacksSequenceRows(next)) {
    const comments = next
      .split('\n')
      .filter((line) => line.trimStart().startsWith('#'))
      .join('\n')
      .trimEnd()
    next = comments === '' ? '[]\n' : `${comments}\n[]\n`
  }
  return next
}
