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
| 自检 | 零依赖、`node tools/verify.mjs` 是唯一必跑命令 | 不装 `node_modules` 也能跑（已实测） |

---

## 3. P6：要改的文件

### 3.1 新增 `cordis.patch.yml`

```yaml
# dsh-mcp-manager 自带的数据容器：所有 MCP 服务器都是这个 group 条目 config 数组里的一行。
# 插件自身只读/写这个条目的 config，从不增删 Loader 条目（AGENTS 2.3 / 2.4）。
- insert:
    - id: mcp-manager          # 必须等于 src/shared/constants.ts 的 GROUP_ID
      name: 'cordis:group'
      config: []
    - id: dsh-mcp-manager
      name: '@qq540491950/dsh-mcp-manager'
```

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
  "engines": { "node": ">=22.18", "dsh": "0.2.0-rc.2" },
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

### 3.6 宿主侧文案微调（可选但推荐）

`src/host/index.ts` 的 `MISSING_GROUP` 现在写的是"请先在 profile 的 cordis.patch.yml 里配置一个 cordis:group 条目"。
bundle 形态下 group 由包自带，所以真实故障变成"bundle 未正确安装，或被更高层覆写压掉了"。改成这句更有指导性。

---

## 4. P6 的自检：现有断言会挡路，按纪律处理

⚠️ 改清单会让**几条现有断言 FAIL**。按 AGENTS 4.5：先判断"是断言过严还是改动错了"，**不许为了通过而放宽**，每条改动都要在提交信息里说明理由，并做反向验证。

| 断言 | 为什么会 FAIL | 正确的改法（保持防护意图） |
|---|---|---|
| **A1** `manifest.name === 'dsh-mcp-manager'` | 改名 | 改成"包名是合法 npm 名且非空"，并**另加**一条"客户端产物 id == `package.json.name`"（E8 已有，A1 就不再硬编码名字） |
| **A2** `exports['./client'] === './lib/client.js'` | 改成条件导出形态 | 接受两种形态：字符串，或 `{ default: './lib/client.js' }`。守的意图是"`./client` 指向真实产物" |
| **A5** `clientSource.includes('id: "dsh-mcp-manager"')` | 包装里的 id 来自 `package.json.name`，改名后变 | 用 `manifest.name` 拼出期望值（不要硬编码），或直接断言"包装用双引号注入 id 且值等于包名" |

**新增 P 区断言**（发布形态的回归保护，建议 8–10 条）：

- `dsh.bundle.patch` 存在，且指向的文件真实存在；
- 该 patch 里 `insert` 的两行都在：group（`cordis:group`）与插件行，且插件行的 `name` == `package.json.name`；
- group 行的 `id` == `src/shared/constants.ts` 的 `GROUP_ID`（跨文件一致性）；
- `files` 覆盖 `lib` / `cordis.patch.yml` / `locale/*.json` / icon / README / LICENSE；
- `files` **不**包含 `src`、`tools`、`docs`（防止把源码与工具发出去）；
- `locale/en.json` 与 `locale/zh.json` 都存在且都有 `meta.title` / `meta.description`；
- `icon` 指向的文件存在且 ≤ 256 KiB；
- `private` 字段**不存在**；
- `peerDependencies` 只有 `@deepseek-ai/cordis`（防止有人顺手钉 `@deepseek-ai/dsh-*`）；
- `engines.node` 存在（自检脚本靠 Node ≥22.18 的类型擦除）。

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

### V3 真安装（本地绝对路径，不用先发布）

```
plugin_manager(action: 'install_bundle', target: 'D:\\project\\dsh-plugins\\dsh-mcp-manager')
```

**读返回值**（不是看日志）：`application` 必须是 `applied`；`warnings` 里不该有"bundle skipped"。
⚠️ 这一步会改**当前 profile**（见 §7 的待确认项）。

### V4 运行时四查

1. **宿主相位**：`plugin_manager(action: 'list_plugins', limit: 100, offset: …)` → 找 `include:dsh-mcp-manager`
   → 必须 `enabled: true`、`fiberPhase: 'active'`（`total: 202`，我们的行在 offset ≥100 那一页）。
2. **客户端座位**：`cordis_inspect_query(platform: 'client', provider: 'Slots', method: 'listSubTree', input: { root: 'settings.section' })`
   → occupants 里必须出现 `{ id: 'mcp', order: 900, active: true }`。
3. **数据面（★ 未实测假设的证伪点）**：在页面上**新增一台服务器** → 确认
   - 落盘进了 profile 的覆写行；
   - 运行时该 MCP 工具真的注册（`mcp__<name>__*`，或在页面的"工具 N 个"里看到）。
4. **回归**：停用 → 启用 → 删除 → 「检测」→「刷新」全流程。

### V5 卸载回归

`plugin_manager(action: 'remove_bundle', target: '@qq540491950/dsh-mcp-manager')`
→ 再查 V4 的 1/2：行与座位都消失、profile 回到初态。

### ★ 唯一未实测的假设

**bundle 层 `insert` 的 `mcp-manager`（`cordis:group`）行，能否被 profile 层（`configEditor` 写的）覆写行命中。**

- 机制上成立：app-boot README 明说"`cordis.patch.yml` 是你的 tweak 层，**在每一个 bundle 层之后**应用"；
  `applyEntryPatches` 对 `insert` 会先 `buildMap` 注册，同层（乃至后续层）的 `- id: X` 覆写因此能找到目标。
- 但本仓库被同类假设坑过一次（B70：把"覆写"误当"继承层"，导致线上一个请求头根本不存在）。
- **证伪点就是 V4 第 3 步**。
- **失败退路**：回到"用户在 profile 里手写 group 行"（即当前形态），在 README 里写明即可 ——
  插件本身不需要改代码（它只是按 `GROUP_ID` 找 group）。

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

---

## 7. 必须在动手前 / 发布前问用户的 4 件事

1. **npm scope 归属**：`@qq540491950/dsh-mcp-manager` 需要那个 scope 归用户（`npm whoami` + 首次 publish 才知道）。
   若不是，换 scope 或改用一个未被占用的无 scope 名。
2. **V3 会改用户的实时 profile**：装 bundle 会往 `profiles/desktop/package.json` 加依赖并选中 bundle。
   默认方案：**先在 desktop 上做（动手前备份 `package.json` + `cordis.patch.yml` 带时间戳）**；
   或者用户更愿意先建一次性 profile（那就得另起一个 DSH 实例，重一些）。
3. ⚠️ **装 bundle 之前必须先摘掉旧的路径行**：desktop profile 里现在同时有
   `- insert: [{ id: dsh-mcp-manager, name: 'file:///D:/project/dsh-plugins/dsh-mcp-manager/lib/index.js' }]`
   与手写的 `mcp-manager` group 行。装上 bundle 后会出现**同 id 的重复行**（两份 `dsh-mcp-manager`、
   两份 `mcp-manager`），最坏是两个 fiber 各自注册一次 `/api/mcp-manager`。
   正确顺序：**先备份 → 装 bundle → 再删掉 profile 里那两行 `insert`，但保留 `- id: mcp-manager` 的覆写行**
   （服务器列表就在那条覆写行里）。这一步恰好就是 §5 那个未实测假设的验证。
4. **发布前停下来让用户确认**，不要自己 `npm publish`；也不要自己 `git push`（用户明确说推才推）。

---

## 8. 建议的执行顺序（每步都是可独立交付的检查点）

1. P6 文件与字段（§3）+ 自检断言（§4）→ `pnpm check` 全绿 + `npm pack` 审查（V0/V1）
2. 备份 profile → 装本地绝对路径（V3）→ 运行时四查（V4）→ 卸载（V5）
3. 本地路径这一轮全通过后 → `npm publish --access public`
4. 从 registry 名再装一次（V3'）→ 同 V4 → 确认与本地路径行为一致
5. `git push`（用户确认后）+ GitHub Release + 在 README 写兼容矩阵（DSH 版本 × 插件版本）
