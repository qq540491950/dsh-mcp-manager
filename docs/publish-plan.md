# 发布为 DSH 插件（bundle）：P6–P8 执行手册

> 这份手册是给**下一个会话**的。P0–P5（TypeScript 化）已完成，`docs/ts-migration-plan.md` §11 有完整的执行记录。
> 本文件只讲"怎么把它变成一个别人能一键安装的插件，以及每一步怎么验证"。
>
> 已定决策不要推翻（§2）；本机环境事实与已踩过的坑在 §6，先读那节能省掉重复踩坑。

---

## 1. 目标与范围

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| **P6** | 把包改造成 bundle：`cordis.patch.yml` + `dsh.bundle.patch` + locale/icon + `files`/`engines`，并给自检加"发布形态"断言 | `pnpm check` 全绿；`npm pack` 内容审查通过 |
| **P7** | 端到端验证：本地路径安装 → 运行时四查 → 卸载回归 | 用户看到页面能用，且 §5 的未实测假设被证实/证伪 |
| **P8** | 发布：`npm publish --access public` + 从 registry 名再装一次 | `plugin_manager install_bundle @qq540491950/dsh-mcp-manager` 成功 |

**"发布为插件"的含义**：DSH **没有**中央插件市场。`pluginInventory` 只是只读投影；安装入口是
`plugin_manager install_bundle`，底层用 pnpm 向 registry 取包。所以发布 = **发布一个声明了
`dsh.bundle.patch` 的 npm 包**。装一次即完成两件事：把包装进 profile 的 `node_modules`，并把
`dsh.profile.bundles` 选上它 —— 它的 patch 层随后自动插入 Loader 行，用户**不需要再手写 `cordis.patch.yml`**。

---

## 2. 已定决策（不要推翻）

| 决策 | 结论 | 理由 |
|---|---|---|
| 包名 | `@qq540491950/dsh-mcp-manager` | 无 scope 的 `dsh-mcp-manager` 已被他人占用（npm v0.6.0，作者 Nichts0v0） |
| 运行时依赖 | **零**；`peerDependencies` 只留 `@deepseek-ai/cordis: ~4.0.4` | app-boot 按 bundle 自己的 peer 判兼容，**不满足就整个 bundle 被 skip**；钉 `@deepseek-ai/dsh-*` 会让每次 DSH 升级都失效 |
| `dsh.client.inject` | 留空 | composition 对"缺失供应方"是拒绝组合，等于给自己钉一条硬依赖 |
| 客户端 JSX | classic runtime（`jsxFactory: h`） | 产物只 `require("react")`，不必赌 `react/jsx-runtime` 在不在基座表 |
| `lib/` | 入库（含 `lib/types/**`） | 支持 `git clone` + 路径行挂载；漂移由构建指纹 E9/E10 + CI `git diff --exit-code lib/` 守 |
| 自检 | 零依赖、`node tools/verify.ts` 是唯一必跑命令 | 不装 `node_modules` 也能跑（已实测） |

---

## 3. P6：要改的文件

### 3.1 `cordis.patch.yml`：**只声明插件自己那一行**

```yaml
# dsh-mcp-manager bundle 自带的补丁层：只有插件行。
# 承载 MCP 服务器的 cordis:group 容器（id mcp-manager）**不在这里** —— 它由 profile 自己的
# 补丁层声明。理由：bundle 是插件的一部分，容器若由 bundle 声明，卸载插件 = 容器消失 =
# 里面所有 MCP 服务器一起停止加载。v0.1.0 曾经把它写在这里，v0.1.1 改掉了（自检 P2/P3）。
- insert:
    - id: dsh-mcp-manager
      name: '@qq540491950/dsh-mcp-manager'
```

**v0.1.1 起这一条是硬约束，不是风格**：本文件里出现 `id: mcp-manager` 就等于把
"用户已配置的 MCP 能不能跑"绑在"插件装没装"上。自检 P2（`insert` 列表里只有一行、不含容器 id）
与 P3（正文里也不许有容器 id，注释不算）反向验证：往本文件加一行容器行 → 立刻红。

容器行改由 profile 提供（README §5.6），所以安装说明多了一步 —— 插件自己创建不了条目
（`ctx.configEditor` 只能写覆写行、`ctx.loader.create()` 被 AGENTS 2.3 禁止）。缺容器时页面必须
给出可整行照抄的 YAML：宿主与客户端两处文案由 P11 守"内容一致"。

### 3.2 新增 `locale/en.json` 与 `locale/zh.json`

官方样例：`@deepseek-ai/dsh-client-ui-schedule/locale/*.json`（asar 内）。字段固定是 `meta.title` / `meta.description`：

```json
{ "meta": { "title": "MCP Manager", "description": "Manage MCP servers from a settings page: add, edit, enable/disable, probe connectivity, list tools." } }
```

```json
{ "meta": { "title": "MCP 服务器管理", "description": "在设置页里可视化增删改 MCP 服务器：启停、连通探测、工具名单。" } }
```

### 3.3 新增 `assets/icon.svg`（或复用 `assets/mcp-mark.svg`）

顶层 `icon` 必须是**包内相对路径**、≤256 KiB、SVG/PNG/JPEG/WebP。
注意 `assets/mcp-mark.svg` 是给 CSS mask 用的**纯笔画**标记（`stroke="currentColor"`），
当卡片图标会显得很淡 —— 建议另画一个（标记 + 圆角底色）。复用也可以，但要接受观感。

### 3.4 `package.json` 目标形态

```jsonc
{
  "name": "@qq540491950/dsh-mcp-manager",
  "version": "0.1.0",
  "description": "在 DSH 设置页可视化管理 MCP 服务器：增删改、启停、连通探测与工具名单。",
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "mcp", "settings"],
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/qq540491950/dsh-mcp-manager.git" },
  "publishConfig": { "access": "public" },
  "type": "module",
  "engines": { "node": ">=22.18", "dsh": "^0.2.0-rc.2" },
  "main": "lib/index.js",
  "types": "lib/types/host/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/host/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "icon": "./assets/icon.svg",
  "files": [
    "lib",
    "cordis.patch.yml",
    "locale/*.json",
    "assets/icon.svg",
    "README.md",
    "README.zh.md",
    "LICENSE"
  ],
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4" }
  // private 必须删掉；devDependencies / scripts / packageManager 保持不变
}
```

**`files` 白名单是刻意的**：不要把 `src/`、`tools/`、`docs/`、`.tsbuildinfo/`、`AGENTS.md` 发出去。
（官方包会额外发 `./src/*` 供源码调试；我们 v1 不发，包更小。）

### 3.5 新增 `LICENSE`（MIT）与 `README.zh.md`

`README.md` 需要新增"安装"一节，写清两件事：
1. **一键安装**：`plugin_manager install_bundle @qq540491950/dsh-mcp-manager`；
2. **宿主半边不热重载**：升级后需重启 DSH（AGENTS 1.2）。

`README.zh.md` 可以是现有 README 的整理版；包内两份并存与官方惯例一致。

### 3.6 宿主侧文案（v0.1.1 已改）

`src/host/index.ts` 的 `MISSING_GROUP` 曾经写"group 由包自带、去看 bundle 有没有装好"。容器归 profile 之后（§3.1），
这句必须换成**可执行**的指引：把要粘的那一行原样给出来。现在两半边共用同一句话——

```
找不到 group 条目「mcp-manager」（cordis:group）。它由 profile 自己的补丁层声明，不由插件自带
（这样卸载插件不会影响已配置的 MCP）：请把这一行粘进 profile 的 cordis.patch.yml ——
- insert: [{id: mcp-manager, name: 'cordis:group', config: []}]
```

写成 YAML **流式单行**是为了"整行可复制、又不会被提示区高度截断"。宿主（`GROUP_ROW` 常量）与客户端
（`section.tsx` 的缺容器分支）必须给同一行：D13 在渲染层守"点名 `cordis:group` + 指向 profile 的
`cordis.patch.yml` + 带 `insert:`"，P11 在源码层守"两半边抠出来的那一行逐字相同"。

---

## 4. P6 的自检：现有断言会挡路，按纪律处理

⚠️ 改清单会让**几条现有断言 FAIL**。按 AGENTS 4.5：先判断"是断言过严还是改动错了"，**不许为了通过而放宽**，每条改动都要在提交信息里说明理由，并做反向验证。

| 断言 | 为什么会 FAIL | 正确的改法（保持防护意图） |
|---|---|---|
| **A1** `manifest.name === 'dsh-mcp-manager'` | 改名 | 改成"包名是合法 npm 名且非空"，并**另加**一条"客户端产物 id == `package.json.name`"（E8 已有，A1 就不再硬编码名字） |
| **A2** `exports['./client'] === './lib/client.js'` | 改成条件导出形态 | 接受两种形态：字符串，或 `{ default: './lib/client.js' }`。守的意图是"`./client` 指向真实产物" |
| **A5** `clientSource.includes('id: "dsh-mcp-manager"')` | 包装里的 id 来自 `package.json.name`，改名后变 | 用 `manifest.name` 拼出期望值（不要硬编码），或直接断言"包装用双引号注入 id 且值等于包名" |

**新增 P 区断言**（发布形态的回归保护；v0.1.1 实装为 P1–P11）：

- `dsh.bundle.patch` 存在，且指向的文件真实存在（P1）；
- 该 patch 里 `insert` 列表**只有插件行**，且插件行的 `id == dsh-mcp-manager`、`name == package.json.name`（P2/P4）；
- **该 patch 里不出现容器 id `GROUP_ID`** —— `insert` 列表里没有、正文里也没有（P3）。v0.1.0 时这条是反的，
  v0.1.1 掉头是因为"容器归 profile"（§3.1）；这不是放宽，是同一条不变量的另一半；
- 缺容器时宿主与客户端给出**同一行**可照抄的 `insert` 行，并都点名 `cordis.patch.yml`（P11）；
- `files` 覆盖 `lib` / `cordis.patch.yml` / `locale/*.json` / icon / README / LICENSE（P5）；
- `files` **不**包含 `src`、`tools`、`docs`、`AGENTS.md`（P6）；
- `locale/en.json` 与 `locale/zh.json` 都存在且都有 `meta.title` / `meta.description`（P7）；
- `icon` 指向的文件存在、是包内相对路径、≤ 256 KiB、类型合法（P8）；
- `private` 字段**不存在**、`publishConfig.access == public`、`exports` 暴露 `./package.json`（P9）；
- `peerDependencies` 只有 `@deepseek-ai/cordis`，`engines.node` 存在，且 `engines.dsh` 是**范围**而非精确 pin（P10；精确 pin 在运行时升一个 rc 后会被 `evaluatePluginCompatibility` 判 incompatible，git/tarball 装完即回滚）。

每条新断言都要做**反向验证**（注入违规 → 确认精确报错 → 还原）。

---

## 5. P7：验证阶梯（从"不用装"到"真跑"）

### V0 包内容审查（不用装）

```powershell
pnpm check                              # 全绿才继续（typecheck/lint/prettier/build/verify）
npm pack                                # 产出 qq540491950-dsh-mcp-manager-0.1.0.tgz
tar -xzf qq540491950-dsh-mcp-manager-0.1.0.tgz
# 然后逐项看：
#   - 有 lib/index.js / lib/client.js / cordis.patch.yml / locale/*.json / icon / README / LICENSE
#   - 没有 src/、tools/、docs/、.tsbuildinfo、node_modules
#   - 扫密钥：不得出现 ctx7sk- / tvly- / eyJ...JWT / Bearer <长串>
```

### V1 清单契约（不用装）

`pnpm check` 里的 P 区断言即此项。

### V2 层序（不需要装，只需读配置）

```powershell
$dsh = 'D:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh --profile mcp-e2e --from-default-profile web    # 建一个一次性 profile
& $dsh --profile mcp-e2e --dump-config | Select-String -Pattern 'mcp-manager' -Context 2,8
```

看 `--dump-config` 的输出：每一行归哪个源文件、哪些 patch 层改过它。这一步**不碰实时 profile**。

⚠️ **实测（2026-10-14）：`--dump-config` 不能用在 desktop profile 上。** 直接跑会得到
`error: profile "desktop" is managed exclusively by the Electron application` —— 应用托管的 profile
被 CLI 明确拒绝。所以 V2 只能按上面那样**先建一次性 profile**（`--from-default-profile web`），
或者干脆跳过 V2、用 V4 的运行时四查代替。

### V3 真安装（本地绝对路径，不用先发布）

```
plugin_manager(action: 'install_bundle', target: 'D:\\project\\dsh-plugins\\dsh-mcp-manager')
```

**读返回值**（不是看日志）：`application` 必须是 `applied`；`warnings` 里不该有"bundle skipped"。
⚠️ 这一步会改**当前 profile**（见 §7 的待确认项）。

### V4 运行时四查

1. **宿主相位**：`plugin_manager(action: 'list_plugins', limit: 100, offset: …)` → 找 `include:dsh-mcp-manager`
   → 必须 `enabled: true`、`fiberPhase: 'active'`（条目多，我们的行在 offset ≥100 那一页；`total` 以实际输出为准，别抄死）。
   **不需要审批的替代查法**：`cordis_inspect_query(host, Config, listConfigs, { name: '@qq540491950/dsh-mcp-manager' })`
   → 应当正好 1 条，且 `name` 是**包名**而不是 `file://` 路径。
2. **客户端座位**：`cordis_inspect_query(platform: 'client', provider: 'Slots', method: 'listSubTree', input: { root: 'settings.section' })`
   → occupants 里必须出现 `{ id: 'mcp', order: 900, active: true }`，且**只有一格**（两格＝同 id 重复，见 §6）。
3. **数据面**：在页面上**新增一台服务器** → 确认
   - 落盘进了 profile 的覆写行；
   - 运行时该 MCP 工具真的注册（`mcp__<name>__*`，或在页面的"工具 N 个"里看到）。
   已有服务器也能代替新增：`cordis_inspect_query(host, Tool, listTools)` 里看得到 `mcp__<name>__*`
   就说明"group 在 → 子条目挂上 → 工具真注册"这条链是通的（2026-10-14 用 context7 验过）。
4. **回归**：停用 → 启用 → 删除 → 「检测」→「刷新」全流程。

### V5 卸载回归

`plugin_manager(action: 'remove_bundle', target: '@qq540491950/dsh-mcp-manager')`
→ 再查 V4 的 1/2：行与座位都消失。

⚠️ **卸载后 MCP 是否掉线，只取决于"容器行是谁声明的"**（2026-10-14 离线复现；`remove_bundle` 本身仍未实跑）：

- **容器归 profile**（v0.1.1 起的唯一形态，README §5.6）：卸载只拿掉插件行，容器与服务器列表都在
  profile 里 → **MCP 照常工作**，只是「设置 → MCP」那一页随插件消失。离线复现（逐字抄
  `applyEntryPatches`/`flatten`，喂真实 patch）：「卸载后」合成结果 = **1 行容器 + 3 台服务器**，
  写盘前断言也通过。
- **容器归 bundle**（v0.1.0 的形态）：group 随 bundle 一起消失，`- id: mcp-manager` 覆写行被判 not found
  整条丢弃（`cordis-plugin-include:90-94`）→ **服务器停止加载**（配置仍在文件里，装回来即恢复）。
  离线复现：WARN 出现 `patch: entry mcp-manager not found`，合成结果 **0 行**。

⚠️ **过渡期注意**：如果 profile 里已经有容器行、而装在机器上的还是 v0.1.0（它也声明容器），
两份同 id 的 insert 行会让 `configEditor` 写盘前自检取到**先出现的空 config** → 保存/启停/删除全部抛
`Configuration for "mcp-manager" is overridden by a home patch or command-line overlay`
（读取不受影响，MCP 照常运行）。离线复现：2 行 → `flatten().find().config` 是 0 台、待提交 3 台。
**就地装到 v0.1.1 即刻消失**，不需要动 profile。

⚠️ **v0.1.0 → v0.1.1 的升级不要走"先卸再装"**（源码判定式 + 离线复现；2026-10-14 本机卸载尝试即失败）：
profile 里已有容器行时，卸载 v0.1.0 会报 **`bundle-in-use`**（GUI 文案「其他配置仍在使用这个组合包的组件」）
—— `removeBundle` 在禁用 + reload 后检查"这个 bundle patch 声明过的行是否还有活着的条目"
（`dsh-plugin-manager/lib/types/index.js:640-666`，按 `row.id` + `row.name` 匹配，**不看那一行来自哪一层**），
而 v0.1.0 声明过容器行、容器现在由 profile 提供 → 永远命中 → 拒绝（profile 实测未被改动）。
正确走法是**就地装**：

```
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.1')
```

换 tag 就是换 spec（`:1778-1782` 用"依赖串变了"判定装上了哪个包），因此不会 `ambiguous-install`；
包本来就是依赖，返回 `restart-required`（`:1801`）是正常的 —— 宿主半边变了，装完重启一次 DSH。
装到 v0.1.1 后其声明只剩插件行，卸载检查恢复正常。

所以这一格要连"**服务器是否随之下线、装回后是否自动恢复**"一起验，不能只看行与座位。

### ★ 曾经唯一未实测的假设 —— **2026-10-14 已证实**（v0.1.0 的历史结论）

> v0.1.1 起容器归 profile（§3.1），"bundle 插入的 group 能否被 profile 覆写行命中"这个问题**不再存在** ——
> 但这段实测仍证明了一件有用的事：**覆写行能命中任意层插入的条目**，而这正是"容器由 profile 声明、
> 列表由覆写行承载"这个分工成立的基础。保留原文以便复核。

**bundle 层 `insert` 的 `mcp-manager`（`cordis:group`）行，能否被 profile 层（`configEditor` 写的）覆写行命中。**
→ **能。** 实测：装好 `github:…#v0.1.0` 后，删掉 profile 手写的 `cordis:group` **insert** 行（只留
`- id: mcp-manager` 覆写行），三台 `@deepseek-ai/dsh-mcp-client` 子条目仍然挂载，且
`mcp__context7__resolve-library-id` / `mcp__context7__query-docs` 出现在**活动工具注册表**里 ——
覆写行确实命中了 bundle 插入的那个空 group。**重启 DSH 后同样成立。**

- 机制：app-boot README 明说"`cordis.patch.yml` 是你的 tweak 层，**在每一个 bundle 层之后**应用"；
  `applyEntryPatches` 对 `insert` 会先 `buildMap` 注册（`cordis-plugin-include:83`），后续层的
  `- id: X` 覆写因此能找到目标。
- **失败退路（现在用不上了，留作回滚手段）**：回到"用户在 profile 里手写 group 行" ——
  插件本身不用改代码（它只是按 `GROUP_ID` 找 group）。
- **但同 id 重复这个坑是真的**（新发现，见 §6）：删旧接线之前，profile 的路径行会把 bundle 行
  **静默盖掉**（后插入者赢），现象是"装完看着毫无变化"。

---

## 6. 本机环境事实 / 已踩过的坑（省时间）

**环境**

- `pnpm` **不在 PATH**：先 `corepack enable pnpm`（本机已做过一次，重装 Node 后可能要重做），
  或用 `node "C:\Users\admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" <args>`。
- `dsh` **不在 PATH**：用 `"D:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"`。
  注意 `dsh plugin --profile X …` 是 **pnpm 的透传**（`--help` 打印的是 pnpm 的帮助）；
  **"把包装成 bundle"是 `plugin_manager` 的活，不是 CLI 的活**。
- 官方源码在 `D:\Program Files\DeepSeek Harness\resources\app.asar`：`read` 工具直读会失败，
  用探针 `node D:\project\dsh-plugins\dsh-continue\tools\asar.mjs read|grep|list <路径>`。
- **本会话运行在 desktop profile 里**：改 `lib/**` 后宿主半边**不热重载**，需要用户重启
  （AGENTS 1.3：不要自己重启 DSH）。

**坑（都是真实踩过的）**

- 用 PowerShell 写 UTF-8 文件会带 **BOM**（`Set-Content -Encoding utf8` 写 commit message，主题行混进 BOM，只能 amend）。
  **所有写操作走 `write`/`edit` 工具**；提交信息写进文件后 `git commit -F`（AGENTS 1.1 / §7）。
- esbuild 默认把非 ASCII 转义成 `\uXXXX` → 必须 `charset: 'utf8'`，否则按文案断言的自检**静默失效**。
- esbuild 会把 `8000` 打印成 `8e3`、模块级 `const` 打印成 `var`、`h(...)` 前插 `/* @__PURE__ */`：
  **断言不得耦合数字/引号/声明关键字格式**（P3/P4 已经改过 10 条）。
- 产物是生成的：改了 `src/**` 必须 `pnpm build`，否则 E10 指纹断言 FAIL（这是设计，不是 bug）。
- `http://127.0.0.1:19387/api/**` **一律 401**（auth 围栏在路由之前）：连一个不存在的路径也返回 401，
  所以**不能**用它判断路由是否存在。
- `cordis_inspect_query(Config)` 里的 `status: "absent"` 是 **Config 投影**字段（本项目不导出 `Config`），
  **不是**挂载状态。判断挂载/相位要用 `plugin_manager list_plugins` 的 `enabled` / `fiberPhase`。
- 新建 `src/**` 文件后要跑 `tsc -b --clean && tsc -b`（已写进 `typecheck` 脚本），否则删掉源文件会留下陈旧 `.d.ts`。
- **同 id 的 `insert` 行不报错，只是"后插入者赢"**（2026-10-14 实测）。`applyEntryPatches` 的顶层
  `insert` 是 `data.push(...insert)`、`buildMap` 只是 `Map.set`（`cordis-plugin-include:82-83`），
  所以 bundle 层先插入的 `dsh-mcp-manager` / `mcp-manager` 会被 profile 层后插入的同 id 行**静默盖掉**：
  按包名在 `Config.listConfigs` 里查不到、条目总数不涨、客户端座位只有一格 —— 看起来就像"没装上"。
  **判别方法**：按 `name:` 过滤查两次（一次包名、一次 `file://` 路径），或干脆删掉旧接线再看。
- **`dsh --dump-config` 对 desktop 这类应用托管的 profile 会被拒**（`profile "desktop" is managed
  exclusively by the Electron application`）→ 想用 V2 验层序只能另建一次性 profile。
- **装完 bundle 若 HMR 没生效，改一下 `cordis.patch.yml` 就能触发重建**：`dsh-hmr` 除补丁文件外还
  监听 profile 的 `package.json`（`dsh-hmr/lib/index.js:375-376`），`refresh` 会重读
  `dsh.profile.bundles` 并重新解析各 bundle 的 patch（`:358-370`，经 `readProfilePatches` →
  `loadProfileDirectory`）。本次实测：改了 `cordis.patch.yml` 立刻换了一批子条目 id（＝确实重建了）。
- **兼容性预检只认 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 peer**（`dsh-app-boot:294` 直接
  `continue` 跳过其它名字）→ 我们只留 `@deepseek-ai/cordis` 的决策**不可能**引发
  `incompatible-version`（DSH 自带 cordis 正好 4.0.4，满足 `~4.0.4`）。

---

## 7. 必须在动手前 / 发布前问用户的 4 件事

1. **npm scope 归属**：`@qq540491950/dsh-mcp-manager` 需要那个 scope 归用户（`npm whoami` + 首次 publish 才知道）。
   若不是，换 scope 或改用一个未被占用的无 scope 名。
2. **V3 会改用户的实时 profile**：装 bundle 会往 `profiles/desktop/package.json` 加依赖并选中 bundle。
   默认方案：**先在 desktop 上做（动手前备份 `package.json` + `cordis.patch.yml` 带时间戳）**；
   或者用户更愿意先建一次性 profile（那就得另起一个 DSH 实例，重一些）。
3. ⚠️ **容器行归 profile 是 v0.1.1 的硬约束**（§3.1）：profile 里必须有
   `- insert: [{id: mcp-manager, name: cordis:group, config: []}]`，而 bundle 里**不能**有同 id 行。
   历史包袱（v0.1.0，2026-10-14 实测走通的那一轮）：desktop profile 里曾有
   `- insert: [{ id: dsh-mcp-manager, name: 'file:///D:/…/lib/index.js' }]` 与手写的 `mcp-manager`
   group 行；装上**自带容器**的 bundle 后就是**同 id 的重复行**，后插入者赢（§6）—— 不报错，
   只会让你以为"没装上"。那一轮的正确顺序是"先备份 → 装 bundle → 确认 V4 → 再删那两行 insert，
   保留 `- id: mcp-manager` 覆写行"。
   **v0.1.1 之后顺序反过来**：先确保 profile 有容器行（否则页面会提示你粘），再装/卸/升级插件都不影响
   MCP；`- id: mcp-manager` 覆写行照旧保留（服务器列表就在那条里）。
   ⚠️ 过渡期唯一要小心的组合：**profile 已有容器行 + 机器上装的还是 v0.1.0**（它自带容器行）——
   保存/启停/删除会抛 `overridden by a home patch or command-line overlay`，重装到 v0.1.1 即消失。
4. **发布前停下来让用户确认**，不要自己 `npm publish`；也不要自己 `git push`（用户明确说推才推）。

---

## 8. 建议的执行顺序（每步都是可独立交付的检查点）

1. P6 文件与字段（§3）+ 自检断言（§4）→ `pnpm check` 全绿 + `npm pack` 审查（V0/V1）
2. 备份 profile → 装本地绝对路径（V3）→ 运行时四查（V4）→ 卸载（V5）
3. 本地路径这一轮全通过后 → `npm publish --access public`
4. 从 registry 名再装一次（V3'）→ 同 V4 → 确认与本地路径行为一致
5. `git push`（用户确认后）+ GitHub Release + 在 README 写兼容矩阵（DSH 版本 × 插件版本）

> 第 3 步不一定要发 npm —— 见 §9 的四条 spec 形式（git / tarball / 路径都不经过 registry）。
> **只走 GitHub 的完整可执行 runbook**（G0 前置检查 → G1 改造 → G2 本地验证 → G3 tag/Release → G4 用户安装 → G5 升级回滚 + 故障对照表）
> 见 [github-release-plan.md](github-release-plan.md)；本文仍是 P6 字段与断言的唯一出处。

---

## 9. 附：不必经过 npm 的分发路线（本轮源码复核）

> **要照着做一遍的话，用 [github-release-plan.md](github-release-plan.md)**（含顺序、命令、验收条件、故障对照表与回滚）；
> 本节只回答"为什么 GitHub 就够"，即四种 spec 形式的源码依据。

`install_bundle` 的 `target` **不是"包名字段"，而是一个 pnpm spec**。安装器先把它解析成四种形式之一——本机安装版
`@deepseek-ai/dsh-plugin-manager/lib/index.js:72-117` 的 `parseInstallSpec`——再原样交给 `pnpm add`：

| 形式 | 接受的样子 | 装前能不能判定 bundle |
|---|---|---|
| `registry` | npm 包名，可带范围（`@scope/name@1.2.3`） | ✅ 用 `pnpm view` 拿到 manifest 后判定 |
| `path` | **绝对路径**（`D:\…\x`、`file:D:\…`、`link:…`） | ✅ 直接读该目录的 `package.json` |
| `git` | `github:user/repo[#ref]`（也认 `gitlab:` / `bitbucket:` / `gist:`）、`git+https://…git`、`git@host:user/repo.git`、`https://github.com/user/repo[#ref]` | ❌ 要抓下来才知道 |
| `tarball` | 本地绝对路径的 `.tgz` / `.tar.gz`，或 `https://…/x.tgz` | ❌ 同上 |

（`https://github.com/user/repo` 走 `git`；以 `.tgz` / `.tar.gz` 结尾的 URL 一律按 `tarball` 走。）

**所以"只发在 GitHub"完全可行：**

```text
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.0')
```

装完之后的机制与 npm 路线**完全相同**：包装进 profile 的 `node_modules`、包名写进 `dsh.profile.bundles`、
`dsh.bundle.patch` 作为 overlay 层加载、`icon` / `locale` 从包目录读（`bundleManifest` + `resolveBundleDir`，`:1784-1789`）。

**四条路线的差别**（都是源码事实）

| | registry | 本地路径 | git / tarball |
|---|---|---|---|
| 装前检查 | 问注册表要版本与 peer；**不是 bundle 直接拒**（`:1638`） | 读目录 `package.json`；**不是 bundle 直接拒**（`:1587`） | 只答复"形式 + host"（`:1560-1575`），**不做 bundle 判定** |
| 失败代价 | 什么都没下载 | 什么都没发生 | **先 `pnpm add` 再判定**：不是 bundle（`:1786`）或 peer 不兼容（`:1788`）→ 抛错并**恢复 profile 清单与锁文件**（`:1790-1793`） |
| 版本 | 语义化范围 + `already-installed` 预检 | 跟着工作区变 | 钉 commit / tag（`#v0.1.0`） |
| 额外成本 | 要 npm 账号与 scope | 机器上要有这份目录 | GitHub 先跑一次 `git ls-remote` 预检（默认 5s，`git` 必须在 PATH；**其他 git 主机与 tarball 跳过**，`:968-971`） |

**GitHub 路线的硬前提**（少一条就会失败或静默失效）

1. `package.json` 声明 `dsh.bundle.patch`，且 **patch 文件与 `lib/**` 都提交进仓库** —— pnpm 拉的是仓库内容，**不会替你跑 `pnpm build`**。本仓库"`lib/` 入库"的决策（§2）正好为此服务，`.gitignore` 也没有忽略 `lib/`。
2. P6 加的 `files` 白名单决定 git 依赖实际拿到哪些文件 —— `cordis.patch.yml`、`locale/*.json`、图标都必须在里面。
3. **同一个 spec 重复安装会报 `ambiguous-install`**（`:1779-1782`：依赖没变化 → 找不到"新装的那一个"）。升级请先 `remove_bundle` 再装，或换一个 `#ref`。
4. 私有仓库需要 pnpm 自己能用的凭据：预检**特意禁用了凭据助手与交互提示**，认证失败留给 pnpm 处理（含 HTTPS→SSH 回退）。

**已实测（2026-10-14，desktop profile）**：`github:` 路线走通了 ——
`install_bundle(target:'github:qq540491950/dsh-mcp-manager#v0.1.0')` → profile 的 `dependencies`
落成 `github:…#v0.1.0` 且列入 `dsh.profile.bundles`；**不需要重启即生效**；git 依赖实际拿到的
30 个文件与自检通过的那份**逐字节一致**（`files` 白名单被严格遵守），`dsh.bundle.patch` /
`icon` / `exports["./locale/*.json"]` 都活着。包装完 `remove_bundle` 那条路还没走过。

**仍未实测**：npm 路线（`npm publish` 与按 registry 名再装一次）、Release 资产的 `.tgz` URL 安装、
`remove_bundle` 卸载回归、私有仓库。
另外 GitHub 的 `archive/refs/tags/*.tar.gz` 源码包**没有验证**——它以 `<repo>-<tag>/` 为根，不是 npm 包的 `package/` 前缀，
作发行资产用 `npm pack` 出来的 `.tgz` 更稳。
