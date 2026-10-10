# dsh-mcp-manager

在 DSH（Web / 桌面端）的**设置面板最下方**加一页 **MCP**，可视化增删改、启停 MCP 服务器并看到它们的加载状态。

本文回答「如何实现」，并且每条结论都标了**在哪个官方源码里实测到**——因为 DSH 的插件席位、配置写入、客户端远程调用这三条链路里有好几条看着能用、实际被硬约束堵死的路，踩错一条会浪费大量时间。

---

## 0. 一句话结论

**这是一个「客户端半边 + 宿主半边」的双半插件**：

| 半边 | 文件 | 职责 |
|---|---|---|
| 客户端 | `lib/client.js` | 往 `settings.section`（list 座位）注册一页，`order: 900` → 落在设置导航最下方。纯 `window.__ModuleLoader__` 懒 CJS bundle。 |
| 宿主 | `lib/index.js` | 用 `ctx.connection.fetch.register()` 开一条**自带鉴权的同源 HTTP 路由**，用 `ctx.configEditor.edit()` 做**外科手术式的配置写入**。 |

数据模型的关键取舍：**所有 MCP 服务器放进一个 `cordis:group` 条目的 config 数组**。于是「增 / 删 / 改 / 启停」四件事全部退化为「重写这一个数组」，全部走官方的配置写入通道。

---

## 1. 界面接入点：「设置界面下方」到底接哪个座位

实测的座位树（`cordis_inspect_query` → client `Slots.listSubTree`）：

```
sidebar.settings                    single
├── settings.section                list   ← 「一页一设置分组」，本插件接这里
│   ├── settings.general.item       list
│   ├── settings.plugins.tab        list   ← 备选：Plugins 分组里的一页
│   ├── settings.models.footer      list
│   └── settings.models.provider-card  keyed
├── settings.onboarding             list
├── settings.trigger / header / action / close / launcher
```

- `settings.section` 是 **list 座位**：所有注册者都会渲染，按 `order` 升序排成设置左侧导航的一页。
- 官方的 General 是 `order: 0`（证据：`dsh-client-ui-settings-general/lib/client.js:1171-1181`）。
- 官方导航自己就是靠 `ctx.slots.entries("settings.section")` + `sort((a,b) => a.order - b.order)` 拼出来的（同上文件 `:1017-1030`）。
- 所以**要「下方」就把 order 开大**。本插件用 `900`。

注册代码（本仓库 `lib/client.js`，与官方写法同形）：

```js
ctx.inject(["slots"], (scope) => {
  scope.slots.inject("settings.section", () =>
    scope.slots.register(
      { name: "settings.section", id: "mcp", order: 900, label: () => "MCP" },
      McpSection,
    ),
  );
});
```

> `label` 可传 `string` 或 `() => string`（`resolveSlotLabel` 两种都认）。
> 注意 `settings.section` 是 list 座位，**不像 `single` 座位那样需要 priority 抢位**，所以不存在遮蔽官方控件的风险——这也让本插件天然可回滚。

---

## 2. 数据面事实：MCP 服务器就是 Loader 条目

### 2.1 一个 MCP 服务器 = 一个 `@deepseek-ai/dsh-mcp-client` 条目

实测（`Config.listConfigs`）：

```json
{ "id": "include:mcp-context7",
  "patchId": "mcp-context7",
  "name": "@deepseek-ai/dsh-mcp-client",
  "status": "schema",
  "packageDir": "...\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-mcp-client" }
```

本机 profile（`C:\Users\admin\.dsh\profiles\desktop\cordis.patch.yml`）里它长这样：

```yaml
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: streamable-http
        url: https://mcp.context7.com/mcp
        headers:
          Authorization: "Bearer ..."
```

### 2.2 `dsh-mcp-client` 的 Config schema（从 `Config.listConfigs` 取到的完整投影）

`anyOf` 两支，都必须有 `serverName`（`^[A-Za-z0-9_-]{1,32}$`）：

| 分支 | 必填 | 可选 |
|---|---|---|
| `transport: stdio` | `serverName`, `command` | `args[]`, `env{}`, `cwd`, `toolCallTimeoutMs`(60s), `failOnStartupError`, `maxInstructionBytes`(32KB), `reconnect{enabled,initialDelayMs,maxDelayMs,maxAttempts}` |
| `transport: streamable-http` | `serverName`, `url` | `headers{}`, 以及同上一组 |

配置也可以是 `null`（该分支存在，表示「本条目没有服务器」）。

### 2.3 条目的行语义（这是很多坑的根源）

`@deepseek-ai/cordis-plugin-include/lib/index.js:56-105` 的 `applyEntryPatches` 是唯一权威：

| 写法 | 语义 |
|---|---|
| `- insert: [ ... ]`（无 `id`） | 把这些行**追加**到顶层条目列表 |
| `- id: X` + `insert: [...]` | 把 `insert` 的行走追加进**已存在的 group 条目 X** 的 `config` 里（X 不是 group 就 warn 跳过） |
| `- id: X`（无 `insert`） | **覆写**已存在条目 X 的字段；**X 不存在就 warn「entry not found」并丢弃** |
| `- id: X, name: Y, config: {...}` | 同上，是覆写；`name` 与目标不符会被拒 |

关键细节：**`insert` 进去的行会被 `buildMap(insert)` 注册进 `entryMap`**（`:83`），所以**同一个文件里排在 insert 后面的顶层 `- id: X` 覆写行能命中它**。这正是下面「单条目 + 覆写」方案的合法性依据。

→ 也顺带解释了 profile 里那句中文注释：想**新增**条目必须用 `insert:`；直接写顶层 `- id:` 因为目标不存在会被丢弃。

---

## 3. 通道选型：四条候选，三条被堵死

这是本文最省时间的部分。客户端要读写宿主配置，看起来有 4 条路：

### ❌ A. `ctx.remote.settings`（`settingsController` 的 Remote 命名空间）

**为什么看着能用**：官方设置页（`ui-settings-shell` / `agent-loop` / `subagent` / `web-search`）就是这么编辑插件配置的，`describe()` / `update()` / `replace()` / `mutate()` 都已挂在客户端。

**为什么不能用**（实测 `@deepseek-ai/dsh-settings/lib/index.js:413-506`）：

- `describe()` 对每个条目算 `volatileForm(schema)`，**为 `undefined` 就 `return []`**（`:418-419`）——即只有声明了 `.volatile()` 的字段才会出现在设置文档里；
- `write()` 更直接：`if (form === void 0) throw new Error('Plugin entry "X" has no volatile fields')`（`:505-506`）。

而 `@deepseek-ai/dsh-mcp-client/lib/index.js:780` 是 `const Config = z.union([...])`，**整个包 grep 不到 `volatile`**。

→ **MCP 条目对 `remote.settings` 完全不可见，也不可写。**

### ⚠️ B. `ctx.configEditor`（宿主服务，直接读写）

**能用**：`entries()` / `configuration()` / `edit()`，`edit` 是外科手术式 YAML 编辑——保留用户手写的 `insert:` 结构、写入前校验、失败回滚（`dsh-config-editor/lib/index.js:69-135`）。

**限制**：`edit()` 只能改**已存在**的条目（`document.add({id, name, config})` 追加一条覆写行），**不能新增/删除条目**。

→ 所以本插件把「新增/删除」表达成**一个数组的重写**（见第 4 节），从而完全不需要碰条目增删。

### ⚠️ C. 自建 Remote 命名空间（`ctx.typert.register()` + `ctx.remote.$mount()`）

**能用，且是官方机制**：`$mount` 确实是公开扩展点（`dsh-api-gateway/lib/types/client/index.js:80-135`），它只要求 descriptor 通过 `validateContribution`，并把 descriptor 注册进 `callerCtx.typert.remotes`。

**为什么没选**：要手写 zod 风格的**严格 codec**（`requireStrictInputs` 要求每个参数的 `codec.mode === 'strict'`，`:587-602`）——客户端 bundle 里没有 zod 种子模块，只能自己造 shim；而且 `@deepseek-ai/dsh-api-remotes` 的 README 明说能力集是**构建期固定**的（"the Client does not discover the Host's active Services or Remote definitions at runtime"）。收益远低于代价。

### ✅ D. `ctx.connection.fetch.register()` —— 本插件采用

**为什么选它**（实测 `@deepseek-ai/dsh-client-connection/lib/index.js`）：

- 精确路径路由（`:608-624`）：`fetchRoutes.get(url.pathname)` 按 pathname 精确匹配；
- **自动鉴权**：这套 handler 就挂在 webServer 的 `/api` prefix 路由之下，该路由先 `connection.admit(req)` 做 Host/Origin 围栏 + 浏览器鉴权，再交给共享 handler（`:829-843`）。**不需要自建 token**；
- 路径形态被 `assertFetchRoute` 约束为 `/api/<单段名>`：`endpointFromPath("/api", route.path)` 必须可解析（`:758-762`，`API_PATH = "/api"`）；
- `register()` **自己就把 disposer 挂到调用方 scope 的 effect 上**（`registerFetchRoute` 里 `owner.effect(...)`，`:632-638`）——注意 `get fetch()` 里的 `owner = this.ctx`，是**调用方上下文**（Cordis Service 方法按调用方上下文求值），所以随插件卸载自动摘路由；
- 宿主半边**零 import**：只用注入进来的 Service + 全局 `Request`/`Response`。这点是硬要求——插件由 `file:///D:/.../lib/index.js` 加载，裸模块说明符都在 app.asar 里，从磁盘路径解析不到。

---

## 4. 本仓库的架构

### 4.1 单一可编辑条目：`cordis:group`

`cordis:group` 是 Cordis 内置插件（实测 `dsh-app-boot/lib/index.js:3703` `ctx.loader.builtins.group = Group`），它的 config 就是一份 `entryList`（`:2814`）。

把 MCP 服务器全放进它的 config 数组：

```yaml
- insert:
    - id: mcp-manager
      name: 'cordis:group'
      config:
        - name: '@deepseek-ai/dsh-mcp-client'
          config:
            serverName: context7
            transport: streamable-http
            url: https://mcp.context7.com/mcp
            headers:
              Authorization: "Bearer ..."
        - name: '@deepseek-ai/dsh-mcp-client'
          config: { serverName: fs, transport: stdio, command: npx, args: ['-y', 'pkg'] }
        - name: '@deepseek-ai/dsh-mcp-client'
          disabled: true            # ← 停用就是这么表达的
          config: { serverName: old, transport: streamable-http, url: https://example.com/mcp }
```

于是：

| 操作 | 实现 |
|---|---|
| 列出 | 读 group 条目的 config 数组 + 扫 `ctx.loader.entries()` 里活着的 MCP 子条目拿状态 |
| 新增 / 删除 | 就是数组加一项 / 去一项 |
| 修改 | 就是改数组里那一项 |
| 启停 | 就是该项的 `disabled: true/false` |

**为什么不用 `ctx.loader.create()/remove()` 动态加条目**：Loader 的 `EntryTree` 基类 `write()` 是空实现，持久化由 `dsh-app-boot` 的 `Include` 类提供，而它的 `write()` 是 **`this.writeFile(this.root.data)`**（`:245-248`）——**整体重写 root.data**，可能把用户手写的 `insert:` 分节压平。那是不可接受的破坏性写入。走 `configEditor.edit()` 则是针对性的 YAML 节点编辑，安全得多。

### 4.2 写入路径的合法性闭环

`configEditor.edit(groupEntry, () => nextArray)` 对 insert 声明的条目会走 `index < 0` 分支 → `document.add({ id: 'mcp-manager', name: 'cordis:group', config: nextArray })`，即在**文件末尾追加一条顶层覆写行**（`dsh-config-editor/lib/index.js:98-110`）。

这条覆写行为什么有效：`applyEntryPatches` 先处理 `insert:` 行（`data.push(...insert)` + `buildMap(insert)` ），**后**处理顶层覆写行，此时 `mcp-manager` 已在 `entryMap` 里 → `target.config = nextArray` ✅（`cordis-plugin-include/lib/index.js:82-102`）。

写完还过一道断言：`composeEntries([patches]).find(row => row.id === 'mcp-manager').config` 必须深等于 `nextArray`，否则抛错（`dsh-config-editor/lib/index.js:122`）。**这道断言在 `writeFileAtomic` 之前**（`:123`），所以即使假设不成立也是**安全失败**：报错、不落盘、不损坏配置。

最后 `reconcileProfilePatches()` 让 Loader 热重载，group 的 `internal/update` 会重建子条目（`cordis-plugin-loader/lib/index.js:108-115`）。

### 4.3 文件清单

```
dsh-mcp-manager/
  package.json      exports{"./client"} + dsh.client{platform:"web"} + name（= 客户端 bundle 的模块 id）
  lib/index.js      宿主半边：/api/mcp-manager 路由 + 读写验证（零 import）
  lib/client.js     浏览器半边：settings.section 页面（懒 CJS bundle）
  tools/verify.mjs  自检：102 条断言，纯 Node 零依赖
  .gitattributes    统一 LF（本仓库全 LF，混入 CRLF 会产生整文件 diff）
  .gitignore        node_modules / 构建产物 / 日志 / 编辑器 / 系统文件
```

运行时**零依赖**：宿主半边不 import 任何东西；浏览器半边只 `require("react")` 与 `require("@deepseek-ai/dsh-client-ui-primitives")`（平台种子表内）。

---

## 5. 接线（两步，都在 profile 的 `cordis.patch.yml`）

文件：`C:\Users\admin\.dsh\profiles\desktop\cordis.patch.yml`

**第一步**：把现有的 MCP 条目收进一个 group。即把现在的

```yaml
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config: { ... }
```

换成（注意 `insert:` 在补丁层里是**必填**的，直接写顶层 `- id:` 会被丢弃）：

```yaml
- insert:
    - id: mcp-manager
      name: 'cordis:group'
      config:
        - name: '@deepseek-ai/dsh-mcp-client'
          config:
            serverName: context7
            transport: streamable-http
            url: https://mcp.context7.com/mcp
            headers:
              Authorization: "Bearer ..."
```

**第二步**：追加本插件的路径行（与 `codex-effort-picker` 完全同一套接线，不需要 pnpm / node_modules）：

```yaml
- insert:
    - id: dsh-mcp-manager
      name: 'file:///D:/project/dsh-plugins/dsh-mcp-manager/lib/index.js'
```

**回滚**：删掉第二条 insert 行即可，设置面板里那一页立刻消失（`settings.section` 是 list 座位，不遮蔽任何官方 UI）。

**本次接线的备份**：`C:\Users\admin\.dsh\profiles\desktop\cordis.patch.yml.bak-1791623293441`（接线前的原始 6221 字节版本）。注意接线期间该文件被并发编辑过（新增了 `web-search-tavily` 等行），所以直接整份回滚会丢掉那些改动——回滚请按上面说的**只删对应行**。

---

## 6. 自检

```powershell
node D:\project\dsh-plugins\dsh-mcp-manager\tools\verify.mjs
# → PASS 102/102
```

覆盖：包清单契约（`dsh.client.platform`、`exports["./client"]`、bundle 模块 id 必须等于包名、只 require 种子模块、宿主半边零 import）；宿主半边行为（依赖声明、路由路径/方法/requestBody、GET 快照与状态映射、**三种操作 `setEnabled`/`remove`/`save`**、`env`/`headers`/`args` 的三种输入形状、非法 `serverName`/空 `url`/未知操作被拒且**不落盘**、group 条目缺失时的可读报错）；**行内操作回归测试**（B27–B42：停用后 `headers` 必须仍在、启用后仍在、删除只删目标、名字找不到回 409、回退路径的文本形状解析正确）；客户端半边行为（懒 CJS 协议、`settings.section` 注册契约、order 与 label、能力协商）；**主题 / 尺寸 / 自适应 / 表单结构护栏**（A11–A12c：不得裸硬编码颜色、主按钮必须用 foreground token、视觉必须走注入的样式表且有 hover 反馈；A13–A31：标题行与说明文字分层、紧凑档尺寸对齐官方 `.sm`/`.rowActions`、**表单面板对齐官方 models 页（底色分层 + 无描边 + 输入框 token）**、操作区不换行、不重复叠加外壳留白、不渲染 URL 详情、主体自适应且不撑破、不在 inline style 里写尺寸、`mono` 与 `multiline` 分离、一卡一服务器且表单展开在同一张卡内、编辑按钮可收起）；**真实渲染测试**（D1–D13：用迷你渲染器递归展开函数组件，覆盖列表 / 展开编辑 / 新增 / 空 / 载入 / 错误 / 未配置七种状态，断言"表单确实在那张卡内部"、"url 是 `input` 而 `headers` 是 `textarea`"、"展开时不会出现第二张同名卡"）。

---

## 7. 实测状态

### 7.1 已在真实运行时验证通过（2026-10-10，本机 desktop profile）

profile 已按第 5 节接线，`dsh-hmr` 监听该文件（`dsh-hmr/lib/index.js:353-376`），**改完即时生效、未重启应用**：

| 验证项 | 证据 |
|---|---|
| 补丁热重载生效 | 运行时条目总数 192 → **195**（`plugin_manager list_plugins`） |
| group 条目挂载 | `include:mcp-manager` → `cordis:group`，`fiberPhase: active` |
| context7 迁移成功 | `include:ef60a0d1` → `@deepseek-ai/dsh-mcp-client`，`active`，`readOnlyReason: "unaddressable"` |
| **宿主半边生效** | `include:dsh-mcp-manager` → `fiberPhase: active`（`apply()` 内同步注册路由，抛错会挂掉 fiber） |
| **客户端半边生效** | `settings.section` 台账 occupants 含 `{id:"mcp", order:900, active:true}`，且是 order 最大的一项 |
| 路由受鉴权保护 | `GET/POST /api/mcp-manager` → **401**；伪造 `Host` → **403** |
| 自检 | `PASS 102/102` |
| 文件编码 | 无 BOM、无 U+FFFD、LF 行尾、YAML 解析通过 |

`readOnlyReason: "unaddressable"` 这一条尤其值得记下：它**正面印证了「group 子条目不可单独寻址」**——所以 `configEditor` 只能整体重写 group 的 config 数组，这正是本插件「单一数组」设计的由来，而不是实现偷懒。

`settings.section` 最终台账（order 升序）：

```
account -10 | general 0 | models 10 | plugins 15 | agent-presets 20 | mcp 900 ← 本插件
```

### 7.2 仍未实测 / 已知取舍

1. **点击进入页面的那一次 fetch 往返**。路由已注册、围栏已验证，但「打开 设置 → MCP 看到列表」这一步需要在浏览器里点一次。客户端已内置失败态：读不到会渲染「读取失败：<原因>」+ 重试按钮，不会白屏。
2. **`configEditor.edit()` 对 insert 声明条目的 `document.add` 分支**尚未产生过一次真实写入（首次在 UI 上点「保存」时才走）。语义推导有 `applyEntryPatches` 源码支撑，且失败是安全的（写入前断言、不落盘）。
3. **覆写行的语义副作用**：首次写入后，配置的权威来源变成**文件末尾那条顶层覆写行**；group 的 `insert:` 行里的原始 config 退化为「继承层」。用户若手改 `insert:` 行会发现不生效——这是 DSH 分层配置的固有行为。
4. **group 子条目当前没有显式 `id`**，Loader 自动生成了 `ef60a0d1` 这类十六进制 id。若希望 id 稳定，给每个子条目手写 `id:`。
5. **UI 不依赖 primitives 组件**：视觉走注入的样式表（class 名 `mcpm-` 前缀），只用主题 token，因此 `require` 里只有 `react`。`@deepseek-ai/dsh-client-ui-primitives` 里确实有 `Button` / `Input` / `Switch` / `SettingsForm` / `Toast` / `Modal` —— 但它们的 props 我没有实测，所以没有猜着用；间距/配色改按官方 CSS 的实测值照抄（第 8 节）。
6. **`serverName` 重命名**：客户端目前按数组下标定位被编辑项，重命名会保留原 `rowId`。若改的是 `insert:` 行里的声明而非覆写行，可能新建而非复用条目。

### 7.3 行内操作曾经静默丢字段（已修）

线上症状：在设置页点「停用」，按钮变灰但状态不变；且 profile 里 context7 的 `headers` 消失了。

**已证实的根因（有落盘证据）**：行内操作原本把**整个数组**回传，宿主再用 `normalizeRow()` 逐行重建。而 `normalizeRow` 期望的 `env`/`headers` 形状是「多行 KEY=VALUE 文本」（表单产出的形状），快照里却是**对象** → 旧解析器对"非字符串非数组"直接返回 `undefined` → **`headers`/`env` 被静默清空**。证据：profile 的覆写行里 context7 只剩 `serverName/transport/url`，`Authorization` 头不见了。

**修复**（两层）：
1. `toRecord()` 现在同时接受对象、字符串数组、多行文本三种形状（A22 断言守住）。
2. 「启停」「删除」改为**宿主侧定点操作**：客户端只发 `{ serverName, enabled }` / `{ serverName }`，宿主按名字定位那一行**原地改**，其余行原样回写——字段不可能丢。B27–B42 是这条路径的回归测试（含"停用后 headers 仍在"）。

**已单独验证的机制**：给 group 子条目加 `disabled: true` 后，`plugin_manager` 报告
`{"moduleName":"@deepseek-ai/dsh-mcp-client","enabled":false,"fiberPhase":null}` —— 启停机制本身完全正常（`Entry.update()` 命中 `this.disabled` 就 `fiber?.dispose()`）。所以问题只在写入路径。
另外补了两道防线：请求 20s 超时（否则宿主侧卡住会让 `busy` 永真、按钮永久发灰）、停用的行整体压暗（只靠圆点颜色区分太弱）。

> **未证实**：我无法在离线复现"状态不变"这一具体症状（拿不到宿主日志，`logs` 目录是空的），所以上面是"能证明的部分 + 最可能的成因"，不是完整因果链。

### 7.4 宿主半边不参与热重载（重要约束）

`dsh-hmr` 只监听 **DSH 安装目录 + profile 补丁文件**；本插件目录不在其中。而且 Node 的 ESM 按 URL 缓存模块——**改了 `lib/index.js`，运行中的宿主半边不会更新**（`lib/client.js` 会，它由 `dsh-client-hmr` 按 mtime/size 发新 rev）。

因此客户端做了**能力协商**：GET 返回 `capabilities`，新宿主可用「定点操作」，旧宿主自动退回整数组提交（并把 `env`/`headers` 转成旧宿主认识的文本形状）。这样无论宿主半边有没有重载，点击都能生效。

- 想让宿主半边的改动立即生效：**重启 DSH**。
- 想让它以后能热重载：把本插件目录加入 `hmr` 的 `root` 表。**本轮没做**——`root` 是整表（`x-cordis.role: table`），补丁层的 `config` 是**整份替换而非深合并**，直接写会丢掉基础 bundle 里的原值，有把客户端 HMR 一起弄坏的风险。要动的话得先从基础 bundle 的 `cordis.patch.yml` 里读出原值。

### 7.5 维护须知：本机 PowerShell 是 5.1，别用它读写本仓库的 UTF-8 文件

本机 `pwsh` 实为 **Windows PowerShell 5.1**，`Get-Content -Raw` / `Set-Content` 默认走 **ANSI 码页**。用它读写含中文的 UTF-8 源文件会：把中文变成乱码、**吃掉部分换行导致行合并**、并用 `?` 替换无法解码的字节——**不可逆**（会造成语法错误）。

- 读：用 `read` 工具，或 `node -e "fs.readFileSync(p,'utf8')"`（脚本里别混中文，会有引号转义坑）。
- 写：用 `write` / `edit` 工具（自带版本护栏）。
- 必须用 shell 时：`Get-Content -Encoding UTF8` / `Set-Content -Encoding UTF8`，但仍不如上述工具可靠。

`tools/verify.mjs` 的 **A11–A31** 断言守住了目前踩过的全部坑：硬编码前景色（深色主题下白底白字）、「按钮/长说明文字挤在同一 flex 行」、间距尺寸擅自发明、操作区换行、行内渲染 URL、字段形状不兼容、能力协商缺失、inline 尺寸压过样式表、`mono` 与 `multiline` 混用、编辑表单嵌进卡片。改代码时先跑一遍自检。

---

## 8. 尺寸与配色基准

### 8.1 当前档位：紧凑（取自官方 `.sm` / `.rowActions`）

结构照抄官方 **`ui-settings-models`**（模型页）的提供商卡片，尺寸缩到紧凑档。数值全部有出处，不是自己发明的：

| 项目 | 当前值（紧凑档） | 出处 |
|---|---|---|
| 列表容器 | `.mcpm-rows { gap:8px }` | 官方 `.rows`（一卡一服务器） |
| 服务器卡 | `.mcpm-rowCard { padding:8px 12px; gap:10px; border:.5px solid settings-card-stroke; radius-lg; settings-card-fill }` | 官方 `.rowCard`（`12px 14px` / `xl`，数值收紧） |
| 卡头（行） | `.mcpm-row { min-height:28px; gap:10px }` | 由 `.sm` 档位推算 |
| 按钮 | `height:28px; font-size:12px; padding:0 10px; min-width:44px; radius-sm; border .5px border-l3` | 官方 `.rowActions button`（`min-width` 为本插件补充） |
| **表单面板** | `.mcpm-form { padding:10px 12px; gap:8px; radius-lg; background:var(--dsw-alias-bg-module-platform) }` | 官方 `.addCard`（`14px 16px` / `14px`，数值收紧） |
| 输入框 | `height:28px; border:.5px solid border-l4; radius-md; background:bg-layer-1` | 官方 `.input`（`32px`，数值收紧） |
| 字段标签 | `12px / 500 / label-secondary`，字段 `gap:4px` | 官方 `.fieldLabel`（`gap:6px`） |
| 页面 | `padding:4px 0; gap:12px; width:100%; max-width:720px` | 官方 `.section { max-width:720px }` |
| 圆点 | `6px` | — |

`tools/verify.mjs` 的 **A15**（尺寸）、**A31**（表单面板配色）、**A16** 断言守住这些数值。反向验证：把按钮 `height` 改成 `40px`、或给表单面板加回描边，断言都能精确报出违规。

### 8.2 自适应

- `.mcpm-page { width:100%; min-width:0; max-width:720px }` —— 铺满内容列，宽面板下不无限拉伸（与官方 `.section` 一致）。
- `.mcpm-meta { flex:1 1 auto; min-width:0 }` + 名称 `text-overflow:ellipsis` —— 窄容器下**先省略文字**。
- `.mcpm-actions { flex:none }` 且不换行 —— 按钮永不换行、永不被压扁。
- 每个块级子项（`.mcpm-page / .mcpm-form / .mcpm-rowCard / .mcpm-notice / .mcpm-field / .mcpm-meta`）都显式 `min-width:0` —— flex 子项默认 `min-width:auto`，内容一宽就会撑破容器；外壳是 `overflow-y:auto`，任何 1px 横向溢出都会冒出横向滚动条。

**A26** 断言这组声明齐全。踩过的反面：`.mcpm-actions` 曾写成 `flex-wrap:wrap` 且没锁 `flex:none`，空间一紧就把「删除」折到第二行。

### 8.3 历史：为什么第一版「比官方丑」

第一版用 inline style 凭感觉写数值，差距不是审美问题，而是**尺寸体系错位 + 几个结构性错误**：

| 项目 | 官方实测 | 第一版（错） | 后果 |
|---|---|---|---|
| 页面左右/底部留白 | **由外壳提供** `padding: 0 24px 24px` | 自己又加 `padding: 4px 0 24px` | **底部留白叠加成 48px** |
| 页面内边距 | `8px 0` | `4px 0 24px` | 顶部偏紧、底部翻倍 |
| 正文行高 | `22px` | `20px` | 行距偏紧 |
| 卡片内边距 | `12px 16px` | `0`（行各自 padding） | 文字贴卡片边 |
| 卡片描边 | `.5px solid settings-card-stroke` | `1px solid border-l2` | 深色主题下发死、显脏 |
| 卡片配色 | `--dsw-alias-settings-card-fill` | `--dsw-alias-bg-layer-2` | 用了"嵌套面板"的色，对比度不对 |
| 卡片圆角 | `var(--dsw-radius-xl)` | 硬编码 `10px` | 与全局圆角体系不一致 |
| 行最小高度 | `44px`（`row` 40px） | 无 | `row` 高度随内容抖动 |
| 行内边距 | `6px 0` | `10px 12px` | 节奏不齐 |
| 按钮高度/字号 | **`36px` / `14px`** | `26px` / `12px` | 控件小一档，像密集小按钮 |
| 按钮 `min-width`/内边距 | `58px` / `0 14px` | 无 / `0 10px` | 按钮大小不一 |
| 按钮描边/圆角 | `.5px border-l3` / `radius-md` | `1px border-l2` / `6px` | 同上 |
| 标题字重 | `500` | `600` | 比 DSH 全局更重 |
| hover / focus 反馈 | 有 | **完全没有** | "廉价感"的主因 |

最后一行是**结构性错误**：第一版把视觉写进 inline style，而 inline 的 `background` 优先级高于 CSS 的 `:hover`，所以悬停反馈根本无从生效。现版本改为注入一张样式表（class 名 `mcpm-` 前缀），**视觉走 CSS、inline 只留布局**。

### 8.4 基准值出处

| 值 | 出处 |
|---|---|
| 外壳 `padding: 0 24px 24px` | `dsh-client-ui-settings-general/lib/client.js` 的 `.wCInkW_options` |
| 外壳导航 `navCell` `height:40px; font-size:14px; padding:9px 16px 9px 12px` | 同上 |
| `section` / `card` / `balanceCard` / `row` / `identity` / `divider` / `actions` / `linkButton` 全部数值 | `dsh-client-ui-settings-account/lib/client.js:2269`（压缩后的 CSS 字符串） |
| 主按钮 token `button-primary-fill` / `label-primary-foreground` | `dsh-client-ui-primitives/lib/Button.module.css` 的 `.primary` |
| **表单/卡片的整体结构**：`.section max-width:720px`、`.rows gap:8px`、`.rowCard`、`.rowActions button {28px/12px}`、`.addCard { background:bg-module-platform; 无描边 }`、`.field`、`.fieldLabel {12px/500}`、`.input { border-l4 + bg-layer-1 }`、`.input::placeholder { label-dimmed }`、`.input:focus { border-color:state-business-primary; outline:none }` | `dsh-client-ui-settings-models/lib/client.js` 的 CSS Module 字符串（`.section` / `.rowCard` / `.addCard` / `.field` / `.input` 等） |
| 合法 alias token 清单（14 个） | `cordis_inspect_query` → client `Theme.listTokens` |

> 注意 `listTokens` 只列出"需要 light/dark 双份覆写"的 alias 子集；`button-primary-fill`、`radius-*`、`settings-card-*`、`label-tertiary` 都不在表里，但官方 CSS 在用，所以真实存在。**判断某个 token 是否存在，以官方 CSS 的用法为准，不要只看 `listTokens`。**

### 8.5 展开的表单：卡片内的「面板」，靠底色分层

对齐官方 `ui-settings-models`（模型页）的提供商卡片：**一个服务器一张卡**（`.mcpm-rows { gap:8px }`），卡头就是那一行（名称 + 编辑/停用/删除）；展开时在**同一张卡内**追加表单面板。点「编辑」展开、按钮变成「收起」；「新增」在列表末尾追加一张只含表单的卡。

关键在于**表单面板不带描边**：

| 层 | 描边 | 底色 |
|---|---|---|
| 服务器卡 `.mcpm-rowCard` | `.5px solid settings-card-stroke` | `settings-card-fill` |
| 表单面板 `.mcpm-form` | **无** | `--dsw-alias-bg-module-platform` |

**靠底色分层，而不是两层描边。** 早先的版本给表单面板加了 `border`，于是和外层卡片叠成「卡片套卡片」——这才是被反馈"内部表单不好看"的真正原因。（`A30b` 守住；反向验证：加回 `border:.5px solid red` 立刻报错，且该断言用精确的描边属性正则，**不会误伤 `border-radius`**。）

字段类型由**两个正交开关**决定，不要合并：

| 开关 | 作用 |
|---|---|
| `mono` | **只**把字体换成等宽（`.mcpm-input--mono`），字段仍是单行 28px |
| `multiline` | 换成真正的 `<textarea rows=3>`（`.mcpm-textarea`） |

混用会在单行字段上套 56px 的多行框——`url` 就曾被渲染成一个大框（`A28` 守住）。

---

## 9. 实测依据索引

| 结论 | 证据位置 |
|---|---|
| `settings.section` 是 list 座位、按 order 排序 | `dsh-client-ui-settings-general/lib/client.js:1017-1030, 1136-1139, 1171-1181` |
| MCP 条目名与 Config schema | `Config.listConfigs`（entry `include:mcp-context7`） |
| mcp-client 的 Config 无 volatile | `dsh-mcp-client/lib/index.js:780`（`z.union`），全包无 `volatile` |
| `remote.settings` 只认 volatile 字段 | `dsh-settings/lib/index.js:413-419, 501-507` |
| `configEditor.edit` 的 YAML 节点编辑与失败回滚 | `dsh-config-editor/lib/index.js:69-135`（断言在 `:122`，写盘在 `:123`） |
| `$mount` 是公开扩展点、descriptor 校验 | `dsh-api-gateway/lib/types/client/index.js:80-135, 587-602` |
| 客户端能力集构建期固定 | `dsh-api-remotes/README.md`（Known Limitations） |
| `connection.fetch.register` 精确路由 + 自动鉴权 | `dsh-client-connection/lib/index.js:608-638, 755-762, 829-843` |
| `applyEntryPatches` 的行语义 | `cordis-plugin-include/lib/index.js:56-105` |
| `cordis:group` 是内置插件、config 是 entryList | `dsh-app-boot/lib/index.js:2814, 3703` |
| `Include.write()` 整体重写 root.data | `dsh-app-boot/lib/index.js:245-248` |
| group 子条目随 `internal/update` 重建 | `cordis-plugin-loader/lib/index.js:108-115` |
| 双半插件的接线范式（路径行） | 同级 `../codex-effort-picker/README.md` |
