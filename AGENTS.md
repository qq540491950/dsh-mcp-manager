# AGENTS.md —— 本仓库的 agent 工作约束

> 写给在本仓库里干活的 AI agent。
> 这里的每条规则都对应一次**真实踩过的坑**；括号里是失败现象，不是理论风险。
> 规则分三级：**硬性纪律**（违反会破坏数据或环境）＞**代码边界**（抄近路会引入已知 bug）＞**风格约定**。

---

## 0. 30 秒定位

**这是什么**：一个 DSH 插件，在设置界面最下方加一页「MCP」，可视化管理 `@deepseek-ai/dsh-mcp-client` 的 Loader 条目。

**双半结构**：

| 半边 | 文件 | 职责 |
|---|---|---|
| 客户端 | `lib/client.js` | 往 `settings.section`（list 座位，`order: 900`）注册一页。`window.__ModuleLoader__` 懒 CJS bundle。 |
| 宿主 | `lib/index.js` | 零 import。用 `ctx.connection.fetch.register()` 开 `/api/mcp-manager`；用 `ctx.configEditor.edit()` 写配置。 |

**数据模型**：所有 MCP 服务器放在**一个** `cordis:group` 条目（id `mcp-manager`）的 config 数组里。

**唯一必跑的命令**：

```powershell
node tools/verify.mjs      # 期望 PASS；当前 102 条断言
```

**详细设计/证据索引**：`README.md`（第 3 节通道选型、第 7 节实测状态、第 8 节尺寸基准、第 9 节证据出处）。

---

## 1. 硬性纪律（违反会破坏数据或环境）

### 1.1 本机 `pwsh` 是 Windows PowerShell **5.1**，禁止用它读写 UTF-8 源文件

`Get-Content -Raw` / `Set-Content` 默认走 **ANSI 码页**，对含中文的 UTF-8 文件会造成：中文变乱码、**吃掉换行导致行合并**、无法解码的字节被 `?` 替换——**不可逆**。

- ✅ 读：`read` 工具，或 `node -e "fs.readFileSync(p,'utf8')"`
- ✅ 写：`write` / `edit` 工具（自带版本护栏）
- ❌ 不要用 PowerShell 做"读改写回"的往返操作

> 事故：我用 `Get-Content -Raw` + `Set-Content` 做反向验证，把 `lib/client.js` 写成语法错误，且"还原"时写回的已是损坏内容，只能整文件重写。

### 1.2 宿主半边**不会**热重载；客户端半边会

`dsh-hmr` 只监听 DSH 安装目录 + profile 补丁文件；本插件目录不在其中，且 Node 的 ESM 按 URL 缓存模块。

- 改 `lib/client.js` → 自动热替换（按 mtime/size 发新 rev），**无需重启**
- 改 `lib/index.js` → **不生效**，需重启 DSH（或用 `hmr.root` 纳入监听，见 README 7.4）

因为存在"宿主已重载/未重载"两种运行态，**客户端必须能同时说两代协议**：GET 返回 `capabilities`，新宿主用定点操作，旧宿主退回整数组提交。改接口时不要拆掉这个协商。

### 1.3 不要重启 DSH

当前会话就运行在被重启的 DSH 里。需要宿主侧生效时，**告知用户**让他们决定，不要自己重启。

### 1.4 不要擅自改 `~/.dsh/profiles/**`

那是用户的**实时配置**。确需改动时：

1. 先备份（`Copy-Item` 到带时间戳的 `.bak`）
2. 只做**最小行级**改动（用 `edit` 工具），不要整文件重写
3. 改完用真实 YAML 解析器验证（`node_modules/yaml`）
4. 明确告知用户备份路径与回滚方式

### 1.5 文件被并发编辑时，按护栏重做，不要覆盖

用户可能同时在改这些文件。`edit` 报 `file changed since it was read` 时：**重新读取 → 基于新内容重做**，绝不要改成整文件写入来"绕过"护栏。

> 事故：本会话中 `cordis.patch.yml` 被用户并发改过多次，护栏每次都拦住了；绕过就会丢掉用户的改动。

---

## 2. 代码边界（抄近路 = 已知 bug）

### 2.1 宿主半边**零 import**

本文件由 Loader 以 `file:///...` 绝对路径加载，裸模块说明符（`@deepseek-ai/cordis` 等）都在 app.asar 里，从磁盘路径解析不到。只使用注入进来的 Service + 全局 `Request`/`Response`。

### 2.2 客户端 bundle 的协议约束

- 是 **classic script**，不是 ESM；执行时只向 `window.__ModuleLoader__` 注册 factory
- `id` **必须等于** `package.json` 的 `name`
- `require` 只能取平台种子模块（当前只用了 `react`）
- `package.json` 必须有 `exports["./client"]` 与 `dsh.client.platform === "web"`

### 2.3 禁止用 `ctx.loader.create()/remove()` 增删条目

Loader 的 `EntryTree.write()`（`dsh-app-boot` 的 `Include` 类）是 `writeFile(this.root.data)` —— **整体重写**，会把用户手写的 `insert:` 分节压平。这是不可接受的破坏性写入。

### 2.4 数据面只有一个写入点：`ctx.configEditor.edit()`

它做外科手术式 YAML 编辑：保留 `insert:` 结构、写入前用 `composeEntries` 深比较断言校验、失败回滚（断言在写盘之前，所以失败是**安全的**）。

配套的行语义（`cordis-plugin-include` 的 `applyEntryPatches`）：

| 写法 | 语义 |
|---|---|
| `- insert: [...]`（无 id） | 追加到顶层条目列表 |
| `- id: X` + `insert: [...]` | 追加进已存在的 group 条目 X 的 config |
| `- id: X`（无 insert） | **覆写**已存在条目 X；X 不存在则 warn 并丢弃 |

`configEditor.edit()` 对 insert 声明的条目会**追加一条顶层覆写行**——因为 `insert` 先被 `buildMap` 注册，后面的顶层行才认领得到它。

### 2.5 行内操作必须走**宿主侧定点操作**，禁止回传整个数组

`setEnabled` / `remove` 只带 `{ serverName, ... }`，宿主按名字定位那一行**原地改**，其余行原样回写。`save`（整数组）只留给**表单**用它那套完整字段形状提交。

> 事故：行内操作原本回传整数组，宿主用 `normalizeRow()` 逐行重建 → 快照里 `headers` 是**对象**、而 `normalizeRow` 只认"多行文本/字符串数组" → **`headers`/`env` 被静默清空**。证据：profile 的覆写行里 context7 的 `Authorization` 头消失。

### 2.6 `toRecord()` 必须同时认三种形状

对象 / 字符串数组 / 「每行 KEY=VALUE」多行文本。少认一种就会静默丢字段。

### 2.7 不要试图用 `remote.settings` 读写 MCP 条目

`@deepseek-ai/dsh-settings` 的 `describe()`/`write()` 只暴露 Config 里声明了 `.volatile()` 的字段；`@deepseek-ai/dsh-mcp-client` 的 Config 是纯 zod union、**无 volatile 字段** → MCP 条目对它完全不可见。这条已实测否决，不要再试。

---

## 3. UI 纪律

### 3.1 绝不硬编码颜色

深色主题下 `--dsw-alias-brand-primary` **近白色**，写 `color:#fff` 会白底白字（整块按钮不可见）。十六进制颜色**只允许作为 `var()` 的 fallback**。主按钮用官方的 `--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-foreground`。

### 3.2 视觉与尺寸都写进注入的样式表，**绝不写 inline**

- inline `background` 的优先级**高于** CSS 的 `:hover` → 按钮永远没有悬停反馈
- inline `height` 会压过样式表 → 改了档位也看不到效果（踩过：输入框 inline `height:36px`）

### 3.3 `mono` 与 `multiline` 是**两个正交开关**

`mono` 只换等宽字体；`multiline` 换真正的 `<textarea>`。混用会把 `url` 这种单行字段渲染成 56px 大框。

### 3.4 表单面板靠**底色**分层，不加描边

| 层 | 描边 | 底色 |
|---|---|---|
| 服务器卡 `.mcpm-rowCard` | `.5px solid settings-card-stroke` | `settings-card-fill` |
| 表单面板 `.mcpm-form` | **无** | `--dsw-alias-bg-module-platform` |

给内层面板加 `border` 会和外层卡片叠成「卡片套卡片」（被用户直接反馈"内部表单不好看"）。

### 3.5 自适应

- 每个块级子项显式 `min-width:0`（flex 子项默认 `min-width:auto`，内容一宽就撑破容器）
- 名称等长文本 `text-overflow:ellipsis`
- 操作区 `flex:none` 且**不换行**（写成 `flex-wrap:wrap` 且没锁 `flex:none`，空间一紧「删除」就被折到第二行）

### 3.6 页面不要重复叠加外壳的底部留白

设置外壳已提供 `padding: 0 24px 24px`（`.wCInkW_options`）。页面自己再垫 24px 会变成 48px。

### 3.7 尺寸基准取自官方 CSS，不要自己发明

当前档位、每个数值的出处、以及"为什么第一版比官方丑"都记在 `README.md` 第 8 节。改尺寸先读那一节，改完同步更新它。

---

## 4. 改代码的流程

### 4.1 动手前先跑自检

```powershell
node tools/verify.mjs
```

改动前是 PASS、改动后是 FAIL，才能证明是你的改动引起的。

### 4.2 每修一个 bug，**同时加断言**

这是本仓库的核心约定。断言分四区：

| 区 | 覆盖 |
|---|---|
| A | 包清单 / 主题 / 尺寸 / 自适应 / 布局 / 表单结构护栏 |
| B | 宿主半边行为 + 行内操作回归（B27–B42 专测"停用后 headers 必须仍在"） |
| C | 客户端半边协议与座位注册契约 |
| D | **真实渲染测试**：迷你渲染器递归展开函数组件，覆盖七种状态 |

### 4.3 新断言必须做**反向验证**

故意注入违规、确认断言能精确报错——**然后还原**。
（推荐用 `edit` 工具注入与还原，不要用 PowerShell 往返，见 1.1。）

> 我自己写的断言出过两次 bug：`box-sizing:border-box` 里的 `border` 被当成边框属性误报；正则未锚定行首而匹配到 `.mcpm-row--off .mcpm-name`。**断言也要被怀疑。**

### 4.4 改渲染层要延长渲染测试的场景

`A` 区的源码 grep 抓不到渲染期问题。只要动了 JSX 结构，就在 D 区加/改场景断言（如"表单确实在那张卡的子树内部"、"`url` 是 `input` 而 `headers` 是 `textarea`"）。

### 4.5 不要为了让断言通过而放宽断言

如果断言拦住了你的改动，先判断**是断言过严还是改动错了**。改断言必须说明理由，并保留原有的防护意图。

---

## 5. 交付标准

声称"做完了"之前，必须给出：

1. `node tools/verify.mjs` 的输出（`PASS n/n`）
2. 编码检查：无 BOM、无 `U+FFFD`、LF 行尾

   ```powershell
   node -e "const fs=require('fs');const b=fs.readFileSync('lib/client.js');const t=b.toString('utf8');console.log((b[0]===0xEF?'BOM!':'no-bom'),(t.includes(String.fromCharCode(0xFFFD))?'FFFD!':'clean'),'crlf='+(t.match(/\r\n/g)||[]).length)"
   ```

3. 改了什么、**为什么**、以及**哪些部分没有实测**

没有实测的部分要明说。本仓库明确区分"已实测"与"未实测"（README 7.1 / 7.2），不要把推断写成结论。

---

## 6. 常用命令

```powershell
# 自检（唯一必跑）
node tools/verify.mjs

# 看运行时条目状态（本插件相关）
#   用 plugin_manager(action: list_plugins) 找 include:dsh-mcp-manager / include:mcp-manager
#   用 cordis_inspect_query(host Config.listConfigs) 查单个条目的 schema/status

# 查客户端座位台账（确认 settings.section 里 mcp 是否 active）
#   cordis_inspect_query(platform: client, provider: Slots, method: listSubTree, input: {"root":"settings.section"})

# 取官方实现的真实 CSS / 服务契约（本插件所有基准值的来源）
#   官方源码在 app.asar 里，用 asar 探针解包后 grep；见 README 第 9 节证据索引
```

**官方源码探针**（只读，不改动安装）：`ASAR_PATH='<安装目录>\resources\app.asar' node <probe.js> find|extract '<正则>' <输出目录>`。
注意 `read` 工具直接读 asar 路径会失败（后端 BigInt 解析缺陷），必须先解包。

---

## 7. Git 约定

- 分支 `main`；远端 `origin` → `https://github.com/qq540491950/dsh-mcp-manager.git`
- 仓库命名惯例：`qq540491950/<plugin-name>`
- 提交信息用中文，结构：`feat|fix|docs: 一句话` + 空行 + 分节说明（接入点 / 数据面 / 正确性 / UI / 自检）
- 提交信息**写进 UTF-8 文件后用 `git commit -F` 传入**，不要用 `-m` 直传中文（见 1.1）
- **推送前必须扫密钥**：本仓库的文件不得包含真实 token / API key。注意 `README.md` 里有 profile 接线示例，新增示例时用 `Bearer ...` 之类的省略写法。
- `.gitattributes` 强制 LF；不要引入 CRLF（混入会产生整文件 diff）
- 沙箱下 `git push` 的 stderr 进度输出会被 PowerShell 当成错误记录并给出 `[exit code: 1]`，这是**假警报**——以 `git ls-remote origin refs/heads/main` 与 `git status -sb` 为准

---

## 8. 已知边界（不要试图"修好"）

| 边界 | 说明 |
|---|---|
| 宿主半边不热重载 | 见 1.2。要么重启，要么改 `hmr.root`（但 `root` 是整表、补丁层 `config` 是整份替换，直接写会丢掉基础 bundle 的原值——动手前先读出原值） |
| 首次保存后 `insert:` 行失效 | 顶层覆写行成为权威来源，`insert:` 行里的 config 退化为继承层。这是 DSH 分层配置的固有行为，不是 bug |
| `listTokens` 不是完整 token 表 | 它只列"需要 light/dark 双份覆写"的 alias 子集；`button-primary-fill`、`radius-*`、`settings-card-*`、`label-tertiary` 都不在表里但真实存在。**判断 token 是否存在，以官方 CSS 的用法为准** |
| group 子条目不可单独寻址 | `plugin_manager` 报 `readOnlyReason: "unaddressable"`。这正是"整体重写 group config 数组"这一设计的由来 |
| `disabled` 对 group 子条目有效 | 已实测：加 `disabled: true` 后 `enabled:false, fiberPhase:null`。启停机制没问题，别再怀疑这里 |
| 无宿主日志可看 | `%APPDATA%\@deepseek-ai\dsh-desktop\logs` 是空的，无法从外部观测宿主侧异常。所以**必须靠自检 + 渲染测试**兜住，不能靠"跑起来看看" |
