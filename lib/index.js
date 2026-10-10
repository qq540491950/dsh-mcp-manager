/**
 * 宿主半边（Host half）——MCP 管理器的数据面。
 *
 * 设计要点（全部来自对 DSH 运行时源码的实测，见 README.md）：
 *
 * 1. **零 import**。本文件由 Loader 以 `file:///...` 绝对路径加载，裸模块说明符
 *    （`@deepseek-ai/cordis` 等）都藏在 app.asar 里，从磁盘路径解析不到。所以宿主
 *    半边只使用注入进来的 Service，不 import 任何东西——与 codex-effort-picker 同一纪律。
 *
 * 2. **单一可编辑条目**。所有 MCP 服务器都放在一个 `cordis:group` 条目的 config
 *    数组里（下称「组条目」，默认 id `mcp-manager`）。持久化交给 DSH 官方的
 *    `ctx.configEditor.edit()`——它做外科手术式的 YAML 编辑：保留用户手写的
 *    `insert:` 结构，写入前校验、失败回滚。
 *
 *    反面教材：直接用 `ctx.loader.create()/remove()` 动态加条目。Loader 的
 *    `EntryTree.write()`（`dsh-app-boot` 的 `Include` 类）会整体重写 `root.data`，
 *    可能把用户手写的 `insert:` 分节压平成顶层列表——不可接受的破坏性写入。
 *
 * 3. **通道用 `ctx.connection.fetch.register()`**。官方浏览器 HTTP 路由扩展点：与
 *    `/api` 的 RPC 共用 `createSharedFetchHandler`，自动享受 Host/Origin 校验与浏览器
 *    鉴权，客户端同源 `fetch()` 即可，不需要自建 token。
 *
 * 4. **「启停」和「删除」是宿主侧定点操作，不是整数组替换**（踩坑后改的，见下）。
 *
 *    曾经的写法：客户端把**整个数组**回传，宿主用 `normalizeRow()` 逐行重建。这有两个
 *    致命问题：
 *      a) `headers` / `env` 在快照里是**对象**，而 `normalizeRow` 只认「字符串（多行文本）
 *         或字符串数组」——那是**表单**提交的形状。于是任何一次行内操作（启停/删除）
 *         都会把 `headers`/`env` **静默清空**。实测证据：profile 里第一次行内写入后，
 *         覆写行的 context7 只剩 `serverName/transport/url`，`Authorization` 头消失。
 *      b) 客户端只要少传一个字段，落盘内容就被改坏；错误还会被当成正常结果。
 *
 *    现在的写法：`setEnabled` / `remove` 只带 `{ serverName, ... }`，宿主自己按名字定位
 *    那一行，**原地改它**（`{ ...row, disabled }`），其余行原样字节回写。字段不可能丢。
 *    `save` 只留给**表单**用它那套完整的字段形状提交。
 *
 * 5. `disabled` 对 `cordis:group` 子条目是有效的：`Entry.disabled` 会向上遍历父级，
 *    `Entry.update()` 里命中 `this.disabled` 就 `fiber?.dispose()` 并返回。已实测：
 *    给子条目加 `disabled: true` 后 `plugin_manager` 报告
 *    `{"moduleName":"@deepseek-ai/dsh-mcp-client","enabled":false,"fiberPhase":null}`。
 */

/** MCP 客户端插件包名；一个 MCP 服务器 = 该插件的一个 Loader 条目。 */
const MCP_PACKAGE = '@deepseek-ai/dsh-mcp-client'
/** 承载全部 MCP 条目的 `cordis:group` 条目 id（在 cordis.patch.yml 里配置，见 README）。 */
const GROUP_ID = 'mcp-manager'
/** 本插件注册的浏览器路由。 */
const ROUTE = '/api/mcp-manager'

export const name = 'dsh-mcp-manager'
/** 依赖在 apply 内用 ctx.inject 声明，便于缺失服务时优雅降级。 */
export const inject = []

const MISSING_GROUP =
  `找不到 group 条目 "${GROUP_ID}"。请先在 profile 的 cordis.patch.yml 里按插件 README 配置一个 cordis:group 条目。`

/**
 * 宿主插件体。
 * @param ctx - 宿主根上下文。
 */
export function apply(ctx) {
  ctx.inject(['connection', 'configEditor', 'loader'], (scope) => {
    /** 取组条目的 Loader entry；条目不存在时返回 undefined。 */
    const groupEntry = () =>
      scope.configEditor.entries().find((entry) => entry.options.id === GROUP_ID)

    /**
     * 读组条目的**声明行**（未展开的原始 config 数组）。
     * configEditor.edit 写的是「覆写层」，所以覆写层非空时以它为准，否则用继承层。
     */
    const declaredRows = () => {
      const entry = groupEntry()
      if (entry === undefined) return undefined
      const layer = scope.configEditor
        .configuration()
        .find((row) => row.entry.options.id === GROUP_ID)
      const override = layer?.override
      const raw =
        Array.isArray(override) && override.length > 0
          ? override
          : layer?.inherited ?? entry.options.config
      return Array.isArray(raw) ? raw : []
    }

    /** 组条目下**活着的** MCP 子条目，用于汇报运行时状态。 */
    const liveChildren = () => {
      const found = new Map()
      for (const entry of scope.loader.entries()) {
        if (entry.options.name !== MCP_PACKAGE) continue
        const config = entry.options.config ?? {}
        const key = typeof config.serverName === 'string' ? config.serverName : entry.options.id
        found.set(key, {
          id: entry.options.id,
          phase:
            entry.options.disabled === true
              ? 'stopped'
              : entry.fiber?.state === 2
                ? 'active'
                : entry.fiber === undefined
                  ? 'pending'
                  : 'inactive',
        })
      }
      return found
    }

    /** 汇总一份客户端可直接渲染的快照。 */
    const snapshot = () => {
      const rows = declaredRows()
      const live = liveChildren()
      return {
        groupId: GROUP_ID,
        configured: rows !== undefined,
        mcpPackage: MCP_PACKAGE,
        // 能力协商：客户端据此决定用「宿主侧定点操作」还是退回整数组提交。
        // 宿主半边不参与热重载（Node 的 ESM 缓存按 URL 生效，且本目录不在
        // dsh-hmr 的监听根里），所以客户端必须能同时说两代协议。
        capabilities: ['setEnabled', 'remove', 'save'],
        servers: (rows ?? []).map((row, index) => {
          const config = row?.config ?? {}
          const serverName = typeof config.serverName === 'string' ? config.serverName : ''
          const status = live.get(serverName)
          return {
            index,
            rowId: typeof row?.id === 'string' ? row.id : undefined,
            disabled: row?.disabled === true,
            config,
            phase: status?.phase ?? 'absent',
          }
        }),
      }
    }

    /** 唯一的写入路径：整份数组交给 configEditor 做外科手术式 YAML 编辑。 */
    const commitRows = async (rows) => {
      const entry = groupEntry()
      if (entry === undefined) throw new Error(MISSING_GROUP)
      if (!Array.isArray(rows)) throw new Error('rows 必须是数组')
      await scope.configEditor.edit(entry, () => rows)
      return snapshot()
    }

    /** 按 serverName 定位声明行；找不到就抛出可读错误。 */
    const locate = (serverName) => {
      const rows = declaredRows()
      if (rows === undefined) throw new Error(MISSING_GROUP)
      const name = String(serverName ?? '')
      const index = rows.findIndex((row) => (row?.config?.serverName ?? '') === name)
      if (index < 0) {
        throw new Error(`找不到名为 "${name}" 的 MCP 服务器；配置可能已被外部修改，请刷新页面后重试`)
      }
      return { rows, index }
    }

    /**
     * 只改一行：`change` 收到原始行，返回改后的行。
     * 其余字段与其他所有行**原样回写**，因此不可能丢掉 headers/env 之类的字段。
     */
    const patchRow = async (serverName, change) => {
      const { rows, index } = locate(serverName)
      return commitRows(rows.map((row, at) => (at === index ? change(row) : row)))
    }

    /** 启停一台服务器：加/去 `disabled`，其余字段分毫不动。 */
    const setEnabled = (serverName, enabled) =>
      patchRow(serverName, (row) => {
        const next = { ...row }
        if (enabled) delete next.disabled
        else next.disabled = true
        return next
      })

    /** 删掉一台服务器。 */
    const removeServer = async (serverName) => {
      const { rows, index } = locate(serverName)
      return commitRows(rows.filter((_row, at) => at !== index))
    }

    /** 表单提交：整份数组替换（字段形状由表单保证）。 */
    const saveAll = async (servers) => {
      if (!Array.isArray(servers)) throw new Error('servers 必须是数组')
      return commitRows(servers.map((server) => normalizeRow(server)))
    }

    const respond = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })

    const handler = async (request) => {
      try {
        if (request.method === 'GET') return respond(200, { ok: true, data: snapshot() })

        const payload = await request.json()
        switch (payload?.op) {
          case 'setEnabled':
            return respond(200, {
              ok: true,
              data: await setEnabled(payload.serverName, payload.enabled === true),
            })
          case 'remove':
            return respond(200, { ok: true, data: await removeServer(payload.serverName) })
          case 'save':
            return respond(200, { ok: true, data: await saveAll(payload.servers) })
          default:
            return respond(400, { ok: false, error: `未知操作：${String(payload?.op)}` })
        }
      } catch (error) {
        // 失败一律回 4xx/5xx + 原文，客户端原样展示；configEditor 在写入前校验、
        // 失败时回滚，所以异常不会留下半截配置。
        return respond(409, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }

    // `connection.fetch` 是 caller-context 求值的 getter：`register()` 内部会把
    // disposer 挂到**我们**这个 scope 的 effect 上，随插件卸载自动摘除路由。
    // 路由必须形如 `/api/<名字>`（assertFetchRoute 用 endpointFromPath('/api', ...) 校验），
    // 且它挂在 webServer 的 `/api` prefix 路由之下，因此自动获得 Host/Origin 围栏与
    // 浏览器鉴权（registerFetchRoute → createSharedFetchHandler 的精确 pathname 匹配）。
    scope.connection.fetch.register({
      path: ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: handler,
    })
  })
}

/**
 * 把一个**表单**提交的服务器描述整理成 `cordis:group` 的一份 entryList 行。
 * 注意这只服务表单路径；行内的启停/删除不走这里（见文件头第 4 条）。
 * @param server - 客户端提交的服务器对象。
 * @returns 可直接写进 YAML 的条目行。
 */
function normalizeRow(server) {
  const transport = server?.transport === 'stdio' ? 'stdio' : 'streamable-http'
  const serverName = String(server?.serverName ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    throw new Error(`serverName "${serverName}" 非法：只允许 1-32 位字母、数字、下划线、连字符`)
  }

  const config = { serverName, transport }
  if (transport === 'stdio') {
    const command = String(server?.command ?? '').trim()
    if (command === '') throw new Error(`服务器 "${serverName}" 使用 stdio，但 command 为空`)
    config.command = command
    const args = toStringArray(server?.args)
    if (args.length > 0) config.args = args
    const env = toRecord(server?.env)
    if (env !== undefined) config.env = env
    if (typeof server?.cwd === 'string' && server.cwd !== '') config.cwd = server.cwd
  } else {
    const url = String(server?.url ?? '').trim()
    if (url === '') throw new Error(`服务器 "${serverName}" 使用 streamable-http，但 url 为空`)
    config.url = url
    const headers = toRecord(server?.headers)
    if (headers !== undefined) config.headers = headers
  }
  if (typeof server?.toolCallTimeoutMs === 'number' && Number.isFinite(server.toolCallTimeoutMs)) {
    config.toolCallTimeoutMs = server.toolCallTimeoutMs
  }

  const row = { name: MCP_PACKAGE, config }
  if (server?.disabled === true) row.disabled = true
  // 保留既有 id，让 Loader 认得出是同一个条目（而不是先删后建）。
  if (typeof server?.rowId === 'string' && server.rowId !== '') row.id = server.rowId
  return row
}

/** 把客户端来的换行分隔文本整理成字符串数组（也接受数组）。 */
function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item !== '')
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
function toRecord(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, String(item)])
    return entries.length === 0 ? undefined : Object.fromEntries(entries)
  }
  const pairs = Array.isArray(value)
    ? value.map((item) => String(item))
    : typeof value === 'string'
      ? value.split('\n')
      : []
  const entries = pairs
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=')
      if (at <= 0) throw new Error(`环境变量/请求头行缺少 "="：${line}`)
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
    })
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}
