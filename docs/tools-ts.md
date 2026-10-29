# tools/ 的 TypeScript 化：现状与续做

> 起因：`src/**` 在 P0–P5 全部 TS 化之后，`tools/`（自检 2226 行 + 构建 130 行）还是 `.mjs`。
> 当时的理由是"零依赖 + oracle 不该和产物共用工具链"，但**这两条都不需要 JS**：
> Node ≥22.18 的入口级类型擦除让 `.ts` 零构建直接跑，而且 `verify.mjs` 本来就在用这条能力
> （它一直 `await import('../src/**/*.ts')`）。所以 `tools/` 也改成 TS。

## 1. 现状

| 文件 | 状态 |
|---|---|
| `tools/build.ts` | ✅ **完成**，strict 类型检查 0 错误，已进 `pnpm check`（`tsconfig.tools.json`） |
| `tools/verify.ts` | ⚠️ 已改名、**已能作为 TS 直接运行**（`node tools/verify.ts` → PASS 243/243，零构建），但 strict 类型检查**未做完**：360 → **240** 条 |

`tools/verify.ts` 的 240 条**故意不进 `pnpm check`**（否则门禁变红）。它由单独的"进度计"度量：

```powershell
pnpm typecheck:tools:wip        # 打印剩余错误（当前 240 条）
pnpm typecheck:tools            # 门禁部分（build.ts），应当 0 错误
```

**这不是"改了个后缀却假装是 TS"**：`verify.ts` 确实作为 TypeScript 运行，A–F 六个区的断言全跑、
243 条全 PASS；缺的只是"把 strict 挂在它身上"，而那件事已经完成 1/3 并留有可度量的余量。
**没做完就不放进门禁**，而不是把没修完的文件塞进 `check` 再放宽规则。

## 2. 已经做完的部分（241 条 → 240 条的由来）

1. **类型脚手架**（`verify.ts` 顶部 `//#region 类型脚手架`）：`StubEntry` / `StubRoute` / `StubExporter` /
   `StubChild` / `StubLayerRow` / `HostScopeStub` / `StubServer` / `StubSnapshot` / `WireBody` /
   `StubModuleDefinition` / `StubReact`，外加 `bodyOf()` / `routeOrThrow()` / `firstOrThrow()` / `lastOrThrow()` /
   `unregisteredRoute`。
   **这是收益最大的一步**：替身用 `[]`/`null` 初始化会被推成 `never[]`/`never`，
   一个容器能连带几十条"属性不存在"，显式声明一次消掉一片。
2. **B 区（宿主半边）**：假 ctx 受 `HostScopeStub` 约束；`captured.writes` 修正为 `StubEntry[][]`
   （每次写入是**整份数组**，原来标成 `StubEntry[]` 是我写错的类型，不是噪音）；
   `Response.json()` 统一走 `bodyOf()` 收窄（undici 类型里是 `unknown` 而不是 `any`）。
3. **C 区（客户端半边）**：假 React / 注册表 / 假客户端 ctx 全部显式声明。
4. **E11 新断言**：`package.json` 的 `verify`/`build` 脚本必须指向真实存在的文件。
   这条正是"改名当天该有的护栏"——漏改一处（`package.json`、CI、AGENTS、README）以前只能靠记得。
   已反向验证：把 `verify` 指回 `tools/verify.mjs`，**只有** E11 报错并打印出那条命令。

## 3. 剩余 240 条的构成（`pnpm typecheck:tools:wip`）

```
TS7006=110  参数隐式 any（回调/工厂函数）
TS18048=34  'x' is possibly undefined
TS2339=16   属性不存在（多半是 never/未标注容器）
TS7005=13   变量隐式 any[]
TS2345=12   传参类型不符
TS7034=9    变量隐式 any[]
TS18046=6   'x' is of type unknown
TS2353=6    对象字面量有多余属性（Snapshot 形状）
TS7053=6    索引签名缺失
TS2554=6    参数个数不符
TS2322=5    赋值类型不符
其余小计 15
```

集中在两个"沙箱区"（**这两处就是续做的主战场**）：

| 区域 | 剩余 | 需要补的东西 |
|---|---|---|
| D 区「客户端渲染 / 迷你渲染器」 | ~59 | `StubVNode`（`createElement` 的返回）、`render()/walk()/collect()/classesOf()/textsOf()/typesOf()/hasClass()` 的签名、`scene(...)` 夹具的参数类型、`hookValues` |
| D2 区「挂载行为（真跑 useEffect 的沙箱）」 | ~32 | 该沙箱的 `document`/`MutationObserver`/`fetch` 桩形状 + 容器 |
| C 区剩余 / B 区剩余 / E- F- | ~30 | 零散容器（`elements`、`staleDocument`、`calls`…） |
| **归不到容器的散点** | ~120 | 大多是"某个工厂函数的参数没标注"，标注了它就一次消掉它内部所有回调 |

## 4. 续做方法（下次照这个做，别再从头摸索）

1. 把 `tsconfig.tools.json` 的 `include` 临时改成 `["tools/**/*.ts"]`（或直接用 wip 配置的输出）。
2. **先按"容器"归因，别逐条修参数。** 拿 tsc 输出与源码行对齐，把每条错误归到"它上方最近的一个
   空容器声明"（`const x = []` / `x: null` / `x: {}`），按错误数排序 —— 前 10 个容器通常覆盖一半以上。
   （本次就是这么做才看清 B/C 区的真凶。）
3. 每标注一个容器/工厂，就重跑一次进度计，数字必须下降；**不要**为了消数字加 `any` 或 `as`：
   已用的 `as` 只有两处，都在"宿主回调返回 `unknown`、而我们自己的假 ctx 知道形状"的边界上，且有注释。
4. 数字到 0 时：`include` 改回 `["tools/**/*.ts"]`，删掉 `tsconfig.tools.wip.json` 与
   `typecheck:tools:wip` 脚本，把 `pnpm check` 跑一遍。
5. 全程 `node tools/verify.ts` 必须保持 PASS 243/243（类型标注是擦拭掉的，不改行为；一旦变红就是改错了）。

## 5. 刻意关掉的四个开关（只对 tools 生效）

`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `noUnusedLocals` / `noUnusedParameters`。

自检脚本是"测试替身 + 断言"的代码：必须往数组塞各种形状的假对象、按序号取下标（`registered[0]`、
`cells[2]`）、故意造多余变量。开着这四项会产生几百条风格噪音，把真信号淹没。
**丢掉的只是噪音**：隐式 any、`never` 误用、属性不存在、传参不符，全部由 `strict` 自己覆盖 ——
也正是上面那 240 条要修的东西。产品侧 `src/**` 这四项一个都没关。

## 6. 不变的性质（这次改造刻意保住的）

- **不需要构建**：`tools/*.ts` 由 Node 原生类型擦除直接执行（无 esbuild/tsc 产物链路）。
  代价：自检 import 了 `js-yaml`，**必须先 `pnpm install`** 才能跑（2026-10-29 修正；
  v0.3.0 之前确实是"不装 node_modules 也能跑"）。
  CI 里这一步现在放在 `pnpm install` **之后** —— 之前放在前面，CI 从 v0.3.0 起一直红。
- **oracle 独立于构建**：`tools/*.ts` 由 Node 直接执行，不经过 esbuild/tsc 的产物链路 ——
  构建链路坏掉时自检仍能跑。这条正是当初"想留着 JS"的真实理由，而它不需要 JS 来兑现。
