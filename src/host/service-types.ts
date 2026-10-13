/**
 * 宿主半边用到的 Service 形状 —— **最小接口，不是官方声明的复刻**。
 *
 * 为什么不直接 import 官方类型：本插件只依赖一个 peer（`@deepseek-ai/cordis`），
 * 刻意不把 `@deepseek-ai/dsh-*` 钉成依赖 —— app-boot 会按 bundle 自己的 peer 做兼容判定，
 * 钉死 rc 版本会让每次 DSH 升级都整个 bundle 被 skip（见 README 与 docs/ts-migration-plan.md §5.4）。
 *
 * 所以这里写的是**实测出来的**契约：只列我们真正调用的成员，形状来自对运行时源码的核对
 * （出处见 README 第 9 节证据索引）。官方类型将来若更宽/更窄，也不影响本文件。
 *
 * 纪律：本文件只放类型，**不放实现**，也不 import 任何运行时值。
 */

/** 配置行 —— 来自 YAML，形状不可信，所以 config 是 unknown，用之前必须收窄。 */
export interface EntryRow {
  id?: string | undefined
  name?: string | undefined
  disabled?: boolean | undefined
  /** 对 group 条目是「子条目数组」，对 MCP 子条目是「服务器配置对象」。 */
  config?: unknown
  [key: string]: unknown
}

/** Loader 条目。`fiber.state` 是 cordis `FiberState` 的数值（见 index.ts 的 FIBER_PHASE）。 */
export interface LoaderEntry {
  options: EntryRow
  fiber?: { state: number } | undefined
}

/** `ctx.loader`：只用到"列出全部条目"。 */
export interface LoaderService {
  entries(): Iterable<LoaderEntry>
}

/**
 * `ctx.configEditor.configuration()` 的一层。
 * `override` 是 profile 补丁层的覆写值，`inherited` 是继承层（bundle / insert 声明）的值。
 * **覆写是整键赋值，不是分层合并** —— 所以 override 非空时只能认它（README 2.4 / B70）。
 */
export interface ConfigLayer {
  entry: { options: { id?: string | undefined } }
  override?: unknown
  inherited?: unknown
}

/** `ctx.configEditor`：外科手术式 YAML 编辑（保留 insert 结构、写前校验、失败回滚）。 */
export interface ConfigEditorService {
  entries(): LoaderEntry[]
  configuration(): ConfigLayer[]
  edit(entry: LoaderEntry, update: () => unknown): Promise<void>
}

/** `ctx.connection.fetch.register()` 的路由声明。 */
export interface FetchRoute {
  path: string
  methods: string[]
  requestBody: 'buffered'
  fetch(request: Request): Promise<Response>
}

/** `ctx.connection`：与 `/api` RPC 共用处理链，自动获得 Host/Origin 围栏与浏览器鉴权。 */
export interface ConnectionService {
  fetch: { register(route: FetchRoute): void }
}

/** cordis 的结构化日志记录（exporter 回调参数）。 */
export interface LogMessage {
  type?: string | undefined
  args?: unknown[] | undefined
  ts?: number | undefined
}

/** `ctx.logger`：cordis 内置服务，只用 exporter 收 mcp-client 的失败原文。 */
export interface LoggerService {
  exporter(options: { levels: { default: number }; export(message: LogMessage): void }): void
}

/** `ctx.tools`：可选服务，只用 schemas() 读"此刻真正注册给模型的工具名"。 */
export interface ToolsService {
  /** 元素允许为 null/undefined：这是运行时表，不是我们造的数据。 */
  schemas(): Array<{ name?: unknown } | null | undefined>
}

/** `ctx.inject([...], scope => …)` 回调收到的 scope。 */
export interface HostScope {
  configEditor: ConfigEditorService
  loader: LoaderService
  connection: ConnectionService
  /** cordis 内置：构造 Context 时就有，所以不写进 inject 声明，只做存在性判断。 */
  logger?: LoggerService | undefined
  /** 可选服务用 get() 拿，缺了也要能降级。 */
  get?(name: string): unknown
  tools?: ToolsService | undefined
}

/** 宿主根上下文：只用到 inject。 */
export interface HostContext {
  inject(services: string[], callback: (scope: HostScope) => void): void
}
