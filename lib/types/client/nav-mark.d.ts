/**
 * 认出设置面板导航里属于本插件的那一格。
 *
 * 官方结构（dsh-client-ui-settings-general 的 SettingsRoot）：
 * `[data-shortcut-modal="settings"] > nav > button > [svg, span(localized label)]`。
 * 官方 class 名是 CSS-module 哈希（`wCInkW_navCell` 那类，会随构建变），所以这里
 * **按我们自己注册的 label 文本**定位——它同时是唯一的锚点与幂等保证。
 * @returns 那一格的 <button>；面板没开或找不到就 null。
 */
export declare function findNavCell(): Element | null;
/**
 * 给导航里那一格打标记，剩下的交给样式表（隐藏官方 svg、画 MCP 标记）。
 *
 * 只做 `setAttribute`：不增删 React 管的节点，所以重渲染不会打架；面板关闭后旧节点
 * 自然失效，用 `isConnected` 判断何时该重新找。MutationObserver 挂在 body 上做
 * 「找到就停」的同步——已标记且仍在文档里时只是一次属性读，不查 DOM。
 * @returns 清理函数（注册进 ctx.effect，插件卸载或热替换时调用）。
 */
export declare function markNavCell(): () => void;
