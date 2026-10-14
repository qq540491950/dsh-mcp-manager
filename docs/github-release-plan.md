# 只用 GitHub 发布：G0–G5 执行手册

> 这份手册回答一个具体问题：**不发 npm，只靠 GitHub，怎么让别人一条命令装上本插件，并且每一步都能验收、能回滚。**
>
> 与 [publish-plan.md](publish-plan.md) 的分工：**共用改造（P6）的字段细节以 publish-plan §3 为准，自检断言的改法以 §4 为准，
> 四种 spec 形式的源码依据以 §9 为准**；本文只写"顺序 / 命令 / 验收 / 回滚"。行号都指本机安装版
> `@deepseek-ai/dsh-plugin-manager/lib/index.js`（本轮复核过）。
>
> ⚠️ **G4 的 `github:` 路线本轮没有实跑过**（`plugin_manager` 每个 action 都需要审批，本会话审批被禁用）。文末 §7 列了全部未实测项。

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

按 publish-plan §5 的 V3 → V4 → V5 走，顺序是：

1. **备份 profile**：`profiles/<名字>/package.json` 与 `cordis.patch.yml` → 带时间戳 `.bak`。
2. **摘掉旧的接入行**：删掉路径行 `- id: dsh-mcp-manager, name: file:///…` 与手写的 `mcp-manager` group **insert** 行；**保留 `- id: mcp-manager` 的覆写行**（服务器列表在里面）。
3. 安装（**路径形式**）：`plugin_manager(action:'install_bundle', target:'D:\project\dsh-plugins\dsh-mcp-manager')`
4. **运行时四查**：①宿主 `list_plugins` 找 `include:dsh-mcp-manager` → `enabled: true` + `fiberPhase: active`；②客户端 `Slots.listSubTree {root:'settings.section'}` → occupants 含 `{id:'mcp', order:900, active:true}`；③在页面上**新增一台服务器** → 确认落盘进 profile 覆写行、且工具真的注册；④启停 / 删除 / 检测 / 刷新全流程回归。
5. `plugin_manager(action:'remove_bundle', target:'D:\…')` → 行与座位都消失、profile 回初态。
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

**用户侧升级**：

```text
plugin_manager(action:'remove_bundle', target:'@qq540491950/dsh-mcp-manager')
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.1')
```

先卸再装是**刻意的**：同一个 spec 重复安装会报 `ambiguous-install`（依赖没变化 → 安装器找不到"新装的那一个"，`:1779-1782`）。换成新 tag 通常能绕过，但显式先卸最稳。升级后**宿主半边仍需重启 DSH**。

**回滚**：

```text
plugin_manager(action:'remove_bundle', target:'@qq540491950/dsh-mcp-manager')
plugin_manager(action:'install_bundle', target:'github:qq540491950/dsh-mcp-manager#v0.1.0')
```

profile 被改坏时用 G2 第 1 步的 `.bak` 还原（`package.json` + `cordis.patch.yml`），再按 §3 第 2 步清一下重复行。

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
| 装上了但设置里没有 MCP 页 | `files` 白名单漏了 `cordis.patch.yml`；或 profile 里旧的路径行与 bundle 行**同 id 重复** | `plugin_manager list_plugins` 看有没有 `include:dsh-mcp-manager`；`--dump-config` 看层序；按 §3 第 2 步清重复行 |
| 页面在、但「检测」按钮灰 | 宿主半边还是旧的（能力协商退回了旧底座） | 重启 DSH |

---

## 8. 交付检查单

- [ ] G0 基线 `PASS n/n`，`git check-ignore lib/client.js` 无输出
- [ ] G1 `pnpm check` 全绿；`npm pack` 内容审查（有产物/patch/locale/图标，无 src/tools/docs/AGENTS，无密钥）；新断言反向验证过
- [ ] G2 路径形式装 → 四查 → 卸，各一轮；`node_modules/` 里确实有 `lib/`、`cordis.patch.yml`、`locale/`
- [ ] G3 tag 与 `package.json.version` 一致；Release 资产与 tag 同源（workflow 或手工）
- [ ] G4 用 `github:` spec 装成功并四查 —— **本方案唯一无法离线证明的环节，必须真机做一次**
- [ ] G5 升级（先卸再装）与回滚各走一遍
- [ ] README 写清：安装命令、兼容矩阵（DSH 版本 × 插件版本）、升级后要重启宿主半边

---

## 9. 本方案的未实测项（不要把推断当结论）

1. **G4 的 `github:` 路线没有实跑**。依据是源码（`parseInstallSpec`/`checkGithubConnection`/`installBundle`）与包内官方 `README.zh.md`:46/48/54/63；`plugin_manager` 需审批，本会话审批被禁用，调用只会被拒。
2. **pnpm 对 git 依赖的实际打包结果没有实测**（`files` 白名单是否被严格遵守）。所以 §3 第 6 步与 §8 的"查 `node_modules/` 内容"不是多余的——它是这条路线唯一的第一手验收。
3. **GitHub `archive/refs/tags/*.tar.gz` 源码包没有验证**：它以 `<repo>-<tag>/` 为根，不是 npm 包的 `package/` 前缀，别当发行物；用 `npm pack` 的 `.tgz`。
4. **`release.yml` 没有在本仓库跑过**：写法按 `ci.yml` 推导，首次要盯 CI 输出；`gh` 已预装在 GitHub runner 上，但 `--verify-tag` 的重复运行行为要自己确认。
5. **没有验证私有仓库**：预检特意禁用了凭据助手与交互提示（`:981-996`），把认证交给 pnpm；私有仓库建议直接用 `.tgz` 资产，绕开这层不确定。
