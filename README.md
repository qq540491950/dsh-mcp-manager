# dsh-mcp-manager

在 DSH（Web / 桌面端）的**设置面板最下方**加一页 **MCP**：可视化增删改、启停 MCP 服务器，并看到它们的加载状态、失败原因与**当前注册的工具名单（个数 + 名称，过多自动折叠）**。

- **是什么**：一个「客户端半边 + 宿主半边」的 DSH 插件，运行时**零依赖**（§0）。
- **怎么装**：见 §5（现在用 profile 路径行接线；发布成 bundle 后是一条命令安装）。**怎么发布**见 §5.3。
- **改了代码怎么生效**：见 §6.2（客户端半边热替换、宿主半边要重启、profile 补丁秒级生效）。
- **写代码前先读**：[AGENTS.md](AGENTS.md)（硬性纪律 / 边界 / 风格）。本文只留结论；"为什么这么设计、当时实测到什么、还有哪些没实测"在 [docs/design-notes.md](docs/design-notes.md)——**两边章节号一一对应**，默认不必读。每条结论的官方源码出处见 §9。

---

## 0. 一句话结论

| 半边 | 产物 | 职责 |
|---|---|---|
| 客户端 | `lib/client.js` | 往 `settings.section`（list 座位）注册一页，`order: 900` → 落在设置导航最下方；纯 `window.__ModuleLoader__` 懒 CJS bundle |
| 宿主 | `lib/index.js` | `ctx.connection.fetch.register()` 开一条**自带鉴权的同源 HTTP 路由**（`/api/mcp-manager`）；`ctx.configEditor.edit()` 做**外科手术式的配置写入** |

**数据模型的关键取舍**：所有 MCP 服务器放进**一个** `cordis:group` 条目的 config 数组。于是「增 / 删 / 改 / 启停」四件事全部退化为「重写这一个数组」，全部走官方的配置写入通道（§4）。

页面提供：服务器列表 + 状态四色 + 失败原因行 + 工具名单 + 行内启停/删除 + 表单增改 + 「检测」（向服务器发一次真实的 MCP `initialize`）。

---

## 1. 界面接入点：「设置界面下方」接哪个座位

实测座位树（`cordis_inspect_query` → client `Slots.listSubTree`）：

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

注册代码（本仓库 `lib/client.js`，与官方写法同形）：

```js
ctx.inject(["slots"], (scope) => {
  scope.slots.inject("settings.section", () =>
    scope.slots.register({ name: "settings.section", id: "mcp", order: 900, label: () => "MCP" }, McpSection),
  );
});
```

- `settings.section` 是 **list 座位**：所有注册者都渲染，按 `order` 升序排成设置左侧导航的一页。官方 General 是 `order: 0` → **要"下方"就把 order 开大**（本插件用 `900`）。
- 不是 `single` 座位，**不存在遮蔽官方控件的风险**，回滚也就一条行（§5.2）。`label` 可传 `string` 或 `() => string`。
- **导航那一格的图标不是注册项**：契约只有 `id`/`order`/`label`，**没有 `icon`**；图标由官方 `navIcon(id)` 硬编码查表、未知 `id` 兜底成齿轮。本插件用「渲染后给自己那一格打标记 + 两行 CSS」换成 MCP 官方标记——做法与代价见 §8.6。

---

## 2. 数据面事实：MCP 服务器就是 Loader 条目

### 2.1 一个 MCP 服务器 = 一个 `@deepseek-ai/dsh-mcp-client` 条目

`Config.listConfigs` 投影：`{ id: "include:mcp-context7", patchId: "mcp-context7", name: "@deepseek-ai/dsh-mcp-client", status: "schema" }`。profile 里长这样：

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

### 2.2 `dsh-mcp-client` 的 Config schema

`anyOf` 两支，都必须有 `serverName`（`^[A-Za-z0-9_-]{1,32}$`）：

| 分支 | 必填 | 可选 |
|---|---|---|
| `transport: stdio` | `serverName`, `command` | `args[]`, `env{}`, `cwd`, `toolCallTimeoutMs`(60s), `failOnStartupError`, `maxInstructionBytes`(32KB), `reconnect{enabled,initialDelayMs,maxDelayMs,maxAttempts}` |
| `transport: streamable-http` | `serverName`, `url` | `headers{}`, 以及同上一组 |

配置也可以是 `null`（该分支存在，表示「本条目没有服务器」）。

### 2.3 条目的行语义（很多坑的根源）

权威是 `@deepseek-ai/cordis-plugin-include` 的 `applyEntryPatches`：

| 写法 | 语义 |
|---|---|
| `- insert: [ ... ]`（无 `id`） | 把这些行**追加**到顶层条目列表 |
| `- id: X` + `insert: [...]` | 把 `insert` 的行追加进**已存在的 group 条目 X** 的 `config` 里（X 不是 group 就 warn 跳过） |
| `- id: X`（无 `insert`） | **覆写**已存在条目 X 的键；**整键赋值**，所以 `config` 是**整数组替换**、不是逐字段合并；**X 不存在就 warn「entry not found」并丢弃** |
| `- id: X, name: Y, config: {...}` | 同上（覆写）；`name` 与目标不符会被拒 |

关键细节：**`insert` 进去的行会被 `buildMap(insert)` 注册进 `entryMap`**，所以同一文件里排在 insert 后面的顶层 `- id: X` 覆写行能命中它——这正是 §4「单条目 + 覆写」方案的合法性依据。

> **`config` 是整数组替换，不是"继承层"。** 覆写补丁逐键赋值、`target.config` 一把换掉，所以 `insert:` 行里同 id 的那份声明是**被丢弃**，而不是"没写到的字段继续继承"。
> 线上踩到的样子：`insert:` 行一直写着 context7 的 `Authorization: Bearer ctx7sk-…`，而首次保存生成的覆写行只有 `serverName/transport/url`——运行时**根本没有这个请求头**，文件里却看着"key 已经配好了"。B70 守住插件侧的读法：**覆写非空时只认覆写，绝不合并两层**。
> → 也解释了"想**新增**条目必须用 `insert:`"：直接写顶层 `- id:` 因为目标不存在会被丢弃。

---

## 3. 通道选型：四条候选，三条被堵死

| 路线 | 结论 | 一句话理由 |
|---|---|---|
| **A** `ctx.remote.settings` | ❌ 不可用 | `describe()`/`write()` 只暴露声明了 `.volatile()` 的字段，而 `dsh-mcp-client` 的 Config **无 volatile** → MCP 条目完全不可见、不可写 |
| **B** `ctx.configEditor`（宿主服务） | ⚠️ 用 | 外科手术式 YAML 编辑 + 写盘前断言 + 失败回滚；但**只能改已存在的条目**，不能新增/删除条目 |
| **C** 自建 Remote 命名空间（`ctx.typert.register()` + `remote.$mount()`） | ❌ 没选 | 是官方机制，但要手写严格 codec（客户端 bundle 里没有 zod 种子模块），且能力集**构建期固定**；收益远低于代价 |
| **D** `ctx.connection.fetch.register()` | ✅ 本插件采用 | 精确路径路由 + **自带鉴权**（handler 挂在 webServer `/api` 前缀下，先过 Host/Origin 围栏与浏览器鉴权）+ disposer 自动绑调用方 scope；宿主半边**零 import** |

→ 正因为 B 不能增删条目，才有 §4 的「单条目 + 数组重写」设计。完整论证与源码行号见 [docs/design-notes.md](docs/design-notes.md) §3。

---

## 4. 本仓库的架构

### 4.1 单一可编辑条目：`cordis:group`

`cordis:group` 是 Cordis 内置插件，它的 config 就是一份 `entryList`。把 MCP 服务器全放进它的 config 数组：

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

| 操作 | 实现 |
|---|---|
| 列出 | 读 group 条目的 config 数组 + 扫活着的 MCP 子条目拿状态与工具 |
| 新增 / 删除 / 修改 | 数组加一项 / 去一项 / 改一项（整数组重写，只给表单用） |
| 启停 | 该项的 `disabled: true/false`——**行内操作走宿主定点改，不回传整数组**（AGENTS 2.5） |

**为什么不用 `ctx.loader.create()/remove()` 动态加条目**：Loader 的持久化实现 `Include.write()` 是 `this.writeFile(this.root.data)`，而 `_writeFile` 是 `yaml.dump(整份 config)`——**整体重写**，会压平用户手写的 `insert:` 分节，是不可接受的破坏性写入（AGENTS 2.3）。

### 4.2 写入路径的合法性闭环

`configEditor.edit(groupEntry, () => nextArray)` 对 insert 声明的条目走 `index < 0` 分支 → `document.add({ id, name, config })`，即在**文件末尾追加一条顶层覆写行**。它有效是因为 `applyEntryPatches` 先处理 `insert:`（并 `buildMap`）、**后**处理覆写行，此时 `mcp-manager` 已在 `entryMap` 里 → `target.config = nextArray`。

写完还过一道断言：`composeEntries(...)` 里该条目的 config 必须深等于 `nextArray`，否则抛错。**这道断言在写盘之前**，所以假设不成立时也是**安全失败**：报错、不落盘、不损坏配置。最后由 `reconcileProfilePatches()` 让 Loader 热重载。

### 4.3 文件清单

```
AGENTS.md                agent 工作约束（硬性纪律 / 边界 / 风格 / 流程 / Git 与发布）
README.md                本文件：是什么、怎么装、怎么改、约束速查
docs/design-notes.md     设计抉择、取证、尺寸基准、实测状态（默认不必读）
docs/agent-rules-notes.md  AGENTS.md 的附注：取证、断言台账、官方证据索引
docs/publish-plan.md     发布为 bundle（P6–P8）的执行手册 + 四种 spec 形式（§9）
docs/github-release-plan.md  只用 GitHub 发布：G0–G5 完整 runbook（顺序 / 命令 / 验收 / 回滚）
package.json             exports{"./client"} + dsh.client.platform + name（= 客户端 bundle 的模块 id）
src/client/**            客户端半边源码（TSX）  → 产物 lib/client.js
src/host/**              宿主半边源码（TS）      → 产物 lib/index.js
src/shared/**            两半边共享的协议值（ROUTE / GROUP_ID / MCP_PACKAGE / SECTION_ID / SECTION_LABEL）
lib/**                   构建产物（带 lib/.build-manifest.json 指纹），不要手改
assets/mcp-mark.svg      设置导航那一格用的 MCP 标记（16x16，几何取自官方 favicon）
assets/nav-preview.png   改后导航那一格的模拟对照图（自绘，非截图；§8.6 引用）
tools/verify.ts          自检：纯 Node 零依赖（.ts 入口直接跑，无需构建）
tools/build.ts           esbuild 打包两半边 + 客户端包装 + 写构建指纹
.github/workflows/ci.yml  CI：typecheck / lint / format / build / verify + lib 漂移检查
```

运行时**零依赖**：宿主半边不 import 任何东西；浏览器半边只 `require("react")`（平台种子表内）——视觉全靠自带样式表 + 主题 token，不用官方组件库。

---

## 5. 安装、接线与发布

### 5.1 现在能"一键安装"吗——还不能，但可以接线

| 安装方式 | 现在 | 说明 |
|---|---|---|
| **`plugin_manager install_bundle`（一键）** | ❌ **不能** | 本包尚未声明 `dsh.bundle`。安装器在任何东西落地**之前**就拒绝，理由是 `not-a-bundle` / "*declares no dsh.bundle*"；判定就是 `package.json` 的 `dsh.bundle.patch` 有没有值（本机安装版 `dsh-plugin-manager/lib/index.js:1587`） |
| **profile 里的路径行（本仓库当前用法）** | ✅ **能，且零依赖** | 只需 `cordis.patch.yml` 两步（§5.2）；不需要 `pnpm`、`node_modules`，也不需要先发布 |

### 5.2 手动接线（两步，都在 profile 的 `cordis.patch.yml`）

**第一步**：把现有的 MCP 条目收进一个 group（`insert:` 在补丁层里是**必填**的，直接写顶层 `- id:` 会被丢弃）：

```yaml
# 原来的 - insert: [{ id: mcp-context7, name: '@deepseek-ai/dsh-mcp-client', config: {...} }]
# 换成：
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

**第二步**：追加本插件的路径行（与同级 `codex-effort-picker` 完全同一套接线，不需要 pnpm / node_modules）：

```yaml
- insert:
    - id: dsh-mcp-manager
      name: 'file:///D:/project/dsh-plugins/dsh-mcp-manager/lib/index.js'
```

**回滚**：删掉第二条 insert 行即可，设置面板里那一页立刻消失（`settings.section` 是 list 座位，不遮蔽任何官方 UI）。

> `dsh plugin --profile <name> …` 是 **pnpm 的透传**；"把包装成 bundle / 选上 bundle"是 `plugin_manager` 的活，不是 CLI 的活。

### 5.3 发布：怎么把它变成别人能一键装的插件

**DSH 没有中央插件市场**：安装入口是 `plugin_manager install_bundle`，底层用 pnpm 把你给的那个 spec 装进 profile——而 spec 有四种形式（见本节末）。所以**发布 = 让别人能装上一个声明了 `dsh.bundle.patch` 的包**，这个包**不一定要在 npm 上**（GitHub / tarball / 本地路径都行）。装一次即完成两件事：把包装进 profile 的 `node_modules`，并把包名写进 profile `package.json` 的 `dsh.profile.bundles`——它的 patch 层随后自动进 Loader，用户**不需要再手写 `cordis.patch.yml`**。

四步（详细清单、要同步改的自检断言、验证阶梯见 [docs/publish-plan.md](docs/publish-plan.md)）：

1. **P6 改造成 bundle**
   - 新增 `cordis.patch.yml`：自带 group 条目（`id: mcp-manager`，`cordis:group`，`config: []`）+ 插件行（`id: dsh-mcp-manager`，`name:` 必须是**发布后的包名**）。
   - 新增 `locale/{en,zh}.json`（`meta.title` / `meta.description`）、图标（放 `assets/` 下，P6 才创建；≤256 KiB、包内相对路径）、`LICENSE`。
   - `package.json`：删 `private`；包名改 **`@qq540491950/dsh-mcp-manager`**（裸名 `dsh-mcp-manager` 被他人占用）；补 `dsh.bundle.patch`、`exports["."]`、`files` 白名单（**不含 `src/`、`tools/`、`docs/`、`AGENTS.md`**）、`publishConfig.access = public`。
   - `peerDependencies` 只留 `@deepseek-ai/cordis`。**不要钉任何 `@deepseek-ai/dsh-*`**：bundle 兼容性只看这些 `dsh-*` peer，不满足就**整个 bundle 被 skip**。
2. **本地验证**（不用先发布）：`pnpm check` 全绿 → `npm pack` 审内容（有产物 / patch / locale / 图标 / README / LICENSE，无 `src`+`tools`+`docs`，无密钥）→ `plugin_manager(action:'install_bundle', target:'<本地绝对路径>')`（读返回值的 `application: applied`，`warnings` 里不该有 bundle skipped）→ 运行时四查（宿主 `fiberPhase: active`、客户端座位 `{id:"mcp",order:900,active:true}`、**新增一台服务器真的落盘且工具注册**、启停删检测全流程回归）→ `remove_bundle` 卸载回归。
3. **发布**：`npm publish --access public` → 用包名再装一次（`target='@qq540491950/dsh-mcp-manager'`），确认与本地路径行为一致 → `git push` + GitHub Release + 在本文补一张兼容矩阵（DSH 版本 × 插件版本）。
4. **发布前必须停下让用户确认**：`npm publish` 与 `git push` 都不代跑。

**npm 不是必须的**——`install_bundle` 的 `target` 认四种 spec（本机安装版 `parseInstallSpec`）：**注册表包名**、**绝对本地路径**、**git 地址**（`github:user/repo`、`git+https://…git`、`https://github.com/user/repo#ref`，也可 `gitlab:` / `bitbucket:` / `gist:`）、**tarball**（本地 `.tgz` / `.tar.gz`，或 `https://…/x.tgz`）。所以"只发在 GitHub"完全可行：

```text
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.0')
```

四条路线的取舍、前提与代价见 [docs/publish-plan.md](docs/publish-plan.md) §9；**从改造到 tag、Release、用户安装、升级回滚的完整步骤见 [docs/github-release-plan.md](docs/github-release-plan.md)**。GitHub 路线最要紧的三条：①仓库里 `package.json` 必须有 `dsh.bundle.patch`，且 **patch 文件与 `lib/**` 都要提交进仓库**（pnpm 拉的是仓库内容，不会替你构建）；②git/tarball 是**抓取之后才判定**是不是 bundle，不是 bundle 会先装上再回滚（本地路径与 registry 是**装前**就拒）；③GitHub 的 spec 会先跑一次 `git ls-remote` 预检（5s，`git` 要在 PATH 上）。

⚠️ **装 bundle 之前先摘掉 profile 里旧的路径行与手写 group 行**：否则会出现同 id 的重复行（两份 `dsh-mcp-manager`、两份 `mcp-manager`），最坏是两个 fiber 各自注册一次 `/api/mcp-manager`。保留 `- id: mcp-manager` 的**覆写行**（服务器列表就在里面）。升级插件后**宿主半边仍需重启 DSH**（§6.2）。

---

## 6. 自检与更新

### 6.1 自检

```powershell
pnpm verify                 # = node tools/verify.ts
# → PASS n/n（条数以实际输出为准；本文不写死条数）
```

零依赖：不需要 `node_modules`，也不需要先 build（`.ts` 由 Node ≥22.18 的类型擦除直接执行）。覆盖范围就是 [tools/verify.ts](tools/verify.ts) 里的 `//#region`：A 包清单/主题/尺寸/自适应/表单结构与导航标记几何、B 宿主行为 + 行内操作回归 + 失败原因采集 + 相位映射 + 主动探测 + 配置分层 + 工具名单、C 产物协议与座位契约 + 导航标记 DOM（假 DOM 真跑）、D 真实渲染逐状态、D2 挂载行为（真跑 `useEffect` 的沙箱 + fetch 桩）、E 共享常量 ↔ 出厂产物（含构建指纹 E9/E10 与文档引用一致性 E11/E12）、F 纯函数直接单测。**断言台账只有这一处**（AGENTS 4.2）；每修一个 bug 同时加断言，新断言必须反向验证。

工具脚本自身另有类型检查：`pnpm typecheck:tools` 是门禁（0 错误），`typecheck:tools:wip` 是进度计（续做方法见 [docs/tools-ts.md](docs/tools-ts.md)）。

### 6.2 改了代码之后，DSH 怎么感知到（三层，机制各不相同）

**改的东西不同，生效路径完全不同**——搞错就会以为"改了没用"：

| 你改了什么 | 谁在监听 | 怎么生效 | 要重启吗 |
|---|---|---|---|
| **profile 的 `cordis.patch.yml`**（增删一台 MCP 服务器） | `dsh-hmr`：注册 profile manifest + profile/home 两个用户补丁监听 | HMR 重新组合 → 条目更新 → 插件被重新 `apply` | **不用**，秒级 |
| **`lib/client.js`（客户端半边）** | `dsh-client-hmr`：Host 监听每个包的**入口产物**，通过 `/plugins/events` 推帧 | revision 变化（**mtime + ctime + size**，不哈希内容）→ 浏览器把该条目**热替换** | **不用** |
| **`lib/index.js`（宿主半边）** | **没人监听**：`hmr.root` 默认是 `[]`，本插件目录不在其中 | 不生效；且 Node 的 ESM 按 URL 缓存模块 | **要** |

开发循环：①改 `src/**`（不是 `lib/**`）→ ②`pnpm build`（= `node tools/build.ts`）→ ③客户端半边刷新页面即生效、宿主半边重启 DSH → ④交付前 `pnpm check` 让门禁全绿（类型 + 风格 + 产物契约 + 自检）。

**"忘了重建"不会悄悄过去**：`lib/.build-manifest.json` 记着每个产物的 sha256 与它**全部输入**的 sha256，E9/E10 会比对这两者，直接报出是哪个产物、哪些输入不一致（这是设计，不是误报）。

**怎么确认真的生效了**：

- 宿主半边：`plugin_manager(action: 'list_plugins')` → 找 `include:dsh-mcp-manager` → `enabled: true` + `fiberPhase: "active"`。
- 客户端半边：`cordis_inspect_query(platform: 'client', provider: 'Slots', method: 'listSubTree', input: { root: 'settings.section' })` → occupants 里出现 `{ id: 'mcp', order: 900, active: true }`。
- **客户端热替换失败不会回滚**：旧 fiber 拆掉后若导入/激活失败，页面只显示一条页面级同步错误，不会恢复上一版。

**想让宿主半边也热重载**：把本插件目录加进 `hmr` 的 `root` 表。**当前刻意没做**——`root` 是整表、补丁层 `config` 是整份替换而非深合并，直接写会丢掉基础 bundle 里的原值（AGENTS 1.2）。

---

## 7. 实测状态

### 7.1 已在真实运行时验证通过（本机 desktop profile / DSH `0.2.0-rc.2`）

| 验证项 | 证据 |
|---|---|
| 补丁热重载生效、**未重启应用** | 运行时条目总数 192 → **195** |
| group 条目挂载 | `include:mcp-manager` → `cordis:group`，`fiberPhase: active` |
| context7 迁移成功 | `include:ef60a0d1` → `@deepseek-ai/dsh-mcp-client`，`active`，`readOnlyReason: "unaddressable"` |
| **宿主半边生效** | `include:dsh-mcp-manager` → `fiberPhase: active`（`apply()` 内同步注册路由，抛错会挂掉 fiber） |
| **客户端半边生效** | `settings.section` 台账 occupants 含 `{id:"mcp", order:900, active:true}`，且是 order 最大的一项 |
| 路由受鉴权保护 | `GET/POST /api/mcp-manager` → **401**；伪造 `Host` → **403** |
| 自检 / 文件编码 | `PASS`；无 BOM、无 U+FFFD、LF 行尾 |

导航台账（order 升序）：`account -10 | general 0 | models 10 | plugins 15 | agent-presets 20 | mcp 900 ← 本插件`。
`readOnlyReason: "unaddressable"` 尤其值得记下：它**正面印证了「group 子条目不可单独寻址」**——这正是 §4「单一数组」设计的由来。

### 7.2 仍未实测 / 已知取舍

1. **点击进入页面的那一次 fetch 往返**：路由已注册、围栏已验证，但「打开 设置 → MCP 看到列表」需要在浏览器里点一次。客户端已内置失败态（「读取失败：<原因>」+ 重试），不会白屏。
2. **`configEditor.edit()` 对 insert 条目的 `document.add` 分支**尚未产生过一次真实写入（首次在 UI 点「保存」时才走）；失败是安全的（写入前断言、不落盘）。
3. **group 子条目当前没有显式 `id`**（Loader 自动生成 `ef60a0d1` 这类十六进制 id）；`serverName` 重命名按数组下标定位，会保留原 `rowId`，改的是 `insert:` 声明而非覆写行时可能新建条目。
4. **导航那一格的 MCP 标记没在真实界面里点过**：离线侧已证明几何（A32–A38）与假 DOM 三条路径（C12–C17），缺"真机打开设置面板，齿轮确实变成 MCP 标记"这一环。
5. **「停用 → 再启用之后自动复查」没在真机浏览器里点过**：离线 D38–D41 已断言请求序列与两条边界；真机还需确认 ①宿主 `probe` 能力存在（**要重启 DSH**）②点完「启用」后约 1s 内那一行变色。

### 7.3 行内操作曾经静默丢字段（已修）

症状：点「停用」按钮变灰但状态不变，且 profile 里 context7 的 `headers` 消失了。根因是行内操作把**整个数组**回传、宿主再用 `normalizeRow()` 逐行重建，而它当时只认「多行 KEY=VALUE 文本/字符串数组」，快照里 `headers` 却是**对象** → 字段被静默清空。

修复：①`toRecord()` 同时接受对象、字符串数组、多行文本三种形状（AGENTS 2.6）；②启停/删除改为**宿主侧定点操作**（AGENTS 2.5，B27–B42 是回归测试）；③请求加 20s 超时（否则宿主卡住会让按钮永久发灰）。**未证实**：拿不到宿主日志，无法离线复现"状态不变"这一症状，所以成因链是"能证明的部分 + 最可能的成因"。

### 7.4 宿主半边不参与热重载（重要的运行约束）

`dsh-hmr` 只监听 **DSH 安装目录 + profile 补丁文件**，本插件目录不在其中；Node 的 ESM 按 URL 缓存模块——**改了 `lib/index.js`，运行中的宿主半边不会更新**（`lib/client.js` 会）。因此客户端做了**能力协商**：GET 返回 `capabilities`，新宿主用定点操作、旧宿主自动退回整数组提交（并把 `env`/`headers` 转成旧宿主认识的文本形状），这样无论宿主有没有重载，点击都能生效。想让宿主侧改动立即生效：**重启 DSH**（AGENTS 1.3：不要自己重启，告知用户）。

### 7.5 维护须知：本机 `pwsh` 是 5.1，别用它读写本仓库的 UTF-8 文件

`Get-Content -Raw` / `Set-Content` 默认走 **ANSI 码页**，读写含中文的 UTF-8 源文件会把中文变乱码、吃掉换行、坏字节变 `?`——**不可逆**。读用 `read` 或 `node -e "fs.readFileSync(p,'utf8')"`，写用 `write` / `edit`（自带版本护栏）。详见 AGENTS 1.1。

### 7.6 失败原因：为什么必须我们自己收

`failOnStartupError` 默认 `false`，所以 mcp-client 的 `apply()` **连接失败也不抛**、fiber 一直是 `ACTIVE`。于是失败时：官方「设置 → 插件」**根本没有这一行**（它只报 `fiberPhase`，且行来自 bundle 清单，patch `insert` 的 group 子条目不属于任何 bundle）；官方插件页即便真 FAILED 也只渲染一个词；宿主日志基本不可看（桌面版 stdout 进了一个没有控制台的父进程，只在崩溃时落 `crash-*.log`）；cordis 内置日志缓冲**收不到 warn**（内置 exporter 没声明 `levels` → 阈值取默认 1，而 WARN = 2，被丢弃——"为什么连不上"恰好是 warn 级）；本插件旧版页面就**报「运行中」**。

**唯一写着原因的地方**是 mcp-client 的 `ctx.logger`（warn `mcp-client(<name>): connection attempt failed: <error>`、error `giving up after N consecutive failed reconnect attempts — tools unregistered…` 等）。所以宿主半边自己挂 `ctx.logger.exporter()`：**显式声明阈值**（否则和内置缓冲一样丢 warn）、只认**行首** `mcp-client(<serverName>): `（内嵌同名的无关日志不入账）、每台记 `{ message(≤500 字符), level, at, count }`、**任一次配置写入**即清空（写配置会让 Loader 重建子条目，旧记录必然过期），快照加 `servers[].error`（旧宿主没有这个字段 → 退化成只看相位，天然向后兼容）。

**边界**：`error` 只是"有失败记录"，**不代表当前一定连不上**；反过来"没有记录"也不等于健康。它记的是**最近一次失败**，所以原因行带时间戳；「刷新」只重读同一份记录，不主动探测。

### 7.7 两条错误通道：同一句提示只渲染一次（用户反馈修）

症状：新增服务器时填错内容，同一条 `服务器 "server-1" 使用 streamable-http，但 url 为空` 在页面上出现**两遍**（卡片上方一遍、表单底部一遍），而且页面级那条渲染在**别人卡片的上方**，归属也是错的——根因是只有一个 `saveError` 状态、却有两个渲染点。

修复：拆成两条**互斥**通道，各自只有一个渲染点（AGENTS 3.9）：`formError` 只由表单提交（`op:"save"`）失败写入、渲染在那张表单内部；`actionError` 只由行内操作（`setEnabled`/`remove`/`probe`）失败写入、渲染在页面级。`call(payload, after, onError)` 的第三个参数就是"写进哪条通道"；每次请求开始前两条都清空，读到权威快照后清 `actionError`，收起表单清 `formError`。

### 7.8 状态语义：四色 + 主动检测（实测 bug 修）

症状：配了一台 `gva`（`http://192.168.1.101:8889/mcp`），实际没有任何响应，页面却是**绿灯「运行中」**。根因：`fiberPhase: active` 只证明"apply 跑完了"，**不证明连上了**（§7.6 同一根因的另一面：**相位不是可用性**）。修复：①补全六相位映射（`PENDING/LOADING/ACTIVE/FAILED/DISPOSED/UNLOADING`，`LOADING` 就是真正的「启动中」）；②新增能力 `probe` 与「检测」按钮——宿主直接向服务器发一次 MCP `initialize`，用**自己的 8s 预算**判定"现在这一刻答不答"。

**四色语义**（客户端 `statusOf` 的判定顺序就是优先级）：

| 颜色 | 文案 | 判定 |
|---|---|---|
| 灰 `state-idle-primary` | 已停用 / 未启动 | `disabled`；或没有活条目（`absent`/`unloading`/`disposed`） |
| 琥珀 `state-warn-primary` | 启动中 | phase `pending` / `loading` |
| 琥珀 | 未检测 | 宿主**能**探测，但这条服务器**没有任何探测记录**（刚写入配置 / 刚打开页面）→ 不许靠相位报绿 |
| 绿 `state-success-primary` | 运行中 | **检测通过 且** phase `active`；或有记录但探不了（stdio 的 `connected: null`）；或旧宿主 |
| 红 `state-error-primary` | 连接失败 / 连接异常 / 加载失败 | 探测失败（TCP 拒绝 / HTTP 401 / 超时 / 响应不是 MCP）；或 logger 里 `mcp-client(...)` 的失败原文；或 phase `failed` |

- **检测优先于日志**：日志只能证明"过去失败过"（放弃重连后就不再打日志），检测是唯一能在"现在"给结论的机制。
- 探测细节：只打**启用中**的服务器；带上配置里的 `headers`（否则带 token 的网关一律 401）；只读响应的**第一个数据块**（SSE 会一直挂着）；网络错误取 `error.cause.message`；HTTP 2xx 但没有 JSON-RPC 信封 → 判失败；stdio 无法用 HTTP 探测 → `connected: null`，**不谎报**失败。
- **预算是"冷连接"的预算**：探测走宿主全局 `fetch`（连接池），与 mcp-client 那条长连不是同一条连接，空闲过期后基本都是一次全新的 DNS + TLS 握手；实测远程冷路径 1.6–3.0s，3s 预算会把**配置正确**的服务器报成假红 → 取 **8s**（A24f 守住下限）。探测并行，总时长 ≈ max 而不是累加。
- **打开页面自动检测一次**（先 GET 拿 `capabilities`，旧宿主不认识 `probe` 就跳过；silent 模式不锁按钮）；**每次写入都补一次检测**（启停/删除/保存都算，因为写入清空了全部记录）：静默探一次，探通了但相位未 `active` 就重读快照到稳定（**有界 10 × 200ms，不是轮询**）。旧宿主没有 `probe` 时「检测」置灰并提示"需要重启 DSH"，而不是让用户点出「未知操作」。
- 已知取舍：**只在打开页面与每次写入后探一次，不轮询**——页面开着但什么都不做时状态不会自己变（要"现在"的结论就点「检测」）。每次探测都是一次真实的 `initialize` 请求（对服务端是无副作用的读操作，但确实"敲了一次门"）。

### 7.9 工具名单（每台服务器"有几个工具、分别叫什么"）

每张服务器卡下面有「工具 N 个」+ 工具名（等宽 chip）；超过 6 个默认只显示前 6 个 +「+N 个」，旁边给「显示全部 / 收起」，折叠状态**每一行独立**。

**数据来自工具注册表，不是再发一次 `tools/list`**：mcp-client 连接成功后把每个工具注册成 `mcp__<serverName>__<rawName>`，所以宿主只要读 `ctx.tools.schemas()` 按前缀 `mcp__<serverName>__` 归属，就能拿到"模型此刻真正能调用的集合"——零网络开销，连不上的服务器自然 0 个。**归属只认前缀**（`publicToolName()` 只在名字超长/含非法字符时改写尾部），所以展示的是**公开名**，不能声称那是服务端原始名。宿主排序后返回、`count` 报真实总数、快照上限 200（超了置 `truncated` 并在 UI 提示）；宿主没有 `tools` 服务时**不写这个键**，客户端就不渲染这块（旧宿主天然兼容）。

---

## 8. 尺寸与配色基准

> 数值全部有出处、不是自己发明的。**改尺寸先读这节、改完同步这节**（AGENTS 3.7）；逐项对照与历史见 [docs/design-notes.md](docs/design-notes.md) §8。

### 8.1 当前档位：紧凑（取自官方 `.sm` / `.rowActions`）

结构照抄官方 **`ui-settings-models`**（模型页）的提供商卡片，尺寸缩到紧凑档：

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

`tools/verify.ts` 的 **A15**（尺寸）、**A31**（表单面板配色）、**A16** 守住这些数值（反向验证：把按钮 `height` 改成 `40px`、或给表单面板加回描边，都能精确报出违规）。

### 8.2 自适应

`.mcpm-page { width:100%; min-width:0; max-width:720px }`（铺满内容列、宽面板下不无限拉伸）；`.mcpm-meta { flex:1 1 auto; min-width:0 }` + 名称 `text-overflow:ellipsis`（窄容器下**先省略文字**）；`.mcpm-actions { flex:none }` 且不换行；**每个块级子项都显式 `min-width:0`**——flex 子项默认 `min-width:auto`，1px 横向溢出就会在外壳的 `overflow-y:auto` 里冒出横向滚动条。**A26** 守住这组声明（踩过的反面：`.mcpm-actions` 曾写成 `flex-wrap:wrap`，空间一紧就把「删除」折到第二行）。

### 8.3 历史：为什么第一版「比官方丑」

不是审美问题，是**尺寸体系错位 + 一个结构性错误**：外壳已有 `padding: 0 24px 24px`，自己又垫 24px → **底部留白 48px**；卡片用了错的 token（`border-l2` / `bg-layer-2` / 硬编码圆角 `10px`）；最大的问题是**视觉写在 inline style**——inline `background` 压过 CSS `:hover`，悬停反馈根本无从生效。现版本改为注入一张样式表（class 名 `mcpm-` 前缀），**视觉走 CSS、inline 只留布局**（AGENTS 3.2 / 3.6）。14 项逐项对照见 [docs/design-notes.md](docs/design-notes.md) §8.3。

### 8.4 颜色与 token 的两条硬约束

每个数值的**官方出处**（外壳 padding、`section`/`card`/`row`/`navCell` 的具体文件与行号、MCP 标记几何的来源）在 [docs/design-notes.md](docs/design-notes.md) §8.4 的完整表里；§8.1 的"出处"列是它的压缩版。另外两条硬约束：

- **绝不硬编码颜色**：深色下 `--dsw-alias-brand-primary` = `#f9fafb`（近白），`color:#fff` 就是白底白字；十六进制只能作 `var()` fallback；主按钮用 `--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-foreground`（AGENTS 3.1）。
- `Theme.listTokens` 只列 **14 个**需 light/dark 双份覆写的 alias；`button-primary-fill`、`radius-*`、`settings-card-*`、`label-tertiary` 不在表里但**真实存在**——**判断 token 是否存在以官方 CSS 的用法为准，不要只看 `listTokens`**。

### 8.5 展开的表单：卡片内的「面板」，靠底色分层

对齐官方模型页：**一个服务器一张卡**，卡头就是那一行（名称 + 编辑/停用/删除）；展开时在**同一张卡内**追加表单面板（点「编辑」展开、按钮变「收起」；「新增」在列表末尾追加一张只含表单的卡）。

| 层 | 描边 | 底色 |
|---|---|---|
| 服务器卡 `.mcpm-rowCard` | `.5px solid settings-card-stroke` | `settings-card-fill` |
| 表单面板 `.mcpm-form` | **无** | `--dsw-alias-bg-module-platform` |

**靠底色分层，不叠两层描边**：早先给面板加过 `border`，和外层卡片叠成「卡片套卡片」——这才是"内部表单不好看"的真正原因（`A30b` 守住）。字段类型由**两个正交开关**决定，不要合并：`mono` **只**把字体换成等宽（仍是单行 28px），`multiline` 换成真正的 `<textarea rows=3>`；混用会在单行字段上套 56px 多行框（`url` 就曾被渲染成一个大框，`A28` 守住）。

### 8.6 设置导航那一格的图标：为什么默认是齿轮，怎么换成 MCP 标记

**为什么默认是齿轮**：DSH 的设置导航**不接受插件提供图标**——注册选项只有 `id`/`order`/`label`（没有 icon）；图标由硬编码的 id 查表决定（未知 id 兜底齿轮）；渲染处只看 id：`children: [navIcon(row.id), span(row.label)]`；`sidebar.settings` 下也没有「导航装饰」座位。顺带否决一条歪路：**不能靠换 id 蹭官方图标**——那会顶掉官方那一页。

**本插件的做法**（只碰一个属性 + 两行 CSS，不动 React 的节点树）：①`markNavCell()` 在 `ctx.effect` 里挂 body 级 MutationObserver，按官方 data 锚点 `[data-shortcut-modal="settings"] > nav` 找到导航，再按**我们自己注册的 `SECTION_LABEL` 文本**认出那一格（官方 class 是 CSS-module 哈希，会随构建变，不能当锚点）；②只 `setAttribute("data-mcpm-nav", "1")`，已标记且 `isConnected` 时立刻 return（聊天流式渲染的高频 mutation 也不会变热）；③样式表两行：`button[data-mcpm-nav] > svg { display:none }` 让齿轮退出 flex 流（label 位置不变），`::before` + `mask` 用内联 SVG 画标记，颜色走 `currentColor`。

**标记几何**：`assets/mcp-mark.svg` 的三条 path 逐字取自官方仓库 `modelcontextprotocol/modelcontextprotocol` 的 `docs/favicon.svg`；墨迹高 15、`scale` 0.0942473（= 15 / 159.1557，由几何反推）、有效描边 **1.0**（官方自然比例 1.043，但 16px 下笔画之间的缝只剩约 1px，4% 的加粗就把缝糊死）。**A32–A38** 用算术逐条钉住（内联副本与资产文件逐字比对）。

改后的样子（**自绘模拟行，非应用截图**）：

![设置导航里的两行对照：通用=官方齿轮，MCP=本插件标记](assets/nav-preview.png)

> **代价，明确记下**：官方 practices 写的是 *Do not write DOM outside your component*，本插件为此**开了一个有意的例外**并压到最小——只在**我们自己那一格**打一个 data 属性，不读别的插件的 DOM，不删/不换 React 节点，卸载时 `removeAttribute` + `disconnect`。它依赖官方 DOM 结构，DSH 改结构就**静默失效**（最坏情况是继续显示齿轮，不会破坏页面）。若哪天官方给 `settings.section` 加上 `icon` 字段，这段整块删掉、改成注册参数即可（AGENTS 3.8）。

---

## 9. 实测依据索引

每条结论都对应某处**本机安装版 DSH 的官方源码或一次运行观测**；完整索引（含行号）在 [docs/agent-rules-notes.md](docs/agent-rules-notes.md) §2，本文旧版的全表在 [docs/design-notes.md](docs/design-notes.md) §9。行号取自 `0.2.0-rc.2`，升级后必然漂移——复核请按"文件 + 关键字符串"重新定位。最常查的几条：

| 结论 | 位置 |
|---|---|
| `settings.section` 是 list 座位、按 `order` 排序；行只带 `id`/`order`/`label` | `dsh-client-ui-settings-general/lib/client.js:1017-1030, 1171-1181` |
| 导航图标是硬编码 id→图标、未知 id 兜底齿轮；那一格的结构与锚点 | 同文件 `:244-267`（用于 `:313`）、`:277-320` |
| `configEditor.edit` 的 YAML 节点编辑与失败回滚（断言在写盘前） | `dsh-config-editor/lib/index.js:69-135`（断言 `:122`、写盘 `:123`） |
| `connection.fetch.register` 精确路由 + 自动鉴权 + disposer 绑调用方 scope | `dsh-client-connection/lib/index.js:608-638, 755-762, 829-843` |
| 覆写补丁是**整键赋值** → group 的 `config` 被整数组替换，不是"继承层" | `cordis-plugin-include/lib/index.js:99-102`（`src/index.ts:120-123`） |
| `applyEntryPatches` 的行语义（`insert` 边插边 `buildMap`） | 同文件 `:56-105`（`buildMap` 在 `:83`） |
| `remote.settings` 只认声明了 `.volatile()` 的字段 | `dsh-settings/lib/index.js:413-419, 501-507` |
| `cordis:group` 是内置插件、config 是 entryList；`Include.write()` 整体重写 `root.data` | `dsh-app-boot/lib/index.js:2814, 3703` / `:245-248` |
| mcp-client 默认 `failOnStartupError:false` → 连不上也不抛、fiber 停在 ACTIVE | `dsh-mcp-client/lib/index.js:788, 797, 831-832` |
| mcp-client 的失败原因全部走 `ctx.logger`（warn 每次尝试 / error 放弃重连） | 同文件 `:560-561, 573, 578, 660` |
| 工具名形状 `mcp__<serverName>__<rawName>`，超长只归一化尾部 | 同文件 `:68, 71, 153` |
| cordis 内置日志缓冲阈值默认 1，**会丢 warn**（WARN=2） | `cordis/lib/types/logger.js:22-27, 76-97` |
| `not-a-bundle` 拒绝：安装器要求 `package.json` 有 `dsh.bundle.patch` | `dsh-plugin-manager/lib/index.js:228, 1587`；`dsh-app-boot/lib/index.js:495-508` |
| 兼容性只看 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer，不满足则整个 bundle 被 skip | `dsh-app-boot/lib/index.js:286-313` |
| 插件卡片图标走 manifest（≤256 KiB、须在包目录内），但 `file://` 接线拿不到 | `dsh-app-boot/lib/index.js:1167-1174, 1851-1876, 1971-2001` |
