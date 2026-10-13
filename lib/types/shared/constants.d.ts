/**
 * 两半边**共享**的常量 —— 全仓库唯一来源。
 *
 * 为什么要有这个文件：这些值原本各写一遍（宿主 `lib/index.js` 用单引号、客户端
 * `lib/client.js` 用双引号），只能靠自检 A9/A10 的「字符串包含」断言保证两边不跑偏。
 * 抽到这里之后，两半边都从同一个模块取值，一致性由**编译期**保证，断言退化为回归保护。
 *
 * 纪律：这里只放两半边都要认的**协议值**。只属于某一半的实现细节（超时预算、日志正则、
 * 相位表……）留在那一半自己的模块里，不要为了"集中"把半边私有细节搬过来。
 */
/** 本插件注册的浏览器路由。宿主 `ctx.connection.fetch.register()` 与客户端 `fetch()` 必须逐字一致。 */
export declare const ROUTE = "/api/mcp-manager";
/**
 * 承载全部 MCP 服务器的 `cordis:group` 条目 id —— 本插件的**数据容器**。
 *
 * 一台 MCP 服务器 = 这个 group 的 config 数组里的一行（`@deepseek-ai/dsh-mcp-client`），
 * 所以它既是"配置文件里的一行"，也是"运行时的一个 Loader 子条目"。
 * 客户端不硬编码这个值：它从快照的 `groupId` 字段读（旧宿主也会给）。
 */
export declare const GROUP_ID = "mcp-manager";
/** MCP 客户端插件包名。宿主用它区分"哪些 Loader 条目是我们管的服务器"。 */
export declare const MCP_PACKAGE = "@deepseek-ai/dsh-mcp-client";
/** 设置导航里那一页的座位 id（`settings.section` 的 `id`）。 */
export declare const SECTION_ID = "mcp";
/**
 * 座位 label。它同时是**导航标记的锚点**：官方 `settings.section` 注册契约里没有 icon 字段，
 * 本插件靠"渲染后按 label 文本找到自己那一格再打 data 属性"来换图标（见 README 8.6），
 * 所以 id / label 必须与注册处共用这两个常量，不能各写各的字面量。
 */
export declare const SECTION_LABEL = "MCP";
