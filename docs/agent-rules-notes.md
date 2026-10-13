# agent 规则附注：取证、台账与证据索引

> 这份文件是 [AGENTS.md](../AGENTS.md) 的**附注**，默认**不需要读**。
>
> 为什么要把这些内容搬出来：AGENTS.md 是每个会话都要进上下文的约束文件，只应该放"做什么、怎么自查、违反的代价"。
> 而下面这些内容——事故取证、断言 ID 台账、官方源码行号——要么体量大、要么**会漂移**（断言 ID 每次加断言都变，
> 行号随 DSH 升级变），留在约束文件里只会变成误导源。规则本身没有减少，只是把"为什么"和"当时怎么查的"移到这里。
>
> 需要读它的场合：想复核某条规则的依据、怀疑规则过时、或要重新查官方源码时。

---

## 1. 规则搬迁对照表（AGENTS.md 重写前后）

旧版 41 个条目 → 新版位置。**没有任何规则被删除**；"改写"指事实更新（旧表述已被现实推翻），"压缩"指保留判据、删去叙事。

| 旧（重写前） | 新（重写后） | 处置 |
|---|---|---|
| §0 30 秒定位 | §0 定位 | 改写：`lib/**` 标为产物；去掉写死的断言条数；补官方资料入口 |
| 1.1 PowerShell 5.1 | 1.1 | 压缩（删事故叙事，保留不可逆的判据与替代做法） |
| 1.2 半边热重载 | 1.2 | **改写**：改成"改 `src/**` + 构建；`lib/**` 是产物"；双代协议协商原样保留 |
| 1.3 不要重启 DSH | 1.3 | 保留 |
| 1.4 profiles | 1.4 | 补"官方首选 `install_bundle`，手改仅 fallback" |
| 1.5 护栏重做 | 1.5 | 保留 |
| 2.1 零 import | 2.1 | 压缩；补机检位置（eslint + 产物断言） |
| 2.2 客户端契约 | 2.2 | 补 `dsh.client.external`；补"恰好注册一次" |
| 2.3 禁 loader 增删 | 2.3 | 压缩；证据改为 `Include.write()` / `_writeFile()` 的实际行为 |
| 2.4 唯一写入点 + 行语义 | 2.4 | 删 profile 行号取证（已失效）；补官方 dialect 原句与 `--dump-config` |
| 2.5 行内定点 | 2.5 | 压缩（事故缩成一句代价） |
| 2.6 `toRecord` 三形状 | 2.6 | 保留 |
| 2.7 `remote.settings` | 2.7 | 保留 |
| 3.1 颜色 | 3.1 | 补实测色值；补"token 是否存在以官方 CSS 用法为准" |
| 3.2 禁 inline | 3.2 | 压缩 |
| 3.3 mono/multiline | 3.3 | 压缩 |
| 3.4 底色分层 | 3.4 | **修正 token 全名**（`--dsw-alias-settings-card-*`） |
| 3.5 自适应 | 3.5 | 压缩 |
| 3.6 外壳留白 | 3.6 | 类名改为"CSS module 里映射为 `options` 的那个类"（hash 名会随构建变） |
| 3.7 尺寸基准 | 3.7 | 压缩 |
| 3.8 DOM 例外 | 3.8 | 补官方引文原文、官方 DOM 结构、上游 icon 提案（sunset 条件） |
| 3.9 单出口 | 3.9 | 压缩（删截图叙事） |
| 3.10 状态语义 | 3.10 | **重写**为"判定顺序表 + 四条配套"；秒数采样与反向验证日志移到本文第 6 节 |
| 4.1 先跑自检 | 4.1 | 命令名改为 `tools/verify.ts` |
| 4.2 加断言 + 四区表 | 4.2 | **重写**：删 ID 清单（16 处区间），台账交给 `tools/verify.ts` 的 `//#region` |
| 4.3 反向验证 | 4.3 | 压缩 |
| 4.4 渲染层加场景 | 4.4 | 合入 `scene(...)` 夹具说明 |
| 4.5 不放宽断言 | 4.5 | 保留 |
| §5 交付标准 | 4.6 | 合入 §4（三件套）；编码检查改为一键脚本 |
| §6 常用命令 | §5 | 压缩为 5 条；补"`plugin_manager` 需审批 / `cordis_inspect_query` 不需要" |
| §7 Git 约定 | §7 | 压缩 + 补发布面（scope 包名、`files` 白名单） |
| §8 已知边界 | §6 | 压缩为表；3 条改措辞（见第 8 节） |

**编号兼容性**：`src/**`、`tools/**`、`eslint.config.js`、`docs/*.md` 里共有 34 处 `AGENTS x.y` 引用，涉及
1.1 / 1.2 / 1.3 / 2.1 / 2.3 / 2.4 / 2.5 / 3.1 / 3.2 / 3.8 / 3.9 / 3.10 / 4.5 / §7。新版的这些编号**全部保持不变**，
所以代码注释里的指向不会失效。

---

## 2. 官方证据索引（本机 DSH `0.2.0-rc.2`）

**怎么读**：源码在 `D:\Program Files\DeepSeek Harness\resources\app.asar`（121 MB / 11470 个文件）。
`read` 工具直接读 asar 路径会失败（后端 `BigInt` 混用缺陷），shell 与 `node` 也无法直接穿透 asar 虚拟路径；
但**可以**用只读探针把 app.asar 当二进制读：解析 8 字节 pickle 头 → header JSON → 按 offset 取文本。

> ⚠️ 下面的行号取自 **0.2.0-rc.2**，升级后必然漂移。复核时请按"文件 + 关键字符串"重新定位，不要信行号。

| 结论 | 文件 | 关键行/字符串 |
|---|---|---|
| `Include.write()` 整文件重写 | `@deepseek-ai/dsh-app-boot/lib/index.js` | `:245-247` `write() { … return this.writeFile(this.root.data) }`；`:210-227` `_writeFile` = `yaml.dump(config)` → `.tmp` → `rename` |
| 补丁合成入口（离线与在线同一函数） | 同上 | `:989` `composeEntries(layers, warn)` → `applyEntryPatches([], …)`；`:1030+` `readProfilePatches` 的层序：bundle → profile patch → `$DSH_HOME/cordis.patch.yml` → CLI overlay |
| 覆写 = 整键赋值 | `@deepseek-ai/cordis-plugin-include/lib/index.js` | `:56` `applyEntryPatches`；`:68` `const { id, insert, name, ...overrides }`；`:81` `target.config.push(...insert)`；`:92-95` `name` 不符则 warn 并跳过；`:99-102` `target[key] = value` |
| `insert` 边插边建索引 | 同上 | `:83` `buildMap(insert)`（所以同列表里靠后的补丁能命中前面刚插入的行） |
| Loader 的 create/remove 与 disabled | `@deepseek-ai/cordis-plugin-loader/lib/index.js` | `:58` `create()`；`:70` `remove(id)`；`:333-348` `get disabled()`（"this entry **or any owning parent**"）+ `disabledOf()` 支持 `!!js` |
| 导航图标硬编码 + 齿轮兜底 | `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` | `:244-266` `navIcon(id)`（`account/models/agent-presets/plugins/archived-sessions` 五条 if，末行 `IconSettingsOutlineMedium`） |
| 导航格 DOM 结构 | 同上 | `:313` `children: [navIcon(row.id), jsx("span", { className: navLabel, children: row.label })]` |
| 设置页行的构造 | 同上 | `:1018-1031` 只取 `options.id/order/label`，`sort((a,b) => a.order - b.order)` |
| 外壳内容区 padding | 同上 | `:60` `… .wCInkW_options{flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto}`（`:83` 映射 `"options": "wCInkW_options"`） |
| `settings.section` 注册契约 | `@deepseek-ai/dsh-cordis-client-runner/lib/client.js`（转述官方 `packages/client/ui-settings/src/client/contract/slots.ts:57`） | `:4710-4760`：`registerOptions` = `id`(required) / `order`(optional) / `label`(optional)，**没有 `icon`** |
| 主题 token 与 inspect 表 | `@deepseek-ai/dsh-client-ui-theme/lib/client.js` | `BUILTIN_INSPECT_TOKENS` 共 **14** 条（bg-base/layer-1/layer-2/overlay、border-l1/l2、brand-primary、label-primary/secondary、state-error/idle/success/warn、sidebar-fill），全部 `requiresLightAndDark: true`；`exportInspectTokens()` 由 `Theme.listTokens` 暴露 |
| `brand-primary` 深浅两值 | 同上 | 深色 = `var(--dsw-static-neutral-bluish-50)` = `#f9fafb`；浅色 = `neutral-bluish-1000` = `#0f1115` |
| 官方主按钮写法 | `@deepseek-ai/dsh-client-ui-primitives/lib/Button.module.css` | `:37-38` `background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground)` |
| 官方卡片写法 | `@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js` 等 4 处 | `border:.5px solid var(--dsw-alias-settings-card-stroke); background: var(--dsw-alias-settings-card-fill)` |
| HMR 监听范围 | `@deepseek-ai/dsh-hmr/lib/index.js` | `:14` "Exact-path watching for live profile patch files **outside Cordis module roots**"；`:239` `root: z.array(String).role("table").default(["."])`；`:319` `baseDir = fileURLToPath(new URL(config.base \|\| ".", ctx.baseUrl))`；`:274/:299-309` `configPaths` 显式登记 |
| `failOnStartupError` 默认 false | `@deepseek-ai/dsh-mcp-client/lib/index.js` | `:788`、`:797` `z.boolean().default(false)`；README `:63` 同 |
| 退避后放弃并注销工具 | 同上 | `:438` `maxAttempts: 10`；`:573` `ctx.logger.error("… giving up after N consecutive failed reconnect attempts — tools unregistered …")`；`:578` `ctx.logger.warn("… attempt N/M")` |
| 工具名形状 | 同上 | README `:71` `mcp__<serverName>__<tool>`；`:68` `MAX_PUBLIC_NAME_LENGTH = 64`（超长只归一化**尾部**） |
| `describe`/`write` 只认 volatile | `@deepseek-ai/dsh-settings/lib/index.js` | `:418` `describe()` → `volatileForm(schema)`；`:506` "has no volatile fields"；`:507/:520` "is not volatile" |
| 日志环形缓冲 | `@deepseek-ai/cordis/src/logger.ts` | `:192-217` `bufferSize = 1000`，内置 exporter `buffer.push(message)` / 超出 `slice(-1000)` |
| `unaddressable` 是契约里的字面量 | `@deepseek-ai/dsh-api-remotes/lib/client.js` | `readOnlyReason: union([literal("management-required"), literal("unaddressable")])` |

---

## 3. 官方 skills 文档要点（app.asar 内，随安装附带）

路径：`@deepseek-ai/dsh-agent-preset/skills/`（17 个文件）。它是**官方写给 agent 的**开发指南，比任何二手资料权威。

- `cordis-plugin-development/SKILL.md`
  - 安装插件走 `plugin_manager` `action: install_bundle`；**明确要求"不要手写 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm"**。
  - `plugin_manager` 的**每个** action（含 `list_plugins`）在非 Full access 下**都需要审批**；`cordis_inspect_query` **不需要**审批 → 查证优先用后者。
  - 环境事实：`$env:DSH_PROFILE` / `$env:DSH_PROFILE_DIR` 在 profile 启动的每次 shell 调用里都有；`dsh --profile "$DSH_PROFILE" --dump-config` 打印真实合成结果。
  - 知识来源顺序：① `cordis_inspect_query` ② 包内 `README.md`（路径由 `Config.listConfigs` 给出，**不要猜**）③ 安装产物的 `lib/**`（源码 checkout 才有 `src/`）。
  - Desktop 下 skill 目录位于 app.asar 内：shell / glob / search / node / pnpm **都无法**直接读它，只有宿主进程自己的文件读取可以。
- `references/practices.md`（UI 段）
  - 原话：*"Do not write DOM outside your component or append to `document.body`."*（AGENTS 3.8 的例外就是针对它）
  - *"Style with the theme tokens that `cordis_inspect_query` `Theme` lists (`--dsw-alias-*`); literal colors are for artwork only."*
  - *"Do not `require('@deepseek-ai/dsh-client-ui-primitives')` or load any other Harness Client package as a module"*（会随版本变；组件抛错会把整个座位渲染成空白）。
- `references/ui-plugin.md`：浏览器产物注册 lazy factory、**id 等于包名**、React 来自浏览器模块表；非基线运行时依赖用 `dsh.client.external` 声明；*"Do not read another plugin's DOM, stylesheet, or component source to estimate placement"*。
- `references/host-plugin.md`：Host 半边的导出形式（`apply(ctx, config)` **或** service class default export，不要混）；*"Read an existing patch before editing it: a matching override replaces the complete `config`"*。
- `cordis-composition-reference/SKILL.md`（Loader patch dialect，2.4 的权威出处）
  - `insert: [rows]` 追加；带 `id` 时追加进 `group: true` 行的 `config`。
  - 带 `id` 无 `insert` 的补丁**覆写**目标行；"**`config` is replaced wholesale, never deep-merged, so restate every field the row needs**"；`name` 为真值时是**断言**而非改名。
  - 无 id 的非 insert 补丁、以及命中不到行的补丁：**warn 并跳过**。
  - `disabled` 接受 boolean / null / `!!js` 表达式，在**每次挂载决策**时求值。

---

## 4. 外部交叉验证（旁证，非权威）

- [settings.section: allow registrations to carry a nav icon · deepseek-harness discussion #1229](https://github.com/deepseek-ai/deepseek-harness/discussions/1229) —— 正是 AGENTS 3.8 的 sunset 条件：第三方 section 只能拿到兜底齿轮，提案给注册项加一个可选 `icon` token。
- [vendor/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/README.md) —— 确认 `applyEntryPatches` 的导出、`insert` 边插边索引、补丁存在时深拷贝 entry list。
- [dsh-mcp-client README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md) —— `failOnStartupError` 默认 `false`、`toolCallTimeoutMs` 默认 60000、`reconnect.enabled` 默认 true、工具名 `mcp__<serverName>__<tool>`。
- [discussion #2889](https://github.com/deepseek-ai/deepseek-harness/discussions/2889)（提到 #2854）—— **上游已知缺陷族**，与本仓库的写路径相关，值得记着（**未在本机复现**）：
  - `applyEntryPatches` 会把 `disabled=true` 等改动写到**共享的 insert 对象**上（建议 clone insert）；表现为"插件被静默 disable"。
  - 同一 id 重复 insert → `duplicate loader entry id`，web boot 直接起不来。
- [What Cordis Does Inside DeepSeek Harness](https://vanducng.dev/2026/08/15/what-cordis-does-inside-deepseek-harness) —— 旁证"patch 按 id 定位、`config` 整体替换、不深合并"与五层补丁顺序。
- Context7 `/cordiverse/cordis` —— 上游 cordis 的 Service/Fiber 生命周期（`PENDING→LOADING→ACTIVE→FAILED→DISPOSED`、`ctx.provide/effect`）与本机 fork 一致，可用于理解概念，但**DSH 是本机 fork**，判据仍以安装版本为准。

---

## 5. 历史事故与取证（AGENTS 里只留一句代价）

1. **PowerShell 往返毁文件（2026-10）**：用 `Get-Content -Raw` + `Set-Content` 做反向验证，把 `lib/client.js` 写成语法错误；"还原"时写回的已是损坏内容，只能整文件重写。
   本轮复核再次看到同一现象：`Get-Content .gitattributes` 读出的中文全是乱码（`PSVersion 5.1.26100.9444 Desktop`，ANSI 码页 936）。
2. **并发编辑**：`cordis.patch.yml` 被用户并发改过多次，版本护栏每次拦住；绕过护栏就会丢掉用户的改动。
3. **context7 的 `Authorization` 消失**（2.4 / 2.5 两条规则的来源）：
   - 一次原因：行内操作回传整数组，宿主用 `normalizeRow()` 逐行重建，而当时的 `normalizeRow` 只认"多行文本/字符串数组"，快照里 `headers` 是**对象** → `headers`/`env` 被静默清空（后已修：`toRecord()` 同时认三种形状）。
   - 又一次原因（语义层）：profile 的 `insert:` 行里写了 `Authorization`，而生效的**覆写行**没有 `headers` → 运行时压根没有这个请求头，文件却"看上去配好了"。
   - ⚠️ **旧版 AGENTS 引用的行号（insert `:96-97`、覆写 `:270-274`）已经失效**：本轮核对 live profile，insert 在 `:87-97`、覆写行在 `:286-311`，**覆写行里三台服务器都有 `headers`**。语义结论（整键赋值）由源码与官方 dialect 双重证实，但"取证行号"这种东西不该写进约束文件——这正是重写要删掉它的原因。
4. **状态误报绿灯**：用户配的 `gva`（`http://192.168.1.101:8889/mcp`）`Test-NetConnection` 显示 `TcpTestSucceeded: False`，页面却是绿「运行中」。根因见 2 节：`failOnStartupError: false` 时连接失败也不抛错，fiber 全程 `ACTIVE`。
5. **重复渲染**：新增服务器填错时，`服务器 "server-1" … url 为空` 同时出现在卡片上方与表单底部（用户截图反馈）→ 3.9 的"一条错误一个出口"。
6. **探测预算 3s → 8s**：host 侧实测（本机 + 真实 profile，请求形状与 `probeServer` 完全相同）
   - 远程 `https://mcp.context7.com/mcp`：冷路径 1.6–3.0 s，热连接约 360 ms，局域网 3–10 ms；
   - 3 s 预算下出现过连续 3005 / 3009 / 3013 ms 被 abort，把**配置正确**（mcp-client 连得上、工具已注册）的服务器报成假红；同条件 20 s 预算下 200。
   - 结论：按**冷连接**定预算，取 8 s（≈2.7 倍余量）；`A24f` 守住下限 ≥8 s。
   - 本轮**未复测**这些秒数（需要向用户端点实际发探测），仅复核了代码里的 `PROBE_TIMEOUT_MS = 8000` 与断言存在。
7. **反向验证日志（3.10 / 4.3 的做法示例）**：去掉"绿灯要有证据"分支 → `D18` 打印出 `运行中`；去掉自动检测 → `D35` 报出只发了 GET；去掉补检测 → `D38` 报出少了最后一次 probe；把稳定重读上界放宽 5 次 → `D41` 报出 `total=14 gets=13`。
   （这些是当时的测试输出记录，不是规则；本轮未重跑。）

---

## 6. 断言台账

**唯一权威是 `node tools/verify.ts` 的输出**（当前 `PASS 243/243`）。分区看 `tools/verify.ts` 里的 `//#region`：

| 区 | 起始位置（本轮核对） | 覆盖 |
|---|---|---|
| A | `//#region A. 包清单` | 包清单 / 主题 / 尺寸 / 自适应 / 布局 / 表单结构护栏 / 导航标记几何与 SVG / 失败原因采集与探测的静态护栏 |
| B | `//#region B. 宿主半边` | 宿主行为 + 行内操作回归（headers 不丢）+ 失败原因采集 + 相位映射 + 主动探测 + 配置分层语义（B70）+ 工具名单 |
| C | `//#region C. 客户端半边` | 懒 CJS 协议、座位注册契约、导航标记的假 DOM 行为 |
| D | `//#region D. 客户端渲染` | 迷你渲染器逐状态（列表 / 编辑 / 新增 / 空 / 载入 / 错误 / 未配置 / 有失败记录 / 停用+旧记录 / 四态 / 两条错误通道） |
| D2 | `//#region D2. 挂载行为` | 会真跑 `useEffect` 的沙箱 + fetch 桩：自动检测、能力门、写入后 `recheck`、相位稳定与有界重读 |
| E | `//#region E. 共享常量 ↔ 出厂产物` | 常量唯一来源、产物与常量一致、模块 id == 包名、构建指纹同步（E10）、脚本指向存在的文件（E11） |
| F | `//#region F. 纯函数直接单测` | `statusOf` / `settling` / `failureText` / `draftOf` / `normalizeRow` / `toRecord` / guards，直接 import `src/**` |

历史条数变化（说明为什么"写死条数"是坏主意）：193（JS 版）→ 203（P3/P4 产物化）→ 241（P2+P5 加 F 区 38 条）→ **243**（tools TS 化后新增）。
上一版 AGENTS.md 长期写着"当前 193 条"，落后了 48 条。

---

## 7. 已知边界的三处措辞修正（对应 AGENTS §6）

| 旧写法 | 修正后 | 依据 |
|---|---|---|
| "`listTokens` 只列需要 light/dark 双份覆写的 alias 子集" | 精确为：**14 条**、全部 `requiresLightAndDark: true`；`button-primary-fill`、`radius-*`、`settings-card-*`、`label-tertiary` 不在表里但**真实存在**，判断以官方 CSS 用法为准 | 直接抽出 `BUILTIN_INSPECT_TOKENS` 比对（同时 `Button.module.css` 用了 `button-primary-fill`） |
| "cordis 内置日志缓冲会丢掉 warn" | 机制是**容量 1000 条的环形缓冲**（超出丢最旧），不是按级别过滤 warn | `cordis/src/logger.ts` 的 `bufferSize = 1000` + `slice(-1000)` |
| "`unaddressable` / `disabled` 已实测" | `unaddressable` 字面量确实在 plugin_manager 契约里，但**本轮没有观测到运行时返回**；`disabled` 已由源码证实是真正的挂载开关（父子联动、支持 `!!js`），但那次运行时观测（`enabled:false, fiberPhase:null`）**本轮未复现** | 见第 2 节两行；运行时观测需要 `plugin_manager`（本会话不可用） |

---

## 8. 仍未复核 / 可能过时的清单

1. **3.10 的探测秒数**（冷 1.6–3.0 s、热 ~360 ms、局域网 3–10 ms）：本轮未复测，仅确认代码常量与断言。
2. **`plugin_manager` 的运行时输出**（`readOnlyReason`、`fiberPhase`）：官方文档明确它需要审批，本会话工具集里也没有该工具，只能用契约与源码佐证。
3. **`disabled` 与 group 子条目的运行时行为**：源码可证，运行时未复现（同上）。
4. **DSH 升级后的行号**：第 2 节所有行号都会漂移，复核请按关键字符串重新定位。
5. **`dsh --profile "$DSH_PROFILE" --dump-config`**：官方文档与上游 README 都提到它，本轮未实际执行（未在会话中调用 `dsh` CLI）。
6. **上游 insert 共享对象缺陷**：来自 discussions，未在本机复现；如果哪天真遇到"插件被静默 disable"或 `duplicate loader entry id`，先回到那两条讨论。

---

## 9. 交付用的编码检查一键脚本

[AGENTS.md](../AGENTS.md) 的 4.6 引用本节。检查 `src/**`、`tools/**`、`lib/**` 里有没有 BOM、`U+FFFD`、CRLF（已验证可直接跑，输出 `encoding clean` 即通过）：

```powershell
node -e "const fs=require('fs'),p=require('path');const bad=[];const walk=d=>fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{const f=p.join(d,e.name);e.isDirectory()?walk(f):/\.(ts|tsx|js|json|md)$/.test(e.name)&&(()=>{const b=fs.readFileSync(f),t=b.toString('utf8');(b[0]===0xEF||t.includes('\uFFFD')||t.includes('\r\n'))&&bad.push(f)})()});['src','tools','lib'].forEach(walk);console.log(bad.length?'BAD: '+bad.join(', '):'encoding clean (no BOM/FFFD/CRLF)')"
```

旧版 AGENTS.md 只检查 `lib/client.js` 一个文件——那是产物且已由构建生成，检查它抓不到手写源码的问题。

---

## 10. 从 AGENTS.md 精简出去的操作细节

这些是"在 AGENTS 里占地方、但按需查一次就够"的内容，规则本身仍留在 AGENTS。

**客户端座位台账的确切调用**（AGENTS §5 只留了方法名）：

```
cordis_inspect_query(platform: client, provider: Slots, method: listSubTree,
                     input: {"root":"settings.section"})
```

**group 子条目不可单独寻址**：`plugin_manager` 对 `include:mcp-manager` 之类会报 `readOnlyReason: "unaddressable"`。这正是本插件"整体重写 group config 数组"设计的由来（子条目没有独立可寻址的写入路径）。契约侧字面量证据见第 2 节；运行时返回**本轮未复现**（本会话没有该工具）。

**导航图标不可由插件提供**：`settings.section` 的注册契约只有 `id`/`order`/`label`，图标是 `navIcon(id)` 硬编码查表 + 齿轮兜底（证据见第 2 节）。本插件靠给自己那一格打 `data-mcpm-nav` + CSS 覆盖实现（AGENTS 3.8 的例外），代价是依赖官方 DOM 结构。上游 [discussion #1229](https://github.com/deepseek-ai/deepseek-harness/discussions/1229) 正是要补上可选 `icon`。

**判据权威顺序**（AGENTS §5 的一句话展开）：① 本机**已安装**的 DSH 产物（`resources/app.asar` 内的 `lib/index.js` + `lib/types/**/*.d.ts`）——官方 skills 自己写着 *"the installed Harness is the authority"*；② 随安装附带的官方 skills 文档；③ 官方 GitHub 仓库与 discussions；④ 二手文章。**不要**用 ④ 去推翻 ①。
