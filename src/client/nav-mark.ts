/**
 * 设置导航那一格（MCP 标记）——**全仓库唯一允许碰 DOM 的模块**。
 *
 * 为什么必须开这个例外（AGENTS 3.8）：设置导航图标由官方 `navIcon(id)` **硬编码查表**、
 * 未知 id 兜底成齿轮，`settings.section` 的注册契约里**没有 icon 字段**，
 * `sidebar.settings` 下也没有导航装饰座位。所以只能渲染后给自己那一格打标记 + 两行 CSS 覆盖。
 *
 * 例外被压到最小：只 `setAttribute`，不增删/不替换/不移动 React 管的节点，
 * 不读别的插件的 DOM，不往 `document.body` append 任何东西；卸载时 `removeAttribute` + `disconnect`。
 * 依赖官方 DOM 结构的代价是：DSH 改结构就静默失效（最坏只是继续显示齿轮）。
 * 若官方将来支持 `icon` 注册参数，就删掉这个文件。
 */
import { SECTION_LABEL } from '../shared/constants'

/** 官方设置面板的定位锚点：SettingsPanel 上写死的 data 属性，比 CSS-module 哈希名稳。 */
const NAV_DIALOG_SELECTOR = '[data-shortcut-modal="settings"]'

/** 打在「MCP」那一格上的标记属性；样式表按它覆盖官方图标。 */
const NAV_ATTRIBUTE = 'data-mcpm-nav'

/**
 * 认出设置面板导航里属于本插件的那一格。
 *
 * 官方结构（dsh-client-ui-settings-general 的 SettingsRoot）：
 * `[data-shortcut-modal="settings"] > nav > button > [svg, span(localized label)]`。
 * 官方 class 名是 CSS-module 哈希（`wCInkW_navCell` 那类，会随构建变），所以这里
 * **按我们自己注册的 label 文本**定位——它同时是唯一的锚点与幂等保证。
 * @returns 那一格的 <button>；面板没开或找不到就 null。
 */
export function findNavCell(): Element | null {
  for (const dialog of document.querySelectorAll(NAV_DIALOG_SELECTOR)) {
    const nav = dialog.querySelector('nav')
    if (nav === null) continue
    for (const cell of nav.querySelectorAll('button')) {
      const label = cell.lastElementChild
      if (label !== null && label.tagName === 'SPAN' && label.textContent === SECTION_LABEL) return cell
    }
  }
  return null
}

/**
 * 给导航里那一格打标记，剩下的交给样式表（隐藏官方 svg、画 MCP 标记）。
 *
 * 只做 `setAttribute`：不增删 React 管的节点，所以重渲染不会打架；面板关闭后旧节点
 * 自然失效，用 `isConnected` 判断何时该重新找。MutationObserver 挂在 body 上做
 * 「找到就停」的同步——已标记且仍在文档里时只是一次属性读，不查 DOM。
 * @returns 清理函数（注册进 ctx.effect，插件卸载或热替换时调用）。
 */
export function markNavCell(): () => void {
  const noop = (): void => {}
  if (typeof document === 'undefined') return noop
  // lib.dom 把 `document.body` 声明成非空，但脚本可能在 <body> 解析出来之前执行 ——
  // 按运行时事实读一次，别信声明。（写成 `const body: HTMLElement | null = document.body`
  // 没用：TS 会按初始值把 body 收窄成非空，于是下面的检查被判成"恒不成立"。）
  const doc = document as { body: HTMLElement | null }
  const body = doc.body
  if (body === null) return noop
  // 同理：lib.dom 说 MutationObserver 一定存在，实际取决于宿主环境。
  // 通过 globalThis 读，这个检查才是"真的在检查"（直接 `typeof MutationObserver` 会被判成恒真）。
  const api = globalThis as { MutationObserver?: typeof MutationObserver | undefined }
  const Observer = api.MutationObserver
  if (Observer === undefined) return noop
  let marked: Element | null = null
  const sync = (): void => {
    if (marked !== null && marked.isConnected && marked.getAttribute(NAV_ATTRIBUTE) === '1') return
    const cell = findNavCell()
    if (cell === null) return
    cell.setAttribute(NAV_ATTRIBUTE, '1')
    marked = cell
  }
  sync()
  const observer = new Observer(sync)
  observer.observe(body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    if (marked !== null && marked.isConnected) marked.removeAttribute(NAV_ATTRIBUTE)
    marked = null
  }
}
