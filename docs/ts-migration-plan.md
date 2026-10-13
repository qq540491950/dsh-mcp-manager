# dsh-mcp-manager：TypeScript 化 + 插件库发布 完整方案

> 本方案的所有"官方标准"结论都来自本机 DSH 0.2.0-rc.2 的**实测**（asar 内官方源码 / 官方已发布包 / npm registry），
> 每条都给了出处。凡未实测的部分，在 §8 单列，不许当成结论用。
>
> 基线：`node tools/verify.mjs` = **PASS 193/193**（commit `f1ff882`，工作区干净）。
>
> **后续变更（2026-02 追加）**：`tools/verify.mjs` 与 `tools/build.mjs` 已改名为 `.ts`
> （零构建，Node ≥22.18 原生类型擦除直接跑；断言数 193 → 243）。本文件正文保留当时的
> 文件名与断言数，作为**当时的历史记录**；当前状态见 `docs/tools-ts.md`。

---

## 0. 结论摘要

1. **可以转 TS，但两半边必须分开处理**，因为它们对"运行时产物"的约束完全不同：
   - **宿主半边**：ESM，由 Loader 用 `file:///` 或包名加载。TS 编译即可，`import type` 换类型、**运行时零 import** 的纪律不变（类型在编译期被擦除）。
   - **客户端半边**：**classic script + 懒 CJS 工厂**，`id` 必须等于包名。TSX 可以写，但必须由构建器产出官方同形的包装，源码里不能再手写 `window.__ModuleLoader__.load`。
2. **官方构建工具是 tsdown + 仓库内私有预设 `client/tsdown.client.ts`**，该预设**没有随包发布**（asar 内不存在，`npm view` 也查不到）。第三方必须自建等价配置——产物形状可以逐字复刻（证据见 §4.2）。
3. **类型检查可以对真实 Service 做**：`@deepseek-ai/dsh-*` 与 `@deepseek-ai/cordis` **都在公共 npm 上**，dist-tag `next` = `0.2.0-rc.2`（与本机运行时一致），且都带 `lib/types/**/*.d.ts`。devDependencies 钉 `0.2.0-rc.2` 即可。
4. **"发布到插件库"与"转 TS"是两条正交的轴**。发布的最小改动是**把插件变成 bundle**（`dsh.bundle.patch`），这与语言无关；TS 化是长期可维护性投入。想尽快发布，可以先做 §7，再回头做 §3–§6。
5. **包名已被占用**：npm 上 `dsh-mcp-manager@0.6.0` 属于**另一位作者**（Nichts0v0，功能相近但实现不同）。必须改用 scope 名 `@qq540491950/dsh-mcp-manager`（未占用，且与 AGENTS §7 的仓库命名惯例一致）。
6. 本仓库最值钱的资产是 `tools/verify.mjs`（1790 行 / 193 断言，针对 `lib/*.js` 即**出厂产物**）。迁移的成败标准就是：**这 193 条断言在每一步之后仍然 PASS**，且新增的断言同样做反向验证。

---

## 1. 事实基线

### 1.1 本仓库现状

| 文件 | 行数 | 风格 | 问题 |
|---|---:|---|---|
| `lib/index.js` | 593 | 2 空格 · 单引号 · **无分号** | 纯 JS，无类型；`ctx.*` 全是隐式 any |
| `lib/client.js` | 1104 | **Tab** · **双引号** · 有分号 | 与宿主半边风格不一致；`h()` 手写 vdom |
| `tools/verify.mjs` | 1790 | 2 空格 · 单引号 · 无分号 | 唯一测试；A/C 区靠源码 grep，D 区靠手写迷你渲染器 |
| `package.json` | 21 | — | `private: true`；无 license/repository/files/engines/icon/meta/locale；**无 `dsh.bundle.patch`** |

现状安装方式是「路线 1 路径行」：profile 的 `cordis.patch.yml` 里手写
`- insert: [{ id: dsh-mcp-manager, name: 'file:///D:/.../lib/index.js' }]`，
外加一个手写的 `cordis:group` 条目 `mcp-manager` 作为数据容器。
→ **发布形态下这两件事都必须由包自己提供**，否则用户装完还是看到「找不到 group 条目」。

### 1.2 官方标准（证据）

| 结论 | 出处 |
|---|---|
| bundle = `package.json` 声明 `dsh.bundle.patch`，patch 里 `insert` 插件行 | 官方 skill `cordis-plugin-development/references/host-plugin.md` |
| 客户端包声明 `dsh.client.platform: 'web'`，导出 `./client` bundle，非基座模块写进 `dsh.client.external` | `@deepseek-ai/dsh-client-modules/README.md` §"Declaring a client plugin" |
| 浏览器产物 = 懒 CJS 工厂，`id` == 包名，`require` 只解析基座模块表 | 同上 §"Lazy-CJS model"；本仓库 `lib/client.js` 已是同形 |
| 官方产物的头尾形状（可逐字复刻） | `@deepseek-ai/dsh-client-ui-settings-models/lib/client.js` 头 7 行 / 尾 6 行 |
| 官方产物 `require("react/jsx-runtime")` 但 manifest 未声明 external → `react/jsx-runtime` 在基座表内 | 该包 `lib/client.js` + 其 `package.json` 的 `dsh.client`（只有 `inject`/`platform`） |
| 显示元数据放 `locale/en.json` / `locale/zh.json` 的 `meta.title`/`meta.description`，图标是顶层 `icon`（相对路径、≤256KiB） | `@deepseek-ai/dsh-client-ui-schedule/locale/*.json`、`host-plugin.md` |
| `dsh.manifestVersion: 1`、`engines.dsh` 是**声明式**的，安装器不强制 | `@deepseek-ai/dsh-package-manifest/README.md` |
| **profile 的 `cordis.patch.yml` 在"每一个 bundle 层之后"应用**；用户补丁"替换整个 config"而非深合并 | `@deepseek-ai/dsh-app-boot/README.md` §Profile / Known Limitations |
| **bundle 的 peer 不满足 → 整个 bundle 被 skip**（列进 `skippedBundles`） | 同上 §Admission |
| patch 层内 `insert` 先 `buildMap` 注册，同层后续 `- id: X` 覆写能命中 | `@deepseek-ai/cordis-plugin-include/lib/index.js:56-105`（本仓库 README 2.3 已记录） |
| `dsh.client.inject` 只排序激活、**不满足即拒绝组合**（"Composition rejects … missing suppliers"） | `dsh-client-modules/README.md` §Sharing modules |
| 不许 `require('@deepseek-ai/dsh-client-ui-primitives')` 等 Harness Client 包（会随版本变、抛错就白屏） | skill `references/practices.md` §UI |

### 1.3 npm 环境（实测）

- 可达。`typescript` latest = **7.0.2**，但 `typescript-eslint@8.71.2` 的 peer 是 `>=4.8.4 <6.1.0`
  → **钉 `typescript: ~5.9.3`**，不要用 7.x。
- `tsdown@0.23.1`、`vitest@5.0.4`、`prettier@3.9.10` 可用。
- `@deepseek-ai/cordis@4.0.4`、`@deepseek-ai/dsh-config-editor@0.2.0-rc.2`（tag `next`）、
  `@deepseek-ai/dsh-client-ui-slots@0.2.0-rc.2`（tag `next`）均可用，且都发布 `lib/types/index.d.ts`。
- `dsh-mcp-manager` **已被他人占用**（v0.6.0，作者 Nichts0v0）；`@qq540491950/dsh-mcp-manager` 未占用。

---

## 2. 目标形态

```
src/
  shared/
    constants.ts        # ROUTE / GROUP_ID / MCP_PACKAGE / SECTION_ID / SECTION_LABEL / 超时预算
    types.ts            # Snapshot / ServerRecord / Draft / ProbeResult / FailureRecord / Wire 类型
  host/
    index.ts            # export name / inject / apply(ctx)   —— 运行时零 import
    rows.ts             # normalizeRow / toRecord / toStringArray / locate / patchRow / declaredRows
    snapshot.ts         # liveChildren / snapshot / toolsOf
    probe.ts            # probeServer / firstChunk / shortenBody / PROBE_TIMEOUT_MS
    log-capture.ts      # failures Map + captureLog + 环形淘汰
    service-types.ts    # 本地最小接口（官方类型不足时在边界收窄，禁止 any）
  client/
    index.tsx           # 只导出 apply()；外层 __ModuleLoader__ 包装由构建注入
    section.tsx         # McpSection（页面）
    row.tsx             # ServerRow
    form.tsx            # ServerForm / Field
    core/
      status.ts         # statusOf / settling / failureText        ← 纯函数，可单测
      draft.ts          # draftOf / serverOf / serverOfExisting / pairsToText / targetOf
      api.ts            # refresh / call / recheck / supports（fetch 层）
    styles.ts           # CSS 文本（含导航标记的两行规则）
    nav-mark.ts         # findNavCell / markNavCell —— 全仓库唯一允许碰 DOM 的模块
lib/                    # 构建产物，入库（发布 files 指向它）
  index.js  client.js  types/**
cordis.patch.yml        # bundle 补丁：group 容器 + 插件行
locale/en.json  locale/zh.json
assets/icon.svg         # 顶层 icon 指向它
```

**关键收益**：`src/shared/constants.ts` 成为路由 / 组 id / 座位 id 的**唯一来源**，
A9/A10 那类"两半边字面量必须一致"的断言升级为编译期保证。

---

## 3. TypeScript 配置（把纪律变成编译期约束）

三个 project，用 project references 串起来。**分开的意义不只是组织**：

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,     // 索引访问不再假装非空（本插件到处在解 JSON）
    "exactOptionalPropertyTypes": true,   // 逼 wire 类型显式写 | undefined（见下方注意）
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,         // import type 必须显式，擦除才可靠
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

| project | include | lib | 为什么这么设 |
|---|---|---|---|
| `tsconfig.host.json` | `src/host`, `src/shared` | `["ES2022"]`，`types: []` | **没有 DOM** → 宿主半边写 `document` 直接编译失败，把 AGENTS 1.2 的"半边隔离"变成机检 |
| `tsconfig.client.json` | `src/client`, `src/shared` | `["ES2022","DOM","DOM.Iterable"]`，`jsx: "react-jsx"`，`types: []` | **没有 node types** → 客户端半边写 `process`/`fs` 编译失败 |
| `tsconfig.tools.json` | `tools/**/*.mjs` | 可选 | 让 verify.mjs 也进类型检查 |

> 注意 `exactOptionalPropertyTypes`：现在快照里是 `error: failure === undefined ? undefined : {...}`，
> 打开后必须把 wire 类型写成 `error?: FailureRecord | undefined`。**这是好事**（它精确描述了 JSON 的实际形状），
> 但要预算改动量：`src/shared/types.ts` 里每个可选字段都要显式带 `| undefined`。

类型来源：

- 宿主：`import type { Context } from '@deepseek-ai/cordis'`，
  `ctx.configEditor` / `ctx.loader` / `ctx.connection` / `ctx.logger` 用 `@deepseek-ai/dsh-config-editor@0.2.0-rc.2` 等的 `lib/types`。
- 客户端：`@deepseek-ai/dsh-client-ui-slots@0.2.0-rc.2` 的 slot 类型；`@types/react@~18.3`（官方 devDeps 就是 18.3，运行时 React 18）。
- **官方类型不够用时**（我们是"用未声明能力扩展"，很可能遇到）：在 `src/host/service-types.ts` 写本地最小接口，
  并在注释里写明"形状来自实测（附出处），不是官方声明"。**禁止 `as any` / `@ts-expect-error` 兜底**（ESLint 会拦）。

---

## 4. 代码风格：全部约束

### 4.1 格式化（唯一权威）

`.prettierrc.json`：

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "useTabs": false,
  "printWidth": 120,
  "trailingComma": "all",
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

选这套的理由：`lib/index.js` 与 `tools/verify.mjs` 已经是「2 空格 / 单引号 / 无分号」，
只有 `lib/client.js` 是 Tab + 双引号 —— 统一到多数派，diff 噪音最小。
`.editorconfig` 同步 `indent_style=space / indent_size=2 / end_of_line=lf / charset=utf-8 / insert_final_newline=true`。
`.gitattributes` 已强制 LF，保留。

### 4.2 ESLint：把踩过的坑写成规则

`eslint.config.js`（flat），要点：

```js
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['lib/**', 'node_modules/**'] },          // 产物不 lint
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',          // section 的 effect 依赖很微妙，必须机检
      'no-console': 'error',                           // 宿主只用 ctx.logger
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: '禁止注入 HTML' },
        { selector: "MemberExpression[object.name='document'][property.name='body']", message: '禁止碰 document.body（AGENTS 3.8）' },
        { selector: "MemberExpression[object.name='window'][property.name='__ModuleLoader__']", message: '包装由构建注入，源码不得手写' },
      ],
    },
  },
  // 唯一的 DOM 例外（AGENTS 3.8）：允许它用 document / MutationObserver / setAttribute
  { files: ['src/client/nav-mark.ts'], rules: { 'no-restricted-syntax': 'off', 'no-restricted-globals': 'off' } },
  // 宿主半边：运行时零 import —— 只允许 import type
  {
    files: ['src/host/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [{ group: ['*'], allowTypeImports: true }] }] },
  },
  // 客户端半边：禁止把 Harness Client 包当运行时模块 require（practices.md 明令）
  {
    files: ['src/client/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [{ group: ['@deepseek-ai/dsh-client-*'], allowTypeImports: true }] }] },
  },
)
```

分工说明（避免重复防护又留盲区）：

- **能机检的纪律**（半边隔离、禁 any、禁 DOM、禁运行时 import）→ ESLint + tsconfig。
- **只能靠文本/产物看的纪律**（硬编码颜色、CSS 里的 `var()` fallback、inline style 禁令、
  `min-width:0`、`flex:none`、座位注册契约、产物形状）→ 继续由 `tools/verify.mjs` 守（A/C 区已有）。
- **纯逻辑正确性** → vitest（见 §6）。

### 4.3 命名与结构约定

| 项 | 约定 |
|---|---|
| 文件名 | `kebab-case.ts`；React 组件文件 `kebab-case.tsx`，导出 `PascalCase` 组件 |
| CSS class | 一律 `mcpm-` 前缀（现状已遵守） |
| 常量 | `UPPER_SNAKE_CASE`，集中在 `src/shared/constants.ts` |
| 纯函数 | 放 `core/`，**不得 import react**（用 lint 的 `no-restricted-imports` 对 `core/**` 加一条） |
| DOM 访问 | 只允许 `nav-mark.ts` |
| 注释 | 保留中文、保留"为什么"；**每条实测结论必须带出处**（README 第 9 节的证据索引或 `asar:路径:行`） |
| 禁止 | `any`、`@ts-expect-error`、`enum`（用 union + `as const`）、默认导出（除官方要求的形态） |

---

## 5. 构建流水线

### 5.1 产物契约（不可协商）

| 产物 | 契约 | 谁在守 |
|---|---|---|
| `lib/index.js` | ESM；**零 import / 零 require**；`export const name` / `inject` / `function apply` | verify A8（升级为查产物）+ ESLint |
| `lib/client.js` | classic script；**唯一**一次 `window.__ModuleLoader__.load({ id: '<包名>', factory })`；无 ESM 语法；`require` 只取基座模块 | verify A5–A7 + 新增 A0x |
| `lib/types/**` | 与 `exports` 的 `types` 一致 | `publint` / `attw`（可选，发布前跑一次） |

### 5.2 客户端包装：两种实现，推荐第二种

**官方形状**（逐字取自 `@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`）：

```js
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-settings-models",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		/* …模块体… */
		exports.apply = apply;
		return module.exports;
	}
});
//# sourceMappingURL=client.js.map
```

**方案 A（tsdown banner/footer）**：`format: ['cjs']` + banner 打开包装 + footer 收尾。
缺点：包装形状依赖 bundler 的具体输出（`exports.x = …` 的写法、"use strict" 位置），升级 tsdown 可能漂移。

**方案 B（推荐：构建后包装，`tools/wrap-client.mjs`）**：
1. tsdown 把 `src/client/index.tsx` 打成中间产物 `lib/.client.cjs`（CJS、external 基座模块）；
2. 我们的脚本读它，套上固定的包装头尾，写 `lib/client.js`（并删除中间产物）；
3. 包装头里的 `id` **从 `package.json` 读**，包名只有一处来源。

方案 B 的包装文本是我们自己的常量，因此可以被 verify 逐字断言（A5/A6/A7 变成"守包装脚本"），
不会因为 bundler 升级而悄悄破约。**采用 B。**

### 5.3 `lib/` 是否入库

**入库**（保持现状），理由：现在 profile 是「路径行」挂载，用户可能直接 `git clone` 后指向 `lib/index.js`；
且 `files` 指向 `lib`，发布产物必须存在。

代价是"产物与 src 漂移"，用两道闸门兜住：

1. `pnpm build` 写 `lib/.build-manifest.json`：每个 `src/**` 文件的 sha256 + 工具链版本；
2. verify 新增 **E0 断言**：manifest 与当前 src 一致，否则 FAIL 并提示"先跑 `pnpm build`"。
   CI 里 `pnpm build && git diff --exit-code lib/`（产物可复现，不许手改产物）。

### 5.4 package.json 目标形态

```jsonc
{
  "name": "@qq540491950/dsh-mcp-manager",     // dsh-mcp-manager 已被占用（他人 v0.6.0）
  "version": "0.1.0",
  "description": "在 DSH 设置页可视化管理 MCP 服务器：增删改、启停、连通探测与工具名单。",
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "mcp", "settings"],
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/qq540491950/dsh-mcp-manager.git" },
  "publishConfig": { "access": "public" },
  "type": "module",
  "engines": { "node": ">=22", "dsh": "0.2.0-rc.2" },
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "icon": "./assets/icon.svg",
  "files": ["lib", "cordis.patch.yml", "locale/*.json", "assets/icon.svg", "README.md", "README.zh.md", "LICENSE"],
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4" },
  "packageManager": "pnpm@<钉死版本>",
  "scripts": {
    "build": "tsdown && node tools/wrap-client.mjs",
    "typecheck": "tsc -b",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "verify": "node tools/verify.mjs",
    "check": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm test && pnpm verify",
    "prepublishOnly": "pnpm check"
  }
}
```

**两个刻意的决定：**

- `dsh.client.inject` **留空**。官方页面会写 `inject: ['@deepseek-ai/dsh-client-ui-settings']`，
  但 client-modules 对"缺失供应方"是**拒绝组合**，等于给自己钉死一条对官方包的硬依赖；
  我们本来就用 `ctx.slots.inject`（容忍晚声明），不需要它。**少一条 inject = 少一类 DSH 升级即挂。**
- `peerDependencies` **只留 cordis**。app-boot 会按 bundle 自己的 peer 做兼容判定，
  不满足就**整个 bundle 被 skip**。钉死 `@deepseek-ai/dsh-*@0.2.0-rc.2` 会让每次 DSH 升级都失效。
  所有 Service 一律走 `ctx.inject` + 快照 `capabilities` 能力协商（这套机制仓库里已经写好并有 B56–B69 守住）。

---

## 6. 自检体系改造（本仓库的核心资产）

现状 193 条断言全部针对 `lib/*.js` —— **这正是迁移的正确姿势**：断言守"出厂产物"，
而不是守源码字面量。迁移后分五层：

| 层 | 工具 | 覆盖 | 目标 | 现状 |
|---|---|---|---|---|
| 产物契约 | `tools/verify.mjs`（保留） | 包清单、产物形状、CSS/尺寸护栏、座位注册、DOM 例外、E0 构建指纹 | `lib/**` + `package.json` | 193 条，已有 |
| 类型 | `tsc -b` | 两半边 Service 用法、共享类型、半边隔离 | `src/**` | 新增 |
| 风格 | eslint + prettier | §4.2 能机检的纪律 | `src/**` | 新增 |
| 纯逻辑 | vitest | `statusOf` 全分支、`toRecord` 三形状、`normalizeRow` 校验、`settling`、probe 解析 | `src/**` | **新增（价值最高）** |
| 渲染/交互 | vitest + jsdom + `@testing-library/react` | 四态、两条错误通道、自动检测、`recheck` 有界重读 | `src/**` | 部分由 D 区覆盖 |
| 端到端 | 手工脚本 + `plugin_manager` | 安装 → 配置 → 落盘 → 生效 | 真实 profile | 新增 |

**为什么"纯逻辑层"价值最高**：现在 `statusOf` / `toRecord` / `normalizeRow` 都埋在闭包里
（`apply()` 与 factory 内部），193 条断言里只能通过"字符串包含"或"渲染出某个文案"间接覆盖。
抽到 `src/client/core/*.ts` / `src/host/*.ts` 之后，可以直接 import 做表驱动单测——
例如 `statusOf` 的 8 条分支（已停用/检测通过/检测失败/日志失败/加载失败/启动中/未检测/未启动）
可以一次列全，而不用构造 8 个渲染夹具。

**断言重定向规则**（迁移时必须遵守）：

1. `clientSource.includes('…')` 这类"源码字面量"断言 → 改为断言**产物里的实际文本**（本就是产物，无需改）；
2. A9/A10"两半边字面量一致" → 升级为"两半边都从 `src/shared/constants.ts` 取值" + "产物里出现该值"；
3. A5（`id: "dsh-mcp-manager"`）→ 升级为"`id` 由 `package.json.name` 注入"，断言两者相等；
4. 新增 A0x：产物里 `window.__ModuleLoader__.load` 恰好一次；`lib/index.js` 零 `import`/`require`；
5. 新增 E0：`lib/.build-manifest.json` 与 `src/**` 指纹一致。

**纪律不变**：每修一个 bug 同时加断言；新断言必须反向验证（注入违规→确认精确报错→还原）；
不许为了让断言通过而放宽断言。`tools/verify.mjs` 继续是**唯一必跑命令**。

---

## 7. 分阶段迁移路线

每个阶段都要求：`node tools/verify.mjs` 仍然 **PASS**（条数只增不减），工作区无 CRLF/无 BOM。

| 阶段 | 内容 | 产出 | 验收 |
|---|---|---|---|
| **P0 冻结基线** | 记录 `f1ff882` + `PASS 193/193`；备份 `lib/*.js` 到 `tools/baseline/`（供产物行为对照） | — | verify PASS |
| **P1 脚手架** | pnpm、`tsconfig.*`、eslint、prettier、editorconfig、CI、`packageManager`；`lib/*.js` **一行不动** | 配置 | verify 仍 193 PASS；`pnpm lint` 对现有 JS 不报错（或 `ignores` 掉） |
| **P2 抽共享常量与纯函数（先 JS→JS，再逐文件 TS）** | `src/shared/*`、`src/host/rows.ts`、`src/client/core/*.ts`；只做"移动 + 加类型"，行为零变化 | src + 构建产物 | verify PASS + 新增 vitest 单测全绿 |
| **P3 宿主半边 TS 化** | `src/host/index.ts` + 官方类型 + `service-types.ts` 边界收窄；构建出 `lib/index.js` | 产物 | verify A8 升级为"产物零 import"仍 PASS；B 区行为断言全绿 |
| **P4 客户端半边 TSX 化** | `src/client/*.tsx`；包装交给 `tools/wrap-client.mjs` | 产物 | A5–A7 + C 区 + D 区全绿；产物与官方形状逐字对照（一次人工核对） |
| **P5 测试升级** | vitest 单测（core）+ jsdom/RTL 组件测试；D 区手写渲染器保留为兜底 | tests | 新增断言做反向验证；verify 条数上升 |
| **P6 打包成 bundle** | `cordis.patch.yml`、locale、icon、`files`、`exports`、`engines`、`license`、README.zh、LICENSE；`MISSING_GROUP` 文案改为"bundle 未正确安装/被更高层覆写" | 可发布包 | `npm pack` 内容审查 + verify 新增包清单断言 |
| **P7 端到端安装验证** | 一次性 profile 上装 bundle，跑全流程（见下） | 验证记录 | 全部通过才允许发布 |
| **P8 发布与维护** | `npm publish --access public`、GitHub Release、CHANGELOG、兼容矩阵 | 发布 | `plugin_manager install_bundle` 从 registry 安装成功 |

### 7.1 `cordis.patch.yml`（P6 的核心）

```yaml
# dsh-mcp-manager 自带的数据容器：所有 MCP 服务器都是这个 group 条目 config 数组里的一行。
# 插件自身只读/写这个条目的 config，从不增删 Loader 条目（见 AGENTS 2.3 / 2.4）。
- insert:
    - id: mcp-manager
      name: 'cordis:group'
      config: []
    - id: dsh-mcp-manager
      name: '@qq540491950/dsh-mcp-manager'
```

`config: []` 是刻意留空：页面显示「还没有配置任何 MCP 服务器」，用户点「新增」即可。
安装后 profile 层的覆写行（`configEditor.edit()` 写的）**应当**能命中 bundle 层 insert 进来的这行
（机制：层按序拼接、insert 先 `buildMap`、profile 层在最后）——**这一点必须在 P7 实测**（§8 风险 3）。

### 7.2 P7 端到端验收清单（发布硬门槛）

在**一次性 profile** 上做（`dsh --profile mcp-e2e --from-default-profile web`，绝不碰用户现有 profile）：

1. `plugin_manager install_bundle <本地绝对路径>` → 读返回的 `application`（必须是 `applied`）与 `warnings`；
2. `dsh --profile mcp-e2e --dump-config` → 确认 `mcp-manager`（group）与 `dsh-mcp-manager` 两行都在、层序正确；
3. 页面「新增」一台服务器 → 确认落盘后**覆写行命中了 bundle 插入的 group 行**，且运行时该 MCP 工具真的注册（`mcp__<name>__*`）；
4. 停用 → 启用 → 删除 → 「检测」→「刷新」全流程；确认「写入后补检测」（D38–D41）在真实环境仍成立；
5. `npm pack` 后解包扫描：**包内不得含任何真实 token / API key**（AGENTS §7）；
6. 卸载 bundle → 确认 profile 回到初始态（无残留行、页面入口消失）。

---

## 8. 风险与未实测项（诚实清单）

| # | 风险 | 现状 | 对策 |
|---|---|---|---|
| 1 | **官方 `clientBundle` 预设未发布** | `client/tsdown.client.ts` 只在 DSH 源码仓库里；asar 内不存在，npm 也查不到 | 自建 `tools/wrap-client.mjs`（§5.2 方案 B），包装文本由我们掌控并被断言 |
| 2 | **`react/jsx-runtime` 是否在基座种子表** | 由"官方 manifest 未声明 external + 官方产物 require 了它"**反推**为是，未直接读到 `PLATFORM_MODULES` 定义 | **P1 已决定绕开**：客户端改用 **classic JSX runtime**（`jsx: "react"` + `jsxFactory: "h"`），JSX 编译成我们本来就在用的 `h()` 调用，运行时只 require `react`（确定在基座表里）。风险归零，见 §11 |
| 3 | **bundle 层 insert 的 group 行能否被 profile 层覆写命中** | 机制上成立（app-boot 明说 profile patch 在 bundle 层之后；include 的 insert 先 buildMap），**未实测** | P7 步骤 3 是唯一证伪点；若失败，退路是"仍要求用户在 profile 里 insert group 行"（即现状），文档写明 |
| 4 | **DSH 0.2.0-rc.2 是 rc，API 可能变** | `engines.dsh` 只是声明，安装器不强制；唯一的真护栏是能力协商 | 保持 capabilities 协商 + `ctx.inject` 可选服务；README 写兼容矩阵；宿主半边不热重载要明确告知需重启 |
| 5 | **`lib/` 入库带来产物漂移** | 现状就是入库 | E0 指纹断言 + CI `git diff --exit-code lib/` |
| 6 | **`ctx.connection.fetch.register()` 属"非 Remote"路径** | README 第 3 节已论证它是公开扩展点 | DSH 大版本升级时重测；快照 capabilities 里加一条能力位以便未来切换 |
| 7 | **TypeScript 版本陷阱** | npm latest = 7.0.2，但 typescript-eslint peer `<6.1.0` | 钉 `typescript: ~5.9.3`；升 TS 前先确认 lint 生态 |
| 8 | **包名冲突** | `dsh-mcp-manager` 已被他人占用（v0.6.0，功能相近） | 用 `@qq540491950/dsh-mcp-manager`；README 里明确差异（我们走 bundle 一键安装 + 真 Loader 行 + 探测证据 + 工具名单） |
| 9 | **D 区手写渲染器 vs 官方 `dsh-client-test-runtime`** | 官方测试运行时**未随包发布**（asar 内无 README，devDep only） | 用 vitest + jsdom + RTL（自己装 devDeps），D 区保留兜底 |

---

## 9. 顺序建议与待决策点

### 9.1 两条路，按你的优先级选

- **想尽快发布**：P0 → P1 → **P6 → P7 → P8**（不改语言，先把 bundle 形态做对并端到端验证）。
  发布能力与语言无关，这一步收益最大、风险最低。
- **想长期可维护**：P0 → P1 → **P2 → P5**（抽纯函数 + vitest）→ P3 → P4 → P6 → P7 → P8。
  P2 是全案性价比最高的一步：它把 193 条"字符串/渲染"断言里最脆弱的部分换成可 import 的单测。

两条路都**不要跳过 P7**。

### 9.2 决策点（状态见 §11）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | **包名** | **`@qq540491950/dsh-mcp-manager`**（2026-10 定）。`dsh-mcp-manager` 已被他人占用（npm v0.6.0，作者 Nichts0v0，功能相近但走 JSON 文件存储、无 bundle patch），不能再用；scope 名与 AGENTS §7 的仓库命名惯例一致。 |
| 2 | `lib/` 入库 | **保持入库**（支持 git clone + 路径行挂载）。配套护栏：构建指纹 E9/E10 + CI `git diff --exit-code lib/`。 |
| 3 | 客户端写法 | **classic JSX runtime**（`jsxFactory: 'h'`）：产物只 require `react`，不必赌 `react/jsx-runtime` 在不在基座种子表。§8 风险 2 因此消除。 |
| 4 | 测试栈 | **不引入 vitest**：纯函数单测放进 `tools/verify.mjs` 的 F 区，直接 import TypeScript 源码。守住"自检零依赖、不装 node_modules 也能跑"。 |
| 5 | 先做哪条路 | **先 TS 化**（P2–P5），发布向的 P6–P8 **暂缓**（2026-10 明确）。 |

> **P6–P8 未开工**，且有一个必须先证伪的假设：bundle 层 `insert` 的 group 行能否被
> profile 层的覆写行命中（机制上成立，但本仓库被同类假设坑过 —— 见 B70）。
> 开工时按 §7 走，硬门槛是 P7 的端到端安装验证。

---

## 10. 证据索引（怎么自己复核）

官方源码都在 `D:\Program Files\DeepSeek Harness\resources\app.asar` 里，用只读探针读
（`node tools/asar.mjs read <asar 内路径>`，探针可从 `dsh-continue/tools/asar.mjs` 复制）：

| 要复核的结论 | asar 内路径 |
|---|---|
| 官方插件开发规范（Host / UI / practices / verification / MCP bundle / 模板） | `dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/**` |
| 客户端模块系统契约（基座表、external、懒 CJS） | `dsh/node_modules/@deepseek-ai/dsh-client-modules/README.md` |
| 官方客户端产物形状 | `dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js` |
| manifest 字段语义（`manifestVersion`/`engines.dsh`/bundle patch） | `dsh/node_modules/@deepseek-ai/dsh-package-manifest/README.md` |
| 层序与 bundle 兼容性判定 | `dsh/node_modules/@deepseek-ai/dsh-app-boot/README.md` |
| patch 语义（insert / 覆写 = 整键赋值） | `dsh/node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js:56-105` |
| locale 元数据样例 | `dsh/node_modules/@deepseek-ai/dsh-client-ui-schedule/locale/{en,zh}.json` |
| 官方 bundle 清单样例（第三方，带 patch + engines） | `~/.dsh/profiles/desktop/node_modules/dsh-web-search-tavily/package.json` |

---

## 11. 执行记录（逐阶段回填）

### P1 工程脚手架 —— 已完成

**产出**

| 文件 | 作用 |
|---|---|
| `package.json` | 加 `devDependencies` / `scripts` / `engines.node >= 22.18` / `packageManager`；`main`/`exports`/`dsh` 一字未动 |
| `tsconfig.base.json` | 共享编译选项（strict 全家桶 + `verbatimModuleSyntax`） |
| `tsconfig.host.json` | 宿主半边编译单元：`lib: ["ES2022"]`（**没有 DOM**）、`types: []`；产出 `lib/types/**` |
| `tsconfig.json` | solution 文件，`references` 目前只有宿主半边（客户端 project 在 P4 接入） |
| `eslint.config.js` | flat config；把半边隔离、禁 any、禁 DOM、禁运行时 import 写成规则 |
| `.prettierrc.json` / `.editorconfig` | 2 空格 / 单引号 / 无分号 / LF（统一到 `lib/index.js` 与 `tools/verify.mjs` 的多数派） |
| `.github/workflows/ci.yml` | **先跑零依赖自检，再装依赖**；然后 `pnpm check` |
| `src/shared/constants.ts` | 两半边共享常量的唯一来源（ROUTE / GROUP_ID / MCP_PACKAGE / SECTION_ID / SECTION_LABEL） |
| `tools/verify.mjs` E 区 | 8 条新断言（E1–E8）：常量非空 + 产物与常量一致 + 模块 id == `package.json.name` |

**自检**：`PASS 201/201`（193 → 201）。E 区做过反向验证：把 `ROUTE` 改成错值、把 `SECTION_LABEL` 写成空串，
E1/E2/E3/E7 精确报错且**没有连带误报**（E6 保持绿），随后还原。

**执行中的决定（与 §3–§9 原文的差异，以这里为准）**

1. **构建器用 esbuild，不用 tsdown。** 理由：我们要自己掌控客户端包装（§5.2 方案 B），esbuild 更小、输出更可预测；
   tsdown 的价值主要在官方那套未发布的预设上。`esbuild@0.28.2`。
2. **不引入 vitest。** 测试继续留在 `tools/verify.mjs`：Node ≥22.18 默认开启类型擦除，自检脚本可以
   **直接 import `src/**/*.ts`**（P1 的 E 区已经在用）。于是"克隆下来不装依赖就能自检"这条性质保住了。
   纯函数单测将在 P3/P4 抽出来之后加进 verify 的 F 区，而不是另起一套测试栈。
3. **客户端 JSX 用 classic runtime**（`jsx: "react"` + `jsxFactory: "h"`）：JSX 编译成现成的 `h()` 调用，
   运行时只 require `react`（确定在基座表里）。§8 风险 2 因此**归零**，代价是产物里多一层 `h(...)`。
4. **P2 与 P3/P4 调序**：先做"机械搬迁 + 类型化"（P3/P4），再做"抽纯函数 + 单测"（P2）。
   理由：抽函数要在已类型化的代码上做才安全，而搬迁本身不改变行为、可以单独用 193 条断言验一遍。
5. **不执行任何依赖脚本**：`pnpm-workspace.yaml` 里 `allowBuilds: esbuild: false`（实测 esbuild 不跑脚本也能用，
   平台二进制走 optionalDependencies）。
6. `lib/types/**` 由 `tsc -b` 生成并**入库**（与 `lib/` 入库一致）；`*.tsbuildinfo` 已 gitignore。
7. 本机 `pnpm` 不在 PATH 上，用 `corepack enable pnpm` 装出 shim（CI 里本来就有这一步）。

**尚未做**：`tools/build.mjs`（esbuild 打包 + 客户端包装）、`src/host`、`src/client`。
在 P3 之前，`lib/index.js` 与 `lib/client.js` 仍是手写的那两份，E 区只是先把"唯一来源"钉住。

### P3 宿主半边 TS 化 + 构建流水线 —— 已完成

**产出**

| 文件 | 说明 |
|---|---|
| `src/host/index.ts` | 由 `lib/index.js` **机械搬迁**（`git mv`，注释一行未丢）后再逐处补类型；行为不变 |
| `src/host/service-types.ts` | 宿主用到的 Service **最小接口**（实测契约，不是官方声明的复刻） |
| `src/shared/types.ts` | 两半边共享的协议类型：`Snapshot` / `ServerSnapshot` / `FiberPhase` / `FailureRecord` / `ProbeRecord` / `ToolRecord` / `ServerConfig` |
| `tools/build.mjs` | esbuild 打包宿主半边 → 单文件 `lib/index.js`；写构建指纹 `lib/.build-manifest.json` |
| `lib/index.js` | **从手写改为生成**（产物入库；指纹保证与 src 同步） |
| `lib/types/**` | `tsc -b` 产出（`tsconfig.host.json` 是 composite + emitDeclarationOnly） |
| `tools/verify.mjs` | 新增 E9/E10（构建指纹）；改造 8 条"耦合实现写法"的断言 |

**执行中的决定**

1. **构建器 esbuild `bundle: true`**：宿主半边必须"运行时零 import"，而 tsc 会留下
   `import '../shared/constants.js'`；只有打包才能把相对模块内联成单文件。
2. **`charset: 'utf8'` 是必须的**：esbuild 默认把非 ASCII 转义成 `\uXXXX`，
   产物里全是中文错误文案 —— 转义后所有"按文案断言"的自检静默失效（第一次构建就踩到了）。
3. **`tsconfig.host.json` 的 `types` 从 `[]` 改为 `["node"]`**：这一半就跑在 Node 里，
   `fetch`/`Response`/`setTimeout` 本来就该有类型。真正的半边隔离是**没有 DOM**（`lib: ["ES2022"]`），
   不是"没有 node 全局"。
4. **不可信输入一律 `unknown` + 类型守卫**：`isRecord` / `asRecord` / `asText` / `readString`，
   不用 `as` 糊过去。收益是 lint 的 `no-unsafe-*` 全绿，而且代码里"哪些值可信"一目了然。
5. **断言改造原则：不得耦合构建器的输出格式。** 产物是生成的，`'x'` vs `"x"`、
   `8000` vs `8e3` 都会随构建器变。改动如下（每条都做了反向验证）：

   | 断言 | 原来 | 现在 | 理由 |
   |---|---|---|---|
   | A8 | 产物无 `import` | 产物无 `import` **且无 `require`** | 升级：打包没内联时 require 也会漏 |
   | A9/A10 | 宿主用单引号 | 单双引号都认 | 守的是"同一个协议值"，不是引号风格 |
   | A21 | `case 'save'` | `case ["']save["']` | 同上 |
   | A22 | 正则匹配 `typeof value === 'object' && !Array.isArray(value)` | 结构存在性（`toRecord` 里仍有对象分支） | 那是**实现写法**；行为由 B18/B29/B34/B39/B40 守 |
   | A24 | capabilities 单引号字面量 | 正则（单双引号都认） | 同上 |
   | A24d | `PROBE_TIMEOUT_MS = \d+` | `[\d.eE+]+` | esbuild 把 8000 打印成 `8e3` |
   | A24e | 相位表字面量 | 解析数组内容与顺序后比对 | 同上 |
   | A24f | `Number(/(\d+)/)` | `Number(/([\d.eE+]+)/)` | 不修就会得到 `8`，把 B69 的夹具一起带偏 |

6. **新增 E9/E10 构建指纹**：`lib/.build-manifest.json` 记录产物自身的 sha256 + 每个输入的 sha256；
   自检逐项复核。这是"产物入库"这个选择的配套护栏 —— 没有它，"改了 src 忘了 build" 会静默通过。

**行为差异（诚实清单，全部是畸形输入下的改进）**

- `liveChildren()`：既没有 `serverName` 也没有 `id` 的畸形条目**跳过**（旧写法会以 `undefined` 为 Map 键，
  永远不会被查中，效果等价）。
- `asText()`：`serverName: {}` 这类畸形值按"没填"处理，错误信息是"serverName "" 非法"，
  而不是把对象变成 `"[object Object]"` 当成名字（数字仍按原样读，`serverName: 123` → `"123"`）。
- `response.ok !== true` → `!response.ok`（类型已知是 boolean，等价）。
- 探测超时回调从箭头简写改成块体（`no-confusing-void-expression`），等价。

**自检与反向验证**

- `pnpm check` 全绿（tsc -b / eslint / prettier --check / build / verify），`node tools/verify.mjs` → **PASS 203/203**。
  B 区（宿主行为，含写入、启停、删除、探测、日志采集、工具名单共 40+ 条）全部通过 ——
  这是"搬迁没有改坏行为"的主要证据。
- **断言反向验证（变异矩阵）**：对 9 条被改写的断言各注入一个变异（产物里塞 import、路由改错、
  组 id 改错、删 `save` 分支、`toRecord` 不再认对象、capabilities 少一项、预算退回 3s、
  相位表顺序错、探测丢 `AbortController`），逐条确认**只打中它该打中的那一条**，基线 9 条全绿。
- **E10 真管线注入**：在 `src/host/index.ts` 加一行注释但不重新构建 → `FAIL 1/203`，
  唯一失败项就是 E10，且直接点名 `src/host/index.ts` 与"先跑 pnpm build"。
- **ESLint 宿主零 import 规则双向验证**：注入 `import { readFile } from 'node:fs/promises'` → 精确报错；
  换成 `import type { Stats } from 'node:fs'` → 该规则**不报**（只剩 `no-unused-vars`）。
  规则本身也踩过一次坑：最初的写法用 `patterns: ['**', '!./**', '!../**']`，
  实测**把相对 import 也拦了**（eslint 的 minimatch 否定式不如预期），改成
  `ImportDeclaration[source.value=/^[^./]/]:not([importKind='type'])]` 选择器后语义才对。

**尚未做**：`src/client`（P4：TSX 化 + 包装脚本）、纯函数抽取与单测（P2）、`lib/client.js` 仍是手写。

### P4 客户端半边 TSX 化 + 产物包装 —— 已完成

**产出**（`lib/client.js` 从手写 1104 行变成产物；源码拆成 10 个各管一件事的文件）

| 文件 | 职责 |
|---|---|
| `src/client/index.ts` | 插件体：`apply()` 只导出这个；**`window.__ModuleLoader__.load` 由构建注入** |
| `src/client/react.ts` | 平台依赖的**唯一入口**：`h` / `Fragment` / 三个 hook |
| `src/client/core/status.ts` | 状态机（纯函数，P2 的成果） |
| `src/client/core/draft.ts` | 记录 ↔ 草稿 ↔ 载荷（纯函数，P2 的成果） |
| `src/client/core/api.ts` | 路由 / 超时预算 / 请求整理（不碰 React） |
| `src/client/styles.ts` | 样式表 + MCP 标记 + `ensureStyles` |
| `src/client/nav-mark.ts` | 全仓库唯一允许碰 DOM 的模块 |
| `src/client/form.tsx` / `row.tsx` / `section.tsx` | 表单 / 一行摘要 / 整页 |
| `src/client/service-types.ts` | 客户端 Service 最小接口 |
| `src/shared/guards.ts` | 不可信输入的收窄守卫（两半边共用，宿主改为引用它） |

**执行中的决定**

1. **classic JSX runtime**（`jsxFactory: 'h'` + `jsxFragment: 'Fragment'`，esbuild 的选项名是
   `jsxFragment`，tsc 那边叫 `jsxFragmentFactory`）：JSX 编译成 `h(...)`，产物**只 require `react`**。
   §8 风险 2（"jsx-runtime 在不在基座种子表里"）就此消失。
2. **`react.ts` 作为平台依赖唯一入口**：打包器会为每个"值 import 了 react"的模块各发一次
   `require("react")`（第一次构建就出现了 3 次）。收敛到一处后产物里只有一次 ——
   "我们到底从平台拿了什么"一眼可见。
3. **`Symbol.toStringTag` 在模块体之后设置**：esbuild 的 CJS 输出会把 `module.exports`
   整个换掉（`__toCommonJS`），按官方产物那样写在前面会丢在旧对象上。
4. **包装文本是我们自己的常量**（`wrapClient()`），因此可以被断言逐字钉住；
   `id` 从 `package.json.name` 注入，包名只有一处来源。

**断言改造（产物由打包器生成，断言不得耦合其输出格式）**

| 断言 | 原来 | 现在 | 为什么 |
|---|---|---|---|
| A14 | 锚点 `const header = h(` | 锚点 `\b(?:const\|var\|let) header =`，并**显式断言锚点找到了** | JSX 不再有 `h(` 字面写法；`const` 可能被打印成 `var`。原来的 `indexOf` 返回 -1 会切出空白，让断言变成摆设 |
| A25 | `flat.args = config.args.join` | `flat\.args = [^\n]*\.join\(` | 实现改成"先 map 成字符串再 join"，写法变了但语义（拼成换行文本）不变 |
| A28 | `multiline\s*\?\s*h\("textarea"` | `h\(\s*"textarea"` | 打包器在 `h(...)` 前插 `/* @__PURE__ */` |
| A38 | `const MCP_MARK_DATA_URI = …` | `(?:const\|var\|let) …` | 模块级 `const` 被打印成 `var` |

**行为差异（诚实清单）**

- `serverOfExisting` 的 `args`：先 `asText` 成字符串再 `join`（`args: ['a', {}]` 不再产出 `"[object Object]"`）。
- `targetOf` / `draftOf` / `pairsToText`：一律用 `asText`，对象/数组按"没写"处理。
- `row.tsx` 的工具名先 `asText`：React 的 child/key 需要 string。
- `ServerSnapshot.disabled` / `ToolRecord.truncated` / `Snapshot.configured` 改为**可选**：
  客户端读的是 JSON，`=== true` / `!== false` 这类防御式写法是刻意的，字段可选才让它们有意义。
- `servers` 用 `useMemo` 稳住（`react-hooks/exhaustive-deps` 指出 `?? []` 每轮都换新数组）；
  自动检测的 `cancelled` 改成可变对象属性（`let` 会被 TS 窄化成字面量 `false`）。
- `nav-mark`：`document.body` 与 `MutationObserver` 改从"运行时事实"读（cast / `globalThis`）——
  lib.dom 说它们一定在，实际不一定，而直接写 `typeof MutationObserver` 会被 lint 判成恒真。

**自检与反向验证**

- `pnpm check` 全绿，`node tools/verify.mjs` → **PASS 203/203**。其中 **C 区（客户端协议 + 假 DOM 真跑）
  与 D 区（40+ 条真实渲染：四态状态机、两条错误通道、自动检测、recheck 有界重读、工具名单折叠）
  全部通过** —— 这是"TSX 搬迁没有改坏行为"的主要证据。
- **反向验证（变异矩阵）**：对 4 条改过的断言各注入一个变异，逐条精确命中，且都是**双保险**：
  A28 同时被渲染测试 D7 抓住，A38 同时被样式表断言 C15 抓住，A14 同时被 A13 抓住；
  另外 E10（构建指纹）在四次变异中都报——产物被手改过就藏不住。
  （第一次跑时 M-A14 的变异写成 `titleRow→titleRowX`，因为 `mcpm-titleRow` 仍是子串而"没打中"，
  这本身就是一次"断言要能被怀疑"的教训。）

**尚未做**：P5 的纯函数单测（`normalizeRow` / `toRecord` 还在 `src/host/index.ts` 里没抽出来）、
`lib/client.js` 的 CSS 仍是原样搬过来的（P2 只抽了 TS 逻辑，没动样式）。

### P2 纯函数抽取 + P5 测试升级 —— 已完成

**产出**

| 文件 | 说明 |
|---|---|
| `src/shared/guards.ts` | 不可信输入的收窄守卫（`isRecord` / `asRecord` / `asText` / `readString`），两半边共用 |
| `src/host/rows.ts` | 宿主纯函数：`normalizeRow` / `toStringArray` / `toRecord`（从 `apply()` 闭包里抽出来） |
| `src/client/core/status.ts` / `draft.ts` | 状态机与记录↔草稿↔载荷整理（P4 已抽，此处确认导出齐全） |
| `tools/verify.mjs` **F 区** | **38 条纯函数单测**，直接 `await import('../src/**/*.ts')` |

**关键决定**

1. **相对 import 一律带扩展名**（`./rows.ts`）。理由：自检脚本要直接 import TypeScript 源码，
   而 Node 的 ESM 解析器不认无扩展名的相对路径（第一次跑 F 区就是被这个卡住的）。
   配套打开 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`
   （后者把产物 `.d.ts` 里的 `.ts` 改写成 `.js`）。三方（tsc / esbuild / Node）由此一致。
2. **单测不引入任何测试框架**：`node tools/verify.mjs` 依然是唯一必跑命令，
   依然**不装 node_modules 也能跑**。这是有意的取舍 —— 自检脚本是用户的最后一道防线，
   不该因为依赖没装好而失效。
3. **F 区只钉输入 → 输出**，不碰实现写法（D 区那些"渲染出某段文案"的断言留在 D 区）。

**F 区覆盖**（38 条）

| 范围 | 断言 | 覆盖点 |
|---|---|---|
| `statusOf` | F1–F12 | 四色语义的 8 条分支 + **优先级**（检测失败压过日志、检测通过压过旧日志、stdio 探不了照旧报绿、能探测但没记录报「未检测」、旧宿主退回相位） |
| `settling` | F13–F16 | 探通但相位没稳 / 终态不再等 / 停用不算 / 快照缺失不抛 |
| `failureText` | F17–F19 | 次数、原文、空记录 |
| `draft.ts` | F20–F27 | 对象 headers → 多行文本、`serverOfExisting` 的文本化（丢字段事故的正解）、args 换行、两条传输分支的字段差异、`targetOf` 占位文案、能力协商、默认名避撞、非对象输入 |
| `rows.ts` | F28–F34 | `toRecord` 三形状 + 注释行 + 缺 `=` 抛错、`toStringArray`、`normalizeRow` 的保留/校验/只写合法字段 |
| `guards.ts` | F35–F38 | `isRecord` 排数组与 null、`asRecord` 降级、`asText` 不产出 `"[object Object]"`、`readString` 区分"没写"与"空串" |

**自检与反向验证**

- `pnpm check` 全绿；`node tools/verify.mjs` → **PASS 241/241**（203 + 38）。
- **反向验证（变异矩阵，6 个变异）**：往纯函数里注入真实 bug，逐条确认命中它该命中的断言：

  | 变异 | 命中 |
  |---|---|
  | statusOf 丢掉"检测失败"分支 | F3, F11 |
  | settling 不再排除停用条目 | F15 |
  | toRecord 不再认"对象形状"（headers/env 会被静默清空） | F28 |
  | normalizeRow 不再校验 serverName | F33 |
  | asText 退回 `String()` | F37, **F24, F33** |
  | serverOfExisting 不再把 headers 转成文本 | F21 |

  每次都附带 E10（src 改了但没重建产物）。`asText` 那次的多处连带命中是**合理**的：
  它是"读不可信标量"的唯一出口，一退化就会让 `targetOf` 把缺失的 url 变成 `"undefined"`、
  让 `normalizeRow` 把 `"undefined"` 当合法名字收下 —— 一处坏、三处报警，正是想要的效果。
  （这也是本仓库第二次出现"我的期望集合写窄了"：断言比作者以为的更敏感，不算坏事。）

**P1–P5 至此收口**：两半边都是 TypeScript，两个产物都由 `tools/build.mjs` 生成并带构建指纹，
断言从 193 条涨到 241 条，其中 38 条是纯函数直接单测。
剩余的是发布向的 P6–P8（bundle 打包 / 端到端安装验证 / 上架），与本轮"先 TS 化"的取舍无关。
