/**
 * 宿主半边（Host half）——MCP 管理器的数据面。
 *
 * 设计要点（全部来自对 DSH 运行时源码的实测，见 README.md）：
 *
 * 1. **运行时零 import**。本文件由 Loader 以 `file:///...` 绝对路径或包名加载，裸模块说明符
 *    （`@deepseek-ai/cordis` 等）在磁盘路径上解析不到。所以宿主半边只使用注入进来的 Service
 *    与全局 `fetch`/`Request`/`Response`，不 import 任何**运行时值**。
 *    源码里可以写相对 import（`../shared/constants`）与 `import type`：前者由 `tools/build.ts`
 *    用 esbuild **内联进单文件**，后者被编译期擦除 —— 产物 `lib/index.js` 里一个 import 都没有
 *    （自检 E0/E10 守这一点）。类型从 `./service-types` 来，那是**实测出来的最小契约**，
 *    不是官方声明的复刻：本插件刻意只依赖一个 peer（`@deepseek-ai/cordis`），
 *    因为 app-boot 会按 bundle 自己的 peer 做兼容判定，钉死 `@deepseek-ai/dsh-*` 的 rc 版本
 *    会让每次 DSH 升级都整个 bundle 被 skip。
 *
 * 2. **单一可编辑条目**。所有 MCP 服务器都放在一个 `cordis:group` 条目的 config
 *    数组里（下称「组条目」，id 见 `GROUP_ID`）。这个容器由**插件 bundle 自带的补丁层**
 *    声明（`cordis.patch.yml`），所以装好即用、用户不需要在 profile 里手写任何东西；
 *    归属理由与"为什么不能由插件在运行时创建"见该文件的头注释与 `MISSING_GROUP`。
 *    持久化交给 DSH 官方的 `ctx.configEditor.edit()`——它做外科手术式的 YAML 编辑：
 *    保留用户手写的 `insert:` 结构，写入前校验、失败回滚。
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
 *
 * 6. **失败原因由本插件自己从 `ctx.logger` 里捞**（见下面 failures / captureLog）。
 *    mcp-client 默认 `failOnStartupError: false` —— 连不上也不抛，fiber 仍是 ACTIVE，
 *    所以「fiber 状态」这条线永远说不出原因；而官方插件页对这些 patch 条目连行都不显示。
 *    唯一写着原因的地方是 mcp-client 的 `ctx.logger.warn/error`，且内置缓冲会丢掉 warn。
 *    因此自己挂 exporter 收：`mcp-client(<serverName>): <detail>` → 快照 `servers[].error`。
 *
 * 7. **`op: "probe"` 主动探测**（见 probeServer）：直接发一次 MCP `initialize`，
 *    用我们自己控制的预算（`PROBE_TIMEOUT_MS`）判定"现在这一刻答不答"。日志只能说明
 *    过去失败过、且 mcp-client 放弃重连后就不再打日志，所以需要这条独立通道：
 *    「TCP 拒绝 / HTTP 401 / 超时 / 响应不是 MCP」都能说清楚，结果进 `servers[].probe`。
 *    相位映射也补全了 `FIBER_PHASE`（LOADING 就是真正的"启动中"）。
 *
 * 8. **页面外的服务器也要报出来**（`outside`）。除容器之外，profile 补丁层里还可能出现
 *    **顶层**的 `@deepseek-ai/dsh-mcp-client` 条目（插件市场就会这么写，例如
 *    `magpie-mcp-context7`）。它们在跑、工具也注册给了模型，但容器里没有它们，所以本页
 *    既不能探测也不能启停 —— 旧版本干脆一行都不显示，空态文案却是「还没有配置任何 MCP
 *    服务器」，用户会以为配置丢了。现在按**官方谓词**识别：`configEditor.entries()` 的定义
 *    就是"顶层、id 唯一、可寻址的条目"（`dsh-config-editor` 里用 `parent.tree.ctx.fiber.entry.id
 *    === 'include'` 过滤），容器的子条目天然不在其中，所以"包名是 mcp-client 且可寻址"
 *    恰好等于"页面外的顶层条目"。
 *
 * **输入一律不可信**：配置行来自用户手写的 YAML，HTTP 体来自浏览器。所以这里不假设形状，
 * 用 `isRecord` / `asRecord` 收窄后再读；`as` 只在"已经用运行时检查证明过"的地方出现。
 */
import { GROUP_ID, MCP_PACKAGE, ROUTE } from '../shared/constants.ts'
import { asRecord, asText, isRecord, readString } from '../shared/guards.ts'
import { normalizeRow } from './rows.ts'
import type {
  ContainerState,
  FailureRecord,
  FiberPhase,
  OutsideServer,
  ProbeRecord,
  ServerSnapshot,
  Snapshot,
  ToolRecord,
} from '../shared/types.ts'
import type { EntryRow, HostContext, LoaderEntry, LogMessage, ToolsService } from './service-types.ts'

/** 单条失败原文的最大长度：足以看清 fetch/401/ENOENT，又不会把整段栈塞进快照。 */
const FAILURE_MESSAGE_LIMIT = 500
/** 最多跟踪多少台服务器的失败记录，超出后丢最旧的（防长跑进程里无界增长）。 */
const FAILURE_SERVER_LIMIT = 64
/** mcp-client 的日志前缀：`mcp-client(<serverName>): <detail>`。 */
const MCP_LOG_LINE = /^mcp-client\(([^)]+)\):\s*([\s\S]*)$/
/** 恢复信号：同一条连接实例重连成功后 mcp-client 会打印这一行。 */
const MCP_RECOVERED = /^reconnected and re-synced tools\b/
/**
 * 主动探测的预算。**这是"冷连接"的预算，不是"局域网"的预算。**
 *
 * 为什么不是 3s：实测（本机 + 真实 profile，用与 probeServer 完全相同的请求形状）
 * `https://mcp.context7.com/mcp` 的**冷路径**（DNS + TLS 握手 + Cloudflare 回程 + POST）
 * 稳定落在 **1.6–3.0s**，而同一条端点的热连接（连接复用）只要 ~360ms，局域网服务器只要 3–10ms。
 * 3s 正好压在冷路径的抖动边缘 → 连着三次都在 3005–3013ms 被 abort：
 * 配置完全正确（mcp-client 连得上、工具都注册了）却被报成
 * 「超时（3s）：服务器没有响应」的假红。
 *
 * 为什么探测总要走冷路径：它用的是**宿主进程全局 fetch（undici 连接池）**，
 * 与 mcp-client 自己那条长连 SSE 会话不是同一条连接；连接池空闲超过 keep-alive 就被回收，
 * 于是"每次打开页面探一次"基本都是一次全新的握手。
 *
 * 取 8s ≈ 冷路径实测上界的 2.7 倍余量。探测是并行的，多台服务器总时长 ≈ max 而不是累加，
 * 所以这个值同时决定"挂死的服务器最多让 UI 等多久"——不要再往上加太多。
 */
const PROBE_TIMEOUT_MS = 8000
/** 探测结果里附带的服务端响应片段上限（只用于说清 HTTP 层报错）。 */
const PROBE_BODY_LIMIT = 160
/**
 * 快照里每台服务器最多列出多少个工具名（防一台就有几百个时把快照撑大）。
 * 真实总数仍然如实报在 `tools.count` 上，`tools.truncated` 说明名单被截过。
 */
const TOOL_NAME_LIMIT = 200
/**
 * mcp-client 注册给模型的工具名 = `mcp__<serverName>__<rawName>`（dsh-mcp-client/lib/index.js:58, 97），
 * 只在名字超过 64 字符或含非法字符时把**尾部**归一化（追加哈希）。前缀 `mcp__<serverName>__`
 * 永远完整，所以按前缀归属是可靠的；但**尾部**（原始工具名）在归一化时可能与名字不同，
 * 展示时只能报公开名，不要假装那就是服务端的原始名。
 */
const MCP_TOOL_PREFIX = 'mcp__'
/**
 * cordis `FiberState` → 客户端认识的相位（数值见 `cordis/lib/types/fiber.js` 的 `_getState`）：
 * `PENDING=0 / LOADING=1 / ACTIVE=2 / FAILED=3 / DISPOSED=4 / UNLOADING=5`。
 * `LOADING` 必须单独报出来：mcp-client 的 `apply` 会 **await 连接建立**，
 * 所以"握手还没回来"期间 fiber 就停在 LOADING —— 那才是真正的"加载中"。
 */
const FIBER_PHASE: readonly FiberPhase[] = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']

export const name = 'dsh-mcp-manager'
/** 依赖在 apply 内用 ctx.inject 声明，便于缺失服务时优雅降级。 */
export const inject: string[] = []

/**
 * 容器行 —— 缺容器时让用户**照抄**的那一行（散文里给出整行，不给"某处加个 group"这种没用的指引）。
 *
 * 写成 YAML 的流式单行：能被整行复制粘贴，也不会在只有一行高度的提示区里被拆散。
 * `config: []` 是容器的子条目列表（MCP 服务器住在里面，由插件通过 configEditor 覆写行维护）。
 */
const GROUP_ROW = `- insert: [{id: ${GROUP_ID}, name: 'cordis:group', config: []}]`

/**
 * 容器**没出现**时的提示（v0.2.0 起容器由插件 bundle 自带，正常用户永远不会看到这句）。
 *
 * 归属为什么是 bundle：插件根本没有创建 Loader 条目的能力 —— `ctx.configEditor.edit()` 只接受
 * "已存在且 fiber 活着"的条目（`entries().includes(entry)` + `fiber.state !== 2` 两道检查），
 * `ctx.loader.create()` 又会整份重写 YAML（AGENTS 2.3 禁止）。所以"零手动"只有 bundle 层这一个
 * 位置；v0.1.1 把容器推给 profile 的代价是**每个用户都要先手改一次 YAML 才能用**。
 * 这条提示只在 bundle 层被整体跳过时有用（例如 `evaluatePluginCompatibility` 判 incompatible
 * 时 bundle 的 patch 不参与合成），所以给的是"兜底粘贴"的口径。
 * 文案里保留 `cordis:group` 字样：它仍然是"缺的是哪一类条目"的唯一判据（自检 D13 / P11 守这一点）。
 */
const MISSING_GROUP = `找不到 group 条目「${GROUP_ID}」（cordis:group）。它由本插件 bundle 自带的补丁层声明，正常不需要你配置；只有在 bundle 被跳过时（多半是兼容性判定）才需要兜底：把这一行粘进 profile 的 cordis.patch.yml —— ${GROUP_ROW}`

/**
 * 容器被**声明了两次**时的提示（v0.1.x 升级上来的用户会遇到：bundle 一份 + profile 里手写的那份）。
 *
 * 为什么要单独说清楚：同 id 两行不会报错，读起来一切正常，但**每一次写入都会失败**
 * ——`edit()` 写盘前用 `flatten(composeEntries(...)).find(row => row.id === id)` 取第一条
 * （即 bundle 那个空 config）与待写值比较，永远不相等，于是保存/启停/删除全报
 * `Configuration for "mcp-manager" is overridden by a home patch`（自检 B82/B83 复现这一现场）。
 * 用户唯一要做的事就是删掉 profile 里那一行，所以提示必须指名那个文件和那一行。
 */
const DUPLICATE_GROUP = `group 条目「${GROUP_ID}」被声明了两次：本插件 bundle 自带一份，profile 的 cordis.patch.yml 里还留着手写的一份。同 id 两行会让保存 / 启停 / 删除全部失败（configEditor 写入前断言取到的是先出现的那条空 config），请删掉 profile 里那一行 —— ${GROUP_ROW} —— 然后重启 DSH。`

/**
 * 把任意抛出物整理成一句话。
 * Node 的 fetch 把网络层原因包在 `cause` 里，只看 `message` 会得到无用的 "fetch failed"。
 */
function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    const cause: unknown = error.cause
    if (cause instanceof Error && cause.message !== '') return cause.message
    return error.message
  }
  return String(error)
}

/**
 * 宿主插件体。
 * @param ctx - 宿主根上下文（形状见 ./service-types，只列我们真正用到的成员）。
 */
export function apply(ctx: HostContext): void {
  ctx.inject(['connection', 'configEditor', 'loader'], (scope) => {
    /** 取组条目的 Loader entry；条目不存在时返回 undefined。 */
    const groupEntry = () => scope.configEditor.entries().find((entry) => entry.options.id === GROUP_ID)

    /**
     * 容器被声明了几次（按 `ctx.loader` 全表数，**不是**按 `configEditor.entries()`）。
     *
     * 为什么必须分开数：`configEditor.entries()` 会把同 id 的重复条目**过滤掉**
     * （`counts.get(id) === 1` 才留），所以"可寻址表里没有"有两种完全不同的原因：
     *   ① 真的一行都没有 → 提示用户兜底粘一行；
     *   ② 声明了两次（bundle 一份 + profile 一份）→ 提示用户删掉 profile 那份。
     * 这两种情况给同一句话，用户就会照错的建议做（去加第三行）。自检 B81–B83 钉住这个区分。
     */
    const containerState = (): ContainerState => {
      let declared = 0
      for (const entry of scope.loader.entries()) if (entry.options.id === GROUP_ID) declared += 1
      if (declared === 0) return 'missing'
      return declared > 1 ? 'duplicated' : 'ok'
    }

    /**
     * 取容器条目；缺失/重复时抛出**能照着做**的错误，而不是一句"找不到"。
     * 写操作一律先过这里：重复声明时 `configEditor.edit()` 的写盘前断言必然失败，
     * 提前给出"删哪一行"的原文比把那句 `overridden by a home patch` 抛给用户有用得多。
     */
    const requireGroup = (): LoaderEntry => {
      const state = containerState()
      if (state === 'duplicated') throw new Error(DUPLICATE_GROUP)
      if (state === 'missing') throw new Error(MISSING_GROUP)
      const entry = groupEntry()
      if (entry === undefined) throw new Error(MISSING_GROUP)
      return entry
    }

    /**
     * 每台服务器最近一次失败的原文 —— 这是"启动失败原因"唯一的可取之处。
     *
     * 为什么必须由我们自己收：`@deepseek-ai/dsh-mcp-client` 把失败原因写进 `ctx.logger`，
     * 而宿主侧的 logger 只有 cordis 内置的 **1000 条内存环形缓冲**。且那个内置 exporter
     * 没有声明 `levels`，于是阈值取 Logger 的 `level ?? 1`；cordis 的
     * `LoggerLevel` 是 `ERROR=0 / INFO=1 / WARN=2 / DEBUG=3`、过滤条件是
     * `targetLevel < level` 就丢弃 —— **warn 级根本进不了那个缓冲**。而"为什么连不上"
     * 恰恰是 warn（`mcp-client(x): connection attempt failed: <error>`）。
     * 宿主进程的 stdout 在桌面版被 pipe 到一个没有控制台的父进程，也不落任何日志文件，
     * 所以不主动收就等于原因不可见（见 README 7.6）。
     *
     * 做法：挂自己的 exporter，显式声明 `levels: { default: 3 }`（全收），再按前缀过滤，
     * 因此不会因为别人改了默认阈值而丢掉 warn。
     */
    const failures = new Map<string, FailureRecord>()

    /**
     * exporter 回调：只认 `mcp-client(<serverName>): <detail>` 形状的日志行。
     * 其他插件/子系统的日志（哪怕也是 warn/error）一律不入账，避免把无关噪声当成服务器故障。
     * @param message - cordis 的结构化日志记录。
     */
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
        // 先删后插：Map 的插入序即"最近失败"序，淘汰时丢的是最久没动静的那台。
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
      // 同一实例重连成功 → 旧记录不再代表现状，清掉。
      if (message.type === 'info' && MCP_RECOVERED.test(detail)) failures.delete(serverName)
    }

    // `logger` 是 cordis 内置服务（Context 构造时就存在），不需要写进 inject 声明；
    // 但探测一次，让缺 logger 的宿主/测试替身优雅降级而不是抛错。
    if (typeof scope.logger?.exporter === 'function') {
      scope.logger.exporter({ levels: { default: 3 }, export: captureLog })
    }

    /** 每台服务器最近一次**主动探测**的结果（见 probeServer）。 */
    const probes = new Map<string, ProbeRecord>()

    /**
     * 工具注册表（`ctx.tools`）。它是**可选**服务，所以用 `get()` 拿而不是写进 inject 声明——
     * 缺了它也要能正常显示配置与探测（只少一块工具名单）。
     *
     * 这里有一次断言：`get()` 的返回类型是 unknown，取到的到底是不是工具表只有运行时知道；
     * 下面的 `toolsOf` 每次调用都会再检查一遍 `schemas` 是不是函数，所以即使拿错了也只是降级。
     */
    const toolsService = (typeof scope.get === 'function' ? scope.get('tools') : scope.tools) as
      ToolsService | undefined

    /**
     * 某台服务器**当前注册给模型的工具名单**。
     *
     * 为什么问注册表而不是发一次 `tools/list`：mcp-client 连接成功并同步完工具之后，
     * 就把每个工具注册成 `mcp__<serverName>__<rawName>`（`dsh-mcp-client/lib/index.js:153`），
     * 所以这份名单就是**模型此刻真正能调用的东西**——连不上的服务器自然没有名字，
     * 工具同步失败的服务器也会显示 0 个，不需要再发一次网络请求、也不必处理
     * streamable-http 的会话（`Mcp-Session-Id`）。
     *
     * 注意归属只按前缀判定：`publicToolName()` 只在名字超长/含非法字符时改写**尾部**
     * （追加 12 位哈希），前缀 `mcp__<serverName>__` 永远完整（见 MCP_TOOL_PREFIX）。
     *
     * @param serverName - 配置里的 `serverName`。
     * @returns `{ count, names, truncated }`；宿主没有 tools 服务时返回 undefined。
     */
    const toolsOf = (serverName: string): ToolRecord | undefined => {
      if (typeof toolsService?.schemas !== 'function' || serverName === '') {
        return undefined
      }
      const prefix = `${MCP_TOOL_PREFIX}${serverName}__`
      const matched: string[] = []
      for (const schema of toolsService.schemas()) {
        const raw = schema?.name
        const toolName = typeof raw === 'string' ? raw : ''
        if (toolName.startsWith(prefix)) matched.push(toolName)
      }
      // 排序后展示：注册顺序随服务端返回顺序变，字母序才稳定、可预测。
      matched.sort()
      const truncated = matched.length > TOOL_NAME_LIMIT
      return { count: matched.length, names: truncated ? matched.slice(0, TOOL_NAME_LIMIT) : matched, truncated }
    }

    /** 把响应片段压成一行、裁到上限（只用于展示 HTTP 层报错）。 */
    const shortenBody = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, PROBE_BODY_LIMIT)

    /**
     * 读响应体的**第一个数据块**。
     * streamable-http 的 SSE 响应会一直挂着不结束，`response.text()` 会一直等到超时，
     * 所以只读一块就收手；超时/断流由调用方的 catch 统一处理。
     */
    const firstChunk = async (response: Response): Promise<string> => {
      if (response.body === null) return ''
      // 只声明我们真正用到的那两个成员：@types/node 里 undici 的 ReadableStream.getReader()
      // 会退化成 any，直接用会一路把 any 传染进来（no-unsafe-* 会拦）。
      const reader = response.body.getReader() as {
        read(): Promise<{ value?: Uint8Array | undefined }>
        cancel(): Promise<void>
      }
      try {
        const { value } = await reader.read()
        return value === undefined ? '' : new TextDecoder().decode(value)
      } finally {
        try {
          void reader.cancel().catch(() => {})
        } catch {
          // 取消失败不影响判定。
        }
      }
    }

    /**
     * 主动探测一台服务器：直接发一次 MCP `initialize`，看它**现在**答不答。
     *
     * 为什么需要这条独立通道：`mcp-client` 默认 `failOnStartupError: false` ——
     * 连不上也不抛错，fiber 永远是 ACTIVE，光看相位只能报绿；
     * 而它放弃重连（默认 10 次）之后不再打日志，靠日志也可能一条都收不到。
     * 探测是唯一能在"现在这一刻"给出结论的机制，而且能区分
     * 「连上了但不响应」（握手卡住/接口挂死）与「根本连不上」（TCP 拒绝）。
     *
     * @param row - 配置行（需要 config.transport / config.url / config.headers）。
     * @returns `{ connected, status, detail, at }`；`connected === null` 表示这种传输无法探测。
     */
    const probeServer = async (row: unknown): Promise<ProbeRecord> => {
      const config = asRecord(isRecord(row) ? row.config : undefined)
      const at = Date.now()
      const url = readString(config, 'url')
      if (readString(config, 'transport') !== 'streamable-http' || url === undefined || url === '') {
        return {
          connected: null,
          status: null,
          detail: '仅能探测 streamable-http（stdio 走子进程，无法从宿主探测）',
          at,
        }
      }
      // headers 来自用户 YAML，逐项转成字符串再交给 fetch（HeadersInit 只认 string）。
      const extraHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(asRecord(config.headers))) extraHeaders[key] = String(value)
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
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'dsh-mcp-manager', version: '0.2.0' },
            },
          }),
          signal: controller.signal,
        })
        const body = await firstChunk(response)
        const status = response.status
        if (!response.ok) {
          return {
            connected: false,
            status,
            detail: `HTTP ${String(status)}${body === '' ? '' : `：${shortenBody(body)}`}`,
            at,
          }
        }
        // 服务端在用 MCP 说话的最低证据：JSON-RPC 信封（result 或 error 都算"活着"）。
        if (/"jsonrpc"\s*:/.test(body)) return { connected: true, status, detail: `HTTP ${String(status)}`, at }
        const type = response.headers.get('content-type') ?? '未知 content-type'
        return { connected: false, status, detail: `HTTP ${String(status)}，但响应不是 MCP（${type}）`, at }
      } catch (error) {
        // Node 的 fetch 把网络层原因包在 cause 里，只看 message 会得到无用的 "fetch failed"。
        const reason = reasonOf(error)
        return {
          connected: false,
          status: null,
          detail: controller.signal.aborted
            ? `超时（${String(PROBE_TIMEOUT_MS / 1000)}s）：服务器没有响应`
            : `请求失败：${reason}`,
          at,
        }
      } finally {
        clearTimeout(timer)
      }
    }

    /**
     * 读组条目的**声明行**（未展开的原始 config 数组）。
     * configEditor.edit 写的是「覆写层」，所以覆写层非空时以它为准，否则用继承层。
     */
    const declaredRows = (): EntryRow[] | undefined => {
      const entry = groupEntry()
      if (entry === undefined) return undefined
      const layer = scope.configEditor.configuration().find((row) => row.entry.options.id === GROUP_ID)
      const override = layer?.override
      const raw = Array.isArray(override) && override.length > 0 ? override : (layer?.inherited ?? entry.options.config)
      return Array.isArray(raw) ? (raw as EntryRow[]) : []
    }

    /** 同上，但容器缺失/重复时抛错（写路径用；读路径要能容忍缺失）。 */
    const requireRows = (): EntryRow[] => {
      requireGroup()
      const rows = declaredRows()
      if (rows === undefined) throw new Error(MISSING_GROUP)
      return rows
    }

    /**
     * 主动探测：默认探所有**启用中**的服务器，也可以只探一台。
     * 结果写进 `probes`，并立刻返回一份带 `probe` 的快照（客户端一次往返就能刷新）。
     * @param only - 只探这一台（serverName）；省略则探全部。
     */
    const runProbes = async (only?: string): Promise<Snapshot> => {
      const rows = requireRows()
      const targets = rows
        .map((row) => ({ name: asText(asRecord(row.config).serverName), row }))
        .filter((item) => item.name !== '' && item.row.disabled !== true && (only === undefined || item.name === only))
      if (only !== undefined && targets.length === 0) {
        throw new Error(`找不到启用中的 MCP 服务器 "${only}"；配置可能已被外部修改，请刷新页面后重试`)
      }
      // 并行探测：每台各自一份预算，总时长不随服务器数量线性增长。
      const results = await Promise.all(targets.map(async (item) => [item.name, await probeServer(item.row)] as const))
      for (const [serverName, result] of results) probes.set(serverName, result)
      return snapshot()
    }

    /** 条目的相位投影：`disabled` → stopped，没有 fiber → pending，其余查表。 */
    const phaseOf = (entry: LoaderEntry): FiberPhase =>
      entry.options.disabled === true
        ? 'stopped'
        : entry.fiber === undefined
          ? 'pending'
          : (FIBER_PHASE[entry.fiber.state] ?? 'pending')

    /** 组条目下**活着的** MCP 子条目，用于汇报运行时状态。 */
    const liveChildren = (): Map<string, { id?: string | undefined; phase: FiberPhase }> => {
      const found = new Map<string, { id?: string | undefined; phase: FiberPhase }>()
      for (const entry of scope.loader.entries()) {
        if (entry.options.name !== MCP_PACKAGE) continue
        const config = asRecord(entry.options.config)
        const key = typeof config.serverName === 'string' ? config.serverName : entry.options.id
        // 既没有 serverName 也没有 id 的畸形条目没有可汇报的归属，跳过（旧写法会以 undefined 为键）。
        if (key === undefined) continue
        found.set(key, {
          id: entry.options.id,
          phase: phaseOf(entry),
        })
      }
      return found
    }

    /**
     * **页面外**的 MCP 服务器：顶层、可寻址、包名是 mcp-client，但不是我们容器里的那一行。
     *
     * 识别谓词直接复用官方定义：`configEditor.entries()` 返回的就是"顶层、id 唯一、可寻址"
     * 的条目（`dsh-config-editor` 用 `parent.tree.ctx.fiber.entry?.id === 'include'` 过滤），
     * 容器的子条目天然不在其中 —— 所以不需要我们自己摸 `entry.parent`（那是未声明的内部结构）。
     *
     * 它们只在两种情况下出现：① 别的插件往 profile 补丁层写了顶层 mcp-client 条目
     * （插件市场的 `magpie-mcp-context7` 就是这样）；② 用户自己手写了一条。
     * 本插件对它们**只读**：`disabled` 是行字段、不在 config 里，`configEditor.edit()` 写不到；
     * 删除顶层条目更没有 API。所以页面上只报状态与工具数，改法交给用户（见 README 5.1）。
     */
    const outsideServers = (): OutsideServer[] => {
      const found: OutsideServer[] = []
      for (const entry of scope.configEditor.entries()) {
        if (entry.options.name !== MCP_PACKAGE) continue
        const id = entry.options.id
        // 没有 id 就没法指认出处；容器自己（cordis:group）不以 mcp-client 为包名，这里只是兜底。
        if (typeof id !== 'string' || id === '' || id === GROUP_ID) continue
        const config = asRecord(entry.options.config)
        const serverName = typeof config.serverName === 'string' ? config.serverName : ''
        const item: OutsideServer = {
          id,
          serverName,
          config,
          phase: phaseOf(entry),
          disabled: entry.options.disabled === true,
        }
        // 失败原文与工具名单按 serverName 归属（与容器内的行共用同一套通道）。
        if (serverName !== '') {
          const failure = failures.get(serverName)
          if (failure !== undefined) item.error = { ...failure }
          const tools = toolsOf(serverName)
          if (tools !== undefined) item.tools = tools
        }
        found.push(item)
      }
      return found
    }

    /** 汇总一份客户端可直接渲染的快照。 */
    const snapshot = (): Snapshot => {
      const rows = declaredRows()
      const live = liveChildren()
      return {
        groupId: GROUP_ID,
        configured: rows !== undefined,
        // 容器三态：旧客户端只认 `configured` 布尔，所以两个字段都要给（AGENTS 1.2 的谈判原则）。
        container: containerState(),
        // 页面外（顶层）的 mcp-client 条目：它们在跑，但不在本页的管理范围，见 outsideServers。
        outside: outsideServers(),
        mcpPackage: MCP_PACKAGE,
        // 能力协商：客户端据此决定用「宿主侧定点操作」还是退回整数组提交。
        // 宿主半边不参与热重载（Node 的 ESM 缓存按 URL 生效，且本目录不在
        // dsh-hmr 的监听根里），所以客户端必须能同时说两代协议。
        // `lastError` = 快照里的 `servers[].error`（失败原文）；旧宿主不报这个能力，
        // 新客户端也只是读不到字段而已，所以不需要按能力分支。
        // `probe` = `op:"probe"` 主动探测 + 快照里的 `servers[].probe`（现在这一刻答不答）。
        // `tools` = 快照里的 `servers[].tools`（这台服务器**当前注册**的工具名单）。
        // `outside` = 快照里的 `outside[]`（页面外的顶层条目，只读展示）。
        // 旧宿主不认识 `outside`：客户端拿不到这个字段就不渲染那块，天然向前兼容。
        capabilities: ['setEnabled', 'remove', 'save', 'lastError', 'probe', 'tools', 'outside'],
        servers: (rows ?? []).map((row, index) => {
          const config = asRecord(row.config)
          const serverName = typeof config.serverName === 'string' ? config.serverName : ''
          const status = live.get(serverName)
          const failure = failures.get(serverName)
          const probe = probes.get(serverName)
          const tools = toolsOf(serverName)
          const server: ServerSnapshot = {
            index,
            rowId: typeof row.id === 'string' ? row.id : undefined,
            disabled: row.disabled === true,
            config,
            phase: status?.phase ?? 'absent',
          }
          // 最近一次失败原文；无记录时不写这个键（JSON.stringify 会丢掉 undefined）。
          if (failure !== undefined) server.error = { ...failure }
          // 最近一次主动探测结果；没探过就不写这个键。
          if (probe !== undefined) server.probe = { ...probe }
          // 当前注册的工具名单；宿主没有 tools 服务时不写这个键。
          if (tools !== undefined) server.tools = tools
          return server
        }),
      }
    }

    /** 唯一的写入路径：整份数组交给 configEditor 做外科手术式 YAML 编辑。 */
    const commitRows = async (rows: unknown): Promise<Snapshot> => {
      const entry = requireGroup()
      if (!Array.isArray(rows)) throw new Error('rows 必须是数组')
      const list: unknown[] = rows
      await scope.configEditor.edit(entry, () => list)
      // 配置写入会让 Loader 重建 group 的子条目（README 4.2），旧实例的失败记录
      // 描述的是**上一个实例**，留着只会误报 → 全部清掉，等新实例自己产生新记录。
      failures.clear()
      // 探测结果同理：url/headers 可能刚被改过，旧结论不再代表现状。
      probes.clear()
      return snapshot()
    }

    /** 按 serverName 定位声明行；找不到就抛出可读错误。 */
    const locate = (serverName: unknown): { rows: EntryRow[]; index: number } => {
      const rows = requireRows()
      const target = asText(serverName)
      const index = rows.findIndex((row) => (asRecord(row.config).serverName ?? '') === target)
      if (index < 0) {
        throw new Error(`找不到名为 "${target}" 的 MCP 服务器；配置可能已被外部修改，请刷新页面后重试`)
      }
      return { rows, index }
    }

    /**
     * 只改一行：`change` 收到原始行，返回改后的行。
     * 其余字段与其他所有行**原样回写**，因此不可能丢掉 headers/env 之类的字段。
     */
    const patchRow = async (serverName: unknown, change: (row: EntryRow) => EntryRow): Promise<Snapshot> => {
      const { rows, index } = locate(serverName)
      return commitRows(rows.map((row, at) => (at === index ? change(row) : row)))
    }

    /** 启停一台服务器：加/去 `disabled`，其余字段分毫不动。 */
    const setEnabled = (serverName: unknown, enabled: boolean): Promise<Snapshot> =>
      patchRow(serverName, (row) => {
        const next: EntryRow = { ...row }
        if (enabled) delete next.disabled
        else next.disabled = true
        return next
      })

    /** 删掉一台服务器。 */
    const removeServer = async (serverName: unknown): Promise<Snapshot> => {
      const { rows, index } = locate(serverName)
      return commitRows(rows.filter((_row, at) => at !== index))
    }

    /** 表单提交：整份数组替换（字段形状由表单保证）。 */
    const saveAll = async (servers: unknown): Promise<Snapshot> => {
      if (!Array.isArray(servers)) throw new Error('servers 必须是数组')
      const list: unknown[] = servers
      return commitRows(list.map((server) => normalizeRow(server)))
    }

    const respond = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })

    const handler = async (request: Request): Promise<Response> => {
      try {
        if (request.method === 'GET') return respond(200, { ok: true, data: snapshot() })

        // 请求体同样不可信：先收窄成 record 再读字段。
        const payload = asRecord(await request.json())
        switch (readString(payload, 'op')) {
          case 'setEnabled':
            return respond(200, {
              ok: true,
              data: await setEnabled(payload.serverName, payload.enabled === true),
            })
          case 'remove':
            return respond(200, { ok: true, data: await removeServer(payload.serverName) })
          case 'probe':
            return respond(200, { ok: true, data: await runProbes(readString(payload, 'serverName')) })
          case 'save':
            return respond(200, { ok: true, data: await saveAll(payload.servers) })
          default:
            return respond(400, { ok: false, error: `未知操作：${String(payload.op)}` })
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
