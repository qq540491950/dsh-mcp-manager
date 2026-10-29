# dsh-mcp-manager

在 DSH（Web / 桌面端）的**设置面板最下方**加一页 **MCP**：可视化增删改、启停 MCP 服务器，并看到它们的加载状态、失败原因与**当前注册的工具名单（个数 + 名称，过多自动折叠）**。

- **是什么**：一个「客户端半边 + 宿主半边」的 DSH 插件，运行时**零依赖**（§0）。
- **怎么装**：见 §5（bundle 形态：一条命令装插件，**装完即用，不需要手改 profile** —— 容器行由 plugin bundle 自带，§5.6）。**怎么发布**见 §5.3。
- **改了代码怎么生效**：见 §6.2（客户端半边热替换、宿主半边要重启、profile 补丁秒级生效）。
- **写代码前先读**：[AGENTS.md](AGENTS.md)（硬性纪律 / 边界 / 风格）。本文只留结论；"为什么这么设计、当时实测到什么、还有哪些没实测"在 [docs/design-notes.md](docs/design-notes.md)——**两边章节号一一对应**，默认不必读。每条结论的官方源码出处见 §9。

---

## 0. 一句话结论

| 半边 | 产物 | 职责 |
|---|---|---|
| 客户端 | `lib/client.js` | 往 `settings.section`（list 座位）注册一页，`order: 900` → 落在设置导航最下方；纯 `window.__ModuleLoader__` 懒 CJS bundle |
| 宿主 | `lib/index.js` | `ctx.connection.fetch.register()` 开一条**自带鉴权的同源 HTTP 路由**（`/api/mcp-manager`）；`ctx.configEditor.edit()` 做**外科手术式的配置写入** |

**数据模型（v0.4.0 起）**：**profile 补丁文件就是数据库**。每台 MCP 服务器都是 profile `cordis.patch.yml` 里的**普通顶层 Loader 条目**，与手写、市场插件写的完全同形——没有受控块、没有 manifest、没有"接管"概念：

- **声明在本文件里**（本插件新增，或手写、市场插件写在 profile 里的）：source 标记为「本地」，**原地增删改**——编辑/删除只重写那个条目的字节区间，其余内容逐字节未变；
- **声明在别的层**（其他 bundle / home patch）：source 标记为「外部」，保存或启停时自动追加一条顶层覆写行（`- id: X`），此后变为「覆写」态——可编辑覆写行、可「还原」（删覆写行恢复原配置）；原始声明物理上不在 profile 里，无法由本插件删除；
- **受控写入**：由条目寻址写入器（`src/shared/patch-doc.ts` 定位字节区间 + `src/host/patch-writer.ts` 文件锁 / 原子替换 / 自动 `.bak`）执行；同 id 多份声明、区间异常一律**拒绝写入**；
- **旧版平滑迁移**：v0.3 受控块只是几行注释，不剥离也能读写，启动时自动剥掉美化；旧版 `cordis:group` 容器里仍有 MCP 时页面提供一键「迁移为顶层条目」。

页面提供：服务器列表（标注 本地/覆写/外部） + 状态四色 + 失败原因行 + 工具名单 + 行内启停/编辑/删除/还原 + 「检测」连通握手。**卸载插件 = 零痕迹**：配置就是一份谁都能手工维护的普通 YAML。

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

### 4.1 条目寻址：profile 里的普通顶层条目（v0.4.0 起）

每台 MCP 服务器都是一条顶层的 `@deepseek-ai/dsh-mcp-client` 条目，与官方模板及插件市场安装的 MCP **完全同形**——文件里没有本插件的任何"私有标记"：

```yaml
# profile 的 cordis.patch.yml —— 手写、市场插件写、本插件写，都长这样
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: streamable-http
        url: https://mcp.context7.com/mcp
        headers:
          Authorization: !!js "`Bearer ${process.env.MCP_TOKEN}`"
- id: magpie-mcp-dbx
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: dbx
    transport: streamable-http
    url: https://api.dbx.example.com/mcp
```

| 操作 | 声明在 profile 文件里（本地） | 声明在别的层（外部） |
|---|---|---|
| 显示 | 正常列出，标记为 `本地` | 正常列出，标记为 `外部`；有覆写行后标记为 `覆写` |
| 新增 | 文件末尾追加 `- {"insert":[…]}` 创建行 | — |
| 修改 | 原地重写该条目的字节区间（表单外的字段原样带回） | 追加/更新顶层覆写行（隐式发生，原声明不动） |
| 启停 | 原地重写该条目的 `disabled` | 追加/更新覆写行 |
| 删除 | 删掉该条目的全部声明行（父 insert 分节变空就连分节一起删） | 有覆写行 → 删覆写行（「还原」）；无 → 拒绝并说明 |

**为什么既不用 `ctx.loader.create()/remove()` 也不整体重写**：Loader 的持久化实现 `Include.write()` 会调用 `yaml.dump(整份 config)`，把用户手写的 `insert:` 分节和注释压平（AGENTS 2.3）。本插件的条目寻址写入器只重写**目标条目自己的字节区间**（由 `src/shared/patch-doc.ts` 的行扫描器定位，认得块式/flow 单行/`!!js` 预处理），其余字节逐字保留；使用 `package.json.lock` 避免并发写坏文件，写前自动 `.bak`。

### 4.2 写入路径的合法性闭环

写操作 = `requireDoc()`（读文件 + 扫描，异常则拒绝写入）→ 组装编辑列表（`entryWriteEdit` / `removalEdits`，同 id 多份声明是歧义状态、直接拒绝）→ `composeEdit` 在内存里合成（区间越界/重叠也抛错）→ `editPatch` 在文件锁内重读原文再合成一次 → 有变化才备份 + 原子替换。写完不调用任何 Loader API——`dsh-hmr` 监听该文件秒级重组合，这里只轮询 `configEditor.entries()` 等它生效（有界 10 × 100ms）。因为校验全部发生在**写盘之前**（或原子替换之前的内存合成），假设不成立时都是**安全失败**：报错、不落盘、不损坏配置。

### 4.3 文件清单

```
AGENTS.md                agent 工作约束（硬性纪律 / 边界 / 风格 / 流程 / Git 与发布）
README.md                本文件：是什么、怎么装、怎么改、约束速查
docs/design-notes.md     设计抉择、取证、尺寸基准、实测状态（默认不必读）
docs/agent-rules-notes.md  AGENTS.md 的附注：取证、断言台账、官方证据索引
docs/publish-plan.md     发布为 bundle（P6–P8）的执行手册 + 四种 spec 形式（§9）
docs/github-release-plan.md  只用 GitHub 发布：G0–G5 完整 runbook（顺序 / 命令 / 验收 / 回滚）
package.json             name（= 客户端 bundle 的模块 id）+ exports + dsh.bundle.patch + files 白名单
cordis.patch.yml         bundle 自带的补丁层：**容器行 + 插件行**（插件行的 name 必须等于包名；容器行必须在 insert 里且排在插件行之前，自检 P2/P3 守它；装完即用，§5.6）
locale/en.json           插件卡片文案（meta.title / meta.description），经 exports["./locale/*.json"] 暴露
locale/zh.json           同上（中文）
assets/icon.svg          bundle 卡片图标（64x64，圆角底色 + 标记；三条 path 几何逐字取自 assets/mcp-mark.svg）
LICENSE                  MIT（版权人见文件首行）
src/client/**            客户端半边源码（TSX）  → 产物 lib/client.js
src/host/**              宿主半边源码（TS）      → 产物 lib/index.js
src/shared/**            两半边共享的协议值（ROUTE / GROUP_ID / MCP_PACKAGE / SECTION_ID / SECTION_LABEL）+ 条目寻址（patch-doc.ts）与 v0.3 遗留清理（managed-block.ts）
lib/**                   构建产物（带 lib/.build-manifest.json 指纹），不要手改
assets/mcp-mark.svg      设置导航那一格用的 MCP 标记（16x16，几何取自官方 favicon）
assets/nav-preview.png   改后导航那一格的模拟对照图（自绘，非截图；§8.6 引用）
tools/verify.ts          自检：纯 Node（需 js-yaml；.ts 入口直接跑，无需构建）
tools/build.ts           esbuild 打包两半边 + 客户端包装 + 写构建指纹
.github/workflows/ci.yml  CI：typecheck / lint / format / build / verify + lib 漂移检查
```

**发出去的是哪些文件**：由 `package.json` 的 `files` 白名单决定（`lib`、`cordis.patch.yml`、`locale/*.json`、`assets/icon.svg`、`README.md`、`LICENSE`）——`src/`、`tools/`、`docs/`、`AGENTS.md` **都不发**。这不是风格问题：git 路线（`github:` spec）下 pnpm 拉的是仓库内容，白名单外的文件**根本不会出现在包里**（[docs/github-release-plan.md](docs/github-release-plan.md) §0）。自检 P5/P6 守这张白名单。

运行时**零依赖**：宿主半边不 import 任何东西；浏览器半边只 `require("react")`（平台种子表内）——视觉全靠自带样式表 + 主题 token，不用官方组件库。

---

## 5. 安装、接线与发布

### 5.1 能"一键安装"吗——**能，GitHub 路线已实测**

**先记住一条归属规则（v0.4.0 起）**：**没有容器了**。每台 MCP 就是用户 profile `cordis.patch.yml` 里的普通顶层条目，插件只负责按 id 原地增删改那些行——bundle 的补丁文件里只有插件自己这一行（§5.6 是 v0.2/v0.3 容器方案的历史与退役原因）。卸载插件不影响任何 MCP 服务器；升级 / 手工维护直接改文件即可。v0.1–v0.3 时代的容器行（`id: mcp-manager`）已退役：v0.2/v0.3 遗留的容器由页面一键迁移，v0.1.x 手写的容器行同样走「迁移为顶层条目」。

| 接线 / 安装方式 | 现在 | 说明 |
|---|---|---|
| **`plugin_manager install_bundle`（一键装插件）** | ✅ **已实测**（2026-10-14，`github:` spec，本机 desktop profile，`#v0.1.0`；v0.2.0 起容器随包安装，无需额外步骤） | `target:'github:qq540491950/dsh-mcp-manager#v0.2.0'` 装成功：profile 的 `dependencies` 落成 `github:…dsh-mcp-manager#v0.2.0`、`dsh.profile.bundles` 选上本包。**不必重启即生效**：`dsh-hmr` 监听 profile 的 `package.json`，变更会重读 `dsh.profile.bundles` 并重新加载每个 bundle 的 patch 层。**没跑过**：npm 渠道、Release 里的 `.tgz` URL 安装、卸载回归（`remove_bundle`）。 |
| **profile 里的路径行（开发循环用法）** | ✅ **能，且零依赖** | 只需 `cordis.patch.yml` 一行插件路径（§5.2）；不需要 `pnpm`、`node_modules`，也不需要先发布。⚠️ **插件路径行与 bundle 绝不要同时存在**：同 id 的两行会让 Loader 只保留一行 —— bundle 层先应用、profile 补丁层后应用，**后插入的路径行会把 bundle 行静默盖掉**（现象就是"装完看着没变化"），删掉路径行后 bundle 行立刻现身。 |
| **容器行（`cordis:group`）** | ✅ **bundle 自带，用户不用管** | 只有当 bundle 的补丁层被整体跳过（`evaluatePluginCompatibility` 判 incompatible 等）时，页面才会给出可整行照抄的 YAML 让你兜底（宿主与客户端两处文案都带这一行，自检 P11 守它）。**⚠️ 别自己再加一行**：同 id 两份声明会让每一次写入都失败（读起来却正常），页面会明确提示你删掉 profile 里那一行（自检 B82/B83/D14 守它）。 |

### 5.2 手动接线（开发循环：一行插件路径）

> **容器行不再需要手写**（v0.2.0 起随 plugin bundle 声明，§5.6）。下面的插件路径行**只在没装过 bundle 时写** —— 装过 bundle 之后再写路径行，同 id 两行会让 Loader 只保留后插入的那条、把 bundle 行静默盖掉（§5.1）。

本插件的路径行（与同级 `codex-effort-picker` 完全同一套接线，不需要 pnpm / node_modules）：

```yaml
- insert:
    - id: dsh-mcp-manager
      name: 'file:///D:/project/dsh-plugins/dsh-mcp-manager/lib/index.js'
```

**回滚**：删掉插件那一条 insert 行即可，设置面板里那一页立刻消失（`settings.section` 是 list 座位，不遮蔽任何官方 UI）；此时容器也随插件补丁层一起消失，已配置的 MCP 服务器暂停加载 —— 列表原文仍在 profile 的 `- id: mcp-manager` 覆写行里，装回即恢复（§5.6）。

> `dsh plugin --profile <name> …` 是 **pnpm 的透传**；"把包装成 bundle / 选上 bundle"是 `plugin_manager` 的活，不是 CLI 的活。

### 5.3 发布：怎么把它变成别人能一键装的插件

**DSH 没有中央插件市场**：安装入口是 `plugin_manager install_bundle`，底层用 pnpm 把你给的那个 spec 装进 profile——而 spec 有四种形式（见本节末）。所以**发布 = 让别人能装上一个声明了 `dsh.bundle.patch` 的包**，这个包**不一定要在 npm 上**（GitHub / tarball / 本地路径都行）。装一次即完成两件事：把包装进 profile 的 `node_modules`，并把包名写进 profile `package.json` 的 `dsh.profile.bundles`——它的 patch 层随后自动进 Loader。

> v0.1.1 起，"顺手把容器也装了"这件事不存在了：容器归 profile（§5.6）。所以安装说明里现在有**两步**——先有容器行，再装插件。

**① 包改造（P6）——已完成**（字段清单的唯一出处是 [docs/publish-plan.md](docs/publish-plan.md) §3）：

- `cordis.patch.yml`：**两行**——容器行（`id: mcp-manager` / `name: 'cordis:group'` / `config: []`）+ 插件行（`id: dsh-mcp-manager`，`name: '@qq540491950/dsh-mcp-manager'`——必须是**发布后的包名**，自检 P4 守它）。自检 P2/P3 守"容器行必须在 `insert:` 里、且排在插件行之前"（写成顶层覆写行会被 `applyEntryPatches` 静默丢弃，表现就是"设置里没有 MCP 页"）。
- 新增 `locale/{en,zh}.json`（`meta.title` / `meta.description`）、`assets/icon.svg`（≤256 KiB、包内相对路径）、`LICENSE`（MIT）。
- `package.json`：删 `private`；包名改 **`@qq540491950/dsh-mcp-manager`**（裸名 `dsh-mcp-manager` 被他人占用）；补 `dsh.bundle.patch`、`exports["."]`（条件导出 + `types`）、`files` 白名单（**不含 `src/`、`tools/`、`docs/`、`AGENTS.md`**）、`publishConfig.access = public`。
- `peerDependencies` 只留 `@deepseek-ai/cordis`。**没有钉任何 `@deepseek-ai/dsh-*`**：bundle 兼容性只看这些 `dsh-*` peer，不满足就**整个 bundle 被 skip**。

**② 本地验证**：`pnpm check` 全绿（typecheck / typecheck:tools / lint / format:check / build / verify 255 条）+ `npm pack` 审内容（有产物 / patch / locale / 图标 / README / LICENSE，无 `src`+`tools`+`docs`，无密钥）。把包装进 profile、运行时四查、`remove_bundle` 回归见 [docs/github-release-plan.md](docs/github-release-plan.md) 的 G2/G4/G5。

**③ 发布（GitHub 路线）**：`git push` → tag（与 `package.json.version` 逐字一致）→ **`.github/workflows/release.yml` 自动**用 `npm pack` 产物建 Release（附 `.tgz` 给没有 git 的用户）。**不发 npm**：两条渠道同时维护只会让版本口径分叉。历史版本要补建 Release 时手工走 `gh release create <tag> <tgz> --notes-file …`（见 [docs/github-release-plan.md](docs/github-release-plan.md) §4）；v0.2.0 / v0.3.0 / v0.4.1 就是这样在 2026-10-29 补齐的。

**④ 发布前必须停下让用户确认**：`npm publish` 与 `git push` 都不代跑。

**npm 不是必须的**——`install_bundle` 的 `target` 认四种 spec（本机安装版 `parseInstallSpec`）：**注册表包名**、**绝对本地路径**、**git 地址**（`github:user/repo`、`git+https://…git`、`https://github.com/user/repo#ref`，也可 `gitlab:` / `bitbucket:` / `gist:`）、**tarball**（本地 `.tgz` / `.tar.gz`，或 `https://…/x.tgz`）。所以"只发在 GitHub"完全可行：

```text
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.2')
```

四条路线的取舍、前提与代价见 [docs/publish-plan.md](docs/publish-plan.md) §9；**从改造到 tag、Release、用户安装、升级回滚的完整步骤见 [docs/github-release-plan.md](docs/github-release-plan.md)**。GitHub 路线最要紧的三条：①仓库里 `package.json` 必须有 `dsh.bundle.patch`，且 **patch 文件与 `lib/**` 都要提交进仓库**（pnpm 拉的是仓库内容，不会替你构建）；②git/tarball 是**抓取之后才判定**是不是 bundle，不是 bundle 会先装上再回滚（本地路径与 registry 是**装前**就拒）；③GitHub 的 spec 会先跑一次 `git ls-remote` 预检（5s，`git` 要在 PATH 上）。

⚠️ **容器只能声明一次**（v0.2.0 起它由 bundle 自带）：profile、home patch、`--patch` 覆盖层里**再**出现一份同 id 的 insert 行，就会让 `configEditor` 写盘前的自检取到先出现的空 config，于是保存/启停/删除全部报错，而读取看着正常（§5.6 有复现细节；页面会明确提示"被声明了两次，删掉 profile 那一行"）。升级插件后**宿主半边仍需重启 DSH**（§6.2）。

⚠️ **v0.1.x → v0.2.0 的迁移只有一步：删掉 profile 里那行手写的容器。** v0.2.0 把容器移回 bundle（§5.6），profile 里那份就变成了"第二次声明"——读正常、写全挂。就地装新版 → 页面会直接点名"被声明了两次，请删掉 profile 里那一行"并给出原文 → 删掉 → 重启 DSH。**不要先卸载再装**（旧版卸载检查按"bundle 声明过的行还在不在运行时里"判定，profile 里那份容器会让它判 `bundle-in-use` 而拒绝，profile 不动、什么都没坏）。

### 5.4 一键安装命令（bundle 形态）

```text
# 主渠道：git + tag（用户机器上要有 git；GitHub 会先跑一次 5s 的 git ls-remote 预检）
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.4.1')

# 备选：Release 资产里的 .tgz（纯 HTTPS，不需要 git，也没有那个预检）
# 每个 tag 都有对应资产（v0.1.0 除外：那一版发布时没建 Release）
plugin_manager(action:'install_bundle', target:'https://github.com/qq540491950/dsh-mcp-manager/releases/download/v0.4.1/qq540491950-dsh-mcp-manager-0.4.1.tgz')

# 只有开发机才有的本地目录形式（改完源码立刻试，不用先发布）
plugin_manager(action:'install_bundle', target:'D:\project\dsh-plugins\dsh-mcp-manager')

# 升级：**就地装新版，不要先卸**（换 tag 就是换 spec：`dsh-plugin-manager` 用
# "依赖串变了"判定装上了哪个包；返回 restart-required 是正常的 —— 宿主半边变了，
# 装完重启一次 DSH）。2026-10-25 实测：`file:` 依赖 → `github:…#v0.4.1` 就地替换成功。
# 下面用 #v0.4.2 作占位（尚未发布）——升级时换成真实的新 tag。
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.4.2')

# ⚠️ 从 v0.1.x 升上来时：**就地装**，然后删掉 profile 里那行手写的容器
#    （`- insert: [{id: mcp-manager, …}]`）并重启 DSH。不删的话容器会被声明两次：
#    读取一切正常、但保存/启停/删除全部失败（§5.6 的复现细节；页面会点名要删哪一行）。
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.2.0')

# 卸载（v0.2.0 起）：插件行与容器行一起消失 → 「设置 → MCP」那一页消失，
# MCP 服务器**暂停加载**（列表原文仍在 profile 的 `- id: mcp-manager` 覆写行里，
# 装回即恢复）；要 MCP 常年在线就别卸插件（§5.6）。
plugin_manager(action:'remove_bundle', target:'@qq540491950/dsh-mcp-manager')
```

三条写法的差别（谁要 git、装前判不判定、怎么钉版本）见 [docs/github-release-plan.md](docs/github-release-plan.md) §5。

> **`engines.dsh` 必须是范围，不能是精确版本**（v0.1.2 起 `^0.2.0-rc.2`）。app-boot 的
> `evaluatePluginCompatibility` 用 `semver.satisfies(runtime, engines.dsh)` 判定：精确 pin 会让
> DSH 每升一个 rc 就被判 `incompatible-version`，而 git/tarball 是**装后判定**——刚装好的包会被
> 回滚（`dsh-plugin-manager/lib/types/operations.js` 的 restore 分支）。v0.1.1 正是因此被
> 0.2.1-rc.2 拒绝；自检 P10 现在反向守"不许退化成精确 pin"。

### 5.5 兼容矩阵（实测）

| 插件版本 | 安装 spec | DSH | 结果 |
|---|---|---|---|
| `v0.1.0`（tag `v0.1.0`，commit `a078ac8`） | `github:qq540491950/dsh-mcp-manager#v0.1.0` | 0.2.0-rc.2（desktop profile） | ✅ 装上即生效（未重启）：旧手动接线删净后三台 MCP 服务器照常挂载、`mcp__context7__*` 工具在注册表；**重启 DSH 后仍然正常**。⚠️ 但这一版的容器行在包里，卸载即带走（§5.6） |
| `v0.1.1`（tag `v0.1.1`，commit `dc1e253`） | `github:qq540491950/dsh-mcp-manager#v0.1.1`（GUI「设置 → 插件 → 添加插件 → 包名或地址」） | 0.2.0-rc.2（desktop profile） | ✅ **装上即生效（未重启）**，2026-10-14 真机全新安装：`include:dsh-mcp-manager` 1 条（name = 包名）、座位 `{id:'mcp',order:900,active:true}` 只一格、3 台 `dsh-mcp-client` 仍在挂、合成结果 = **1 行容器 + 3 台**（写盘前断言 3/3 → 保存/启停/删除均可写）。本版改动：patch 不再声明容器行、缺容器时提示给出可照抄的整行。⚠️ 该版 `engines.dsh` 是**精确 pin** `0.2.0-rc.2`，在 0.2.1-rc.2 上会被判 `incompatible-version` |
| `v0.1.2`（tag `v0.1.2`） | `github:qq540491950/dsh-mcp-manager#v0.1.2` | 0.2.1-rc.2（desktop profile） | ⚠️ **只放宽了 `engines.dsh`：`0.2.0-rc.2` → `^0.2.0-rc.2`**（其余文件与 v0.1.1 逐字节相同）。**未实测安装** |
| `v0.2.0`（tag `v0.2.0`） | `github:qq540491950/dsh-mcp-manager#v0.2.0` | 0.2.1-rc.2（desktop profile） | **未实测安装**。改动：①容器行移回 bundle（装上即用，profile 不再需要任何东西）；②容器三态（缺失/重复/正常）+ 页面在"声明两次"时点名要删的那一行；③快照新增 `outside[]`，页面单列「页面外还有 N 台」并给出工具数（解决 `magpie-mcp-context7` 那种"在跑却看不见"）。本轮只跑了 `node tools/verify.ts`（PASS）与新增断言的反向验证；**真机安装 + 迁移验收待执行** |
| `v0.4.1`（tag `v0.4.1`） | `github:qq540491950/dsh-mcp-manager#v0.4.1` | 0.2.1-rc.3（desktop profile） | ✅ **已实测安装**（2026-10-25 19:36 真机）：依赖由开发用 `file:` 路径**就地替换**为 `github:…#v0.4.1`——spec 变更升级成立，未触发 `ambiguous-install`、无需先 `remove_bundle`；装后产物四份 sha256 与发布构建一致，`mcp__context7__*` 真机调用正常。同逻辑副本（装前手动同步，仅版本号字符串不同）上：重启 DSH 后首次启停把「创建行 + 遗留覆写行」**收拢为单份**（单行、注释保留），官方插件页的行级启停写入与我们的写入器共存。装后补丁文件被整体改写为块式 YAML 并新增 3 台 stdio 服务器——块式条目原生可寻址。改动（对 v0.4.0）：启停状态跟进改衰减长尾 + 可见性补读（修「停用→启用后一直黄色」）、扫描器支持官方美化产生的多行 flow、同内容覆写行就地收拢 |

上面几行里 v0.1.0 / v0.1.1 / v0.4.1 是"它到底能不能用"的真机安装实测；v0.1.2 与 v0.2.0 只有自检结论、**没有真机安装证据**。未跑的部分（npm 渠道 / `.tgz` URL / 卸载回归 / 同包换 `#ref` 的常规升级）见 §7.2 与 [docs/publish-plan.md](docs/publish-plan.md) §9。

### 5.6 容器的兴衰（v0.4.0 起**已退役**；v0.2/v0.3 曾归 bundle，v0.1.x 曾是 profile）

**v0.4.0 起没有容器**：每台 MCP 就是 profile 里的普通顶层条目，条目寻址写入器让插件**第一次具备了运行时创建/删除 Loader 条目的能力**（按 id 定位字节区间原位编辑）——容器当初"插件不能创建条目所以需要一个数组容器"的存在理由消失了。bundle 的 `cordis.patch.yml` 现在只有插件自己这一行：

```yaml
- insert:
    - id: dsh-mcp-manager      # 插件行（name 必须等于 package.json 的 name）
      name: '@qq540491950/dsh-mcp-manager'
```

**历史方案与其代价**（保留给考古；两者都已被 v0.4 消灭）：

- **容器在 bundle**（v0.2.0/v0.3.0）：装好即用，但卸载插件 = 容器消失 = 承载列表的覆写行被判 `not found` 整条丢弃 → MCP 停止加载（配置原文仍在 profile，装回即恢复）。也因此"容器被声明两次"（profile 手写一份 + bundle 一份）会让 `configEditor` 写盘断言取到空 config，**读正常、写全挂**——v0.2/v0.3 的页面为此单独做了 `duplicated` 检测。
- **容器在 profile**（v0.1.1）：卸载插件不影响 MCP，代价是每个用户装完插件还得先手改一次 YAML。

**v0.3 → v0.4 升级**：就地装新版 + 重启 DSH 即可。v0.3 写在受控块里的条目**不迁移也能用**（marker 行只是注释，寻址器当透明），启动时会自动剥掉那三行注释；旧 group 容器里还有服务器时页面给一键「迁移为顶层条目」（容器声明在 profile 里就直接删行，在别的层就兜底追加清空覆写行）。降级回 v0.3 的代价：v0.4 写的普通条目会被 v0.3 当成"外部条目"只读展示。

**bundle 被整体跳过时怎么办**（`evaluatePluginCompatibility` 判 incompatible，patch 层不参与合成）：页面本体照常打开，只多一条提示 —— 宿主与客户端都会把插件行 YAML 原样给出来（可直接复制粘贴到 profile），自检 P11 守住两半边给出**同一行**。这是兜底，不是常规步骤。

### 5.7 外部条目（声明不在 profile 文件里的顶层条目）

声明**不在** profile 补丁文件里的 MCP 条目（真实案例：其他 bundle 的补丁层声明了它，source 标记为「外部」）**在跑**、工具也注册给了模型，但它的原始声明物理上不在本插件可写的文件里。

- **可编辑、可启停**：保存或启停时自动追加一条顶层覆写行（`- id: X`）——此后该条目标记为「覆写」，原始声明不动；
- **删除 = 还原**：删掉覆写行、恢复外部原配置；原始声明本身无法由本插件删除（去声明它的层处理），没有覆写行时删除按钮禁用并说明原因；
- **profile 里的顶层条目不再是"页面外"**：v0.2 的 `outside[]` 概念随容器一起退役——市场插件写在 profile 里的条目现在就是「本地」条目，直接增删改；
- **状态判据**：与本地条目同一套（AGENTS 3.10 的四色语义）。


---

## 6. 自检与更新

### 6.1 自检

```powershell
pnpm verify                 # = node tools/verify.ts
# → PASS n/n（条数以实际输出为准；本文不写死条数）
```

**不需要构建**（`.ts` 由 Node ≥22.18 的类型擦除直接执行），但**需要先 `pnpm install`**：`tools/verify.ts` 依赖 `js-yaml` 按真实 YAML 解析 profile 补丁（2026-10-29 起口径修正；此前文档写的"零依赖"自 v0.3.0 起就不成立，CI 从 v0.3.0 起连续 4 次 push 全红）。覆盖范围就是 [tools/verify.ts](tools/verify.ts) 里的 `//#region`：A 包清单/主题/尺寸/自适应/表单结构与导航标记几何、B 宿主行为 + 行内操作回归 + 失败原因采集 + 相位映射 + 主动探测 + 配置分层 + 工具名单 + **页面外条目 + 容器三态**、C 产物协议与座位契约 + 导航标记 DOM（假 DOM 真跑）、D 真实渲染逐状态（含**页面外那一块**与"声明两次"的提示）、D2 挂载行为（真跑 `useEffect` 的沙箱 + fetch 桩）、E 共享常量 ↔ 出厂产物（含构建指纹 E9/E10 与文档引用一致性 E11/E12）、P 发布形态（`dsh.bundle.patch` / patch 内容 —— **P2/P3 守的是"本文件必须自带容器行、且写在 insert 里排在插件行之前"** / `files` 白名单 / locale / 图标 / `private` / peer / **P11 缺容器时两半边给出同一行可照抄的 YAML**）、F 纯函数直接单测。**断言台账只有这一处**（AGENTS 4.2）；每修一个 bug 同时加断言，新断言必须反向验证。

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
| group 条目挂载 | `include:mcp-manager` → `cordis:group`，`fiberPhase: active`（v0.1.0 时它的声明来自 bundle 层；v0.1.1 起来自 profile 层，条目不改名、`include:` 前缀同理） |
| context7 迁移成功 | `include:ef60a0d1` → `@deepseek-ai/dsh-mcp-client`，`active`，`readOnlyReason: "unaddressable"` |
| **宿主半边生效** | `include:dsh-mcp-manager` → `fiberPhase: active`（`apply()` 内同步注册路由，抛错会挂掉 fiber） |
| **客户端半边生效** | `settings.section` 台账 occupants 含 `{id:"mcp", order:900, active:true}`，且是 order 最大的一项 |
| 路由受鉴权保护 | `GET/POST /api/mcp-manager` → **401**；伪造 `Host` → **403** |
| 自检 / 文件编码 | `PASS`；无 BOM、无 U+FFFD、LF 行尾 |
| **bundle 一键安装（`github:` spec）** | profile 落成 `"@qq540491950/dsh-mcp-manager": "github:…#v0.1.0"` 且列入 `dsh.profile.bundles`；`node_modules` 里 30 个文件与自检通过的那份**五处 sha256 一致**（这一版 bundle 自带容器行 —— v0.1.1 起不再自带，见 §5.6） |
| **v0.1.1 全新安装（GUI「添加插件」）** | 依赖落成 `…#v0.1.1`、`dsh.profile.bundles` 选上；`include:dsh-mcp-manager` **1 条**（name = 包名、patchId = `dsh-mcp-manager`）；座位 `{id:'mcp',order:900,active:true}` **只一格**；已装包 `node_modules/.../cordis.patch.yml` 声明**只有插件行**、正文无容器 id；合成 = 1 行容器 + 3 台 MCP（写盘前断言 3/3） |
| **卸载插件期间 MCP 不掉线**（v0.1.1 的设计目的） | 手工执行管理器同一套动作（`pnpm remove` + 摘 `dsh.profile.bundles`）后：该包 Config 条目 **0 条**、`mcp` 座位消失，但 `@deepseek-ai/dsh-mcp-client` **仍是 3 条**、`mcp__context7__*` 仍在活动工具注册表 |
| **bundle 层的 group 行能被 profile 覆写行命中**（v0.1.0 的"★ 唯一未实测假设"） | 删掉 profile 手写的 `cordis:group` **insert** 行、只留 `- id: mcp-manager` 覆写行之后：3 台 `dsh-mcp-client` 子条目仍挂载，且 `mcp__context7__resolve-library-id` / `mcp__context7__query-docs` 在**活动工具注册表**里 |
| **旧手动接线删净后仍然正常** | 同 id 的两行曾把 bundle 行静默遮住；删掉路径行后按包名立刻查到 `include:dsh-mcp-manager` |
| **重启 DSH 后仍然正常** | 重启后 `include:dsh-mcp-manager` → `name: "@qq540491950/dsh-mcp-manager"`（**1 条**，旧 `file://` 行为 **0 条**）；context7 绿、dbx 红（`127.0.0.1:5225` 无监听，符合预期）、gva 灰（`disabled: true`） |

导航台账（order 升序）：`account -10 | general 0 | models 10 | plugins 15 | agent-presets 20 | mcp 900 ← 本插件`。
`readOnlyReason: "unaddressable"` 尤其值得记下：它**正面印证了「group 子条目不可单独寻址」**——这正是 §4「单一数组」设计的由来。

### 7.2 仍未实测 / 已知取舍

1. ~~**点击进入页面的那一次 fetch 往返**~~ **已确认**：2026-10-14 重启前后各打开过一次「设置 → MCP」，服务器列表正常。客户端的失败态（「读取失败：<原因>」+ 重试）仍未在真机触发过。
2. **`configEditor.edit()` 对 insert 条目的 `document.add` 分支**尚未产生过一次真实写入（首次在 UI 点「保存」时才走）；失败是安全的（写入前断言、不落盘）。
3. **group 子条目当前没有显式 `id`**（Loader 自动生成 `ef60a0d1` 这类十六进制 id）；`serverName` 重命名按数组下标定位，会保留原 `rowId`，改的是 `insert:` 声明而非覆写行时可能新建条目。
4. **导航那一格的 MCP 标记没在真实界面里点过**：离线侧已证明几何（A32–A38）与假 DOM 三条路径（C12–C17），缺"真机打开设置面板，齿轮确实变成 MCP 标记"这一环。
5. **「停用 → 再启用之后自动复查」——2026-10-25 真机已点过**：v0.4.1 之前的代码复现了「再启用后一直黄色」（本轮修复的触发现场），v0.4.1 同逻辑代码在真机触发了收拢（文件级证据见 §5.5 v0.4.1 行）；离线 D38–D41/D49–D54 断言请求序列与边界。仍缺的目视确认：点完「启用」后那一行**自己变绿**——期望也不是 1s：慢启动走 ≈30s 衰减长尾，更久的退避靠切回窗口的补读。
6. **卸载回归（`remove_bundle`）没跑**：装是实测过的（§5.5），卸没有。**v0.2.0 的形态下卸载会把容器一起带走**：容器行在 bundle 补丁层里，卸载 = 那一层消失 = 承载列表的 `- id: mcp-manager` 覆写行被判 `not found` 整条丢弃 → 服务器停止加载（**配置原文仍在 profile 文件里，装回即恢复**）。这是 v0.2.0 明确接受的取舍（§5.6）：换来的是"装完即用、用户不用手写 YAML"。目前是离线证据，没实跑过 `remove_bundle`。
   已知的**卸载被拒**情形（离线复现，逐字抄 `removeBundle` 的判定式）：**v0.1.0 + profile 已有容器行 → `bundle-in-use`**（该 bundle 声明过容器行，而那个容器当时由 profile 提供、永远活着）；v0.1.0 + profile 无容器行 → 允许；**v0.1.1/v0.1.2 + profile 有容器行 → 允许**。
   **v0.2.0 的现场**：容器由 bundle 声明，卸载照常允许（那份声明就在被卸的 bundle 里），代价是 MCP 随之中止加载、装回即恢复。
   反例仍要记住（v0.1.1 当年就是为它改的归属）：容器若写在 bundle 里，卸载 = 容器消失 = 承载列表的覆写行被判 `not found` 整条丢弃 → 服务器停止加载（配置仍在文件里、装回即恢复）。v0.2.0 又把归属翻回 bundle，理由是"装上即用"更重要 —— **取舍写在 §5.6，别再无声来回翻**。
7. **npm 渠道没跑**：`npm publish` 与"用 registry 包名再装一次"都没做；本轮只走 GitHub（见 [docs/github-release-plan.md](docs/github-release-plan.md) §0）。
8. **Release 资产 `.tgz` 的 URL 安装没跑**：`github:` spec 已实测；纯 HTTPS 的 `.tgz` 路线只做了 `npm pack` 内容审查与本地 git 依赖的对照（v0.1.1 / v0.1.2 / v0.2.0 / v0.3.0 / v0.4.1 的资产都已存在且 URL 可下载，但还没用 `install_bundle` 从 URL 装过）。
9. **逐按钮的点击回归没做**：页面渲染与数据读取已确认正常（重启前后各一次），但启停 / 删除 / 检测 / 刷新这几个按钮本轮没有逐个点过。
10. ~~**v0.1.1 的真机重装 + 重启后四查没做**~~ —— **2026-10-14 已做**：GUI「添加插件」填 `github:qq540491950/dsh-mcp-manager#v0.1.1` 装成功（`dependencies` 落成 `…#v0.1.1`、`dsh.profile.bundles` 选上），**未重启即生效**；核查结果见 §5.5 那一行。唯一仍只有离线覆盖的是**缺容器时那段提示文案**（本机容器在位，走不到那个分支）。
11. **同包换 `#ref` 的常规升级没单独走过**（v0.4.1 → 下一版）：spec 变更升级已实测（2026-10-25，`file:` → `github:…#v0.4.1` 就地替换，见 §5.5），换 `#ref` 的依赖串变化机理相同，但没有单独验证过；同 spec 重复安装会报 `ambiguous-install`（源码判读，未复现）。详见 [docs/publish-plan.md](docs/publish-plan.md) §9。

### 7.3 行内操作曾经静默丢字段（已修）

症状：点「停用」按钮变灰但状态不变，且 profile 里 context7 的 `headers` 消失了。根因是行内操作把**整个数组**回传、宿主再用 `normalizeRow()` 逐行重建，而它当时只认「多行 KEY=VALUE 文本/字符串数组」，快照里 `headers` 却是**对象** → 字段被静默清空。

修复：①`toRecord()` 同时接受对象、字符串数组、多行文本三种形状（AGENTS 2.6）；②启停/删除改为**宿主侧定点操作**（AGENTS 2.5，B27–B42 是回归测试）；③请求加 20s 超时（否则宿主卡住会让按钮永久发灰）。**未证实**：拿不到宿主日志，无法离线复现"状态不变"这一症状，所以成因链是"能证明的部分 + 最可能的成因"。

**v0.2.1 补上第二层**：表单保存曾仍会把**所有行**回传给 `normalizeRow()` 重建 —— 行内操作修好了，但「新增/编辑任意一台」还会清空其他行的 `headers/env`。现在客户端优先用 `saveRows` 能力：未修改的行只带原始 `config`，宿主原样写回；只有被改的那一行带 `patch`，以原 config 为 base 覆盖表单字段。`!!js` 在表单里显示为 `KEY=!!js <expr>`，保存时还原成 `{__jsExpr}`（共享实现 `src/shared/expr.ts`），`reconnect` / `maxInstructionBytes` / 未知字段也不再被丢。旧宿主没有 `saveRows` 且配置里含 `!!js` 时，保存会被拦下并提示重启 DSH，而不是继续写坏。B24a–B24f / F27a–F34e 守住这条路径。

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
- 探测细节：只打**启用中**的服务器；用 `fiber.config` 里**已求值**的 `url/headers`（否则 `!!js` 凭据会被读成空；条目未激活时 `connected: null` 并说明原因）；协议版本用官方 SDK 的 legacy 首选 **`2025-11-25`**；响应最多读 4 块 / 64 KiB（SSE 会一直挂着），看到 JSON-RPC 信封即停；网络错误取 `error.cause.message`；HTTP 2xx 但只有 JSON-RPC `error`（如不支持的协议版本）→ **判失败**，不再把"拒绝握手"当绿灯；stdio 无法用 HTTP 探测 → `connected: null`，**不谎报**失败。
- **预算是"冷连接"的预算**：探测走宿主全局 `fetch`（连接池），与 mcp-client 那条长连不是同一条连接，空闲过期后基本都是一次全新的 DNS + TLS 握手；实测远程冷路径 1.6–3.0s，3s 预算会把**配置正确**的服务器报成假红 → 取 **8s**（A24f 守住下限）。探测并行，总时长 ≈ max 而不是累加。
- **打开页面自动检测一次**（先 GET 拿 `capabilities`，旧宿主不认识 `probe` 就跳过；silent 模式不锁按钮）；**每次写入都补一次检测**（启停/删除/保存都算，因为写入清空了全部记录）：静默探一次，探通了但相位未 `active` 就重读快照到稳定（**有界 10 × 200ms，不是轮询**）。旧宿主没有 `probe` 时「检测」置灰并提示"需要重启 DSH"，而不是让用户点出「未知操作」。
- 已知取舍：**只在打开页面与每次写入后探一次，不轮询**——页面开着但什么都不做时状态不会自己变（要"现在"的结论就点「检测」）。每次探测都是一次真实的 `initialize` 请求（对服务端是无副作用的读操作，但确实"敲了一次门"）。

### 7.9 工具名单（每台服务器"有几个工具、分别叫什么"）

每张服务器卡下面有「工具 N 个」+ 工具名（等宽 chip）；超过 6 个默认只显示前 6 个 +「+N 个」，旁边给「显示全部 / 收起」，折叠状态**每一行独立**。

**数据来自工具注册表，不是再发一次 `tools/list`**：mcp-client 连接成功后把每个工具注册成 `mcp__<serverName>__<rawName>`，所以宿主只要读 `ctx.tools.schemas()` 按前缀 `mcp__<serverName>__` 归属，就能拿到"模型此刻真正能调用的集合"——零网络开销，连不上的服务器自然 0 个。**归属只认前缀**（`publicToolName()` 只在名字超长/含非法字符时改写尾部），所以展示的是**公开名**，不能声称那是服务端原始名。宿主排序后返回、`count` 报真实总数、快照上限 200（超了置 `truncated` 并在 UI 提示）；宿主没有 `tools` 服务时**不写这个键**，客户端就不渲染这块（旧宿主天然兼容）。

### 7.10 v0.2.0：容器归属翻转 + 页面外可见（只有离线证据）

两件事的推导见 §5.6 / §5.7，这里只记"证据到哪一步"：

- **自检**：`node tools/verify.ts` → `PASS 274/274`（新增 19 条：B9c/B9d、B77–B83、D14、D15/D15b、D16/D16b、F39–F43；改写 D13、P2/P3/P11 与 A24/B9b 的能力表）。
- **反向验证**（逐条注入 → 确认精确报错 → 还原）：删容器行 → P2 三项红；容器行改成顶层 `- id:` → P3 三项红（**顺带抓出断言自己的漏洞**：原来的正则容忍前导空白，会把 insert 里缩进的那行也当成"顶层"）；`containerState()` 把 `duplicated` 说成 `missing` → B82 打印 `["missing",false]`、B83 打印"去找一行"的口径；`outsideServers()` 返回空 → B77/B78/B79 同红；`outsideStatus` 只看相位就报绿 → F40/F41/F42 红；客户端 `containerOf` 把 `duplicated` 归到 `missing` → D14 红；空态文案改回固定句 → D16b 红并打印整页文本。
- **样式**：页面外那块完全复用紧凑档（12px / 28px 行高 / `--dsw-radius-*` / `--dsw-alias-border-l2` 顶部分隔线），**不加外框和底色**（AGENTS 3.4：别叠成卡片套卡片）；颜色只有圆点走 token（AGENTS 3.1/3.2）。
- **没实测**：真机装 v0.2.0、真机删掉 profile 那行容器后的写入（保存/启停/删除）、真机迁移现场。本机 profile 现在**同时**有手写容器行与 `magpie-mcp-context7` —— 正是 B82 / B77 复现的那两个现场，但运行时还停在 v0.1.2，所以这三条要装完新版 + 重启后各点一次才算数（清单见 §7.2 第 7 条）。

### 7.11 v0.2.1：保存保真 + 探测语义

- **自检**：`node tools/verify.ts` → `PASS 294/294`（新增 B24a–B24f、B69b/B69c、B70b、D48、A24g、F27a/F27b/F28b/F31b/F34b–F34f；A24/B9b 的能力表加 `saveRows`）。
- **反向验证**（注入 → 确认精确报错 → 还原）：`pairsToText` 退回 `asText` → F27a 打印 `Authorization=`；`declaredRows` 退回 `override.length > 0` → B70b 打印继承层那一行；`saveRows` 对未修改行也 normalize → B24b 丢掉 `futureField`；JSON-RPC `error` 改报 `connected:true` → B69b 打印 `"connected":true`；探测不用 `fiber.config` → B69c 打印 `connected:null`。
- **已知边界**：`disabled` 是行字段（不在 config 里），快照只投影布尔值；`serverName` 是必填普通字符串。因此 `disabled: !!js` / `serverName: !!js` 仍不在表单保存支持范围，需要条件启停/命名的用户继续手写 YAML。本轮保证的是 config 内标量（`headers/env/url/command/args/cwd`）的 `!!js` 保真。
- **未实测**：真机新增/编辑一台带 `!!js` 凭据的服务器、真机重启前后的 `saveRows` 能力切换、真机对返回 JSON-RPC error 的服务器点「检测」。宿主半边改了，生效需要重启 DSH。

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

### 7.12 v0.3.0：顶层 insert + 外部接管 + 旧 group 迁移

- **架构变化**：彻底告别 `cordis:group` 容器；新增 MCP 一律以顶层 `- insert:` 项落盘；外部已有 MCP 一键「接管」（追加 `- id` 覆写行）与「取消接管」（恢复外部原始配置）。
- **受控块安全**：引入 `src/shared/managed-block.ts` 与 `src/host/patch-writer.ts`，只更新 marker 块，块外内容逐字节保留；原子写 + `package.json.lock` 锁 + 自动 `.bak` 备份。
- **旧版迁移**：启动时如检测到旧版 group 容器有数据，页面显示「迁移到顶层 insert」按钮，调用 `op:migrate` 一键将旧服务器搬迁为顶层 insert 并清空旧 group `config: []`。
- **自检**：`node tools/verify.ts` → `PASS 290/290`。
### 7.13 v0.4.0：条目寻址——没有受控块，没有接管，profile 就是数据库

- **架构变化**：受控 marker 块、manifest、「接管/取消接管」整套概念全部移除。每台 MCP 是 profile 里的普通顶层条目；本插件按 **id 寻址**原地增删改那些行（`src/shared/patch-doc.ts` 行扫描器定位字节区间，认块式 / flow 单行 / `!!js` 预处理），声明在别的层的条目保存/启停时自动追加覆写行（source 三态 `profile` / `overridden` / `external`）。bundle 补丁文件只剩插件一行，卸载插件零痕迹。
- **写入安全**：`composeEdit` 纯函数合成（区间越界/重叠/多 append 抛错）→ `editPatch` 文件锁内重读原文再合成 → 有变化才 `.bak` + 原子替换；同 id 多份声明时 update/setEnabled 拒绝、remove 删全部；删空兜底保留 `[]`。
- **兼容**：v0.3 受控块的 marker 行是注释，寻址器当透明——不迁移也能读写，启动时自动剥离美化（`stripManagedMarkers`）；旧 group 容器一键迁移（声明在 profile 里删行，否则兜底清空覆写行）；能力表新增 `nativeRows`（保留 `patchInsert` 给 v0.3 客户端做版本提示），adopt/release op 返回明确的"已移除"错误。
- **自检**：`node tools/verify.ts` → `PASS 303/303`（新增 F39–F49 patch-doc 纯函数、B27–B44 手写条目/遗留形态/外部条目/同 id 歧义、B84/B85 容器在文件里的迁移；P2/P3 反转为"patch 只有一行、容器不得再声明"）。
- **反向验证**（注入 → 精确报错 → 还原）：patch 加回容器行 → P2/P3 红（点名"只有一行"/"容器行已退役"）；composeEdit 区间替换改成整份重写 → B30/F45 红（块外字节被吞）；stripManagedMarkers 改成空操作 → B40/F49 红（marker 残留）。
- **未实测**：真机安装 v0.4.0 与重启前后的能力协商、v0.3 受控块/手写容器行的真机迁移现场、真机对 flow 行与 `!!js` 条目的编辑（以上全部只有离线自检证据）。宿主半边改了，生效需要重启 DSH。
