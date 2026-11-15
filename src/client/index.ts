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
 * 由 `tools/build.ts` 在构建时注入（包名只有 package.json 一处来源）。
 *
 * 本插件做什么：往 `settings.section`（list 座位）注册一页 **MCP** 设置页，
 * `order: 900` 使它落在设置导航的**最下方**（General 是 0，其余官方页在中间）；
 * 再往 `settings.section.icon` 注册这一页的图标（MCP 官方标记，按 section id 认领）。
 *
 * 图标的历史：0.2.1 及更早的宿主没有 icon 座位，只能在渲染后给自己那一格打标记 + 两行 CSS。
 * 那套做法依赖官方 `<button><svg/><span/></button>` 的精确结构，0.2.2-alpha.3 把图标包进
 * `<span class="navIcon">` 之后就失效了（齿轮和标记同时显示）。现在改走注册参数，
 * 客户端产物**不碰 DOM**（唯一的 `document` 用法是注入样式表）。
 *
 * 模块划分（P4 拆的，每个文件只负责一件事）：
 *   core/status.ts  运行时状态 → 颜色/文案（纯函数，可单测）
 *   core/draft.ts   记录 ↔ 草稿 ↔ 提交载荷（纯函数，可单测）
 *   core/api.ts     路由 / 超时预算 / 请求整理（不碰 React）
 *   styles.ts       样式表
 *   mark.ts         MCP 标记几何（唯一来源，自检与 assets/mcp-mark.svg 逐字比对）
 *   icon.tsx        导航格图标组件（settings.section.icon 座位）
 *   form.tsx        表单          row.tsx     一行摘要
 *   section.tsx     整页
 */
import { SECTION_ID, SECTION_LABEL } from '../shared/constants.ts'
import { McpNavIcon } from './icon.tsx'
import { McpSection } from './section.tsx'
import { ensureStyles } from './styles.ts'
import type { ClientContext } from './service-types.ts'

/**
 * 客户端插件体：在设置导航最下方注册一页 MCP 管理，并给这一页注册 MCP 官方标记作图标。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  // 幂等注入视觉层：inline style 的 background 会压过 :hover，
  // 所以视觉必须走 CSS，inline 只留布局。
  ensureStyles()
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
    // 导航那一格的图标：官方按 section id 认领（`only: row.id`），所以 id 必须与上面一致。
    // 0.2.2-alpha.3 之前的宿主没有声明这个座位 → 回调永远不执行，官方齿轮照常兜底。
    scope.slots.inject('settings.section.icon', () => {
      scope.slots.register({ name: 'settings.section.icon', id: SECTION_ID }, McpNavIcon)
    })
  })
}
