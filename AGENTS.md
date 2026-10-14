# AGENTS.md —— 本仓库的 agent 工作约束

> 分级：**[硬]**（破坏数据/环境）＞**[边界]**（抄近路引入已知 bug）＞**[风格]**；同级冲突以**机检**为准（`tsconfig.*` / [eslint.config.js](eslint.config.js) / [tools/verify.ts](tools/verify.ts)）。只写"做什么、怎么自查、代价"；取证与历史事故见 [docs/agent-rules-notes.md](docs/agent-rules-notes.md)，设计与证据概览见 [README.md](README.md)（详尽版：[docs/design-notes.md](docs/design-notes.md)，章节号一一对应）。

## 0. 30 秒定位

DSH 插件：在设置界面最下方加一页「MCP」，可视化管理 `@deepseek-ai/dsh-mcp-client` 的 Loader 条目。**源码在 `src/**`；`lib/**` 是构建产物，不要直接编辑。**

- 客户端 `src/client/**` → `lib/client.js`：注册 `settings.section`（list 座位，`order: 900`）；把导航里**自己那一格**的兜底齿轮换成 MCP 标记（3.8）。
- 宿主 `src/host/**` → `lib/index.js`：零 import；`ctx.connection.fetch.register()` 开 `/api/mcp-manager`；`ctx.configEditor.edit()` 写配置。
- 数据模型：所有 MCP 服务器放在**一个** `cordis:group` 条目（id `mcp-manager`）的 config 数组里。
- 唯一必跑：`node tools/verify.ts`，期望 `PASS`（条数看输出、别抄死；命令名以 [package.json](package.json) scripts 为准）。

## 1. 硬性纪律

**1.1 [硬] 不用 PowerShell 读写 UTF-8 源文件。** 本机 `pwsh` 是 Windows PowerShell **5.1**（ANSI 码页 936）：`Get-Content -Raw` / `Set-Content` 会让中文变乱码、吃掉换行、坏字节变 `?`，**不可逆**。读用 `read` 或 `node -e "fs.readFileSync(p,'utf8')"`，写用 `write` / `edit`（自带版本护栏）。

**1.2 [硬] 改 `src/**`，不手改 `lib/**`；半边热重载不同。** `lib/**` 由 `pnpm build`（[tools/build.ts](tools/build.ts)）生成、带[指纹](lib/.build-manifest.json)，手改会被下次构建静默覆盖。改 `src/client/**` 构建后 HMR 自动热替换；改 `src/host/**` **不生效**，需重启 DSH（`hmr.root` 可纳入监听，但它是整表、补丁层 `config` 是整份替换）。因为存在"宿主已重载/未重载"两种运行态，**客户端必须同时说两代协议**（GET 返回 `capabilities`，新宿主定点操作、旧宿主退回整数组提交）——改接口时别拆掉协商。

**1.3 [硬] 不要重启 DSH。** 当前会话就跑在它里面；需要宿主侧生效时告知用户。

**1.4 [硬] 不擅自改 `~/.dsh/profiles/**`。** 首选 `plugin_manager install_bundle`，而不是手写 profile 的 `package.json` / `cordis.patch.yml`。确需手改：①备份到带时间戳 `.bak` ②只做最小行级改动（`edit`）③用真实 YAML 解析器验证 ④告知备份路径与回滚方式。**profile 原文（含明文凭据）不得粘进仓库文件**（§7）。

**1.5 [硬] 并发编辑按护栏重做。** `edit` 报 `file changed since it was read` → 重新读取、基于新内容重做；不要用整文件写入绕过护栏。

## 2. 代码与数据边界

**2.1 [边界] 宿主半边运行时零 import。** 判据是**裸模块说明符**（都在 app.asar 里，磁盘路径解析不到）；相对 import 由打包器内联、`import type` 被擦除，两者允许。→ eslint `HOST_BARE_IMPORT` + 产物断言。

**2.2 [边界] 客户端产物协议：** classic script（非 ESM），只向 `window.__ModuleLoader__.load` 注册 factory（**恰好一次**）；`id` == `package.json.name`（构建注入）；`require` 只取种子模块（当前 `react`），非基线依赖声明 `dsh.client.external`；`package.json` 必须有 `exports["./client"]` 与 `dsh.client.platform === "web"`。

**2.3 [硬] 禁止 `ctx.loader.create()/remove()`。** `Include.write()` → `writeFile(this.root.data)`，而 `_writeFile` 是 `yaml.dump(整份 config)`：**整体重写**，会压平用户手写的 `insert:` 分节。

**2.4 [硬] 数据面唯一写入点 `ctx.configEditor.edit()`。** 外科手术式 YAML 编辑：保留 `insert:`、写盘前 `composeEntries` 深比较断言、失败回滚（**断言在写盘前，失败是安全的**）。行语义（`applyEntryPatches`）：`insert:`（无 id）追加到顶层；`id: X` + `insert:` 追加进 group 条目 X 的 config；`id: X`（无 insert）**覆写** X——**整键赋值**，X 不存在则 warn 并丢弃。**覆写 `config` 是整数组替换，不是继承层**（官方 dialect：*"config is replaced wholesale, never deep-merged"*）：`insert:` 行里同 id 的 config 被整体丢弃，写在那里的 `headers`/`env` 运行时根本不存在，文件却看着"已经配好了"（源码 `cordis-plugin-include/lib/index.js:99-102`）。`edit()` 对 insert 条目会**追加顶层覆写行**；改完用 `dsh --profile "$DSH_PROFILE" --dump-config` 看真实合成。

**2.5 [边界] 行内操作走宿主定点操作，禁止回传整数组。** `setEnabled`/`remove` 只带 `{ serverName, ... }`，宿主按名字定位原地改、其余行原样回写；`save`（整数组）只给表单。回传整数组 + 逐行重建会**静默清空 `headers`/`env`**（历史事故）。

**2.6 [边界] `toRecord()` 三种形状都要认：**对象 / 字符串数组 / 「每行 KEY=VALUE」多行文本。少一种就静默丢字段。

**2.7 [边界] 不要用 `remote.settings` 读写 MCP 条目。** `dsh-settings` 的 `describe()/write()` 只暴露声明了 `.volatile()` 的字段，而 `dsh-mcp-client` 的 Config 无 volatile 字段 → 完全不可见。**已否决，勿再试。**

## 3. UI 纪律

**3.1 [边界] 绝不硬编码颜色。** 深色下 `--dsw-alias-brand-primary` = `#f9fafb`（近白），`color:#fff` 就是白底白字；十六进制只能作 `var()` fallback；主按钮用 `--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-foreground`。

**3.2 [边界] 视觉与尺寸进注入的样式表，绝不写 inline。** inline `background` 压过 `:hover`（按钮没有悬停反馈）；inline `height` 压过样式表（改档位看不到效果）。唯一例外：圆点颜色（走 token）。

**3.3 [风格] `mono` 与 `multiline` 正交。** `mono` 只换等宽字体，`multiline` 换真 `<textarea>`；混用会把 `url` 渲染成 56px 大框。

**3.4 [风格] 表单面板靠底色分层，不加描边。** 卡：`.5px solid var(--dsw-alias-settings-card-stroke)` + `var(--dsw-alias-settings-card-fill)`；面板：无描边 + `var(--dsw-alias-bg-module-platform)`。加 `border` 会叠成"卡片套卡片"。

**3.5 [风格] 自适应：**块级子项显式 `min-width:0`；长文本 `text-overflow:ellipsis`；操作区 `flex:none` 且不换行。

**3.6 [风格] 不重复叠加外壳底部留白。** 外壳内容区已有 `padding: 0 24px 24px`（官方 CSS module 里映射为 `options` 的 hash 类），再垫就成 48px。

**3.7 [风格] 尺寸基准取自官方 CSS。** 档位、每个数值的出处、"为什么第一版比官方丑"在 README 第 8 节；改尺寸先读它、改完同步它。

**3.8 [边界] 不动别人的 DOM —— 唯一例外：设置导航里我们自己那一格。** 官方 practices 禁止在组件外写 DOM、禁止往 `document.body` append。例外压到最小：`markNavCell()` 只在 label == `SECTION_LABEL` 那一格打 `data-mcpm-nav`，视觉全交给样式表，卸载时 `removeAttribute` + `disconnect`；不读别的插件的 DOM / 样式表 / 组件源码，不删换移 React 管的节点，不往 `document.body` append。必须这样是因为 `settings.section` 契约只有 `id`/`order`/`label`（**无 icon 字段**），图标由官方 `navIcon(id)` 硬编码查表、未知 id 兜底齿轮——**上游已有"带 icon"的提案，落地即改用注册参数**；代价是依赖官方 DOM 结构，结构改了静默失效（最坏仍是齿轮）。

**3.9 [边界] 一条错误只允许一个渲染点。** 错误跟着来源走：`formError` 只由表单提交失败写入、渲染在表单内部；`actionError` 只由行内操作（启停/删除/检测）失败写入、渲染在页面级。`call(payload, after, onError)` 的第三个参数就是"写进哪条通道"，**必须只写一条**。

**3.10 [边界] 状态色必须有正面证据，禁止只看 fiber 相位报绿。** `mcp-client` 默认 `failOnStartupError: false`——连接失败也不抛错（退避 10 次后放弃并注销工具），fiber 全程 `ACTIVE`："apply 跑完了" ≠ "能用"。判定顺序即优先级（[status.ts](src/client/core/status.ts) 的 `statusOf`，F 区逐分支钉住）：停用 / 无活条目 → 灰；**绿只有三条**（探测通过**且** phase `active`、phase `active` 且有记录但探不了（stdio 的 `connected: null`）、旧宿主）；**红三源**（探测失败 / logger 里 `mcp-client(...)` 原文 / phase `failed`）；`pending`/`loading` → 琥珀「启动中」；**有 `probe` 能力却一条探测记录都没有 → 「未检测」，不许退回相位报绿**。
配套：探测自带 `PROBE_TIMEOUT_MS` = **8s** 超时（按**冷连接**定，别再退回 3s）+ `AbortController`、只读首个数据块（SSE 会挂着）、网络错误取 `error.cause.message`；旧宿主没有 `probe` → 按钮禁用 + 提示重启，别让用户点出「未知操作」；打开页面自动检测一次（先 GET 拿 capability、silent 模式，不锁按钮）；**写入后必须补检测**（启停/删除/保存都算，因为清空的是全部记录）：静默探一次，探通但相位未 `active` 就重读快照到稳定，**有界 10 × 200ms，不是轮询**。

## 4. 改代码与交付流程

**4.1 先跑自检。** `node tools/verify.ts`：改动前 PASS、改动后 FAIL，才能证明是你的改动引起的。

**4.2 每修一个 bug 同时加断言。** 台账只有一处：[tools/verify.ts](tools/verify.ts) 的 `//#region` + 自检输出——**本文件不维护断言 ID**。覆盖：`A` 包清单/主题/尺寸/自适应/布局/表单结构/导航标记几何；`B` 宿主行为 + 行内操作回归 + 失败原因采集 + 相位映射 + 主动探测 + 配置分层 + 工具名单；`C` 产物协议 + 座位契约 + 导航标记 DOM（假 DOM 真跑）；`D` 真实渲染逐状态；`D2` 挂载行为（真跑 `useEffect` 的沙箱 + fetch 桩）；`E` 共享常量 ↔ 出厂产物（含构建指纹、脚本与文档里的引用一致性）；`F` 纯函数直接单测。

**4.3 新断言必须反向验证。** 注入违规 → 确认能精确报错 → 还原（用 `edit`，别用 PowerShell）。断言自己也会错，**断言也要被怀疑**。

**4.4 改了 JSX 就延长渲染测试。** `A` 区 grep 抓不到渲染期问题：动 JSX 就在 `D`/`D2` 加/改场景（如"表单确实在那张卡的子树内部"、"`url` 是 `input` 而 `headers` 是 `textarea`"）。`scene(...)` 按 `useState` 顺序发值，新增状态必须补一位。

**4.5 不要为了让断言通过而放宽断言。** 先判断是断言过严还是改动错了；改断言要说明理由，并保留原有防护意图。

**4.6 交付三件套。** ①`node tools/verify.ts` 的输出（`PASS n/n`）；②编码检查：无 BOM、无 `U+FFFD`、LF 行尾，覆盖 `src/**`、`tools/**`、`lib/**`（一键脚本见[附注第 9 节](docs/agent-rules-notes.md)）；③改了什么、**为什么**、**哪些没实测**。没有实测的必须明说——不要把推断写成结论。

## 5. 常用命令

`node tools/verify.ts` 是唯一必跑；其余按需：

- **条目状态**：本插件 Loader 行是 `include:dsh-mcp-manager` / `include:mcp-manager`；单条 schema/status 用 `cordis_inspect_query`(host `Config.listConfigs`)。
- **座位台账**：`cordis_inspect_query`(platform: client, provider: Slots, method: listSubTree, input: {"root":"settings.section"})。
- **真实合成配置**：`dsh --profile "$DSH_PROFILE" --dump-config`。
- **官方源码 / CSS / 契约**：见 [README.md](README.md) 第 9 节。源码在 `<安装目录>\resources\app.asar` 内，`read` 工具、shell、`node` 都穿不过 asar 虚拟路径，要用**只读探针**（解析 asar 头按 offset 取文件）。**判据权威**：本机安装的 DSH 源码 ＞ asar 内官方 skills（`@deepseek-ai/dsh-agent-preset/skills/`）＞ 二手资料。
- **权限**：官方明确 `plugin_manager` 每个 action（含 `list_plugins`）**需要审批**，`cordis_inspect_query` **不需要**——查证优先后者。

## 6. 已知边界（不要试图"修好"）

| 边界 | 说明 |
|---|---|
| 宿主不热重载 | 见 1.2：重启，或改 `hmr.root`（整表替换，先读出原值） |
| 覆写层不合并 `insert:` 层 | 见 2.4。DSH 分层配置的固有行为，不是 bug |
| `listTokens` 不是全表 | 只列 14 个需 light/dark 双份覆写的 alias；`button-primary-fill`、`radius-*`、`settings-card-*`、`label-tertiary` 在表外但真实存在——**判断 token 以官方 CSS 用法为准** |
| group 子条目不可寻址 | 契约里的 `readOnlyReason: "unaddressable"`；这正是"整体重写 group config 数组"的由来 |
| `disabled` 有效 | 条目**或任一父条目** disabled 即不挂载，支持 `!!js`；启停机制没问题 |
| 宿主日志基本不可看 | 只写 `crash-*.log`；cordis logger 是 1000 条环形缓冲，超出丢最旧 → 靠自检 + 渲染测试兜住。例外：本插件自己挂的 exporter 把 `mcp-client(<name>): …` 收进快照 |
| 导航图标不可由插件提供 | 见 3.8；上游提案落地即改用注册参数 |
| 导航位置由 `order` 决定 | 900 只是比官方页大，别的插件更大就排后面；标记按 label 认格，不受顺序影响 |
| 上游 `insert` 共享对象缺陷（未在本机复现） | 上游报告：补丁可能改到共享 insert 对象（插件被静默 disable）；同 id 重复 insert → `duplicate loader entry id` |

## 7. Git 与发布

- 分支 `main`；远端 `origin` → `https://github.com/qq540491950/dsh-mcp-manager.git`。提交信息中文：`feat|fix|docs: 一句话` + 空行 + 分节说明；**写进 UTF-8 文件用 `git commit -F`**（不要 `-m` 直传中文，见 1.1）。
- **推送前扫密钥**：不得含真实 token / API key；示例用 `Bearer ...` 省略写法；profile 原文（含明文凭据）一律不粘进仓库。
- `.gitattributes` 强制 LF；不要引入 CRLF，也不要依赖 `core.autocrlf`（本机为 `true`，方向相反）。
- `git push` 的 stderr 进度会被 PowerShell 记成错误并给出 `[exit code: 1]`——**假警报**，以 `git ls-remote origin refs/heads/main` 与 `git status -sb` 为准。
- 发布（见 [docs/publish-plan.md](docs/publish-plan.md)）：包名用 **`@qq540491950/dsh-mcp-manager`**（裸名被占）；`files` 白名单不含 `src/`、`tools/`、`docs/`、`AGENTS.md`；升级后宿主半边仍需重启。
