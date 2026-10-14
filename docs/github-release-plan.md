# 只用 GitHub 发布：G0–G5 执行手册

> 这份手册回答一个具体问题：**不发 npm，只靠 GitHub，怎么让别人一条命令装上本插件，并且每一步都能验收、能回滚。**
>
> 与 [publish-plan.md](publish-plan.md) 的分工：**共用改造（P6）的字段细节以 publish-plan §3 为准，自检断言的改法以 §4 为准，
> 四种 spec 形式的源码依据以 §9 为准**；本文只写"顺序 / 命令 / 验收 / 回滚"。行号都指本机安装版
> `@deepseek-ai/dsh-plugin-manager/lib/index.js`（本轮复核过）。
>
> ✅ **G4 的 `github:` 路线已于 2026-10-14 实跑通过**（用户在 DSH 界面里安装，审批由 GUI 完成）。
> 文末 §9 列出**仍未**实测的部分（卸载 / 升级 / Release 资产 / 私有仓库）。
>
> ⚠️ **v0.1.1 起多了一条前置条件（G2 第 0 步）**：承载 MCP 服务器的容器条目由 **profile** 声明，
> 不由插件包声明（理由与那 4 行 YAML 见 [README](../README.md) §5.6）。装插件之前 profile 里就该有
> 那一行；装完没有页面入口时才需要人来补（页面会把整行给出来）。

---

## 0. 先定三件事（后面所有命令都由它们推出）

| 项 | 本方案取值 | 为什么 |
|---|---|---|
| **分发载体** | 主：`github:qq540491950/dsh-mcp-manager#vX.Y.Z`（tag）<br>备：Release 资产里的 `npm pack` 产物 `.tgz` | `github:` 短、可钉 tag；`.tgz` 走纯 HTTPS，用户机器**不需要 git**，也跳过 `git ls-remote` 预检 |
| **仓库角色** | 仓库根目录**就是**发布包 | `cordis.patch.yml` 与 `lib/**` 必须随仓库提交——pnpm 拉的是仓库内容，**不会替你跑 `pnpm build`** |
| **版本号** | git tag `vX.Y.Z`，且 `package.json.version` 与之**逐字一致** | 用户按 tag 钉版本；两边不一致就说不清"装的是哪个版本" |

**这套机制的硬约束（违反就出问题，不是风格问题）**

1. ❌ **不要加 `prepare` / `postinstall` 之类的依赖脚本**：git 依赖的构建脚本会被 pnpm 拦成 `pendingBuilds`（要用户逐个批准），而我们靠**已提交的 `lib/**`** 出货。
2. ❌ **不要移动或删除已发布的 tag**：用户按 `#v0.1.0` 钉住，移动 tag = 静默改变所有人装到的东西。要改就发新 tag（或让用户钉 commit sha）。
3. ❌ **不要把 `tools/`、`docs/`、`AGENTS.md` 放进 `files` 白名单**，也不要提交任何凭据（AGENTS §7）。
4. ❌ **`files` 白名单是 git 路线的生命线**：它优先于 `.gitignore`，白名单外的文件在 git 安装时**根本不会出现在包里**（`lib/`、`cordis.patch.yml`、`locale/*.json`、图标都必须在里面）。
5. ❌ **本方案不需要 npm**：不要为了"顺便"去 `npm publish`——两条渠道同时维护只会让版本口径分叉。

---

## 1. G0 前置检查（5 分钟，不改任何东西）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `git status -sb` | 干净的 `main`，或只有你预期的改动 |
| 2 | `node tools/verify.ts` | `PASS n/n` —— **这是"改动前基线"**，没有它就无法证明后面是你改坏的（AGENTS 4.1） |
| 3 | `git tag -l` + `git ls-remote --tags origin` | 看清已发布的 tag，据此定下一个版本号 |
| 4 | `git --version` | 有 git（`github:` spec 的预检与抓取都要它；**用户机器上也一样要**） |
| 5 | `git check-ignore -v lib/client.js` | **没有输出**（`lib/` 没被忽略）。哪天有人把 `lib/` 加进 `.gitignore`，整条 git 路线立刻失效 |
| 6 | `git ls-remote origin refs/heads/main` | 能连上远端（`git push` 的 `[exit code: 1]` 是假警报，见 AGENTS §7） |

---

## 2. G1 把包改造成 bundle（P6）

字段与文件内容的**逐项清单在 publish-plan §3**，这里只强调**顺序**——顺序错了会连累自检断言：

1. 先改 `package.json` 的 `name` → `@qq540491950/dsh-mcp-manager`（客户端 bundle 的模块 id 由构建从包名注入）。
2. **立刻 `pnpm build`**：让 `lib/client.js` 里的 id 跟上，否则 E8（id == 包名）/E10（构建指纹）立刻红。
3. 加 `cordis.patch.yml`：group 行的 `id` 必须等于 `src/shared/constants.ts` 的 `GROUP_ID`（`mcp-manager`）；插件行的 `name` 必须等于**新包名**。
4. 加 `locale/{en,zh}.json`、图标（放 `assets/` 下，≤256 KiB）、`LICENSE`、`README.zh.md`。
5. 改 `package.json`：删 `private`；加 `dsh.bundle: { patch: "./cordis.patch.yml" }`；加 `exports["."]`；加 `files` 白名单（`lib`、`cordis.patch.yml`、`locale/*.json`、图标、`README.md`、`README.zh.md`、`LICENSE`）。
6. 按 publish-plan §4 改 A1/A2/A5、加 P 区 8–10 条断言，**每条都要反向验证**（注入违规 → 精确报错 → 还原）。

**G1 验收（缺一不可）**

```powershell
pnpm check                                   # typecheck / lint / format / build / verify 全绿
node tools/verify.ts                         # PASS n/n
git diff --exit-code lib/                    # 空：产物与 src/** 同步（CI 也跑这条）
npm pack                                     # 产出 qq540491950-dsh-mcp-manager-0.1.0.tgz
tar -tzf qq540491950-dsh-mcp-manager-0.1.0.tgz
```

`tar` 列表里必须有 `package/lib/index.js`、`package/lib/client.js`、`package/cordis.patch.yml`、`package/locale/*.json`、图标、`package/README.md`、`package/LICENSE`；**不能有** `package/src/`、`package/tools/`、`package/docs/`、`package/AGENTS.md`、`package/node_modules/`。再扫一遍密钥（不得出现 `ctx7sk-` / `tvly-` / 长 JWT）。

---

## 3. G2 本地路径三连验证（先证明"装得进、跑得起"，再去 GitHub）

按 publish-plan §5 的 V3 → V4 → V5 走。**v0.1.1 的顺序是"先有容器行、再装、最后才删旧路径行"**（v0.1.0 那轮的顺序见 §10 的历史附注）：

0. **先确认 profile 里有容器行**（v0.1.1 的前置条件，README §5.6）：`cordis.patch.yml` 里要有
   `- insert: [{id: mcp-manager, name: 'cordis:group', config: []}]`，且 **bundle / home patch / 任何层都不许再有第二份同 id 的 insert 行**。
   - 缺了它：插件装上也管不了任何服务器（页面会提示你粘这一行，并给出可复制的内容）。
   - 多了第二份：`configEditor` 写盘前自检取到先出现的空 config → **保存 / 启停 / 删除全部报错**
     （`overridden by a home patch or command-line overlay`），而读取与 MCP 运行看着都正常。
1. **备份 profile**：`profiles/<名字>/package.json` 与 `cordis.patch.yml` → 带时间戳 `.bak`。
2. **安装**：`plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.1')`（或本地绝对路径形式）。这一步只加一层插件行，任何失败都还能干净回滚。
3. **删掉旧路径行**（确认第 4 步通过后再做）：删 `- id: dsh-mcp-manager, name: file:///…` 那条；**保留容器行与 `- id: mcp-manager` 覆写行**（服务器列表在覆写行里，容器是它的目标）。
   - **为什么必须留容器行**（源码依据 `cordis-plugin-include:90-94`）：容器一没，覆写行就失去目标、被判 **not found 并整条丢弃**；后果不是"少一页"，而是**三台 MCP 服务器一起掉线**。
   - **并且不要反过来把容器写进 bundle**（v0.1.0 的形态）：那样"卸载插件 = MCP 掉线"，正是 v0.1.1 要消除的耦合。
   - **同 id 并存期的现象**（实测）：两行**不报错**，只是**后插入者赢**（层序 bundle 先、profile 后）——bundle 行会被路径行**静默盖掉**，按包名在 `Config.listConfigs` 里查不到它，看着像"没装上"。判别：按 `name:` 分别用包名与 `file://` 路径各查一次。
4. **运行时四查**：①宿主 `list_plugins` 找 `include:dsh-mcp-manager` → `enabled: true` + `fiberPhase: active`；②客户端 `Slots.listSubTree {root:'settings.section'}` → occupants 含 `{id:'mcp', order:900, active:true}`；③在页面上**新增一台服务器** → 确认落盘进 profile 覆写行、且工具真的注册；④启停 / 删除 / 检测 / 刷新全流程回归。
5. `plugin_manager(action:'remove_bundle', target:'@qq540491950/dsh-mcp-manager')` → 插件行与座位消失，但**容器与三台服务器仍在**（v0.1.1 的设计目的；v0.1.0 会一起掉线）。这一格要连"服务器是否随之下线、装回后是否自动恢复"一起验。
6. **顺带查包装对不对**（git 路线的前置风险全在这）：

```powershell
Get-ChildItem "$env:DSH_PROFILE_DIR\node_modules\@qq540491950\dsh-mcp-manager" -Recurse -Depth 1 |
  Select-Object -ExpandProperty FullName
```

必须看到 `lib/`、`cordis.patch.yml`、`locale/`、图标。**这一步就是 G4 的预演**：路径形式是"装前判定"（`not-a-bundle` 之类当场就报，什么都不改），而 git/tarball 是"**装后才判定**"（先 `pnpm add`，失败再回滚 profile 清单与锁文件）——所以先用便宜的方式把包本身排干净。

---

## 4. G3 提交 + 打 tag + 建 Release

```powershell
# 提交（中文分节说明写进 UTF-8 文件，再 -F；不要 -m 直传中文，AGENTS §7 / 1.1）
git add -A
git commit -F .git/COMMIT_MSG.txt

# 发布前的最后一道门（tag 一旦推上去就代表"可发布"）
pnpm check

# 打 tag（package.json.version 必须是 0.1.0）
git push origin main
git tag -a v0.1.0 -m "dsh-mcp-manager v0.1.0"
git push origin v0.1.0

# Release：附 npm pack 产物（给没有 git 的用户走 tarball 路线）
npm pack
gh release create v0.1.0 qq540491950-dsh-mcp-manager-0.1.0.tgz --title "v0.1.0" --notes-file .git/RELEASE_NOTES.md
```

**建议同时加 `.github/workflows/release.yml`**，让资产永远与 tag 同源（下面的 YAML **没有在本仓库跑过**，首次要盯 CI 输出）：

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24

      # 零依赖自检先跑（与 ci.yml 同一顺序：install 之前）
      - name: 自检（零依赖）
        run: node tools/verify.ts

      # tag 与包内版本必须一致，否则"装的哪个版本"就说不清
      - name: 校验 tag 与 package.json.version
        run: |
          node -e "const v=require('./package.json').version; if (process.env.GITHUB_REF_NAME !== 'v'+v) { console.error('tag ' + process.env.GITHUB_REF_NAME + ' != v' + v); process.exit(1) }"

      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - name: 类型 + 风格 + 产物契约
        run: pnpm check

      - name: 产物与 src 同步（构建指纹）
        run: git diff --exit-code lib/

      - name: 打包（npm 格式 .tgz）
        run: npm pack

      - name: 发布到 GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "${GITHUB_REF_NAME}" *.tgz --verify-tag --title "${GITHUB_REF_NAME}" --generate-notes
```

> 注意两点：①workflow 里**不要**去改 `package.json.version`（版本号由 tag 驱动）；②`gh release create --verify-tag` 在 Release 已存在时会失败——重复跑请改用 `gh release upload --clobber`。

---

## 5. G4 用户侧安装（三种写法，按环境选）

```text
# A. 推荐：git + tag（用户机器上要有 git）
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.0')

# B. 备选：Release 资产的 .tgz（纯 HTTPS，不需要 git；也没有 git ls-remote 预检）
plugin_manager(action:'install_bundle', target:'https://github.com/qq540491950/dsh-mcp-manager/releases/download/v0.1.0/qq540491950-dsh-mcp-manager-0.1.0.tgz')

# C. 只有你自己机器才有的路径形式（开发循环用）
plugin_manager(action:'install_bundle', target:'D:\project\dsh-plugins\dsh-mcp-manager')
```

**验收**：读返回值（`application: applied`，`warnings` 里不该有 bundle skipped）→ 再跑 G2 的"运行时四查" → 重启 DSH 后确认「检测」按钮可用（宿主半边不热重载，§6）。

**三种写法的差别**（决定了用户会遇到什么错）

| | A `github:` | B `.tgz` URL | C 本地路径 |
|---|---|---|---|
| 用户需要 git | **要**（预检 `git ls-remote` 用得到） | 不要 | 不要 |
| 装前判定 | ❌ 只答复"形式 + host" | ❌ 同左 | ✅ 读目录 `package.json` |
| 不是 bundle 时 | 装上再回滚（`:1786`） | 装上再回滚 | 立刻拒（`:1587`） |
| 版本钉法 | `#v0.1.0` / `#<sha>`（sha 不可变，最严） | URL 里的文件名 | 跟着工作区变 |
| 额外预检 | 5s `git ls-remote`（`:968-971`） | 无 | 无 |
| 分发用 | ✅ 主渠道 | ✅ 备选 | ❌ 只给自己用 |

---

## 6. G5 升级与回滚

**用户侧升级**（**v0.1.0 → v0.1.1 必须就地装，不要先卸**）：

```text
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.1')
```

为什么不再"先卸再装"：①换 tag 本身就是换 spec —— 安装器用"依赖串变了"判定装上了哪个包
（`:1778-1782`），所以**同 spec 重复装才**是 `ambiguous-install`，升级不会；②**先卸会失败**：
下面那条 `bundle-in-use` 陷阱。就地装返回 `restart-required`（`:1801`，包本来就是依赖）是正常的
—— 宿主半边变了，**装完重启一次 DSH**。

⚠️ **陷阱（源码判定式 + 离线复现；本机 2026-10-14 的卸载尝试即失败）**：profile 里已经有容器行时，
卸载 **v0.1.0** 会失败并报 `bundle-in-use`（GUI 文案：「其他配置仍在使用这个组合包的组件」）。机制：
`removeBundle` 在禁用 bundle、reload 之后检查"**这个 bundle patch 声明过的行**是否还有一个活着的条目"
（`lib/types/index.js:640-666`，按 `row.id` + `row.name` 匹配，**不看这一行来自哪一层**）。
v0.1.0 的 patch 声明了容器行 `mcp-manager`/`cordis:group`，而容器现在由 profile 提供、永远活着
→ 命中 → 拒绝（profile 的 `package.json` 实测未被改动）。**就地装到 v0.1.1 后它的声明只剩插件行，
卸载恢复正常**（离线复现三种组合：v0.1.0+容器行 → 拒绝；v0.1.0+无容器行 → 允许；v0.1.1+容器行 → 允许）。
要"先卸旧版"只有一条路：**临时删掉 profile 那行容器 → 卸载 → 装新版 → 再把容器行加回来**
（中间 MCP 会掉线，不推荐）。

⚠️ **v0.1.1 起装/卸都不会让 MCP 掉线**：容器 `mcp-manager` 由 **profile** 声明（README §5.6），
插件包里只有插件行。离线复现（逐字抄 `applyEntryPatches`/`flatten`，喂真实 patch）：
「卸载后」合成 = 1 行容器 + 3 台服务器，写盘前断言也通过。

- **还在 v0.1.0 时**（且 profile 还没有容器行）：卸载会让容器消失，`- id: mcp-manager` 覆写行被
  `applyEntryPatches` 判 `not found` 整条丢弃（`cordis-plugin-include:90-94`），三台服务器停止加载
  （**配置不丢**，装回来即恢复）。所以第一次升级前请先确认 profile 里有那行容器（本机已加好）。
- ⚠️ **别把容器搬回包里**：bundle 自带容器 = 卸载即掉线；而且 profile 与 bundle 各一份会让
  `configEditor` 写盘前自检取到先出现的空 config → 保存/启停/删除全部抛
  `overridden by a home patch or command-line overlay`（读取与 MCP 运行不受影响，很隐蔽）。

**回滚**：

```text
plugin_manager(action:'remove_bundle', target:'@qq540491950/dsh-mcp-manager')
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.0')
```

⚠️ 回滚到 `v0.1.0` 时它会**自带容器行**，而 profile 里已有那一行 → 又是"两份同 id" → 保存/启停/删除会报错
（MCP 照常跑）。要么回滚后把 profile 那行**临时**删掉（此时 MCP 由 bundle 提供，仍不掉线），要么回滚后直接
装回 v0.1.1。这是唯一需要注意的"降级陷阱"。

profile 被改坏时用 G2 第 1 步的 `.bak` 还原（`package.json` + `cordis.patch.yml`），再按 §3 第 3 步清一下重复行。
**只想把 MCP 服务器拿回来**（不重装 bundle 也行）：确保 `cordis.patch.yml` 里有容器行
（`- insert: [{id: mcp-manager, name: 'cordis:group', config: []}]`）—— 不需要插件就能跑；服务器列表本来就在
同一文件的 `- id: mcp-manager` 覆写行里（原始段落见本机 profile 目录的 `.bak-*`）。

**维护者侧"撤回一个版本"**：**不要动已有 tag**。要么发 `v0.1.1` 修好，要么 `git revert` 后新开 tag；同时在 README 的兼容矩阵里标注该版本作废。

---

## 7. 故障对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| `not-a-bundle`（路径 / registry 形式） | 装前判定：`package.json` 没有 `dsh.bundle.patch` | G1 第 5 步 |
| 装完之后报错并回滚（git / tarball） | 同上，但判定发生在抓取之后（`:1786`） | 同上；先用 G2 的路径形式自查 |
| `incompatible-version` | peer 不满足（多半是钉了 `@deepseek-ai/dsh-*`） | 只留 `@deepseek-ai/cordis`（publish-plan §2） |
| `ambiguous-install` | 同一个 spec 重复装 | 先 `remove_bundle`（§6） |
| `failedAt: 'spec-host'` | `git ls-remote` 预检失败：网络不通 / 机器上没有 git / 仓库不存在 / 私有仓库没凭据 | 装 git、查网络与仓库可见性；或改用 B 的 `.tgz` |
| `pendingBuilds` 列出本包 | 包里被加了 `prepare` / `postinstall` | 删掉脚本，靠已提交的 `lib/**` 出货（§0 硬约束 1） |
| 装上了但设置里没有 MCP 页 | `files` 白名单漏了 `cordis.patch.yml`；或 profile 里旧的路径行与 bundle 行**同 id 重复**（后插入者赢，bundle 行被静默盖掉）；或 **profile 里缺容器行**（v0.1.1 起容器不由包提供） | 用 `cordis_inspect_query(host, Config, listConfigs, {name:'@qq540491950/dsh-mcp-manager'})` 查；**不要**用 `--dump-config`（见下一行）；按 §3 第 3 步清重复行；缺容器就把页面给出的那一行粘进 `cordis.patch.yml` |
| 页面提示「找不到 group 条目「mcp-manager」（cordis:group）」 | profile 里没有容器行（v0.1.1 的容器前置条件） | 把提示里给出的 `- insert: [{id: mcp-manager, name: 'cordis:group', config: []}]` 粘进 profile 的 `cordis.patch.yml`，保存即热重载，**不用重启** |
| 卸载 v0.1.0 报 `bundle-in-use`（profile 未被动过） | profile 里已有容器行：v0.1.0 的 patch 声明过 `mcp-manager`/`cordis:group`，而容器现在由 profile 提供、条目一直活着 → 卸载检查（`:1850-1855`，按 id+name 匹配、不看来源层）判"还在用" | **不要卸载**：就地 `install_bundle` 到 v0.1.1（换 tag = 换 spec，`:1778-1782`；返回 `restart-required` 正常），装完重启一次。之后卸载恢复正常 |
| 保存 / 启停 / 删除报 `Configuration for "mcp-manager" is overridden by a home patch or command-line overlay`（读取与 MCP 运行却正常） | 容器行被声明了**两份**（profile 一份 + 别处一份，典型是 v0.1.0 的 bundle 自带一份）；`configEditor` 写盘前用 `flatten().find()` 取到**先出现的空 config**（`dsh-config-editor:12/122`，flatten 不去重） | 保证只有一份：v0.1.1 的包不自带容器行，profile 里留那一行。过渡期（装了 v0.1.0 + profile 也有一份）**就地装回 v0.1.1 即消失**，不必改 profile |
| 卸载插件后 `mcp__*` 工具全没了 | 机器上装的是 **v0.1.0**（容器随包走） | 升级到 v0.1.1 并在 profile 里补上容器行；此后卸载只拿掉插件行，MCP 不受影响（README §5.6） |
| 装完"看着毫无变化"（条目总数没涨、按包名查不到） | 同 id 重复把 bundle 行盖住了；或那次 profile `package.json` 变更没被 watcher 收到 | 删掉旧接线；或改一下 `cordis.patch.yml`（会触发重读 `dsh.profile.bundles`）；还不行就重启 DSH |
| `--dump-config` 报 `profile "desktop" is managed exclusively by the Electron application` | 应用托管的 profile 不允许 CLI 读 | 另建一次性 profile 验层序（publish-plan §5 V2），或改用运行时四查 |
| 页面在、但「检测」按钮灰 | 宿主半边还是旧的（能力协商退回了旧底座） | 重启 DSH |

---

## 8. 交付检查单

- [x] G0 基线 `PASS n/n`，`git check-ignore lib/client.js` 无输出
- [x] G1 `pnpm check` 全绿；`npm pack` 内容审查（有产物/patch/locale/图标，无 src/tools/docs/AGENTS，无密钥）；新断言反向验证过（244 → 254 条）
- [x] G2 装 → 四查（**没走"卸"**）；`node_modules/` 里确实有 `lib/`、`cordis.patch.yml`、`locale/`（30 个文件与自检通过的那份逐字节一致）
- [x] G3 tag `v0.1.0` 与 `package.json.version` 一致且已推送到 GitHub；**Release 资产没建**（没跑 `release.yml` / `gh release create`）
- [x] G4 用 `github:` spec 装成功并四查（2026-10-14）：profile 落成 `github:…#v0.1.0` + `dsh.profile.bundles`；①`include:dsh-mcp-manager` 的 name = 包名 ②座位 `{id:'mcp',order:900,active:true}` ③`mcp__context7__*` 在活动工具注册表 ④页面渲染与数据读取正常，重启后仍然正常
- [ ] G5 卸载（`remove_bundle`）与升级（先卸再装）各走一遍 —— **没跑**
- [x] G6（v0.1.1）容器归属改造：`cordis.patch.yml` 只留插件行（P2/P3 反过来守"不许出现容器 id"）、缺容器时两半边给出同一行可照抄的 YAML（P11）、`pnpm check` 全绿（**255 条**）+ 新断言注入式反向验证（3 处注入 → 精确报错 → 还原）；profile 侧容器行已加（备份 + 两个真实解析器校验 + 四种状态的离线合成复现）
- [ ] G7（v0.1.1）真机重装 + 重启后四查 —— **没跑**（宿主半边变了，必须重启一次）
- [x] README 写清：安装命令（§5.4）、兼容矩阵（§5.5）、升级后要重启宿主半边

---

## 9. 本方案的未实测项（不要把推断当结论）

1. ~~**G4 的 `github:` 路线没有实跑**~~ —— **2026-10-14 实跑成功**（用户在 DSH 界面里安装，审批由 GUI 完成）：`install_bundle(target:'github:qq540491950/dsh-mcp-manager#v0.1.0')` → profile 的 `dependencies` 与 `dsh.profile.bundles` 都落位，**不需要重启即生效**，重启后仍然正常。
2. ~~**pnpm 对 git 依赖的实际打包结果没有实测**~~ —— **已实测**：装到 `node_modules` 的 30 个文件与自检通过的那份**逐字节一致**（`cordis.patch.yml` / `lib/index.js` / `lib/client.js` / `locale/en.json` / `assets/icon.svg` 五处 sha256 相同），`files` 白名单被严格遵守。§3 第 6 步仍值得做 —— 它是**别人机器上**的第一手验收。
3. **GitHub `archive/refs/tags/*.tar.gz` 源码包没有验证**：它以 `<repo>-<tag>/` 为根，不是 npm 包的 `package/` 前缀，别当发行物；用 `npm pack` 的 `.tgz`。
4. **`release.yml` 没有在本仓库跑过**：写法按 `ci.yml` 推导，首次要盯 CI 输出；`gh` 已预装在 GitHub runner 上，但 `--verify-tag` 的重复运行行为要自己确认。
5. **没有验证私有仓库**：预检特意禁用了凭据助手与交互提示（`:981-996`），把认证交给 pnpm；私有仓库建议直接用 `.tgz` 资产，绕开这层不确定。
6. **v0.1.1 的真机重装没跑**（本文写作时的最新状态）：本次改动是"容器不再随包走 + 缺容器时给出可照抄的整行"，
   离线侧做到「255 条自检全绿 + 四种状态（装 v0.1.0 过渡期 / 重装后 / 卸载后 / 从未安装）的合成复现 +
   新断言三处注入式反向验证」，但**没装到运行中的 DSH 上**。宿主半边变了 → 装完必须重启一次。

---

## 10. 历史附注：v0.1.0 那一轮的顺序（仅存档，别再照做）

v0.1.0 的布局是"**容器由 bundle 自带** + profile 只留 `- id: mcp-manager` 覆写行"，所以当时的 G2 顺序是
"先装 bundle → 四查 → 再删 profile 里手写的 group insert 行与 `file://` 路径行"（因为删早了容器就没了）。
那一轮实测走通并写进了本文 §3。

v0.1.1 把归属翻了过来（README §5.6），于是 §3 的顺序变成"**先有容器行 → 装 → 删旧路径行**"。
两个版本混用时的唯一症状是"两份同 id 的容器行 → 写盘报 `overridden`"（§7 故障表第三行），
装回 v0.1.1 即消失 —— **不要**为了消这个症状去删 profile 里的容器行（删掉它才是真正会掉线的做法）。
