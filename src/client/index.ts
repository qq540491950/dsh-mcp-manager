/**
 * 客户端半边（Client half）——DSH 自带的「懒 CJS」模块协议。
 *
 * 契约（实测自 @deepseek-ai/dsh-client-modules 与既有插件）：
 *   1. 产物是一个普通 classic script，不是 ESM；执行时只做一件事：向
 *      `window.__ModuleLoader__.load` 注册一个 factory。
 *   2. factory 首次被 materialize 时执行，返回的 exports 就是模块导出。
 *   3. `id` 必须等于本包 package.json 的 `name`。
 *   4. `require` 只能取平台种子模块（react / react-dom / cordis / …）。
 *
 * **这个文件里看不到上面那段包装**：源码只导出 `apply`，`window.__ModuleLoader__.load({...})`
 * 由 `tools/build.mjs` 在构建时注入（包名只有 package.json 一处来源）。
 *
 * 本插件做什么：往 `settings.section`（list 座位）注册一页 **MCP** 设置页，
 * `order: 900` 使它落在设置导航的**最下方**（General 是 0，其余官方页在中间）；
 * 并把自己在设置导航里那一格的**齿轮图标换成 MCP 官方标记**——注册契约没有 icon 字段，
 * 官方 `navIcon(id)` 对未知 id 一律兜底成齿轮，所以只能渲染后打标记 + 样式覆盖
 * （见 nav-mark.ts 与 README 8.6；只 setAttribute，不动 React 的节点树）。
 *
 * 模块划分（P4 拆的，每个文件只负责一件事）：
 *   core/status.ts  运行时状态 → 颜色/文案（纯函数，可单测）
 *   core/draft.ts   记录 ↔ 草稿 ↔ 提交载荷（纯函数，可单测）
 *   core/api.ts     路由 / 超时预算 / 请求整理（不碰 React）
 *   styles.ts       样式表 + MCP 标记
 *   nav-mark.ts     全仓库唯一允许碰 DOM 的模块
 *   form.tsx        表单          row.tsx     一行摘要
 *   section.tsx     整页
 */
import { SECTION_ID, SECTION_LABEL } from '../shared/constants'
import { markNavCell } from './nav-mark'
import { McpSection } from './section'
import { ensureStyles } from './styles'
import type { ClientContext } from './service-types'

/**
 * 客户端插件体：在设置导航最下方注册一页 MCP 管理，并把导航那一格的齿轮换成 MCP 标记。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  // 幂等注入视觉层：inline style 的 background 会压过 :hover，
  // 所以视觉必须走 CSS，inline 只留布局。
  ensureStyles()
  // 导航那一格：注册契约里没有 icon 字段，只能渲染后自己覆盖。
  // ctx.effect 让 observer 与标记随插件卸载/热替换一起收掉。
  ctx.effect(markNavCell, 'ui-mcp-manager: nav mark')
  // 只注入 slots：数据面走同源 fetch，不需要 remote / connection 注入。
  ctx.inject(['slots'], (scope) => {
    scope.slots.inject('settings.section', () => {
      scope.slots.register(
        {
          name: 'settings.section',
          id: SECTION_ID,
          // General 是 0，官方其它页在中间；900 让本页落在设置列表最下方。
          order: 900,
          label: () => SECTION_LABEL,
        },
        McpSection,
      )
    })
  })
}
