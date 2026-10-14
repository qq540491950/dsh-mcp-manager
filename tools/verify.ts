/**
 * dsh-mcp-manager 自检程序（纯 Node，零依赖）。
 *
 * 覆盖三组断言：
 *   A. 包清单契约（dsh.client.platform / exports["./client"] / 模块 id 与包名一致）
 *   B. 宿主半边行为（路由注册、GET 快照、POST 全量写入、非法输入拒绝）
 *   C. 客户端半边行为（懒 CJS 协议、只 require 种子模块、settings.section 注册契约）
 *
 * 用法：node tools/verify.ts
 */
import { readdir, readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import vm from 'node:vm'

/**
 * 共享常量的**唯一来源**：`src/shared/constants.ts`。
 *
 * 这里直接 import TypeScript 源文件 —— Node ≥22.18 默认开启类型擦除，所以自检脚本
 * 仍然**零依赖**（不装 node_modules 也能跑），却能把"两半边必须一致"的那些值从
 * "断言里手写的字面量"升级成"期望值来自唯一来源"。E 区就是这件事的守卫。
 */
let shared
try {
  shared = await import('../src/shared/constants.ts')
} catch (error) {
  console.error('无法加载 src/shared/constants.ts —— 需要 Node ≥22.18（默认开启类型擦除）。')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
const failures: string[] = []

/**
 * 断言辅助。
 *
 * `condition` 收 `unknown` 而不是 `boolean`：调用处会传各种真值表达式（字符串包含、可选链比较、
 * 计数相等……），写成 `boolean` 会逼着每一处都加 `=== true`，反而让断言更难读。
 * 这里只当"真值"用，所以 `unknown` 是最贴切的签名。
 */
function check(label: string, condition: unknown, detail = ''): void {
  if (condition) {
    passed += 1
    return
  }
  failures.push(`${label}${detail === '' ? '' : ` — ${detail}`}`)
}

/** 深度相等（够用的 JSON 形状比较）。 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

//#region 类型脚手架（测试替身的最小形状）
/**
 * 为什么需要这一段。
 *
 * 自检脚本到处在造假对象（假 ctx、假 Loader、假 DOM、假 React）。这些容器若用 `[]` / `null`
 * 初始化，TypeScript 会把它们推成 `never[]` / `never`，于是后面每一处"读它的某个字段"
 * 都报一条错 —— **一个容器能连带几十条噪音**（P0–P5 结束时全文件 360 条，其中约 200 条
 * 只来自十几个容器）。
 *
 * 显式声明一次把噪音消掉，同时让替身**受约束**：产品侧要求或产出的字段一旦改名，
 * 这里会立刻编译失败 —— 那正是想要的方向（断言跟着产品走，而不是自己跟自己玩）。
 *
 * 纪律：只列**断言真正读到**的字段。替身不是产品类型的复刻 ——
 * 宿主/客户端的真实契约在 `src/host/service-types.ts` 与 `src/client/service-types.ts`。
 */
/** 一行 Loader 条目（断言会读 id / name / config / disabled）。 */
interface StubEntry {
  id?: string
  name?: string
  /** 比产品侧的 `unknown` 更具体一层：断言要读 `config.headers` / `config.args`。 */
  config?: Record<string, unknown>
  disabled?: boolean
}
/** `ctx.connection.fetch.register()` 收到的路由声明。 */
interface StubRoute {
  path: string
  methods: string[]
  requestBody: string
  fetch(request: Request): Promise<Response>
}
/** 挂到 `ctx.logger.exporter()` 上的记录器。 */
interface StubExporter {
  levels: { default: number }
  export(message: Record<string, unknown>): void
}
/** group 条目下的子条目（Loader 的运行时投影）。 */
interface StubChild {
  id?: string
  config?: Record<string, unknown>
  /** cordis FiberState 数值。 */
  state?: number
}
/** `configEditor.configuration()` 的一层（B70 用它复现"覆写 replace insert"的分层现场）。 */
interface StubLayerRow {
  entry: { options: { id?: string } }
  inherited?: StubEntry[]
  override?: StubEntry[]
}
/** 假 ctx.inject 回调收到的 scope：只列宿主真正用到的成员。 */
interface HostScopeStub {
  /** 宿主只在自己声明了资源时才用；最小替身可以不给。 */
  effect?(callback: () => (() => void) | void): void
  /** 宿主用 `typeof scope.get === 'function'` 判断是否存在，所以是可选成员。 */
  get?(name: string): unknown
  logger?: {
    exporter(options: { levels: { default: number }; export(message: Record<string, unknown>): void }): unknown
  }
  configEditor: {
    entries(): Array<{ options: { id?: string; name?: string; config?: StubEntry[] } }>
    configuration(): StubLayerRow[]
    edit(entry: unknown, update: (rows: StubEntry[], again: StubEntry[]) => unknown): Promise<void>
  }
  loader: {
    entries(): Array<{ options: { id?: string; name?: string; config?: unknown }; fiber?: { state: number } }>
  }
  connection: { fetch: { register(route: StubRoute): unknown } }
}
/** 快照里的一台服务器（只列断言真正读到的字段）。 */
interface StubServer {
  index?: number
  rowId?: string
  disabled?: boolean
  phase?: string
  config?: Record<string, unknown>
  probe?: { connected?: boolean | null; status?: number | null; detail?: string; at?: number }
  error?: { message?: string; level?: string; at?: number; count?: number }
  tools?: { count?: number; names?: string[]; truncated?: boolean }
}
/** 宿主 GET/POST 返回的快照。 */
interface StubSnapshot {
  groupId?: string
  configured?: boolean
  mcpPackage?: string
  /** 能力表：断言会 `includes(...)` 或直接比对数组。 */
  capabilities?: string[]
  servers?: StubServer[]
}
/** 响应体的线格式。**刻意不用 `any`**：字段名打错时必须编译失败（断言的价值就在这里）。 */
interface WireBody {
  ok?: boolean
  data?: StubSnapshot
  error?: string
}

/**
 * 读一次响应体。
 * `Response.json()` 在 undici 的类型里是 `unknown`（不是 `any`），所以每处都要收窄一次；
 * 统一走这个函数，收窄点就只有一个。
 */
async function bodyOf(response: Response): Promise<WireBody> {
  return (await response.json()) as WireBody
}

/** 取宿主注册的路由；为 null 就抛（B4 会先报这个失败，这里只是让类型收窄，行为不变）。 */
function routeOrThrow(captured: { route: StubRoute | null }): StubRoute {
  if (captured.route === null) throw new Error('宿主没有注册路由（B4 报过这个失败）')
  return captured.route
}

/**
 * "还没注册"的占位路由。
 *
 * 用它而不是 `null`：断言里 `captured.route.fetch(...)` 有十几处，让 `route` 恒为 `StubRoute`
 * 可以把十几条"possibly null"一次消掉；B4 仍然靠**引用相等**检查"宿主到底注册了没有"。
 * 真在注册前调用它会抛一条能看懂的错误，而不是 `Cannot read properties of null`。
 */
const unregisteredRoute: StubRoute = {
  path: '',
  methods: [],
  requestBody: '',
  fetch: () => Promise.reject(new Error('宿主还没有注册路由')),
}

/** 客户端 bundle 向 `window.__ModuleLoader__.load` 注册的模块定义。 */
interface StubModuleDefinition {
  id?: string
  factory(require: (specifier: string) => unknown): { apply(ctx: unknown): void }
}
/** 假 React（C 区只验证协议，不渲染）。 */
interface StubReact {
  createElement(...args: unknown[]): unknown
  Fragment: { $$typeof: symbol }
  useState<T>(initial: T): [T, (next: T) => void]
  useEffect(callback: () => void): void
  useCallback<T>(fn: T): T
  useMemo<T>(fn: () => T): T
}

/**
 * 取数组首/尾项并收窄类型。
 * 为空就抛 —— 前置断言（C1「注册了一个模块」之类）已经报过这个失败，这里只是让类型收窄，
 * **不改变行为**：真为空时原来也会在下一行 `Cannot read properties of undefined` 崩掉。
 */
function firstOrThrow<T>(items: T[], what: string): T {
  const [head] = items
  if (head === undefined) throw new Error(`${what} 为空（前面的断言已经报过这个失败）`)
  return head
}
function lastOrThrow<T>(items: T[], what: string): T {
  const tail = items[items.length - 1]
  if (tail === undefined) throw new Error(`${what} 为空（前面的断言已经报过这个失败）`)
  return tail
}
//#endregion

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const hostSource = await readFile(join(root, 'lib', 'index.js'), 'utf8')
const clientSource = await readFile(join(root, 'lib', 'client.js'), 'utf8')
/**
 * 实现里的探测预算（ms）。B69 的自限兜底与新断言都从**产物**里取，避免同一个数字写死两处
 * ——否则改预算时自检会先炸在夹具上，让人误以为是实现错了。
 *
 * 这里必须容忍构建器的数字写法：esbuild 会把 `8000` 打印成 `8e3`（数字字面量缩短），
 * 所以不能只匹配 `\d+`（那样会得到 8 而不是 8000，把 B69 的夹具一起带偏）。
 */
const probeBudgetMs = Number(/PROBE_TIMEOUT_MS = ([\d.eE+]+)/.exec(hostSource)?.[1] ?? 0)

//#region A. 包清单
/**
 * 包名的合法性判据。
 *
 * P6 改名（`dsh-mcp-manager` → `@qq540491950/dsh-mcp-manager`）后这里**不再硬编码名字**：
 * 旧版写的是 `manifest.name === 'dsh-mcp-manager'`，改名时它必然失败——但它想守的其实是
 * "这是一个合法的、能被 pnpm 解析的 npm 名"，而"产物里的模块 id 必须等于包名"由 A5 与 E8
 * 用 `manifest.name` 拼期望值来守。所以这里换成形状校验，**没有放宽任何一处防护**。
 */
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
check(
  'A1 包名是合法的 npm 名（非空 / 小写 / 至多一段 scope / ≤214 字符）',
  typeof manifest.name === 'string' && manifest.name.length <= 214 && NPM_NAME.test(manifest.name),
  String(manifest.name),
)
/**
 * `exports["./client"]` 的两种合法形态都是允许的：字符串，或带 `default` 的条件导出对象
 * （官方 bundle 用的是后者）。守的意图不变——**它必须指向真实存在的客户端产物**，
 * 所以顺带断言那个文件在盘上（只比字符串相等的话，指到一个不存在的路径也能过）。
 */
const clientExport = manifest.exports?.['./client']
const clientExportTarget =
  typeof clientExport === 'string'
    ? clientExport
    : typeof clientExport?.default === 'string'
      ? clientExport.default
      : ''
const clientExportExists = clientExportTarget !== '' && existsSync(join(root, clientExportTarget))
check(
  'A2 exports["./client"] 指向真实存在的客户端产物',
  clientExportTarget === './lib/client.js' && clientExportExists,
  `${String(clientExport)} → 目标 ${clientExportTarget}（文件存在：${String(clientExportExists)}）`,
)
check('A3 dsh.client.platform === "web"', manifest.dsh?.client?.platform === 'web', JSON.stringify(manifest.dsh))
check('A4 main points at lib/index.js', manifest.main === 'lib/index.js', String(manifest.main))
/**
 * A5 与 E8 都守"产物里的模块 id 等于包名"，但查的是**两件不同的东西**：
 * A5 查构建器注入的那一行包装（`id: "<name>",` 的逐字形状，含逗号），E8 查产物里出现过该 id。
 * 期望值一律用 `manifest.name` 拼出来，**不写死名字**（publish-plan §4）。
 */
check(
  'A5 客户端 bundle 用包名注册模块 id（构建注入，两处都不硬编码包名）',
  clientSource.includes(`id: ${JSON.stringify(manifest.name)},`),
  manifest.name,
)
check('A6 客户端 bundle 是 classic script（无 ESM 语法）', !/^\s*(import|export)\s/m.test(clientSource))
check(
  'A7 只 require 平台种子模块',
  [...clientSource.matchAll(/require\((?:"|')([^"']+)(?:"|')\)/g)].every(([, specifier]) =>
    [
      'react',
      'react-dom',
      'cordis',
      'dsh-client-store',
      'ui-slots',
      'ui-primitives',
      'ui-dockkit',
      '@deepseek-ai/dsh-client-ui-primitives',
    ].includes(specifier),
  ),
  [...clientSource.matchAll(/require\((?:"|')([^"']+)(?:"|')\)/g)].map(([, s]) => s).join(', '),
)
// 宿主产物现在由 tools/build.ts 从 src/host/index.ts 打包生成（相对 import 被内联、
// 类型被擦除），所以断言必须看**产物**：这里同时禁掉 import 与 require —— 只要产物里出现
// 任何一个，说明打包没把依赖内联，Loader 从磁盘路径加载时就会解析失败。
check(
  'A8 宿主产物零 import/require（磁盘路径解析不到裸模块）',
  !/^\s*import\s/m.test(hostSource) && !/\brequire\s*\(/.test(hostSource),
)
// 产物由构建器生成，所以下面这些"字面量一致"的断言**不得耦合引号风格**：
// 它们守的是"两半边写着同一个协议值"，不是"宿主用单引号"。
// 更严格的"值来自唯一来源（src/shared/constants.ts）"由 E 区守。
check(
  'A9 两半边的路由字面量一致',
  (hostSource.includes('"/api/mcp-manager"') || hostSource.includes("'/api/mcp-manager'")) &&
    clientSource.includes('"/api/mcp-manager"'),
)
check(
  'A10 两半边的组条目 id 一致',
  (hostSource.includes('"mcp-manager"') || hostSource.includes("'mcp-manager'")) &&
    clientSource.includes('mcp-manager'),
)

// 主题适配护栏：硬编码颜色在深色主题下会造成「白底白字」这类不可见文本。
// 规则：客户端里的十六进制颜色只允许作为 var() 的 fallback 出现。
// 先剥掉注释（注释里可以自由讨论 #fff），再剥 var()，最后扫描残留颜色。
{
  const code = clientSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  let stripped = code
  for (let pass = 0; pass < 8; pass += 1) {
    const next = stripped.replace(/var\([^()]*\)/g, 'var()')
    if (next === stripped) break
    stripped = next
  }
  const bare = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(([hex]) => hex)
  check('A11 无裸硬编码颜色（必须是 var() 的 fallback）', bare.length === 0, bare.join(', '))
  check(
    'A12 主按钮前景色用 foreground token',
    /\.mcpm-btn--primary\s*\{[^}]*color:var\(--dsw-alias-label-primary-foreground/.test(code),
  )
  // 视觉必须走 CSS class：inline 的 background 会压过 :hover，导致没有悬停反馈。
  check('A12b 视觉层是注入的样式表', code.includes('STYLE_ELEMENT_ID') && code.includes('document.head.appendChild'))
  check('A12c 按钮有 hover 反馈', /\.mcpm-btn:hover:not\(:disabled\)/.test(code))
}

// 间距护栏：**紧凑档**，数值取自官方小号控件（`Button.module.css` 的 `.sm`）。
{
  // 只保留代码本身（剥掉注释）再做声明匹配。
  const code = clientSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  // 锚定到行首，否则 `.mcpm-row--off .mcpm-name {}` 会先被匹配到。
  const ruleOf = (cls: string): string => code.match(new RegExp('(?:^|\\n)\\s*\\' + cls + '\\s*\\{[^}]*\\}'))?.[0] ?? ''
  // 参数收到 `[类名, 声明]` 的字符串对数组：标注之后，下面那些数组字面量会被**上下文推断**，
  // 回调里的 `([cls, decl]) => …` 也就自动有了 string 类型（否则每个回调都要单独标注）。
  const missing = (pairs: ReadonlyArray<readonly string[]>): ReadonlyArray<readonly string[]> =>
    pairs.filter(([cls, decl]) => !ruleOf(cls).includes(decl))

  const metrics = [
    ['.mcpm-page', 'padding:4px 0'], // 左右/底部留白由设置外壳的 0 24px 24px 提供，不能重复叠加
    ['.mcpm-page', 'gap:12px'],
    ['.mcpm-page', 'line-height:18px'],
    ['.mcpm-page', 'max-width:720px'], // 官方 ui-settings-models .section 的上限
    ['.mcpm-rows', 'gap:8px'], // 官方 .rows：一卡一服务器
    ['.mcpm-rowCard', 'padding:8px 12px'],
    ['.mcpm-rowCard', 'border:.5px solid var(--dsw-alias-settings-card-stroke)'],
    ['.mcpm-rowCard', 'border-radius:var(--dsw-radius-lg'],
    ['.mcpm-rowCard', 'background:var(--dsw-alias-settings-card-fill)'],
    ['.mcpm-row', 'min-height:28px'],
    ['.mcpm-btn', 'height:28px'],
    ['.mcpm-btn', 'min-width:44px'],
    ['.mcpm-btn', 'padding:0 10px'],
    ['.mcpm-btn', 'font-size:12px'],
    ['.mcpm-btn', 'border:.5px solid var(--dsw-alias-border-l3)'],
    ['.mcpm-btn', 'border-radius:var(--dsw-radius-sm'],
  ]
  const badMetrics = missing(metrics)
  check(
    'A15 紧凑档尺寸（对齐官方 .sm / .rowActions）',
    badMetrics.length === 0,
    badMetrics.map(([c, d]) => `${c} { ${d} }`).join('; '),
  )
  // 表单面板照抄官方 ui-settings-models：靠**底色**分层，不靠描边。
  const formMetrics = [
    ['.mcpm-form', 'background:var(--dsw-alias-bg-module-platform'],
    ['.mcpm-form', 'border-radius:var(--dsw-radius-lg'],
    ['.mcpm-input', 'border:.5px solid var(--dsw-alias-border-l4'],
    ['.mcpm-input', 'background:var(--dsw-alias-bg-layer-1)'],
    ['.mcpm-label', 'color:var(--dsw-alias-label-secondary)'],
    ['.mcpm-label', 'font-weight:500'],
  ]
  const badForm = missing(formMetrics)
  check('A31 表单面板对齐官方 models 页', badForm.length === 0, badForm.map(([c, d]) => `${c} { ${d} }`).join('; '))
  // 外壳已有 24px 底部内边距；页面自己再垫 24px 会变成 48px。
  check('A16 页面不重复叠加外壳的底部留白', !/padding:\s*[^;]*24px/.test(ruleOf('.mcpm-page')))
  // 操作区必须单行：一旦允许 wrap，空间不足时"删除"会被折到下一行。
  check('A17 操作区不换行（控件并排一行）', !/\.mcpm-actions\s*\{[^}]*flex-wrap/.test(code))
  // 传输方式与 URL 不占版面（只在名称 tooltip 里提供）。
  check('A18 行内不渲染 URL/传输方式详情', !clientSource.includes('mcpm-target'))
  check(
    'A19 启停用是按钮（不再是 switch）',
    !clientSource.includes('mcpm-switch') && /enabled \? "停用" : "启用"/.test(clientSource),
  )
  // 自适应：主体填满容器且可被压缩，长文本走省略号；卡片裁掉溢出，圆角不被分隔线破坏。
  const adaptive = [
    ['.mcpm-page', 'width:100%'],
    ['.mcpm-page', 'min-width:0'],
    // flex 子项默认 min-width:auto，内容一宽就会撑破容器 → 每个块级子项都要显式归零。
    ['.mcpm-form', 'min-width:0'],
    ['.mcpm-rowCard', 'min-width:0'],
    ['.mcpm-notice', 'min-width:0'],
    ['.mcpm-field', 'min-width:0'],
    ['.mcpm-meta', 'min-width:0'],
    ['.mcpm-meta', 'flex:1 1 auto'],
    ['.mcpm-name', 'text-overflow:ellipsis'],
    ['.mcpm-actions', 'flex:none'],
  ]
  const badAdaptive = missing(adaptive)
  check(
    'A26 自适应主体（填满 + 可压缩 + 省略号 + 不撑破）',
    badAdaptive.length === 0,
    badAdaptive.map(([c, d]) => `${c} { ${d} }`).join('; '),
  )
  check(
    'A26b 失败原因行可断行且不撑破卡片',
    ruleOf('.mcpm-rowError').includes('min-width:0') && ruleOf('.mcpm-rowError').includes('overflow-wrap:anywhere'),
    ruleOf('.mcpm-rowError'),
  )
  // inline 的尺寸会压过样式表，改档位时看不到效果（踩过：输入框 inline height 36px）。
  check('A27 不在 inline style 里写尺寸', !/style:\s*\{[^}]*\b(height|fontSize|padding|lineHeight)\s*:/.test(code))
  // 「等宽」与「多行」必须分离：混用会把 url 这种单行字段渲染成 56px 的大框。
  check(
    'A28 mono 与 multiline 分离',
    // multiline 必须真的换成 <textarea>（不是只加个 class）。打包器会在每个 h(...) 前插
    // `/* @__PURE__ */` 注解，所以不能断言 `? h("textarea"` 这种紧凑写法。
    /h\(\s*"textarea"/.test(clientSource) &&
      /mcpm-input--mono/.test(code) &&
      !clientSource.includes('mcpm-input mcpm-textarea'),
  )
  // 一卡一服务器：表单面板展开在**同一张卡内**，不在别处重复显示这一台。
  {
    const at = clientSource.indexOf('className: "mcpm-rows"')
    const rowsBlock = clientSource.slice(at, clientSource.indexOf('//#endregion', at) === -1 ? at + 2600 : at + 2600)
    check(
      'A29 每个服务器一张卡，表单展开在同一张卡内',
      at > 0 && rowsBlock.includes('mcpm-rowCard') && rowsBlock.includes('ServerForm'),
    )
    check('A30 编辑按钮可收起', clientSource.includes('editing ? "收起" : "编辑"'))
    // 按**属性语法**匹配，否则 box-sizing:border-box 里的 "border" 会误报。
    const formRule = code.match(/(?:^|\n)\s*\.mcpm-form\s*\{[^}]*\}/)?.[0] ?? ''
    // 只匹配描边类属性（border / border-top / border-width…），不能误伤 border-radius。
    const strokeProp = /[;{]\s*border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?\s*:/
    check(
      'A30b 表单面板不带描边（靠底色分层，否则卡片套卡片）',
      formRule !== '' && !strokeProp.test(formRule) && /background:var\(--dsw-alias-bg-module-platform/.test(formRule),
      formRule,
    )
  }
  // 行内操作必须是「宿主侧定点操作」，不能把整份数组回传——回传会因字段形状差异静默丢字段。
  check(
    'A20 客户端用定点操作而非整数组回传',
    clientSource.includes('op: "setEnabled"') &&
      clientSource.includes('op: "remove"') &&
      clientSource.includes('op: "save"'),
  )
  check(
    'A21 宿主支持三种操作',
    ['setEnabled', 'remove', 'save'].every((op) => new RegExp(`case ["']${op}["']`).test(hostSource)),
  )
  // 已实测的字段丢失根因：toRecord 不认「快照回传的对象」形状。
  //
  // 这条原本用正则匹配实现文本（`typeof value === 'object' && !Array.isArray(value)`）——
  // 那是在断言**实现写法**，不是行为：P3 把这段收窄逻辑抽成 isRecord() 之后正则就失效了，
  // 而行为其实一点没变。真正守住"对象形状不被静默清空"的是行为断言：
  // B18（解析成对象）/ B29、B34（启停后仍在）/ B39（表单路径保留对象）/ B40（文本形状也能解析）。
  // 所以这里退成"结构存在性"检查，并在标签里写明行为守卫的归属。
  check(
    'A22 toRecord 仍按"对象形状"分支（行为由 B18/B29/B34/B39/B40 守）',
    /function toRecord\(value\)[\s\S]{0,600}?isRecord\(value\)/.test(hostSource),
  )
  // 宿主半边不参与热重载，所以客户端必须能同时说两代协议。
  check(
    'A23 客户端做能力协商',
    /supports\(snapshot,\s*"setEnabled"\)/.test(clientSource) && clientSource.includes('capabilities'),
  )
  check(
    'A24 宿主声明 capabilities',
    /capabilities: \[["']setEnabled["'], ["']remove["'], ["']save["'], ["']lastError["'], ["']probe["'], ["']tools["']\]/.test(
      hostSource,
    ),
  )
  // 失败原因必须由宿主自己从 ctx.logger 里捞：mcp-client 默认 failOnStartupError=false，
  // 连接失败不会让 fiber 变 FAILED，而内置日志缓冲的默认阈值是 1（WARN=2 会被丢掉）。
  check(
    'A24b 宿主挂 logger exporter 且显式声明阈值（否则 warn 级原因被丢）',
    /logger\.exporter\(\{\s*levels:\s*\{\s*default:\s*3\s*\}/.test(hostSource),
  )
  check(
    'A24c 只认 mcp-client 自己的日志行（别的插件报错不算服务器故障）',
    hostSource.includes('^mcp-client\\(([^)]+)\\):') && hostSource.includes('MCP_LOG_LINE.exec(line)'),
  )
  // 主动探测必须有自己的超时：没有超时的话服务器挂死会把 UI 的按钮永久卡住。
  check(
    'A24d 主动探测带自己的超时（AbortController + PROBE_TIMEOUT_MS）',
    /PROBE_TIMEOUT_MS = [\d.eE+]+/.test(hostSource) &&
      hostSource.includes('new AbortController()') &&
      hostSource.includes('controller.abort()') &&
      hostSource.includes('clearTimeout(timer)'),
  )
  // 相位映射必须补全 LOADING（那才是"启动中"），不能只区分 active/其它。
  // 断言"数组内容与顺序"，不耦合引号风格：顺序就是 FiberState 的数值 → 相位的映射表。
  {
    const arrayText = /FIBER_PHASE\s*=\s*\[([^\]]*)\]/.exec(hostSource)?.[1] ?? ''
    const phases = [...arrayText.matchAll(/["']([a-z]+)["']/g)].map(([, phase]) => phase)
    check(
      'A24e 相位映射覆盖 LOADING（启动中）与 FAILED',
      same(phases, ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']),
      phases.join(','),
    )
  }
  // 探测预算必须留够**冷连接**余量。实测（本机 + 真实 profile，与 probeServer 同形状）：
  // 远程 https://mcp.context7.com/mcp 冷路径 1.6–3.0s、热连接 ~360ms，局域网服务器 3–10ms。
  // 3s 正好卡在冷路径的抖动边缘 → 配置正确的远程服务器被反复报成假红
  // 「超时（3s）：服务器没有响应」。取 8s ≈ 2.7 倍余量，别再退回 3s。
  check('A24f 探测预算留够冷连接余量（≥8s）', probeBudgetMs >= 8000, `budget=${String(probeBudgetMs)}ms`)
  // 退回整数组提交时，env/headers 必须转成旧宿主认识的文本形状，否则又会被清空。
  {
    const block = clientSource.slice(
      clientSource.indexOf('function serverOfExisting'),
      clientSource.indexOf('function supports'),
    )
    check(
      'A25 回退路径把 env/headers/args 转成文本',
      block.includes('flat.env = pairsToText') &&
        block.includes('flat.headers = pairsToText') &&
        // args 必须被拼成"换行文本"再回传；具体是 config.args.join 还是先 map 成字符串再 join，
        // 属于实现细节（产物由打包器生成，写法会变），所以只钉住"确实 join 了"。
        /flat\.args = [^\n]*\.join\(/.test(block),
    )
  }
}

// 布局护栏：动作按钮与长说明文字不能挤在同一个 flex 行里抢宽度。
{
  check(
    'A13 标题行与说明文字分层（heading/titleRow）',
    clientSource.includes('mcpm-heading') && clientSource.includes('mcpm-titleRow'),
  )
  // 产物由打包器生成：`const` 可能被打印成 `var`，JSX 也不再是 `h(...)` 的字面写法，
  // 所以这里用"声明关键字可选"的锚点，并且**显式断言锚点找到了**——否则 indexOf 返回 -1
  // 会让切片变成一片空白，断言就成了永远通过的摆设。
  const headerAt = clientSource.search(/\b(?:const|var|let) header =/)
  const headerBlock = clientSource.slice(headerAt, clientSource.indexOf('if (loadError !== null)'))
  const rowAt = headerBlock.indexOf('mcpm-titleRow')
  const subtitleAt = headerBlock.indexOf('mcpm-subtitle')
  check('A14 说明文字在标题行之外', headerAt >= 0 && rowAt >= 0 && subtitleAt > rowAt)
}

// 导航图标护栏：DSH 的设置导航是**硬编码 id→图标**、未知 id 兜底成齿轮
// （dsh-client-ui-settings-general/lib/client.js:244-267），注册契约里没有 icon 字段，
// 所以本插件只能渲染后给自己那一格打标记再覆盖。下面把「标记方式」与「标记几何」都钉住。
{
  // 官方墨迹包围盒（含描边）：由官方仓库 docs/favicon.svg 那三条 path 采样解析得到。
  const OFFICIAL_INK = { x: 18.06625, y: 10.63465, w: 143.0821, h: 159.1557 }
  const TARGET_HEIGHT = 15

  const asset = await readFile(join(root, 'assets', 'mcp-mark.svg'), 'utf8')
  // 注释里也会出现 stroke-width 之类的字样，先剥掉再解析，否则会取到注释里的数字。
  const assetMarkup = asset.replace(/<!--[\s\S]*?-->/g, '')
  const assetPaths = [...assetMarkup.matchAll(/<path d="([^"]+)"/g)].map(([, d]) => d)
  const inlinePaths = [...clientSource.matchAll(/<path d="([^"]+)"/g)].map(([, d]) => d)
  check(
    'A32 MCP 标记：内联副本与 assets/mcp-mark.svg 的三条 path 逐字一致',
    assetPaths.length === 3 && inlinePaths.length === 3 && same(assetPaths, inlinePaths),
    `asset=${assetPaths.length} inline=${inlinePaths.length}`,
  )
  check(
    'A33 MCP 标记：几何与官方 favicon 同源（round linecap + currentColor，无硬编码颜色）',
    /stroke-linecap="round"/.test(assetMarkup) &&
      /stroke="currentColor"/.test(assetMarkup) &&
      !/#[0-9a-fA-F]{3,8}/.test(assetMarkup),
  )

  // 变换必须能把官方墨迹放进 16x16：高 = 15、居中、有效描边 = 1.0。
  const numbers = (text: string): { tx: number; ty: number; scale: number; stroke: number } | null => {
    const transform = text.match(/translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)/)
    const stroke = text.match(/stroke-width="([\d.]+)"/)
    return transform === null || stroke === null
      ? null
      : { tx: Number(transform[1]), ty: Number(transform[2]), scale: Number(transform[3]), stroke: Number(stroke[1]) }
  }
  const inline = numbers(clientSource)
  const inAsset = numbers(assetMarkup)
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol
  const geometryOk =
    inline !== null &&
    inAsset !== null &&
    same(inline, inAsset) &&
    near(inline.scale, TARGET_HEIGHT / OFFICIAL_INK.h, 1e-6) &&
    near(inline.tx + (OFFICIAL_INK.x + OFFICIAL_INK.w / 2) * inline.scale, 8, 1e-3) &&
    near(inline.ty + (OFFICIAL_INK.y + OFFICIAL_INK.h / 2) * inline.scale, 8, 1e-3) &&
    near(inline.stroke * inline.scale, 1, 0.02)
  check('A34 MCP 标记：按官方比例缩进 16x16（墨迹高 15、居中、有效描边 1.0）', geometryOk, JSON.stringify(inline))

  const code = clientSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  check(
    'A35 导航标记用官方 data 锚点，不依赖 CSS-module 哈希类名',
    code.includes('\'[data-shortcut-modal="settings"]\'') ||
      code.includes('NAV_DIALOG_SELECTOR = \'[data-shortcut-modal="settings"]\''),
  )
  check(
    'A36 导航标记只 setAttribute/removeAttribute，不改 React 节点树',
    /cell\.setAttribute\(NAV_ATTRIBUTE, "1"\)/.test(code) &&
      /removeAttribute\(NAV_ATTRIBUTE\)/.test(code) &&
      !/document\.body\.append|\.removeChild\(|innerHTML/.test(code),
  )
  check(
    'A37 只隐藏官方 <svg>，不隐藏我们自己那一格',
    /\[data-shortcut-modal="settings"\] button\[data-mcpm-nav\] > svg \{ display:none; \}/.test(clientSource) &&
      !/button\[data-mcpm-nav\]\s*\{[^}]*display\s*:\s*none/.test(clientSource),
  )
  // 注意：这条规则里含 `${MCP_MARK_DATA_URI}`，用 `[^}]*` 取规则会在第一个 `}` 处截断，
  // 所以按「行」取（样式表里一条规则一行）。
  const markAt = clientSource.indexOf('button[data-mcpm-nav]::before')
  const markRule = markAt < 0 ? '' : clientSource.slice(markAt, clientSource.indexOf('\n', markAt))
  check(
    'A38 标记颜色走 currentColor，几何走内联 SVG 的 data URI（不是外链图片或硬编码颜色）',
    markRule.includes('background-color:currentColor') &&
      markRule.includes('mask:url("${MCP_MARK_DATA_URI}")') &&
      markRule.includes('width:16px') &&
      // 打包器会把 `const` 打印成 `var`，所以声明关键字要可选。
      /(?:const|var|let) MCP_MARK_DATA_URI = `data:image\/svg\+xml,\$\{encodeURIComponent\(MCP_MARK_SVG\)\}`/.test(
        clientSource,
      ),
    markRule.slice(0, 120),
  )
}
//#endregion

//#region B. 宿主半边
const host = await import(new URL('../lib/index.js', import.meta.url).href)
check('B1 导出 name', host.name === 'dsh-mcp-manager', String(host.name))
check('B2 导出 apply', typeof host.apply === 'function')

/**
 * 造一个够用的假宿主上下文；写入会落到 state，因此可以连续操作。
 * @param layers - 可选：显式给出 `configEditor.configuration()` 的继承层/覆写层
 *   （默认 `inherited = state.rows`、`override = undefined`，即"只有 insert 层"）。
 *   B70 用它复现"覆写行存在、insert 行里还留着旧字段"的真实分层现场。
 * @param registeredTools - 可选：假 `ctx.tools` 注册表里**全部**工具名（宿主按
 *   `mcp__<serverName>__` 前缀归属给某台服务器，所以这里要把别人的工具也放进来）。
 */
function makeHostCtx({
  configRows = [],
  mcpChildren = [],
  withLogger = true,
  layers = undefined,
  registeredTools = undefined,
}: {
  configRows?: StubEntry[]
  mcpChildren?: StubChild[]
  withLogger?: boolean
  layers?: { inherited?: StubEntry[]; override?: StubEntry[] } | undefined
  registeredTools?: string[] | undefined
} = {}) {
  const captured: {
    deps: string[] | null
    /** 恒为 StubRoute；"还没注册"用 `unregisteredRoute` 这个占位表示（见类型脚手架）。 */
    route: StubRoute
    /** 每次写入都是**整份数组**（`configEditor.edit` 的语义就是"给我一份新数组"）。 */
    writes: StubEntry[][]
    exporters: StubExporter[]
  } = {
    deps: null,
    route: unregisteredRoute,
    writes: [],
    exporters: [],
  }
  const state: { rows: StubEntry[] } = { rows: structuredClone(configRows) }
  const groupEntry = {
    options: {
      id: 'mcp-manager',
      name: 'cordis:group',
      get config(): StubEntry[] {
        return state.rows
      },
    },
  }
  /** cordis LoggerLevel：ERROR=0 / INFO=1 / WARN=2 / DEBUG=3（数字越大越啰嗦）。 */
  const LEVELS: Record<string, number> = { error: 0, info: 1, warn: 2, debug: 3 }
  /** 假 `ctx.tools`：只提供宿主用到的 `schemas()`；`registeredTools` 为 undefined 时视作"没有该服务"。 */
  const fakeTools:
    { schemas(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> } | undefined =
    registeredTools === undefined
      ? undefined
      : { schemas: () => registeredTools.map((name) => ({ name, description: '', parameters: {} })) }
  /** 把一条结构化日志喂给宿主注册的 exporter，模拟 mcp-client 自己打的日志。 */
  const log = (type: string, text: string, ts = 1_700_000_000_000): void => {
    for (const exporter of captured.exporters) {
      exporter.export({
        sn: captured.exporters.length,
        ts,
        type,
        level: LEVELS[type],
        name: 'mcp-client',
        args: [text],
      })
    }
  }
  const ctx = {
    inject(deps: string[], callback: (scope: HostScopeStub) => void): void {
      captured.deps = deps
      callback({
        effect: (factory: () => (() => void) | void) => factory(),
        // 宿主半边用 `scope.get('tools')` 取**可选**服务（不进 inject 声明，缺了也能跑）。
        get: (name: string): unknown => (name === 'tools' ? fakeTools : undefined),
        ...(withLogger
          ? {
              logger: {
                exporter: (exporter: StubExporter) => {
                  captured.exporters.push(exporter)
                  return () => {}
                },
              },
            }
          : {}),
        configEditor: {
          entries: () => [groupEntry],
          configuration: () => [
            {
              entry: groupEntry,
              // 默认就是"只有 insert 层"；给了 layers 就照实给两层（覆写层可以为 undefined）。
              inherited: layers === undefined ? state.rows : structuredClone(layers.inherited ?? []),
              override:
                layers === undefined || layers.override === undefined ? undefined : structuredClone(layers.override),
            },
          ],
          edit: async (entry: unknown, change: (rows: StubEntry[], again: StubEntry[]) => unknown) => {
            // 宿主回调的返回类型是 `unknown`（它只承诺"给我一份新数组"）；这里是我们自己的假 ctx，
            // 知道那就是条目数组，所以就地收窄一次。
            const next = change(state.rows, state.rows) as StubEntry[]
            captured.writes.push(structuredClone(next))
            state.rows = next
          },
        },
        loader: {
          entries: () =>
            mcpChildren.map((child) => ({
              options: { id: child.id, name: '@deepseek-ai/dsh-mcp-client', config: child.config },
              fiber: child.state === undefined ? undefined : { state: child.state },
            })),
        },
        connection: {
          fetch: {
            register: (route: StubRoute) => {
              captured.route = route
              return async () => {}
            },
          },
        },
      })
    },
  }
  return { ctx, captured, groupEntry, log }
}

{
  const { ctx, captured } = makeHostCtx({
    configRows: [
      {
        id: 'abc123',
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp' },
      },
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'fs', transport: 'stdio', command: 'npx' },
        disabled: true,
      },
    ],
    mcpChildren: [{ id: 'abc123', config: { serverName: 'context7' }, state: 2 }],
  })
  host.apply(ctx)
  check(
    'B3 声明了三个依赖',
    same(captured.deps, ['connection', 'configEditor', 'loader']),
    JSON.stringify(captured.deps),
  )
  check('B4 注册了路由', captured.route !== unregisteredRoute)
  check('B5 路由路径', captured.route?.path === '/api/mcp-manager', String(captured.route?.path))
  check('B6 路由方法', same(captured.route?.methods, ['GET', 'POST']), JSON.stringify(captured.route?.methods))
  check('B7 路由带 requestBody 模式', captured.route?.requestBody === 'buffered', String(captured.route?.requestBody))
  check('B7b 路由路径符合 /api/<name> 约定', /^\/api\/[^/]+$/.test(String(captured.route?.path ?? '')))

  const getResponse = await captured.route.fetch(new Request('http://localhost/api/mcp-manager', { method: 'GET' }))
  const getBody = await bodyOf(getResponse)
  check('B8 GET 200', getResponse.status === 200, String(getResponse.status))
  check('B9 GET 汇报 configured', getBody.data?.configured === true)
  check(
    'B9b GET 声明 capabilities',
    same(getBody.data?.capabilities, ['setEnabled', 'remove', 'save', 'lastError', 'probe', 'tools']),
    JSON.stringify(getBody.data?.capabilities),
  )
  check('B10 GET 列出 2 台服务器', getBody.data?.servers?.length === 2, JSON.stringify(getBody.data?.servers?.length))
  check('B11 第一台运行中', getBody.data?.servers?.[0]?.phase === 'active', String(getBody.data?.servers?.[0]?.phase))
  check('B12 第二台 disabled', getBody.data?.servers?.[1]?.disabled === true)
  check('B13 第二台未加载', getBody.data?.servers?.[1]?.phase === 'absent', String(getBody.data?.servers?.[1]?.phase))

  const saveResponse = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', {
      method: 'POST',
      body: JSON.stringify({
        op: 'save',
        servers: [
          {
            rowId: 'abc123',
            serverName: 'context7',
            transport: 'streamable-http',
            url: 'https://mcp.context7.com/mcp',
            headers: 'Authorization=Bearer x',
          },
          { serverName: 'fs', transport: 'stdio', command: 'npx', args: '-y\npkg', env: 'A=1\n# comment\nB=2' },
        ],
      }),
    }),
  )
  const saveBody = await bodyOf(saveResponse)
  check('B14 POST 200', saveResponse.status === 200, `${String(saveResponse.status)} ${JSON.stringify(saveBody)}`)
  const written = captured.writes.at(-1)
  check('B15 写的是数组', Array.isArray(written), JSON.stringify(written))
  check('B16 保留 rowId', written?.[0]?.id === 'abc123', JSON.stringify(written?.[0]))
  check('B17 条目名是 mcp 包', written?.[0]?.name === '@deepseek-ai/dsh-mcp-client')
  check(
    'B18 headers 解析成对象',
    same(written?.[0]?.config?.headers, { Authorization: 'Bearer x' }),
    JSON.stringify(written?.[0]?.config?.headers),
  )
  check(
    'B19 args 按行拆分',
    same(written?.[1]?.config?.args, ['-y', 'pkg']),
    JSON.stringify(written?.[1]?.config?.args),
  )
  check(
    'B20 env 忽略注释行',
    same(written?.[1]?.config?.env, { A: '1', B: '2' }),
    JSON.stringify(written?.[1]?.config?.env),
  )

  const badName = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', {
      method: 'POST',
      body: JSON.stringify({
        op: 'save',
        servers: [{ serverName: 'bad name!', transport: 'streamable-http', url: 'x' }],
      }),
    }),
  )
  check('B21 非法 serverName → 409', badName.status === 409, String(badName.status))

  const badUrl = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', {
      method: 'POST',
      body: JSON.stringify({ op: 'save', servers: [{ serverName: 'ok', transport: 'streamable-http', url: '' }] }),
    }),
  )
  check('B22 空 url → 409', badUrl.status === 409, String(badUrl.status))

  const badOp = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', { method: 'POST', body: JSON.stringify({ op: 'nope' }) }),
  )
  check('B23 未知操作 → 400', badOp.status === 400, String(badOp.status))
  check('B24 非法写入没有落盘', captured.writes.length === 1, String(captured.writes.length))
}

{
  // 组条目缺失时必须给出可读报错，而不是静默失败。
  const captured = { route: unregisteredRoute }
  host.apply({
    inject(_deps: string[], callback: (scope: HostScopeStub) => void) {
      callback({
        effect: (factory: () => (() => void) | void) => factory(),
        configEditor: { entries: () => [], configuration: () => [], edit: async () => {} },
        loader: { entries: () => [] },
        connection: {
          fetch: {
            register: (route: StubRoute) => {
              captured.route = route
              return async () => {}
            },
          },
        },
      })
    },
  })
  const response = await captured.route.fetch(new Request('http://localhost/api/mcp-manager', { method: 'GET' }))
  const body = await bodyOf(response)
  check('B25 组条目缺失时 configured=false', body.data?.configured === false, JSON.stringify(body.data))
  const save = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', {
      method: 'POST',
      body: JSON.stringify({ op: 'save', servers: [] }),
    }),
  )
  check('B26 组条目缺失时写入 → 409', save.status === 409, String(save.status))
}

{
  // 回归测试（线上 bug）：行内「停用」必须只改 disabled，
  // 且**绝不能丢掉 headers/env**——曾经的整数组回传 + 字段形状差异会把
  // context7 的 Authorization 头静默清空。
  const context7 = {
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      serverName: 'context7',
      transport: 'streamable-http',
      url: 'https://mcp.context7.com/mcp',
      headers: { Authorization: 'Bearer secret' },
    },
  }
  const other = {
    name: '@deepseek-ai/dsh-mcp-client',
    config: { serverName: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } },
  }
  const { ctx, captured } = makeHostCtx({ configRows: [context7, other] })
  host.apply(ctx)
  const post = (payload: Record<string, unknown>): Promise<Response> =>
    captured.route.fetch(
      new Request('http://localhost/api/mcp-manager', { method: 'POST', body: JSON.stringify(payload) }),
    )

  const off = await post({ op: 'setEnabled', serverName: 'context7', enabled: false })
  const offBody = await bodyOf(off)
  check('B27 停用 → 200', off.status === 200, `${String(off.status)} ${JSON.stringify(offBody)}`)
  const offRows = captured.writes.at(-1)
  check('B28 停用确实写入了 disabled', offRows?.[0]?.disabled === true, JSON.stringify(offRows?.[0]))
  check(
    'B29 停用保留了 headers',
    same(offRows?.[0]?.config?.headers, { Authorization: 'Bearer secret' }),
    JSON.stringify(offRows?.[0]?.config),
  )
  check('B30 停用没有动另一行', same(offRows?.[1], other), JSON.stringify(offRows?.[1]))
  check(
    'B31 响应里 context7 已是停用',
    offBody.data?.servers?.[0]?.disabled === true,
    JSON.stringify(offBody.data?.servers?.[0]),
  )

  const on = await post({ op: 'setEnabled', serverName: 'context7', enabled: true })
  const onBody = await bodyOf(on)
  check('B32 启用 → 200', on.status === 200, String(on.status))
  const onRows = captured.writes.at(-1)
  check('B33 启用移除了 disabled', !('disabled' in (onRows?.[0] ?? {})), JSON.stringify(onRows?.[0]))
  check(
    'B34 启用仍然保留 headers',
    same(onRows?.[0]?.config?.headers, { Authorization: 'Bearer secret' }),
    JSON.stringify(onRows?.[0]?.config),
  )
  check(
    'B35 响应里 context7 已启用',
    onBody.data?.servers?.[0]?.disabled === false,
    JSON.stringify(onBody.data?.servers?.[0]),
  )

  const gone = await post({ op: 'remove', serverName: 'fs' })
  const goneBody = await bodyOf(gone)
  check(
    'B36 删除 → 200 且只剩一台',
    gone.status === 200 && goneBody.data?.servers?.length === 1,
    JSON.stringify(goneBody.data?.servers),
  )
  check(
    'B37 删掉的是 fs，context7 完好',
    goneBody.data?.servers?.[0]?.config?.serverName === 'context7',
    JSON.stringify(goneBody.data?.servers),
  )

  const miss = await post({ op: 'setEnabled', serverName: 'nope', enabled: false })
  check('B38 名字找不到 → 409', miss.status === 409, String(miss.status))

  // 表单路径仍需接受「快照回传的对象形状」，否则编辑保存也会清空 headers。
  const form = await post({
    op: 'save',
    servers: [
      {
        serverName: 'context7',
        transport: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        headers: { Authorization: 'Bearer kept' },
      },
    ],
  })
  const formRows = captured.writes.at(-1)
  check(
    'B39 表单提交也保留对象形状的 headers',
    form.status === 200 && same(formRows?.[0]?.config?.headers, { Authorization: 'Bearer kept' }),
    JSON.stringify(formRows?.[0]?.config),
  )

  // 回退路径（宿主半边尚未重载时走的就是它）：客户端发的是「多行文本」形状。
  const fallback = await post({
    op: 'save',
    servers: [
      {
        serverName: 'context7',
        transport: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        headers: 'Authorization=Bearer text-shape',
        disabled: true,
      },
      { serverName: 'fs', transport: 'stdio', command: 'npx', args: '-y\npkg', env: 'A=1\nB=2' },
    ],
  })
  const fbRows = captured.writes.at(-1)
  check(
    'B40 回退路径：文本形状 headers 解析成对象',
    fallback.status === 200 && same(fbRows?.[0]?.config?.headers, { Authorization: 'Bearer text-shape' }),
    JSON.stringify(fbRows?.[0]?.config),
  )
  check('B41 回退路径：disabled 落盘', fbRows?.[0]?.disabled === true, JSON.stringify(fbRows?.[0]))
  check(
    'B42 回退路径：文本 args/env 解析正确',
    same(fbRows?.[1]?.config?.args, ['-y', 'pkg']) && same(fbRows?.[1]?.config?.env, { A: '1', B: '2' }),
    JSON.stringify(fbRows?.[1]?.config),
  )
}

{
  // 失败原因采集（README 7.6）：宿主自己挂 logger exporter，把 mcp-client 的
  // warn/error 原文带进快照。没有它，页面上只有 fiber 相位，而 mcp-client 默认
  // `failOnStartupError:false` —— 连不上也保持 ACTIVE，于是永远显示「运行中」。
  const { ctx, captured, log } = makeHostCtx({
    configRows: [
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp' },
      },
      { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'fs', transport: 'stdio', command: 'npx' } },
    ],
    mcpChildren: [
      { id: 'a', config: { serverName: 'context7' }, state: 2 },
      { id: 'b', config: { serverName: 'fs' }, state: 2 },
    ],
  })
  host.apply(ctx)
  const snapshotOf = async (): Promise<StubSnapshot | undefined> =>
    (await bodyOf(await captured.route.fetch(new Request('http://localhost/api/mcp-manager', { method: 'GET' })))).data

  check('B43 宿主注册了自己的 logger exporter', captured.exporters.length === 1, String(captured.exporters.length))
  // 阈值必须**自己声明**：cordis 内置缓冲没声明 levels → 取 Logger.level ?? 1，
  // 而 WARN=2，`targetLevel < level` 直接丢弃 —— "为什么连不上"恰好是 warn。
  check(
    'B44 exporter 显式声明阈值（默认阈值 1 会把 warn 丢掉）',
    typeof captured.exporters[0]?.levels?.default === 'number' && captured.exporters[0].levels.default >= 2,
    JSON.stringify(captured.exporters[0]?.levels),
  )

  const clean = await snapshotOf()
  check('B45 没有记录时快照不带 error 键', !('error' in (clean.servers?.[0] ?? {})), JSON.stringify(clean.servers?.[0]))

  log('warn', 'mcp-client(context7): connection attempt failed: Error: connect ECONNREFUSED 127.0.0.1:443')
  const warned = await snapshotOf()
  check(
    'B46 warn 原文进入快照',
    warned.servers?.[0]?.error?.message === 'connection attempt failed: Error: connect ECONNREFUSED 127.0.0.1:443',
    JSON.stringify(warned.servers?.[0]?.error),
  )
  check(
    'B47 记下级别与时间戳',
    warned.servers?.[0]?.error?.level === 'warn' && warned.servers?.[0]?.error?.at === 1_700_000_000_000,
    JSON.stringify(warned.servers?.[0]?.error),
  )
  check(
    'B48 只影响这一台（另一台仍无记录）',
    !('error' in (warned.servers?.[1] ?? {})),
    JSON.stringify(warned.servers?.[1]),
  )

  log('warn', 'mcp-client(context7): connection failed; retrying in 500ms (attempt 2/10)')
  const counted = await snapshotOf()
  check(
    'B49 同一台多次失败累计 count',
    counted.servers?.[0]?.error?.count === 2,
    JSON.stringify(counted.servers?.[0]?.error),
  )

  // 别的子系统的 error 不能算到服务器头上，否则任意一条宿主报错都会让页面报「运行异常」。
  // 这一行特意**内嵌**了 mcp-client 的形状：只有锚定行首（^）才不会把无关日志误认成故障。
  log('error', 'llm: mcp-client(fs): embedded mention must not be attributed')
  const unrelated = await snapshotOf()
  check(
    'B50 非 mcp-client 前缀的日志不入账（含内嵌同名形状）',
    same(unrelated.servers?.[0]?.error, counted.servers?.[0]?.error) && !('error' in (unrelated.servers?.[1] ?? {})),
    JSON.stringify(unrelated.servers?.[1]?.error),
  )

  const givingUp =
    'giving up after 10 consecutive failed reconnect attempts — tools unregistered; reload the plugin or restart the Host to reconnect'
  log('error', `mcp-client(fs): ${givingUp}`)
  check(
    'B51 error 级也采集（放弃重连也要看得见）',
    (await snapshotOf()).servers?.[1]?.error?.message === givingUp,
    JSON.stringify((await snapshotOf()).servers?.[1]?.error),
  )

  log('info', 'mcp-client(context7): reconnected and re-synced tools (attempt 2/10)')
  check('B52 恢复信号清掉旧记录', !('error' in ((await snapshotOf()).servers?.[0] ?? {})), 'still present')

  const write = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', {
      method: 'POST',
      body: JSON.stringify({ op: 'setEnabled', serverName: 'fs', enabled: false }),
    }),
  )
  const writeBody = await bodyOf(write)
  check(
    'B53 任一次配置写入会清空旧失败记录（旧实例的记录不代表现状）',
    write.status === 200 && !('error' in (writeBody.data?.servers?.[1] ?? {})),
    JSON.stringify(writeBody.data?.servers?.[1]),
  )
}

{
  // 边界：超长原文必须截断（一条日志可能是整段栈），且缺 logger 的宿主替身不能崩。
  const long = makeHostCtx({
    configRows: [
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'x', transport: 'streamable-http', url: 'https://x' },
      },
    ],
  })
  host.apply(long.ctx)
  long.log('error', `mcp-client(x): ${'E'.repeat(4000)}`)
  const longBody = await (await long.captured.route.fetch(new Request('http://localhost/api/mcp-manager'))).json()
  check(
    'B54 超长原文按上限截断',
    longBody.data?.servers?.[0]?.error?.message?.length === 500,
    String(longBody.data?.servers?.[0]?.error?.message?.length),
  )

  const bare = makeHostCtx({
    configRows: [
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'y', transport: 'streamable-http', url: 'https://y' },
      },
    ],
    withLogger: false,
  })
  let crashed = false
  try {
    host.apply(bare.ctx)
  } catch (error) {
    crashed = true
    void error
  }
  const bareBody = crashed
    ? null
    : await (await bare.captured.route.fetch(new Request('http://localhost/api/mcp-manager'))).json()
  check(
    'B55 没有 logger 服务时优雅降级（不抛、路由照常）',
    crashed === false && bareBody?.data?.servers?.length === 1,
    `crashed=${String(crashed)}`,
  )
}

{
  // 相位映射：LOADING 才是真正的"启动中"；FAILED 必须能报出来。
  // 数值取自 cordis FiberState（PENDING=0/LOADING=1/ACTIVE=2/FAILED=3/DISPOSED=4/UNLOADING=5）。
  const rowsOf = (states) => {
    const { ctx, captured } = makeHostCtx({
      configRows: states.map((_, index) => ({
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: `s${String(index)}`, transport: 'streamable-http', url: 'https://x' },
      })),
      mcpChildren: states.map((state, index) => ({
        id: `s${String(index)}`,
        config: { serverName: `s${String(index)}` },
        state,
      })),
    })
    host.apply(ctx)
    return captured.route.fetch(new Request('http://localhost/api/mcp-manager')).then((response) => response.json())
  }
  const mapped = await rowsOf([0, 1, 2, 3, 4, 5, undefined])
  const phases = mapped.data?.servers?.map((server) => server.phase)
  check(
    'B56 相位映射覆盖全部 FiberState（loading 不再被当成"未运行"）',
    same(phases, ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading', 'pending']),
    JSON.stringify(phases),
  )
}

{
  // 主动探测（op:"probe"）：日志只能说明"过去失败过"，探测才能说明"现在答不答"。
  // 这是"绿灯但没反应"的正解，也覆盖 mcp-client 放弃重连后不再打日志的窗口。
  const url = (n) => `http://10.9.9.${String(n)}/mcp`
  const { ctx, captured } = makeHostCtx({
    configRows: [
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'ok', transport: 'streamable-http', url: url(1), headers: { 'x-token': 'tok' } },
      },
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'auth', transport: 'streamable-http', url: url(3) },
      },
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'dead', transport: 'streamable-http', url: url(2) },
      },
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'notmcp', transport: 'streamable-http', url: url(5) },
      },
      { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'local', transport: 'stdio', command: 'npx' } },
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'off', transport: 'streamable-http', url: url(9) },
        disabled: true,
      },
    ],
    mcpChildren: [],
  })
  host.apply(ctx)

  const realFetch = globalThis.fetch
  const calls = []
  const SSE_OK = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"ok"}}}\n\n'
  globalThis.fetch = async (target, init) => {
    calls.push({ target, init })
    if (target === url(1))
      return new Response(SSE_OK, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    if (target === url(3))
      return new Response('{"error":"token expired"}', { status: 401, headers: { 'content-type': 'application/json' } })
    if (target === url(2)) {
      const error = new TypeError('fetch failed')
      error.cause = new Error('connect ECONNREFUSED 10.9.9.2:80')
      throw error
    }
    if (target === url(5))
      return new Response('<html>hello</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    throw new Error(`unexpected probe target: ${target}`)
  }

  const probe = async (payload = { op: 'probe' }) => {
    const response = await captured.route.fetch(
      new Request('http://localhost/api/mcp-manager', { method: 'POST', body: JSON.stringify(payload) }),
    )
    return { status: response.status, body: await response.json() }
  }
  const byName = (body, name) => body.data?.servers?.find((server) => server.config?.serverName === name)

  try {
    const result = await probe()
    check('B57 探测返回 200', result.status === 200, JSON.stringify(result.body).slice(0, 200))
    check(
      'B58 探测只打启用中的服务器（停用的不发请求）',
      calls.length === 4 && !calls.some((call) => call.target === url(9)),
      `${String(calls.length)} calls`,
    )

    const sent = calls.find((call) => call.target === url(1))
    check(
      'B59 探测请求是 MCP initialize，且带上配置里的 headers',
      sent?.init?.method === 'POST' &&
        sent.init.headers['content-type'] === 'application/json' &&
        sent.init.headers['x-token'] === 'tok' &&
        String(sent.init.body).includes('"method":"initialize"'),
      JSON.stringify(sent?.init?.headers),
    )

    check(
      'B60 探测通过 → connected:true',
      byName(result.body, 'ok')?.probe?.connected === true,
      JSON.stringify(byName(result.body, 'ok')?.probe),
    )
    check(
      'B61 HTTP 401 → connected:false 且带上状态与响应片段',
      byName(result.body, 'auth')?.probe?.connected === false &&
        byName(result.body, 'auth')?.probe?.detail.includes('401') &&
        byName(result.body, 'auth')?.probe?.detail.includes('token expired'),
      JSON.stringify(byName(result.body, 'auth')?.probe),
    )
    check(
      'B62 TCP 拒绝 → 报出 cause 里的真实原因（不是无用的 "fetch failed"）',
      byName(result.body, 'dead')?.probe?.connected === false &&
        byName(result.body, 'dead')?.probe?.detail.includes('ECONNREFUSED'),
      JSON.stringify(byName(result.body, 'dead')?.probe),
    )
    check(
      'B63 200 但不是 MCP → connected:false（防止把 HTML 门户当成可用服务器）',
      byName(result.body, 'notmcp')?.probe?.connected === false &&
        byName(result.body, 'notmcp')?.probe?.detail.includes('不是 MCP'),
      JSON.stringify(byName(result.body, 'notmcp')?.probe),
    )
    check(
      'B64 stdio 无法探测 → connected:null（不谎报失败）',
      byName(result.body, 'local')?.probe?.connected === null &&
        byName(result.body, 'local')?.probe?.detail.includes('stdio'),
      JSON.stringify(byName(result.body, 'local')?.probe),
    )
    check('B65 停用的服务器不被探测（快照里没有 probe）', !('probe' in (byName(result.body, 'off') ?? {})))

    const one = await probe({ op: 'probe', serverName: 'ok' })
    check(
      'B66 可以只探一台',
      one.status === 200 && calls.length === 5,
      `${String(one.status)} calls=${String(calls.length)}`,
    )
    const missing = await probe({ op: 'probe', serverName: 'nope' })
    check('B67 探测不存在的服务器 → 409', missing.status === 409, String(missing.status))

    // 配置写入会重建子条目 → 旧探测结论必须失效，否则"改完 url 还显示上一次的结果"。
    const written = await captured.route.fetch(
      new Request('http://localhost/api/mcp-manager', {
        method: 'POST',
        body: JSON.stringify({ op: 'setEnabled', serverName: 'ok', enabled: false }),
      }),
    )
    const writtenBody = await bodyOf(written)
    check(
      'B68 配置写入清空旧探测结果',
      !('probe' in (byName(writtenBody, 'ok') ?? {})),
      JSON.stringify(byName(writtenBody, 'ok')?.probe),
    )
  } finally {
    globalThis.fetch = realFetch
  }

  // 挂死的服务器：必须在自己的预算内判定"超时"，不能把 UI 永久卡住。
  const { ctx: hangCtx, captured: hangCaptured } = makeHostCtx({
    configRows: [
      {
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'slow', transport: 'streamable-http', url: url(7) },
      },
    ],
  })
  host.apply(hangCtx)
  globalThis.fetch = (_target, init) =>
    new Promise((_resolve, reject) => {
      // 自限兜底（比实现里的预算多 3s）：正确实现会在预算内 abort；
      // 万一实现漏了 abort，这里也不会把自检永久挂死，而是让 B69 以"没超时"的形式失败。
      const guard = setTimeout(() => reject(new Error('probe never aborted the request')), probeBudgetMs + 3000)
      init.signal.addEventListener('abort', () => {
        clearTimeout(guard)
        reject(new Error('The operation was aborted'))
      })
    })
  try {
    const response = await hangCaptured.route.fetch(
      new Request('http://localhost/api/mcp-manager', { method: 'POST', body: JSON.stringify({ op: 'probe' }) }),
    )
    const body = await bodyOf(response)
    check(
      'B69 挂死的服务器 → 超时（' + String(probeBudgetMs / 1000) + 's 预算内给出结论）',
      body.data?.servers?.[0]?.probe?.connected === false && body.data?.servers?.[0]?.probe?.detail.includes('超时'),
      JSON.stringify(body.data?.servers?.[0]?.probe),
    )
  } finally {
    globalThis.fetch = realFetch
  }

  // 覆写层是**整数组替换**，不是"继承层"。
  // 证据：cordis-plugin-include 的 applyEntryPatches 对非 insert 补丁逐键赋值
  // （`target[key] = value`，lib/index.js:99-102 / src/index.ts:120-123），于是
  // `target.config = 覆写数组` —— insert 行里同 id 的那份声明被**整体丢弃**。
  // 线上就是这么中的：profile 的 insert 行一直写着 `Authorization: Bearer <context7 key>`，
  // 而权威的覆写行没有 headers → 运行时这个头根本不存在，可文件看上去"key 已经配好了"。
  // 这条钉住插件侧的读法：覆写非空时**只认覆写**，绝不把两层合并（也别"补回"继承层的字段）——
  // 合并会让那份死配置重新变成生效值，还会凭空多出一台服务器。
  {
    const insertRow = {
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'context7',
        transport: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        headers: { Authorization: 'Bearer FAKE-insert-layer-value' },
      },
    }
    const overrideRow = {
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp' },
    }
    const layered = makeHostCtx({
      configRows: [overrideRow],
      layers: { inherited: [insertRow], override: [overrideRow] },
    })
    host.apply(layered.ctx)
    const response = await layered.captured.route.fetch(new Request('http://localhost/api/mcp-manager'))
    const body = await bodyOf(response)
    const rows = body.data?.servers ?? []
    check(
      'B70 覆写层整数组替换：只认覆写行，不合并 insert 层（合并会把死配置当成生效）',
      rows.length === 1 && same(rows[0]?.config, overrideRow.config),
      JSON.stringify(rows.map((row) => row.config)),
    )
  }

  // 每台服务器"当前注册了几个工具、分别叫什么"。宿主问的是**注册表**（`ctx.tools.schemas()`），
  // 不是再发一次 `tools/list`：注册表就是模型此刻真正能调用的集合，连不上的服务器自然没有名字。
  {
    const context7 = {
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'context7', transport: 'streamable-http', url: 'https://x' },
    }
    const gva = {
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'gva', transport: 'streamable-http', url: 'https://y' },
    }
    // 故意乱序、混入别人的工具和非 MCP 工具：归属只认 `mcp__<serverName>__` 前缀。
    const registry = [
      'mcp__context7__query-docs',
      'mcp__gva__create_api',
      'mcp__context7__resolve-library-id',
      'read_image',
      'mcp__gva__list_all_apis',
    ]
    const { ctx, captured } = makeHostCtx({ configRows: [context7, gva], registeredTools: registry })
    host.apply(ctx)
    const response = await captured.route.fetch(new Request('http://localhost/api/mcp-manager'))
    const body = await bodyOf(response)
    const byName = Object.fromEntries(body.data.servers.map((s) => [s.config.serverName, s]))
    check(
      'B71 每台服务器都带上当前注册的工具（count = 前缀命中的个数）',
      byName.context7.tools?.count === 2 && byName.gva.tools?.count === 2,
      JSON.stringify([byName.context7.tools, byName.gva.tools]),
    )
    check(
      'B72 工具按 serverName 前缀归属（别人的工具和非 MCP 工具都不算）',
      same(byName.context7.tools.names, ['mcp__context7__query-docs', 'mcp__context7__resolve-library-id']) &&
        same(byName.gva.tools.names, ['mcp__gva__create_api', 'mcp__gva__list_all_apis']),
      JSON.stringify([byName.context7.tools.names, byName.gva.tools.names]),
    )
    check(
      'B73 工具名单已排序（与注册顺序无关，展示才稳定）',
      same(byName.context7.tools.names, [...byName.context7.tools.names].sort()),
    )
    check(
      'B74 宿主声明 tools 能力（客户端据此决定要不要渲染那块）',
      body.data.capabilities.includes('tools'),
      JSON.stringify(body.data.capabilities),
    )
  }

  // 没有任何工具注册（服务器没连上 / 工具同步失败）：如实报 0，不谎报"有工具"。
  {
    const { ctx, captured } = makeHostCtx({
      configRows: [
        {
          name: '@deepseek-ai/dsh-mcp-client',
          config: { serverName: 'down', transport: 'streamable-http', url: 'https://z' },
        },
      ],
      registeredTools: ['read_image'],
    })
    host.apply(ctx)
    const response = await captured.route.fetch(new Request('http://localhost/api/mcp-manager'))
    const body = await bodyOf(response)
    check(
      'B75 一台都没注册时 count=0（不谎报）',
      body.data.servers[0].tools?.count === 0 && same(body.data.servers[0].tools.names, []),
      JSON.stringify(body.data.servers[0].tools),
    )
  }

  // 宿主没有 tools 服务（老宿主 / 测试替身）：不写这个键，客户端就不渲染那块（向前兼容）。
  {
    const { ctx, captured } = makeHostCtx({
      configRows: [
        {
          name: '@deepseek-ai/dsh-mcp-client',
          config: { serverName: 's', transport: 'streamable-http', url: 'https://x' },
        },
      ],
    })
    host.apply(ctx)
    const response = await captured.route.fetch(new Request('http://localhost/api/mcp-manager'))
    const body = await bodyOf(response)
    check(
      'B76 没有 tools 服务时省略该键（客户端读不到就不渲染）',
      !('tools' in body.data.servers[0]) && body.data.capabilities.includes('tools'),
      JSON.stringify(Object.keys(body.data.servers[0])),
    )
  }
}
//#endregion

//#region C. 客户端半边
const registered: StubModuleDefinition[] = []
const sandbox: Record<string, unknown> = {
  window: { __ModuleLoader__: { load: (definition: StubModuleDefinition) => registered.push(definition) } },
  console,
}
sandbox.globalThis = sandbox
vm.runInNewContext(clientSource, sandbox, { filename: 'lib/client.js' })

check('C1 注册了一个模块', registered.length === 1, String(registered.length))
const definition = firstOrThrow(registered, '客户端模块注册表')
check('C2 模块 id 等于包名', definition.id === manifest.name, String(definition.id))
check('C3 factory 是函数', typeof definition.factory === 'function')

const fakeReact: StubReact = {
  createElement: () => null,
  Fragment: { $$typeof: Symbol.for('react.fragment') },
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}
const stubRequire = (specifier: string): unknown => {
  if (specifier === 'react') return fakeReact
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error(`unexpected require: ${specifier}`)
}
const clientExports = definition.factory(stubRequire)
check('C4 导出 apply', typeof clientExports.apply === 'function')

/** C 区只验证"协议与座位注册"，不渲染 —— 所以这里的 ctx 只提供 apply 真正用到的那两个成员。 */
interface ClientCtxStub {
  effect(callback: () => (() => void) | void, label?: string): void
  inject(
    names: string[],
    callback: (scope: {
      slots: {
        inject(name: string, register: () => void): void
        register(options: Record<string, unknown>, component: unknown): void
      }
    }) => void,
  ): void
}

const registrations: Array<{ options: Record<string, unknown>; component: unknown }> = []
const injectedNames: string[] = []
const effects: Array<{ label?: string; dispose?: unknown }> = []
const clientCtx: ClientCtxStub = {
  // 资源登记：官方客户端插件就是 `ctx.effect(() => disposer, label)`。
  effect(callback, label) {
    effects.push({ label, dispose: callback() })
  },
  inject(names, callback) {
    injectedNames.push(...names)
    callback({
      slots: {
        inject: (name, register) => {
          register()
          void name
        },
        register: (options, component) => {
          registrations.push({ options, component })
        },
      },
    })
  },
}
clientExports.apply(clientCtx)

check('C5 只注入 slots', same(injectedNames, ['slots']), JSON.stringify(injectedNames))
check('C6 注册了一个座位条目', registrations.length === 1, String(registrations.length))
const { options, component } = registrations[0] ?? {}
check('C7 座位名', options?.name === 'settings.section', String(options?.name))
check('C8 条目 id', options?.id === 'mcp', String(options?.id))
check(
  'C9 order 落在最下方（>= 官方页）',
  typeof options?.order === 'number' && options.order >= 500,
  String(options?.order),
)
check('C10 label 可解析', (typeof options?.label === 'function' ? options.label() : options?.label) === 'MCP')
check('C11 组件是函数', typeof component === 'function')
// 导航标记必须走 ctx.effect 登记，否则插件卸载/热替换后 observer 会留在页面上。
check(
  'C12 导航标记经 ctx.effect 登记（可随插件卸载收掉）',
  effects.length === 1 && /nav mark/.test(effects[0]?.label ?? '') && typeof effects[0]?.dispose === 'function',
  JSON.stringify(effects.map((effect) => effect.label)),
)

// C13–C17：拿一套假 DOM 真跑一遍 apply，验证「只标记我们那一格」「面板关闭重开后能重新标记」
// 「卸载后清干净」。这些行为源码 grep 抓不到。
{
  /** 按官方结构造一格：`<button><svg/><span>label</span></button>`。 */
  const makeCell = (label) => {
    const span = { tagName: 'SPAN', textContent: label }
    const svg = { tagName: 'svg' }
    return {
      tagName: 'BUTTON',
      children: [svg, span],
      isConnected: true,
      attributes: {},
      get lastElementChild() {
        return this.children[this.children.length - 1]
      },
      setAttribute(name, value) {
        this.attributes[name] = value
      },
      getAttribute(name) {
        return name in this.attributes ? this.attributes[name] : null
      },
      removeAttribute(name) {
        delete this.attributes[name]
      },
    }
  }

  const cells = [makeCell('通用'), makeCell('模型'), makeCell('MCP')]
  const nav = { querySelectorAll: (selector) => (selector === 'button' ? cells : []) }
  const dialog = { querySelector: (selector) => (selector === 'nav' ? nav : null) }
  const injected = []
  const observers = []
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      observers.push(this)
    }
    observe(target, options) {
      this.target = target
      this.options = options
    }
    disconnect() {
      this.disconnected = true
    }
  }
  const fakeDocument = {
    body: { nodeName: 'BODY' },
    head: { appendChild: (element) => injected.push(element) },
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    querySelectorAll: (selector) => (selector === '[data-shortcut-modal="settings"]' ? [dialog] : []),
  }

  const domSandbox = {
    window: { __ModuleLoader__: { load: (definition) => registered.push(definition) } },
    document: fakeDocument,
    MutationObserver: FakeMutationObserver,
    console,
  }
  domSandbox.globalThis = domSandbox
  vm.runInNewContext(clientSource, domSandbox, { filename: 'lib/client.js' })
  const domExports = registered[registered.length - 1].factory(stubRequire)
  const domEffects = []
  domExports.apply({
    effect(callback, label) {
      domEffects.push({ label, dispose: callback() })
    },
    inject() {},
  })

  check(
    'C13 只在「MCP」那一格打标记（按 label 文本认，不看哈希类名）',
    cells.filter((cell) => cell.getAttribute('data-mcpm-nav') === '1').length === 1 &&
      cells[2].getAttribute('data-mcpm-nav') === '1',
    `marked=${cells.filter((cell) => cell.getAttribute('data-mcpm-nav') === '1').length}`,
  )
  check(
    'C14 observer 挂在 body 上（设置面板是 portal 到 body 的）',
    observers.length === 1 && observers[0].target === fakeDocument.body && observers[0].options?.subtree === true,
  )
  const sheet = injected[0]?.textContent ?? ''
  check(
    'C15 注入的样式表里已含导航那两行（隐藏官方 svg + mask 画标记）',
    /\[data-shortcut-modal="settings"\] button\[data-mcpm-nav\] > svg \{ display:none; \}/.test(sheet) &&
      /content:""[^}]*mask:url\("data:image\/svg\+xml,/.test(sheet),
    `chars=${sheet.length}`,
  )

  // 面板关闭 → 旧节点断开 → 重新打开（新节点）→ 应重新标记。
  cells[2].isConnected = false
  cells[2].removeAttribute('data-mcpm-nav')
  const reopened = makeCell('MCP')
  cells[2] = reopened
  observers[0].callback()
  check('C16 面板关闭重开后能重新标记新节点', reopened.getAttribute('data-mcpm-nav') === '1')

  // 先确认确实标记过，否则「卸载后没有属性」会变成一条空断言（曾经就差点漏过这个洞）。
  const beforeDispose = reopened.getAttribute('data-mcpm-nav')
  domEffects[0].dispose()
  check(
    'C17 卸载时摘掉 observer 与标记',
    beforeDispose === '1' && observers[0].disconnected === true && reopened.getAttribute('data-mcpm-nav') === null,
    `before=${String(beforeDispose)} after=${String(reopened.getAttribute('data-mcpm-nav'))}`,
  )
}

// C18：客户端半边热替换时，页面上那份**旧样式表**必须被刷新。
// 反例（真实踩过）：`ensureStyles` 写成「元素存在就 return」，于是新加的导航规则永远进不了页面，
// 表现就是「bundle 更新了、图标却还是齿轮」。
{
  const elements = [{ id: 'dsh-mcp-manager-styles', textContent: '/* 旧版样式，没有导航规则 */' }]
  const staleDocument = {
    body: { nodeName: 'BODY' },
    head: { appendChild: (element) => elements.push(element) },
    getElementById: (id) => elements.find((element) => element.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '' }),
    querySelectorAll: () => [],
  }
  const staleSandbox = {
    window: { __ModuleLoader__: { load: (definition) => registered.push(definition) } },
    document: staleDocument,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console,
  }
  staleSandbox.globalThis = staleSandbox
  vm.runInNewContext(clientSource, staleSandbox, { filename: 'lib/client.js' })
  registered[registered.length - 1].factory(stubRequire).apply({ effect: () => {}, inject: () => {} })
  check(
    'C18 热替换时刷新已有样式表（写成「存在就跳过」会让新 CSS 永不生效）',
    elements.length === 1 && elements[0].textContent.includes('data-mcpm-nav'),
    `count=${elements.length} refreshed=${elements[0].textContent.includes('data-mcpm-nav')}`,
  )
}
//#endregion

//#region D. 客户端渲染（迷你渲染器：真正递归展开函数组件，不只是 grep 源码）
{
  const reactFragment = Symbol.for('react.fragment')
  let hookValues = []
  let hookIndex = 0

  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: reactFragment,
    // 状态由场景提供：按组件名取一组值，按调用顺序发。设置函数是 no-op。
    useState: (initial) => {
      const value = hookIndex < hookValues.length ? hookValues[hookIndex] : initial
      hookIndex += 1
      return [value, () => {}]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }

  /** 把 element 树展开成宿主元素树（函数组件会被真正调用）。 */
  function render(node, values) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number')
      return { type: '#text', props: { text: String(node) }, children: [] }
    if (Array.isArray(node)) return node.map((child) => render(child, values)).filter(Boolean)
    if (typeof node.type === 'function') {
      hookValues = values[node.type.name] ?? []
      hookIndex = 0
      return render(node.type(node.props), values)
    }
    const children = (node.children ?? [])
      .flat()
      .map((child) => render(child, values))
      .filter(Boolean)
    return { type: node.type, props: node.props, children }
  }

  const walk = (tree, visit) => {
    for (const node of Array.isArray(tree) ? tree : [tree]) {
      if (node === null || typeof node !== 'object') continue
      visit(node)
      walk(node.children ?? [], visit)
    }
  }
  const collect = (tree, pick) => {
    const out = []
    walk(tree, (node) => {
      const value = pick(node)
      if (value !== undefined && value !== null) out.push(value)
    })
    return out
  }
  const classesOf = (tree) =>
    collect(tree, (n) => (typeof n.props?.className === 'string' ? n.props.className : undefined))
  const textsOf = (tree) => collect(tree, (n) => (n.type === '#text' ? n.props.text : undefined))
  const typesOf = (tree) => collect(tree, (n) => (typeof n.type === 'string' ? n.type : undefined))
  const hasClass = (tree, cls) => classesOf(tree).some((value) => value.split(/\s+/).includes(cls))

  /** 用给定场景渲染 McpSection。 */
  const renderSection = (values) => {
    let sectionComponent = null
    const fresh = definition.factory((specifier) => (specifier === 'react' ? fakeReact : {}))
    fresh.apply({
      // 渲染测试只关心页面组件；导航标记那部分由 C12–C17 覆盖。
      effect: () => {},
      inject: (_names, callback) =>
        callback({
          slots: {
            inject: (_name, register) => register(),
            register: (_options, registered) => {
              sectionComponent = registered
            },
          },
        }),
    })
    hookValues = []
    hookIndex = 0
    return render(fakeReact.createElement(sectionComponent, {}), values)
  }

  const server = {
    index: 0,
    disabled: false,
    config: { serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp' },
    phase: 'active',
  }
  const snapshot = {
    groupId: 'mcp-manager',
    configured: true,
    capabilities: ['setEnabled', 'remove', 'save', 'lastError', 'probe'],
    servers: [server],
  }
  const emptySnapshot = { ...snapshot, servers: [] }
  const draft = {
    disabled: false,
    serverName: 'context7',
    transport: 'streamable-http',
    url: 'https://mcp.context7.com/mcp',
    command: '',
    args: '',
    env: '',
    headers: 'Authorization=Bearer x',
    cwd: '',
  }

  /**
   * 场景夹具：McpSection 的 useState 调用顺序 —— **新增一个状态就必须在这里补一位**，
   * 否则后面所有槽位都会错位（假 useState 是按顺序发值的）。
   * [snapshot, loadError, busy, editing, draft, formError, actionError, probing]
   */
  const scene = (
    snapshotValue,
    loadError = null,
    busy = false,
    editing = null,
    draft = null,
    formError = null,
    actionError = null,
    probing = false,
  ) => renderSection({ McpSection: [snapshotValue, loadError, busy, editing, draft, formError, actionError, probing] })

  // D1–D3 列表视图
  const list = scene(snapshot)
  check(
    'D1 列表视图：一卡一服务器',
    hasClass(list, 'mcpm-rows') && hasClass(list, 'mcpm-rowCard') && hasClass(list, 'mcpm-row'),
  )
  check('D2 列表视图不含表单面板', !hasClass(list, 'mcpm-form'))
  {
    const texts = textsOf(list)
    check(
      'D3 行内三个动作按钮',
      ['编辑', '停用', '删除'].every((label) => texts.includes(label)),
      texts.join('|'),
    )
  }

  // D4–D7 展开编辑：表单必须在**同一张卡内**
  const editing = scene(snapshot, null, false, 0, draft)
  check('D4 展开后出现表单面板', hasClass(editing, 'mcpm-form'))
  {
    // 找到 rowCard 节点，确认表单是它的后代（而不是兄弟/别处）。
    let cardHasForm = false
    walk(editing, (node) => {
      if (typeof node.props?.className === 'string' && node.props.className.includes('mcpm-rowCard')) {
        if (hasClass(node.children, 'mcpm-form')) cardHasForm = true
      }
    })
    check('D5 表单就在那张卡片内部', cardHasForm)
  }
  check('D6 展开时按钮变成「收起」', textsOf(editing).includes('收起'))
  {
    // url 是单行 input，headers 是多行 textarea —— 直接守住 mono/multiline 那个坑。
    const types = typesOf(editing)
    check(
      'D7 url 用 input、headers 用 textarea',
      types.includes('input') && types.includes('textarea'),
      types.filter((t) => t === 'input' || t === 'textarea').join(','),
    )
  }
  check('D8 展开时不会重复显示第二张同名卡', classesOf(editing).filter((c) => c.includes('mcpm-rowCard')).length === 1)

  // D9 新增：末尾追加一张只含表单的卡
  const adding = scene(snapshot, null, false, 'new', draft)
  check(
    'D9 新增时追加一张只含表单的卡',
    classesOf(adding).filter((c) => c.includes('mcpm-rowCard')).length === 2 && hasClass(adding, 'mcpm-form'),
  )

  // D10–D12 空 / 载入 / 错误
  check('D10 空列表走无边框 .mcpm-empty', hasClass(scene(emptySnapshot), 'mcpm-empty'))
  check('D11 载入态', textsOf(scene(null)).includes('正在读取…'))
  check('D12 错误态', hasClass(scene(null, 'boom'), 'mcpm-notice--error'))

  // D13 组条目缺失
  // 文案在 P6 改成了 bundle 形态的指引（group 由包自带的 patch 层提供；故障只剩"没装好"
  // 与"被更高层覆写压掉"两种），所以断言同步跟上，**两项都守**：
  // ①点名缺的是哪一类条目（`cordis:group`，原意图，不能被删）；
  // ②指出成因在 bundle 侧（否则用户会照着旧文案去 profile 里手写一行，而现在那是错的指引）。
  check(
    'D13 未配置 group 时给出可读提示（点名 cordis:group + 指出 bundle 侧的两个成因）',
    textsOf(scene({ ...snapshot, configured: false })).some((t) => t.includes('cordis:group') && t.includes('bundle')),
  )

  // D42–D47 工具名单：显示「N 个」，超过 TOOL_PREVIEW_LIMIT 就折叠，点开才显示全部。
  {
    // 自带夹具（不依赖外层的 server/snapshot）：一台有 9 个工具的服务器（> TOOL_PREVIEW_LIMIT=6，触发折叠）。
    const toolServer = {
      index: 0,
      disabled: false,
      config: { serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp' },
      phase: 'active',
    }
    const toolNames = Array.from({ length: 9 }, (_, i) => `mcp__context7__tool_${i}`)
    const toolsSnapshot = (tools) => ({
      groupId: 'mcp-manager',
      configured: true,
      capabilities: ['setEnabled', 'remove', 'save', 'lastError', 'probe', 'tools'],
      servers: [{ ...toolServer, tools }],
    })
    // 渲染后的文本节点是 {type:'#text', props:{text}}，直接 join 会得到 [object Object]。
    const nodeText = (node) =>
      (node?.children ?? []).map((child) => (typeof child === 'string' ? child : (child?.props?.text ?? ''))).join('')
    const toolChips = (tree) =>
      collect(tree, (n) =>
        typeof n.props?.className === 'string' && n.props.className.split(/\s+/).includes('mcpm-tool')
          ? nodeText(n)
          : undefined,
      )
    // 页面级「显示全部 / 收起」按钮（D32–D33 里的 buttonWith 只在那一个局部块里可见，这里自带一个）。
    const toolButton = (tree, label) =>
      collect(tree, (n) => (n.type === 'button' && nodeText(n) === label ? n.props : undefined))[0]
    // ServerRow 的 useState 顺序是 [confirming, toolsOpen]；toolsOpen=false → 折叠态。
    const collapsed = renderSection({
      McpSection: [
        toolsSnapshot({ count: 9, names: toolNames, truncated: false }),
        null,
        false,
        null,
        null,
        null,
        null,
        false,
      ],
      ServerRow: [false, false],
    })
    check(
      'D42 卡片内显示工具总数「工具 N 个」',
      textsOf(collapsed).includes('工具 9 个'),
      textsOf(collapsed)
        .filter((t) => t.includes('工具'))
        .join('|'),
    )
    const collapsedChips = toolChips(collapsed)
    check(
      'D43 超过 6 个时默认只显示前 6 个 + 「+3 个」（折叠）',
      collapsedChips.length === 7 && collapsedChips[6] === '+3 个' && !collapsedChips.includes('mcp__context7__tool_6'),
      JSON.stringify(collapsedChips),
    )
    check(
      'D44 折叠时提供「显示全部 9 个」按钮',
      toolButton(collapsed, '显示全部 9 个') !== undefined,
      textsOf(collapsed)
        .filter((t) => t.includes('显示全部') || t.includes('显示'))
        .join('|'),
    )

    // toolsOpen=true → 展开态，全部显示，无「+N 个」，按钮变「收起」。
    const expanded = renderSection({
      McpSection: [
        toolsSnapshot({ count: 9, names: toolNames, truncated: false }),
        null,
        false,
        null,
        null,
        null,
        null,
        false,
      ],
      ServerRow: [false, true],
    })
    const expandedChips = toolChips(expanded)
    check(
      'D45 展开后显示全部 9 个、按钮变「收起」',
      expandedChips.length === 9 &&
        toolButton(expanded, '收起') !== undefined &&
        !expandedChips.some((t) => t.startsWith('+')),
      JSON.stringify(expandedChips),
    )

    // 宿主名单被截断（> TOOL_NAME_LIMIT）：多一个「名单已截断」提示。
    const capped = renderSection({
      McpSection: [
        toolsSnapshot({ count: 500, names: toolNames, truncated: true }),
        null,
        false,
        null,
        null,
        null,
        null,
        false,
      ],
      ServerRow: [false, false],
    })
    check('D46 宿主名单被截断时额外提示「名单已截断」', textsOf(capped).includes('名单已截断'))

    // 工具名数量 <= 6：直接全显示，不出现「显示全部」按钮。
    const fewTools = renderSection({
      McpSection: [
        toolsSnapshot({ count: 3, names: ['a', 'b', 'c'], truncated: false }),
        null,
        false,
        null,
        null,
        null,
        null,
        false,
      ],
      ServerRow: [false, false],
    })
    check(
      'D47 工具不多（≤6）时直接全显示、没有折叠按钮',
      toolButton(fewTools, '显示全部 3 个') === undefined && textsOf(fewTools).includes('工具 3 个'),
      textsOf(fewTools)
        .filter((t) => t.includes('工具') || t.includes('显示'))
        .join('|'),
    )
  }

  // D14–D20 失败原因行（README 7.6）：状态不能再误报「运行中」，原因要落在同一张卡内。
  {
    const ariaOf = (tree) =>
      collect(tree, (n) => (typeof n.props?.['aria-label'] === 'string' ? n.props['aria-label'] : undefined))
    const broken = {
      ...server,
      error: {
        message: 'connection attempt failed: Error: connect ECONNREFUSED 127.0.0.1:443',
        level: 'warn',
        at: 1_700_000_000_000,
        count: 3,
      },
    }
    const failureView = scene({ ...snapshot, servers: [broken] })

    check(
      'D14 有失败记录时状态改成「连接异常」（不能再报运行中）',
      ariaOf(failureView).includes('连接异常') && !ariaOf(failureView).includes('运行中'),
      ariaOf(failureView).join('|'),
    )
    check(
      'D15 原因渲染成一行小字且含 mcp-client 原文',
      hasClass(failureView, 'mcpm-rowError') && textsOf(failureView).some((t) => t.includes('ECONNREFUSED')),
      textsOf(failureView).join('|'),
    )
    check(
      'D16 多次失败带次数与时间',
      textsOf(failureView).some((t) => t.includes('已失败 3 次')),
      textsOf(failureView).join('|'),
    )
    {
      let inCard = false
      walk(failureView, (node) => {
        if (
          typeof node.props?.className === 'string' &&
          node.props.className.includes('mcpm-rowCard') &&
          hasClass(node.children, 'mcpm-rowError')
        ) {
          inCard = true
        }
      })
      check('D17 原因行在那张卡片内部', inCard)
    }
    check(
      'D18 宿主可探测但没有探测记录 → 报「未检测」，不再靠相位报绿',
      !hasClass(list, 'mcpm-rowError') && ariaOf(list).includes('未检测') && !ariaOf(list).includes('运行中'),
      ariaOf(list).join('|'),
    )
    // 绿灯必须来自**正面证据**（AGENTS 3.10）：宿主能探测却没有探测记录时，相位只说明
    // "apply 跑完了"，不能拿它报绿。「停用 → 再启用」必然走到这一态（宿主写入会清掉旧记录）。
    check(
      'D18b 旧宿主（无 probe 能力）→ 退回相位判定，仍报运行中',
      ariaOf(scene({ ...snapshot, capabilities: ['setEnabled', 'remove', 'save'] })).includes('运行中'),
      ariaOf(scene({ ...snapshot, capabilities: ['setEnabled', 'remove', 'save'] })).join('|'),
    )
    // 探不了的传输（stdio 的 connected:null）不算"没有证据"，不该因此变黄。
    {
      const stdio = scene({
        ...snapshot,
        servers: [
          {
            ...server,
            config: { ...server.config, transport: 'stdio' },
            probe: { connected: null, status: null, detail: 'stdio 走子进程', at: 1 },
          },
        ],
      })
      check(
        'D18c 探不了的传输（stdio）不因此报未检测 → 仍报运行中',
        ariaOf(stdio).includes('运行中'),
        ariaOf(stdio).join('|'),
      )
    }
    check(
      'D19 停用中的旧记录不显示（历史噪声）',
      !hasClass(scene({ ...snapshot, servers: [{ ...broken, disabled: true }] }), 'mcpm-rowError'),
    )
    check(
      'D20 标题行给出刷新按钮（失败原因事后才写入，必须能手动重读）',
      textsOf(list).includes('刷新'),
      textsOf(list).join('|'),
    )
    check(
      'D20b 标题行给出「检测」按钮（主动问候服务器，见 D24–D31）',
      textsOf(list).includes('检测'),
      textsOf(list).join('|'),
    )

    // D24–D31 四态状态机：灰(未启动/已停用) · 琥珀(启动中) · 绿(运行中) · 红(失败)
    const view = (extra) => scene({ ...snapshot, servers: [{ ...server, ...extra }] })
    const aria = (extra) => ariaOf(view(extra)).join('|')

    check(
      'D24 握手期间报「启动中」（LOADING 而不是"未运行"）',
      aria({ phase: 'loading' }).includes('启动中'),
      aria({ phase: 'loading' }),
    )
    check('D25 pending 同样是「启动中」', aria({ phase: 'pending' }).includes('启动中'), aria({ phase: 'pending' }))
    check('D26 fiber FAILED 报「加载失败」', aria({ phase: 'failed' }).includes('加载失败'), aria({ phase: 'failed' }))
    check('D27 没有活条目报「未启动」', aria({ phase: 'absent' }).includes('未启动'), aria({ phase: 'absent' }))

    const probedOk = view({
      phase: 'active',
      probe: { connected: true, status: 200, detail: 'HTTP 200', at: 1_700_000_000_000 },
    })
    check(
      'D28 检测通过 + 条目 active → 绿色运行中，且不显示历史原因',
      ariaOf(probedOk).includes('运行中') && !hasClass(probedOk, 'mcpm-rowError'),
      ariaOf(probedOk).join('|'),
    )
    // 关键：条目没挂上时即使端点可达也不能报绿——那时工具根本没注册。
    check(
      'D29 检测通过但条目未加载 → 不报绿',
      !aria({ phase: 'absent', probe: { connected: true, status: 200, detail: 'HTTP 200', at: 1 } }).includes('运行中'),
      aria({ phase: 'absent', probe: { connected: true, status: 200, detail: 'HTTP 200', at: 1 } }),
    )
    const probedDead = view({
      phase: 'active',
      probe: {
        connected: false,
        status: null,
        detail: '请求失败：connect ECONNREFUSED 10.9.9.2:80',
        at: 1_700_000_000_000,
      },
    })
    check(
      'D30 检测失败 → 连接失败 + 原因行里是检测结论（含真实原因）',
      ariaOf(probedDead).includes('连接失败') &&
        hasClass(probedDead, 'mcpm-rowError') &&
        textsOf(probedDead).some((t) => t.includes('ECONNREFUSED')),
      textsOf(probedDead).join('|'),
    )
    // 检测成功要能盖掉更早的日志记录（否则"修好了还是红的"）。
    const recovered = view({
      phase: 'active',
      error: { message: 'connection attempt failed: boom', level: 'warn', at: 1, count: 1 },
      probe: { connected: true, status: 200, detail: 'HTTP 200', at: 1_700_000_000_000 },
    })
    check(
      'D31 检测通过盖掉更早的失败记录（不再显示旧原因）',
      ariaOf(recovered).includes('运行中') && !hasClass(recovered, 'mcpm-rowError'),
      textsOf(recovered).join('|'),
    )

    // D32–D33 能力协商：旧宿主不认识 probe，按钮必须禁用并说明，而不是点了报「未知操作」。
    const buttonWith = (tree, label) => {
      let found = null
      walk(tree, (node) => {
        if (node.type === 'button' && textsOf(node).includes(label)) found = node
      })
      return found
    }
    const oldHost = scene({ ...snapshot, capabilities: ['setEnabled', 'remove', 'save'] })
    check(
      'D32 旧宿主（无 probe 能力）→「检测」禁用并提示要重启 DSH',
      buttonWith(oldHost, '检测')?.props?.disabled === true &&
        String(buttonWith(oldHost, '检测')?.props?.title).includes('重启'),
      JSON.stringify(buttonWith(oldHost, '检测')?.props),
    )
    check(
      'D33 新宿主（有 probe 能力）→「检测」可点',
      buttonWith(list, '检测')?.props?.disabled === false,
      JSON.stringify(buttonWith(list, '检测')?.props),
    )
    check(
      'D34 检测进行中显示「检测中…」且按钮暂时锁住（自动检测的可见反馈）',
      textsOf(scene(snapshot, null, false, null, null, null, null, true)).includes('检测中…') &&
        buttonWith(scene(snapshot, null, false, null, null, null, null, true), '检测')?.props?.disabled === true,
      textsOf(scene(snapshot, null, false, null, null, null, null, true)).join('|'),
    )
  }

  // D21–D23 两条错误通道互斥（用户截图反馈：同一句话出现了两遍）。
  {
    const reason = '服务器 "server-1" 使用 streamable-http，但 url 为空'
    /** 所有 `.mcpm-notice--error` 节点的文本（页面级 + 表单内都算）。 */
    const errorNotices = (tree) =>
      collect(tree, (node) =>
        typeof node.props?.className === 'string' && node.props.className.includes('mcpm-notice--error')
          ? textsOf(node).join(' ')
          : undefined,
      )
    /** 表单子树里的全部文本，用来判断报错到底渲染在哪一层。 */
    const formTexts = (tree) => {
      const out = []
      walk(tree, (node) => {
        if (typeof node.props?.className === 'string' && node.props.className.includes('mcpm-form'))
          out.push(...textsOf(node))
      })
      return out
    }

    // 表单开着 + 行内操作失败 → 只有页面级一条，表单里不能重复。
    const actionOnly = scene(snapshot, null, false, 0, draft, null, reason)
    check(
      'D21 行内操作失败只在页面级出现一次',
      same(errorNotices(actionOnly), [reason]) && !formTexts(actionOnly).includes(reason),
      `${JSON.stringify(errorNotices(actionOnly))} form=${String(formTexts(actionOnly).includes(reason))}`,
    )

    // 表单开着 + 提交失败 → 只有表单里一条，页面级不能重复（截图里的那种重复）。
    const formOnly = scene(snapshot, null, false, 0, draft, reason)
    check(
      'D22 表单提交失败只在表单里出现一次',
      same(errorNotices(formOnly), [reason]) && formTexts(formOnly).includes(reason),
      `${JSON.stringify(errorNotices(formOnly))} form=${String(formTexts(formOnly).includes(reason))}`,
    )

    // 两个通道都非空时（同一次渲染里理论上不会发生）也只各出现一次，不会互相复制。
    const both = scene(snapshot, null, false, 0, draft, `表单：${reason}`, `操作：${reason}`)
    check(
      'D23 两条通道各自只渲染一次',
      errorNotices(both).length === 2 &&
        formTexts(both).includes(`表单：${reason}`) &&
        !formTexts(both).includes(`操作：${reason}`),
      JSON.stringify(errorNotices(both)),
    )
  }
}
//#endregion

//#region D2. 挂载行为：打开页面就自动检测（要真正执行 useEffect，所以另起一套沙箱）
{
  const tick = async (times = 6) => {
    for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  /**
   * 跑一次"挂载"：带 fetch 的沙箱建模块 → 渲染一次 McpSection（effect 真执行）→ 收集请求。
   * @param capabilities - 宿主声明的能力（旧宿主没有 `probe`）。
   * @param failGet - GET 就失败（模拟读不到快照）。
   * @param server - 快照里那一条服务器记录（默认启用中、active）。
   * @param responses - GET/POST 依次返回的快照队列（模拟"相位还没稳定"的多轮读取）；
   *   用完之后一直返回默认快照。
   * @param stateValues - 喂给 McpSection 的 8 位 useState 初值
   *   `[snapshot, loadError, busy, editing, draft, formError, actionError, probing]`。
   *   不传时 snapshot 为 null（只在挂载里用返回值做能力判断，不渲染列表）。
   * @param click - 首次渲染的树里，点一次这个文案的按钮（用来跑"停用 → 再启用"这条路）。
   * @returns 实际发出的请求（`{ method, body }`，按顺序）。
   */
  const mount = async ({ capabilities, failGet = false, server, responses = [], stateValues = [], click } = {}) => {
    const requests = []
    const base = {
      groupId: 'mcp-manager',
      configured: true,
      capabilities,
      servers: [server ?? { index: 0, disabled: false, config: { serverName: 's' }, phase: 'active' }],
    }
    const queue = [...responses]
    const stubFetch = async (_url, init) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
      if (method === 'GET' && failGet) throw new Error('boom')
      return { status: 200, json: async () => ({ ok: true, data: queue.length > 0 ? queue.shift() : base }) }
    }
    const loaded = []
    const sandbox = {
      window: { __ModuleLoader__: { load: (definition) => loaded.push(definition) } },
      console,
      fetch: stubFetch,
      // 相位稳定那一步要等一拍；平时（挂载即稳定）不会用到。
      setTimeout,
      clearTimeout,
      // 故意不提供 AbortSignal / document：客户端两处都有 typeof 守卫。
    }
    sandbox.globalThis = sandbox
    vm.runInNewContext(clientSource, sandbox, { filename: 'lib/client.js' })

    const states = [...stateValues]
    const effectReact = {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      Fragment: Symbol.for('react.fragment'),
      // McpSection 的 8 个状态先按顺序取；取完之后（ServerRow 的 confirming 等）回落到初值。
      useState: (initial) => [states.length > 0 ? states.shift() : initial, () => {}],
      useEffect: (callback) => {
        callback()
      },
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
    }
    const exportsOfModule = loaded[0].factory((specifier) => (specifier === 'react' ? effectReact : {}))
    let component = null
    exportsOfModule.apply({
      effect: () => {},
      inject: (_names, callback) =>
        callback({
          slots: {
            inject: (_name, register) => register(),
            register: (_options, registered) => {
              component = registered
            },
          },
        }),
    })
    const tree = component({}) // 渲染一次 → useEffect 立即执行 → 自动检测发请求
    await tick()
    if (click !== undefined) {
      // 函数组件要展开才拿得到按钮（树是惰性的）；展开时 ServerRow 的 useState 已回落到初值。
      const button = findButton(tree, click)
      if (button === null) throw new Error(`找不到按钮：${click}`)
      button.props.onClick()
      await tick()
    }
    return requests
  }

  /** 在（惰性）元素树里按文案找 <button>，找到就展开函数组件继续找。 */
  const findButton = (node, label) => {
    if (node === null || node === undefined || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findButton(child, label)
        if (found !== null) return found
      }
      return null
    }
    if (typeof node.type === 'function') return findButton(node.type(node.props), label)
    if (node.type === 'button' && (node.children ?? []).flat().join('') === label) return node
    for (const child of node.children ?? []) {
      const found = findButton(child, label)
      if (found !== null) return found
    }
    return null
  }

  const withProbe = await mount({ capabilities: ['setEnabled', 'remove', 'save', 'lastError', 'probe'] })
  check(
    'D35 打开页面自动检测：先 GET 快照、再 POST probe（不需要点按钮）',
    withProbe.length === 2 &&
      withProbe[0].method === 'GET' &&
      withProbe[1].method === 'POST' &&
      withProbe[1].body?.op === 'probe',
    JSON.stringify(withProbe),
  )

  const staleHost = await mount({ capabilities: ['setEnabled', 'remove', 'save'] })
  check(
    'D36 旧宿主（没有 probe 能力）只读快照、不发探测（免得拿到「未知操作」）',
    staleHost.length === 1 && staleHost[0].method === 'GET',
    JSON.stringify(staleHost),
  )

  const brokenRead = await mount({ capabilities: ['probe'], failGet: true })
  check(
    'D37 快照读失败时不发探测（只有 GET 一次）',
    brokenRead.length === 1 && brokenRead[0].method === 'GET',
    JSON.stringify(brokenRead),
  )

  // D38–D41 写入之后必须重新检测。用户反馈："关闭 MCP 后再启动，不会检测它的连接性是否正常"。
  // 根因：宿主每次写入都清掉旧的失败/探测记录（commitRows），只剩相位；而相位 active 只说明
  // apply 跑完了（mcp-client 连不上也不抛错），照它报绿就是"没有证据的绿灯"（AGENTS 3.10）。
  {
    const newHost = ['setEnabled', 'remove', 'save', 'lastError', 'probe']
    const oldHost = ['setEnabled', 'remove', 'save']
    const row = (disabled, extra) => ({
      index: 0,
      disabled,
      config: { serverName: 'gva', transport: 'streamable-http', url: 'http://127.0.0.1:8899/mcp' },
      phase: 'active',
      ...extra,
    })
    /** McpSection 的 8 位初值（见 D 区 scene 夹具）：这里只喂第 1 位，其余走初值。 */
    const values = (capabilities, server) => [
      { groupId: 'mcp-manager', configured: true, capabilities, servers: [server] },
    ]
    /** 请求序列压成 `[method, op]` 便于比对。 */
    const shape = (requests) => requests.map((request) => [request.method, request.body?.op])

    // 停用中的一台（按钮文字是「启用」）→ 点它 → 先 POST setEnabled，紧接着再 POST probe。
    const enabling = await mount({
      capabilities: newHost,
      server: row(true),
      stateValues: values(newHost, row(true)),
      click: '启用',
    })
    check(
      'D38 点「启用」之后自动补一次探测（否则只能靠相位报一个没有证据的绿灯）',
      same(shape(enabling), [
        ['GET', undefined],
        ['POST', 'probe'],
        ['POST', 'setEnabled'],
        ['POST', 'probe'],
      ]),
      JSON.stringify(shape(enabling)),
    )

    // 旧宿主没有这条通道：写入之后不发探测（免得拿到「未知操作：probe」）。
    const staleToggle = await mount({
      capabilities: oldHost,
      server: row(true),
      stateValues: values(oldHost, row(true)),
      click: '启用',
    })
    check(
      'D39 旧宿主（无 probe 能力）点「启用」不发探测',
      same(shape(staleToggle), [
        ['GET', undefined],
        ['POST', 'setEnabled'],
      ]),
      JSON.stringify(shape(staleToggle)),
    )

    // 探通了、但 Loader 还没把子条目挂上（相位 loading）→ 继续重读快照，直到 active 才收手。
    // 相位稳定那一步客户端会 sleep（SETTLE_INTERVAL_MS = 200ms），所以这里必须真的等一会儿。
    const settled = { ...row(false), probe: { connected: true, status: 200, detail: 'HTTP 200', at: 1 } }
    const settle = await mount({
      capabilities: newHost,
      responses: [
        {
          groupId: 'mcp-manager',
          configured: true,
          capabilities: newHost,
          servers: [{ ...row(false), phase: 'loading' }],
        },
        {
          groupId: 'mcp-manager',
          configured: true,
          capabilities: newHost,
          servers: [{ ...settled, phase: 'loading' }],
        },
        { groupId: 'mcp-manager', configured: true, capabilities: newHost, servers: [{ ...settled, phase: 'active' }] },
      ],
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    check(
      'D40 探通了但条目还没挂上（相位 loading）→ 重读快照直到 active（绿灯必须有证据）',
      same(shape(settle), [
        ['GET', undefined],
        ['POST', 'probe'],
        ['GET', undefined],
      ]),
      JSON.stringify(shape(settle)),
    )

    // 相位永远不稳定 → 有界收手（不是轮询），总重读次数 == SETTLE_ATTEMPTS（10 × 200ms）。
    const stuck = await mount({ capabilities: newHost, server: { ...settled, phase: 'loading' } })
    await new Promise((resolve) => setTimeout(resolve, 2400))
    const gets = stuck.filter((request) => request.method === 'GET').length
    check(
      'D41 相位一直不稳定时有界收手（10 次重读后不再问，不轮询）',
      stuck.length === 12 && gets === 11 && stuck.filter((request) => request.body?.op === 'probe').length === 1,
      `total=${String(stuck.length)} gets=${String(gets)}`,
    )
  }
}
//#endregion

//#region E. 共享常量 ↔ 出厂产物
/**
 * E 区守的是"两半边必须认同一套协议值"。
 *
 * 历史做法是 A9/A10 那种"两边各自包含某个字面量"的断言 —— 它有两个毛病：
 *   1. 期望值写在断言里，改一处实现要同时改断言，容易把断言改成"迁就实现"；
 *   2. 空值恒真：`source.includes('')` 永远为 true，一个被写空的常量会让断言静默失效。
 * 所以这里先证明常量非空（E1），再用它去比对产物（E2–E7）。
 *
 * 注意 E6/E7 是按**当前手写形状**的声明式正则（`SECTION_ID = "mcp"`）。P4 把客户端交给
 * 构建器之后，常量可能被内联/改名，届时这两条要改成"产物里出现该值且该值被用于座位注册"，
 * 而不是放宽成裸 includes（`'mcp'` 这种子串在路由里就出现过，裸 includes 等于没断言）。
 */
{
  const names = ['ROUTE', 'GROUP_ID', 'MCP_PACKAGE', 'SECTION_ID', 'SECTION_LABEL']
  check(
    'E1 共享常量都是非空字符串（空值会让 includes 断言恒真）',
    names.every((name) => typeof shared[name] === 'string' && shared[name] !== ''),
    names.map((name) => `${name}=${JSON.stringify(shared[name])}`).join(' '),
  )

  /** 产物里是否出现该值（对引号风格不敏感：两半边历史上一个单引号、一个双引号）。 */
  const has = (source, value) => typeof value === 'string' && value !== '' && source.includes(value)
  /** 产物里是否以 `NAME = "值"` 的形式声明了该常量（单双引号都认）。 */
  const declares = (source, name, value) =>
    new RegExp(`${name}\\s*=\\s*["']${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(source)

  check('E2 路由：宿主产物用的是共享常量 ROUTE', has(hostSource, shared.ROUTE), shared.ROUTE)
  check('E3 路由：客户端产物用的是共享常量 ROUTE', has(clientSource, shared.ROUTE), shared.ROUTE)
  check('E4 组条目 id：宿主产物用的是共享常量 GROUP_ID', has(hostSource, shared.GROUP_ID), shared.GROUP_ID)
  check('E5 MCP 包名：宿主产物用的是共享常量 MCP_PACKAGE', has(hostSource, shared.MCP_PACKAGE), shared.MCP_PACKAGE)
  check(
    'E6 座位 id：客户端产物声明了共享常量 SECTION_ID',
    declares(clientSource, 'SECTION_ID', shared.SECTION_ID),
    shared.SECTION_ID,
  )
  check(
    'E7 座位 label：客户端产物声明了共享常量 SECTION_LABEL',
    declares(clientSource, 'SECTION_LABEL', shared.SECTION_LABEL),
    shared.SECTION_LABEL,
  )
  check(
    'E8 客户端 bundle 的模块 id 等于 package.json 的 name（改名时不会漏改产物）',
    has(clientSource, `id: "${manifest.name}"`) || has(clientSource, `id: '${manifest.name}'`),
    manifest.name,
  )

  /**
   * E9/E10 —— 产物指纹。
   *
   * 宿主产物现在是**生成的**（`tools/build.ts` → `lib/index.js`），于是出现了新的失败模式：
   * 改了 `src/**` 却忘了重新构建，仓库里躺着一份与源码不符的产物，而所有断言照样绿。
   * 构建脚本每次写 `lib/.build-manifest.json`（产物自身的 sha256 + 每个输入的 sha256），
   * 这里逐项复核：任何一边对不上就 FAIL，并直接说"重新 build"。
   */
  const fingerprint = await (async () => {
    try {
      return JSON.parse(await readFile(join(root, 'lib', '.build-manifest.json'), 'utf8'))
    } catch {
      return null
    }
  })()
  check('E9 存在构建指纹 lib/.build-manifest.json', fingerprint !== null, '先跑 pnpm build')

  if (fingerprint !== null) {
    const sha256Of = async (file) =>
      createHash('sha256')
        .update(await readFile(join(root, file)))
        .digest('hex')
    const stale = []
    for (const target of fingerprint.targets ?? []) {
      if ((await sha256Of(target.output)) !== target.outputSha256) stale.push(target.output)
      for (const [file, expected] of Object.entries(target.inputs ?? {})) {
        if ((await sha256Of(file)) !== expected) stale.push(file)
      }
    }
    check(
      'E10 产物与 src 同步（改了 src 必须重新 build）',
      stale.length === 0,
      stale.length === 0 ? '' : `与指纹不符：${stale.join(', ')} —— 先跑 pnpm build`,
    )
  }

  /**
   * E11 —— 脚本指向的文件必须真实存在。
   *
   * 这条是"把 tools/*.mjs 改名成 *.ts"当天该有的护栏：改名要同时改 package.json、CI、
   * AGENTS、README 里的好几处，漏一处只会在别人手打命令时才发现。有了它，漏改立刻红。
   */
  for (const scriptName of ['verify', 'build']) {
    const command = manifest.scripts?.[scriptName] ?? ''
    const target = /node\s+(\S+)/.exec(command)?.[1] ?? ''
    check(
      `E11 package.json 的 ${scriptName} 脚本指向真实存在的文件`,
      target !== '' && existsSync(join(root, target)),
      `${scriptName}: ${command}`,
    )
  }

  /**
   * E12 —— 文档与工作流里提到的仓库文件 / 脚本必须真实存在。
   *
   * E11 只覆盖 package.json 的两个脚本，而一次改名（`tools/*.mjs` → `*.ts`）同时散落在
   * CI 工作流、AGENTS.md、README.md 里，漏改一处只会等别人手打命令时才发现。这里按四类引用核对：
   * markdown 相对链接、`node <路径>`、`pnpm <脚本名>`、反引号里的仓库路径。
   *
   * 两个**刻意的收窄**（都是有实测误报才写的）：
   *   1. 反引号路径只认 `tools/`、`src/`、`assets/`、`.github/` —— `lib/main.js` 指的是 **asar 根**
   *      的宿主 bundle、`docs/favicon.svg` 指的是**官方 MCP 仓库**的文件，把这两个命名空间纳进来
   *      当天就是 4 条假阳性；
   *   2. 不扫 `docs/**`：`docs/ts-migration-plan.md` 是历史计划快照，故意保留改名前的文件名。
   *
   * 聚合为**一条**断言（问题拼在 detail 里），失败时一次给全清单，不淹没其他断言。
   */
  {
    /** pnpm 内建命令与虚拟脚本（`pnpm test` / `pnpm install` 没有 scripts 条目也合法）。 */
    const PNPM_BUILTIN = new Set([
      'install',
      'add',
      'remove',
      'dlx',
      'exec',
      'run',
      'why',
      'update',
      'publish',
      'pack',
      'audit',
      'outdated',
      'list',
      'prune',
      'rebuild',
      'setup',
      'init',
      'import',
      'patch',
      'deploy',
      'start',
      'test',
      'store',
      'env',
      'config',
      'link',
      'unlink',
    ])
    const NODE_CMD = /\bnode\s+((?:\.{1,2}\/)?[\w./@-]+\.(?:ts|mjs|cjs|js))\b/g
    const REPO_FILE = /`((?:tools|src|assets|\.github)\/[\w./@-]+\.(?:ts|tsx|mjs|cjs|js|json|yml|yaml|svg))`/g
    const LINK = /\]\(([^)\s]+)\)/g
    const PNPM_SCRIPT = /\bpnpm\s+(?:run\s+)?([a-z][\w:-]*)/g
    const workflows = join(root, '.github', 'workflows')
    const targets = [
      'AGENTS.md',
      'README.md',
      ...(existsSync(workflows)
        ? (await readdir(workflows))
            .filter((name) => name.endsWith('.yml'))
            .map((name) => join('.github', 'workflows', name))
        : []),
    ]
    const problems: string[] = []
    for (const doc of targets) {
      const text = await readFile(join(root, doc), 'utf8')
      for (const [, link] of text.matchAll(LINK)) {
        if (/^(https?:|mailto:|#)/.test(link)) continue
        const rel = decodeURI(link.split('#')[0])
        if (!existsSync(join(root, rel))) problems.push(`${doc}: 链接目标不存在 ${rel}`)
      }
      for (const [, file] of text.matchAll(NODE_CMD)) {
        if (!existsSync(join(root, file))) problems.push(`${doc}: node 脚本不存在 ${file}`)
      }
      for (const [, name] of text.matchAll(PNPM_SCRIPT)) {
        if (!PNPM_BUILTIN.has(name) && !(name in (manifest.scripts ?? {}))) {
          problems.push(`${doc}: pnpm 脚本不存在 ${name}`)
        }
      }
      for (const [, file] of text.matchAll(REPO_FILE)) {
        if (!existsSync(join(root, file))) problems.push(`${doc}: 正文提到但文件不存在 ${file}`)
      }
    }
    check('E12 文档 / 工作流里的文件与脚本引用都存在（改名的漏改面）', problems.length === 0, problems.join('；'))
  }
}
//#endregion

//#region P. 发布形态（bundle / npm 包）
/**
 * P 区守的是"这个仓库能不能被 `plugin_manager install_bundle` 一键装上"（publish-plan §4）。
 *
 * 为什么值得单独一区：bundle 判定的失败**不报错在源码上**，而是在别人的机器上表现为
 * 「装不上」（`not-a-bundle`）或「装上了但设置里没有 MCP 页」（github-release-plan §7）。
 * 这些字段一旦漂移（改名、换 patch 路径、`files` 白名单漏项），本地构建与流水线都照样全绿。
 *
 * 零依赖约束：自检不装 `node_modules`（publish-plan §2），所以这里**不引 YAML 解析器**，
 * 只按本仓库 patch 文件用到的 YAML 子集做行解析（见 insertEntriesOf）。
 */
{
  /** 把若干子条件聚合成一条断言；失败时 detail 直接列出不成立的子项（反向验证要能看出是哪一项）。 */
  const checkAll = (label: string, cases: Record<string, unknown>): void => {
    const failed = Object.entries(cases)
      .filter(([, ok]) => !ok)
      .map(([name]) => name)
    check(label, failed.length === 0, failed.length === 0 ? '' : `不成立：${failed.join(', ')}`)
  }

  /**
   * 取出 `insert:` 列表下的条目（只认本仓库 patch 用到的 `id` / `name` 两个键）。
   *
   * 为什么必须区分"在 insert 里"：`- id: X`（不带 `insert`）是**顶层覆写行**——目标条目不存在时
   * `applyEntryPatches` 直接 warn 并丢弃它（README 2.3）。把插件行写成覆写行，效果就是
   * "bundle 装上了、Loader 里却没有这一行"，也就是最难查的那种故障。
   */
  const insertEntriesOf = (text: string): Array<{ id: string; name?: string }> => {
    const entries: Array<{ id: string; name?: string }> = []
    let insertIndent: number | null = null
    let current: { id: string; name?: string } | null = null
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+#.*$/, '').trimEnd()
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue
      const indent = line.length - line.trimStart().length
      if (/^\s*(?:-\s*)?insert:\s*(?:\[\s*\])?\s*$/.test(line)) {
        insertIndent = indent
        current = null
        continue
      }
      if (insertIndent === null) continue
      if (indent <= insertIndent) {
        insertIndent = null
        current = null
        continue
      }
      const item = /^\s*-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
      if (item !== null) {
        current = { id: item[1] ?? '' }
        entries.push(current)
        continue
      }
      const named = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
      if (named !== null && current !== null && current.name === undefined) current.name = named[1] ?? ''
    }
    return entries
  }

  // —— P1：必须声明 dsh.bundle.patch，且文件真实存在（安装器的 bundle 判据就是它）——
  const bundlePatch = manifest.dsh?.bundle?.patch
  const bundlePatchPath = typeof bundlePatch === 'string' ? bundlePatch : ''
  const bundlePatchFile = bundlePatchPath === '' ? '' : join(root, bundlePatchPath)
  check(
    'P1 dsh.bundle.patch 声明了 patch 文件，且该文件真实存在',
    bundlePatchPath !== '' && existsSync(bundlePatchFile),
    String(bundlePatch),
  )

  // —— P2–P4：patch 的内容与跨文件一致性 ——
  const patchText = bundlePatchPath !== '' && existsSync(bundlePatchFile) ? await readFile(bundlePatchFile, 'utf8') : ''
  const patchEntries = insertEntriesOf(patchText)
  checkAll('P2 patch 的 insert 列表里自带两条（group + 插件），且 id 不重复', {
    两条: patchEntries.length === 2,
    'id 不重复': new Set(patchEntries.map((entry) => entry.id)).size === patchEntries.length,
  })
  const groupEntry = patchEntries.find((entry) => entry.id === shared.GROUP_ID)
  checkAll('P3 patch 的 group 行：id == src/shared/constants.ts 的 GROUP_ID，name == cordis:group', {
    'id 命中 GROUP_ID': groupEntry !== undefined,
    'name 是 cordis:group': groupEntry?.name === 'cordis:group',
  })
  const pluginEntry = patchEntries.find((entry) => entry.id !== shared.GROUP_ID)
  checkAll('P4 patch 的插件行：name == package.json 的 name（改名漏改立刻红）', {
    插件行存在: pluginEntry !== undefined,
    'name 等于包名': pluginEntry?.name === manifest.name,
  })

  // —— P5/P6：files 白名单 ——
  // git 路线下它是**生命线**：白名单外的文件根本不会出现在包里（github-release-plan §0 硬约束 4）。
  const filesList: string[] = Array.isArray(manifest.files)
    ? manifest.files.filter((file: unknown): file is string => typeof file === 'string')
    : []
  /**
   * npm 的 `files` 匹配语义有两条规则，缺一不可：
   *   1. 指向**目录**的条目（本仓库的 `lib`）＝包含该目录下的全部内容；
   *   2. 其余按 glob 比对（`locale/*.json`）。
   * 只按字符串相等比对是**错的**：它会把 `lib` 判成"没覆盖 lib/index.js"（本区第一次写就踩了）。
   */
  const isDirectoryEntry = (relative: string): boolean => {
    try {
      return statSync(join(root, relative)).isDirectory()
    } catch {
      return false
    }
  }
  const covered = (target: string): boolean =>
    filesList.some((pattern) => {
      const normalized = pattern.replace(/^\.\//, '').replace(/\/+$/, '')
      if (normalized === target) return true
      if (isDirectoryEntry(normalized)) return target.startsWith(`${normalized}/`)
      const regex = normalized
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*')
      return new RegExp(`^${regex}$`).test(target)
    })
  const requiredInPackage = [
    'lib/index.js',
    'lib/client.js',
    'lib/types/host/index.d.ts',
    bundlePatchPath.replace(/^\.\//, ''),
    'locale/en.json',
    'locale/zh.json',
    typeof manifest.icon === 'string' ? manifest.icon.replace(/^\.\//, '') : '',
    'README.md',
    'LICENSE',
  ]
  checkAll(
    'P5 files 白名单覆盖产物 / patch / locale / 图标 / README / LICENSE，且这些文件都在盘上',
    Object.fromEntries(
      requiredInPackage.map((file) => [file, file !== '' && covered(file) && existsSync(join(root, file))]),
    ),
  )
  const leaked = filesList
    .map((pattern) => pattern.replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter((pattern) => /^(?:src|tools|docs|AGENTS\.md)(?:\/|$)/.test(pattern))
  check(
    'P6 files 白名单不含 src / tools / docs / AGENTS.md（源码与工具不发出去）',
    leaked.length === 0,
    leaked.join(', '),
  )

  // —— P7：locale（app-boot 经 ESM 解析器读 `<包名>/locale/en.json`，只认 exports 暴露的路径）——
  const localeDir = join(root, 'locale')
  const localeFiles = existsSync(localeDir) ? (await readdir(localeDir)).filter((name) => name.endsWith('.json')) : []
  /**
   * 读一份语言包并校验 `meta.title` / `meta.description`。
   * app-boot 的 `textOf()` 对空串/非字符串**直接抛**（dsh-app-boot/lib/index.js:1910），
   * 那会让整个插件元数据变成一条 error，所以这里按"必须是非空字符串"来守。
   */
  const localeMetaOk = async (name: string): Promise<boolean> => {
    try {
      const parsed = JSON.parse(await readFile(join(localeDir, name), 'utf8'))
      const meta = parsed?.meta
      return (
        typeof meta?.title === 'string' &&
        meta.title !== '' &&
        typeof meta?.description === 'string' &&
        meta.description !== ''
      )
    } catch {
      return false
    }
  }
  const badLocales: string[] = []
  for (const name of localeFiles) if (!(await localeMetaOk(name))) badLocales.push(name)
  checkAll(
    'P7 locale：en/zh 都有非空 meta.title + meta.description，且 exports 暴露 ./locale/*.json（否则 app-boot 解析不到、静默丢语言包）',
    {
      'en.json 存在且字段非空': localeFiles.includes('en.json') && (await localeMetaOk('en.json')),
      'zh.json 存在且字段非空': localeFiles.includes('zh.json') && (await localeMetaOk('zh.json')),
      其它语言包也合法: badLocales.length === 0,
      'exports ./locale/*.json': typeof manifest.exports?.['./locale/*.json'] === 'string',
    },
  )

  // —— P8：图标（app-boot 的 iconOf()：包内相对路径、SVG/PNG/JPEG/WebP、≤256 KiB）——
  const iconPath = typeof manifest.icon === 'string' ? manifest.icon.replace(/^\.\//, '') : ''
  const iconFile = join(root, iconPath)
  const iconBytes = iconPath !== '' && existsSync(iconFile) ? await readFile(iconFile) : null
  const pathsIn = (text: string): string[] => [...text.matchAll(/\sd="([^"]+)"/g)].map(([, d]) => d ?? '')
  const markPaths = pathsIn(await readFile(join(root, 'assets', 'mcp-mark.svg'), 'utf8'))
  const iconPaths = pathsIn(iconBytes?.toString('utf8') ?? '')
  checkAll('P8 icon：包内相对路径 / 文件存在 / ≤256 KiB / 类型合法，且三条标记几何逐字取自 assets/mcp-mark.svg', {
    包内相对路径:
      iconPath !== '' &&
      !iconPath.startsWith('/') &&
      !iconPath.includes('..') &&
      !/^[A-Za-z][A-Za-z\d+.-]*:/.test(iconPath),
    文件存在: iconBytes !== null,
    '≤256 KiB': iconBytes !== null && iconBytes.length <= 256 * 1024,
    '类型是 svg/png/jpeg/webp': /\.(?:svg|png|jpe?g|webp)$/i.test(iconPath),
    三条标记几何逐字取自资产:
      markPaths.length === 3 && iconPaths.length === 3 && markPaths.every((path) => iconPaths.includes(path)),
  })

  // —— P9/P10：发布字段 ——
  // `exports["./package.json"]` 不是装饰：app-boot 用 `<包名>/package.json` 读 `icon` 与兜底文案
  // （dsh-app-boot/lib/index.js:1974），没暴露就是拿不到图标。
  checkAll('P9 不是 private 包、publishConfig.access == public、exports 暴露 ./package.json', {
    '无 private 字段': manifest.private === undefined,
    'publishConfig.access == public': manifest.publishConfig?.access === 'public',
    'exports ./package.json': typeof manifest.exports?.['./package.json'] === 'string',
  })
  // 兼容性只看 `@deepseek-ai/dsh-*` peer：钉死它们会让每次 DSH 升级都变成"整个 bundle 被 skip"
  // （publish-plan §2）。`engines.node` 则是自检自己的前提（Node ≥22.18 的类型擦除）。
  const peers = Object.keys(manifest.peerDependencies ?? {})
  checkAll('P10 peerDependencies 只有 @deepseek-ai/cordis（不许钉 @deepseek-ai/dsh-*），engines.node 存在', {
    '只有一个 peer 且是 cordis': peers.length === 1 && peers[0] === '@deepseek-ai/cordis',
    'engines.node 非空': typeof manifest.engines?.node === 'string' && manifest.engines.node !== '',
  })
}
//#endregion

//#region F. 纯函数直接单测
/**
 * F 区是 P2（把纯函数从闭包里抽出来）的回报。
 *
 * 在这之前，状态机只能靠"渲染出某段文案"间接覆盖（D 区），宿主那三个整理函数只能靠
 * B 区走一遍 handler。抽成模块之后这里直接 import **TypeScript 源码**（Node ≥22.18 的类型擦除），
 * 一条分支一条断言，失败时直接指出是哪个分支错了，而不是"某个页面少了一行字"。
 *
 * 纪律不变：断言不碰实现细节，只钉输入 → 输出。
 */
{
  const { statusOf, settling, failureText } = await import('../src/client/core/status.ts')
  const { draftOf, serverOf, serverOfExisting, pairsToText, targetOf, supports, suggestName } =
    await import('../src/client/core/draft.ts')
  const { normalizeRow, toRecord, toStringArray } = await import('../src/host/rows.ts')
  const { isRecord, asRecord, asText, readString } = await import('../src/shared/guards.ts')

  /** 期望抛出（返回 true 表示确实抛了）。 */
  const throws = (run) => {
    try {
      run()
      return false
    } catch {
      return true
    }
  }
  /** 造一条服务器记录；只写关心的字段。 */
  const srv = (over) => ({ index: 0, config: {}, phase: 'active', ...over })
  const probeOk = { connected: true, status: 200, detail: 'HTTP 200', at: 1 }
  const probeFail = { connected: false, status: 401, detail: 'HTTP 401', at: 1 }

  // —— statusOf：判定顺序就是优先级（AGENTS 3.10 的四色语义）——
  check('F1 已停用 → 灰', statusOf(srv({ disabled: true }), true).text === '已停用')
  check('F2 检测通过 + 条目 active → 绿', statusOf(srv({ probe: probeOk }), true).text === '运行中')
  check(
    'F3 检测失败 → 红，且原因带上 detail',
    statusOf(srv({ probe: probeFail }), true).text === '连接失败' &&
      statusOf(srv({ probe: probeFail }), true).reason.includes('HTTP 401'),
  )
  check(
    'F4 探不了（connected null，stdio）但条目 active → 绿（相位是唯一证据）',
    statusOf(srv({ probe: { connected: null, detail: '仅能探测 streamable-http', at: 1 } }), true).text === '运行中',
  )
  check(
    'F5 有日志失败记录 → 连接异常（红），原因带原文',
    statusOf(srv({ error: { message: 'connect ECONNREFUSED', at: 1, count: 1 } }), true).text === '连接异常',
  )
  check('F6 fiber FAILED → 加载失败', statusOf(srv({ phase: 'failed' }), true).text === '加载失败')
  check(
    'F7 pending / loading → 启动中（琥珀）',
    statusOf(srv({ phase: 'pending' }), true).text === '启动中' &&
      statusOf(srv({ phase: 'loading' }), true).text === '启动中',
  )
  check('F8 active 但没有探测记录 + 宿主能探测 → 未检测（**不报绿**）', statusOf(srv({}), true).text === '未检测')
  check('F9 active 但没有探测记录 + 旧宿主（不能探测）→ 运行中（向后兼容）', statusOf(srv({}), false).text === '运行中')
  check('F10 没有活条目 → 未启动', statusOf(srv({ phase: 'absent' }), true).text === '未启动')
  check(
    'F11 优先级：检测失败压过日志记录（"现在" > "过去"）',
    statusOf(srv({ probe: probeFail, error: { message: '旧错误' } }), true).text === '连接失败',
  )
  check(
    'F12 优先级：检测通过 + active 压过日志记录（旧失败不再代表现状）',
    statusOf(srv({ probe: probeOk, error: { message: '旧错误' } }), true).text === '运行中',
  )

  // —— settling：写入之后"相位稳定了吗" ——
  check(
    'F13 探通了但条目还没挂上（loading）→ 还没稳定',
    settling({ servers: [srv({ phase: 'loading', probe: probeOk })] }) === true,
  )
  check(
    'F14 active 或 failed 是终态 → 不再等',
    settling({ servers: [srv({ phase: 'active', probe: probeOk })] }) === false &&
      settling({ servers: [srv({ phase: 'failed', probe: probeOk })] }) === false,
  )
  check(
    'F15 停用的条目不算"没稳定"',
    settling({ servers: [srv({ disabled: true, phase: 'loading', probe: probeOk })] }) === false,
  )
  check('F16 快照缺失时不抛（旧宿主/首屏）', settling(null) === false && settling(undefined) === false)

  // —— failureText：时间 + 次数 + 原文 ——
  check(
    'F17 次数 > 1 时带上「已失败 N 次」',
    failureText({ message: 'boom', count: 3, at: Date.UTC(2026, 0, 1) }).includes('已失败 3 次'),
  )
  check('F18 只有 message 时就是原文', failureText({ message: 'boom' }) === 'boom')
  check('F19 空记录 → 空串（不抛）', failureText({}) === '')

  // —— draft.ts：记录 ↔ 草稿 ↔ 载荷 ——
  check(
    'F20 draftOf 把对象 headers 转成 KEY=VALUE 多行文本',
    draftOf(srv({ config: { serverName: 'x', headers: { A: '1', B: '2' } } })).headers === 'A=1\nB=2',
  )
  check(
    'F21 serverOfExisting 把 headers/env 转成文本形状（否则旧宿主静默清空）',
    (() => {
      const flat = serverOfExisting(
        srv({ config: { serverName: 'x', headers: { Authorization: 'Bearer k' }, env: { A: '1' } } }),
      )
      return flat.headers === 'Authorization=Bearer k' && flat.env === 'A=1'
    })(),
  )
  check(
    'F22 serverOfExisting 把 args 数组转成换行文本',
    serverOfExisting(srv({ config: { serverName: 'x', args: ['-y', 'pkg'] } })).args === '-y\npkg',
  )
  check(
    'F23 serverOf 按传输方式给出不同字段（http 不带 command，stdio 不带 url）',
    (() => {
      const http = serverOf({
        serverName: 'a',
        transport: 'streamable-http',
        url: 'http://x/mcp',
        command: 'npx',
        args: '',
        env: '',
        headers: 'H=1',
        cwd: '',
        disabled: false,
      })
      const stdio = serverOf({
        serverName: 'b',
        transport: 'stdio',
        url: 'http://x/mcp',
        command: 'npx',
        args: '-y',
        env: 'E=1',
        headers: 'H=1',
        cwd: '/tmp',
        disabled: false,
      })
      return !('command' in http) && !('url' in stdio) && http.url === 'http://x/mcp' && stdio.command === 'npx'
    })(),
  )
  check(
    'F24 targetOf：stdio 拼命令行，http 给 url，缺字段给占位文案',
    targetOf({ transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] }) === 'npx -y pkg' &&
      targetOf({ transport: 'streamable-http', url: 'http://x' }) === 'http://x' &&
      targetOf({ transport: 'streamable-http' }) === '(未填写 url)',
  )
  check(
    'F25 supports：能力表缺失/不含该项 → false',
    supports({ capabilities: ['probe'] }, 'probe') === true &&
      supports({ capabilities: ['probe'] }, 'remove') === false &&
      supports(null, 'probe') === false,
  )
  check(
    'F26 suggestName 跳过已占用的名字',
    suggestName([srv({ config: { serverName: 'server-1' } })]) === 'server-2' && suggestName([]) === 'server-1',
  )
  check('F27 pairsToText 对非对象返回空串', pairsToText(undefined) === '' && pairsToText('A=1') === '')

  // —— rows.ts：表单值 → YAML 行 ——
  check(
    'F28 toRecord 认三种形状（对象 / 字符串数组 / KEY=VALUE 多行文本）',
    JSON.stringify(toRecord({ A: '1' })) === '{"A":"1"}' &&
      JSON.stringify(toRecord(['A=1'])) === '{"A":"1"}' &&
      JSON.stringify(toRecord('A=1\nB=2')) === '{"A":"1","B":"2"}',
  )
  check(
    'F29 toRecord 忽略注释行与空行，空输入 → undefined',
    toRecord('# c\n\nA=1') !== undefined && toRecord('') === undefined,
  )
  check(
    'F30 toRecord 遇到缺 "=" 的行**抛错**（不静默丢字段）',
    throws(() => toRecord('NOEQUALS')),
  )
  check(
    'F31 toStringArray：数组 / 换行文本都认，其余 → 空数组',
    JSON.stringify(toStringArray(['a', 'b'])) === '["a","b"]' &&
      JSON.stringify(toStringArray('a\nb')) === '["a","b"]' &&
      JSON.stringify(toStringArray(42)) === '[]',
  )
  check(
    'F32 normalizeRow 保留 rowId 与 disabled（Loader 才认得出是同一个条目）',
    (() => {
      const row = normalizeRow({
        serverName: 'ctx',
        transport: 'streamable-http',
        url: 'http://x/mcp',
        headers: 'H=1',
        rowId: 'mcp-ctx',
        disabled: true,
      })
      return row.id === 'mcp-ctx' && row.disabled === true && row.name === '@deepseek-ai/dsh-mcp-client'
    })(),
  )
  check(
    'F33 normalizeRow 校验 serverName / url / command（非法就抛，不落盘半截配置）',
    throws(() => normalizeRow({ serverName: '有中文', transport: 'streamable-http', url: 'http://x' })) &&
      throws(() => normalizeRow({ serverName: 'a', transport: 'streamable-http' })) &&
      throws(() => normalizeRow({ serverName: 'a', transport: 'stdio' })),
  )
  check(
    'F34 normalizeRow 只写合法字段：toolCallTimeoutMs 非有限数不写，空 args/env 不写',
    (() => {
      const row = normalizeRow({
        serverName: 'a',
        transport: 'stdio',
        command: 'npx',
        args: '',
        env: '',
        toolCallTimeoutMs: Number.POSITIVE_INFINITY,
      })
      const config = row.config
      return !('args' in config) && !('env' in config) && !('toolCallTimeoutMs' in config)
    })(),
  )

  // —— guards.ts：不可信输入的收窄 ——
  check('F35 isRecord 排掉数组与 null', isRecord({}) === true && isRecord([]) === false && isRecord(null) === false)
  check('F36 asRecord 非对象 → 空表（读属性不会炸）', JSON.stringify(asRecord('x')) === '{}')
  check(
    'F37 asText 只认 string/number：对象给 "" 而不是 "[object Object]"',
    asText('a') === 'a' && asText(12) === '12' && asText({}) === '' && asText([1]) === '',
  )
  check(
    'F38 readString 非字符串 → undefined（"没写"与"写了空串"可区分）',
    readString({ a: '' }, 'a') === '' && readString({ a: 1 }, 'a') === undefined,
  )
}
//#endregion

const total = passed + failures.length
if (failures.length === 0) {
  console.log(`PASS ${String(passed)}/${String(total)}`)
} else {
  console.log(`FAIL ${String(failures.length)}/${String(total)}`)
  for (const failure of failures) console.log(`  ✗ ${failure}`)
  process.exitCode = 1
}
