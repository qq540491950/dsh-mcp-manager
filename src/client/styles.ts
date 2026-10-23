/**
 * 视觉层：样式表 + MCP 官方标记。
 *
 * 采用**紧凑档**：数值取自官方小号控件
 * （`ui-primitives/Button.module.css` 的 `.sm` = 28px 高 / 12px 字号 /
 * `0 10px` 内边距 / `--dsw-radius-sm`），行高与间距随之收紧一档。
 *
 * 自适应：所有会在窄容器里溢出的地方都给 `min-width:0` + 省略号；
 * 操作区 `flex:none` 且不换行，信息区吸收压缩——面板变窄时先省略文字，
 * 而不是把按钮挤到第二行或撑破卡片。
 *
 * 纪律（都由 tools/verify.ts 的 A11–A25 断言守住）：
 *   1. **绝不硬编码前景色**。深色主题下 `brand-primary` 近白色，曾把主按钮做成白底白字。
 *   2. **说明文字不能和按钮同处一个 flex 行**，否则按钮被压成竖排两字。
 *   3. **视觉不要写在 inline style 里**：inline 的 `background` 会压过 `:hover`，
 *      导致按钮没有 hover/focus 反馈（截图里"廉价感"的主因）。
 *   4. **尺寸也不要写 inline**：inline 会压过样式表，换紧凑档时看不到效果。
 */

/** 注入的 <style> 元素 id。 */
export const STYLE_ELEMENT_ID = 'dsh-mcp-manager-styles'

/**
 * MCP 官方标记（三联弧线笔画）。几何逐字取自官方仓库
 * `modelcontextprotocol/modelcontextprotocol` 的 `docs/favicon.svg`（那三条
 * stroke-width=11.0667 / linecap=round 的 path），只加一层 translate+scale 缩进 16x16：
 * 墨迹高 15、宽 13.4851（居中），有效描边 1.0——官方自然比例是 1.043，
 * 但 16px 下笔画之间的缝只剩约 1px，4% 的加粗就会把缝糊死（实测覆盖率 0.169 → 0.242）。
 *
 * 同源的可读版本是 `assets/mcp-mark.svg`；自检逐字比对两份，防止漂移。
 * 作为 CSS mask 用时只看 alpha：data URI 里的 `currentColor` 会退化成初始色，
 * 真正的颜色由使用处的 `background-color:currentColor` 提供。
 */
export const MCP_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round"><g transform="translate(-0.44525 -0.50229) scale(0.0942473)" stroke-width="10.61038"><path d="M23.5996 85.2532L86.2021 22.6507C94.8457 14.0071 108.86 14.0071 117.503 22.6507C126.147 31.2942 126.147 45.3083 117.503 53.9519L70.2254 101.23"/><path d="M70.8789 100.578L117.504 53.952C126.148 45.3083 140.163 45.3083 148.806 53.952L149.132 54.278C157.776 62.9216 157.776 76.9357 149.132 85.5792L92.5139 142.198C89.6327 145.079 89.6327 149.75 92.5139 152.631L104.14 164.257"/><path d="M101.853 38.3013L55.553 84.6011C46.9094 93.2447 46.9094 107.258 55.553 115.902C64.1966 124.546 78.2106 124.546 86.8543 115.902L133.154 69.6025"/></g></svg>'

/** 同一份几何的 data URI（给 CSS mask 用）；encodeURIComponent 负责转义引号与尖括号。 */
const MCP_MARK_DATA_URI = `data:image/svg+xml,${encodeURIComponent(MCP_MARK_SVG)}`

/** class 名统一 `mcpm-` 前缀，避免与官方样式冲突。 */
export const CSS = `
.mcpm-page { box-sizing:border-box; width:100%; max-width:720px; min-width:0; display:flex; flex-direction:column; gap:12px; padding:4px 0; color:var(--dsw-alias-label-primary); font-size:13px; line-height:18px; }
.mcpm-heading { display:flex; flex-direction:column; gap:2px; min-width:0; }
.mcpm-titleRow { display:flex; align-items:center; justify-content:space-between; gap:10px; min-width:0; }
.mcpm-title { margin:0; font-size:13px; font-weight:500; line-height:18px; }
.mcpm-subtitle { margin:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
/* 「检测中…」：自动检测在后台跑，用这行小字说明"状态还在刷新"，而不是锁住按钮。 */
.mcpm-probing { min-width:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; white-space:nowrap; }
/* 每个服务器一张卡（对齐 ui-settings-models 的 .rows/.rowCard）。 */
.mcpm-rows { display:flex; flex-direction:column; gap:8px; margin:0; padding:0; list-style:none; }
.mcpm-rowCard { box-sizing:border-box; min-width:0; display:flex; flex-direction:column; gap:10px; border:.5px solid var(--dsw-alias-settings-card-stroke); border-radius:var(--dsw-radius-lg, 8px); background:var(--dsw-alias-settings-card-fill); padding:8px 12px; }
.mcpm-row { box-sizing:border-box; min-width:0; display:flex; align-items:center; gap:10px; min-height:28px; }
/* 停用的行整体压暗：只靠圆点颜色区分太弱，用户会以为"没生效"。 */
.mcpm-row--off .mcpm-name { color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.mcpm-row--off .mcpm-dot { opacity:.45; }
/* 失败原因：一行小字跟在行下面（仍在同一张卡内）。min-width:0 是自适应纪律；
   overflow-wrap:anywhere 让 fetch/路径这类长串在窄面板里也能断行，不撑破卡片。 */
.mcpm-rowError { min-width:0; color:var(--dsw-alias-state-error-primary, #d9534f); font-size:12px; line-height:16px; overflow-wrap:anywhere; }
/* 工具名单：卡片内的第三块（行 → 原因 → 工具）。名字是标识符，用等宽字体；
   超过 TOOL_PREVIEW_LIMIT 就只留前几个 + 「+N 个」，由用户点开。 */
.mcpm-tools { display:flex; flex-direction:column; gap:6px; min-width:0; }
.mcpm-toolsHead { display:flex; align-items:center; gap:8px; min-width:0; }
.mcpm-toolsCount { min-width:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
.mcpm-toolsList { display:flex; flex-wrap:wrap; gap:4px; min-width:0; margin:0; padding:0; list-style:none; }
.mcpm-tool { box-sizing:border-box; min-width:0; max-width:100%; padding:1px 6px; border:.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-sm, 4px); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font-family:ui-monospace, monospace; font-size:12px; line-height:16px; overflow-wrap:anywhere; }
.mcpm-tool--more { color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
/* 「显示全部 / 收起」沿用紧凑档按钮尺寸（28px / 12px），不引入新档位。 */
.mcpm-toolsToggle { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; flex:none; white-space:nowrap; height:24px; padding:0 8px; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-sm, 4px); background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; line-height:18px; cursor:pointer; }
.mcpm-toolsToggle:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.mcpm-toolsToggle:focus-visible { outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset:1px; }
.mcpm-empty { padding:8px 0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
/* 「页面外」服务器（顶层 Loader 条目，本页只读）。
   用一条顶部分隔线把它和本页管理的卡片分开：不加外框/底色 = 不会叠成"卡片套卡片"（AGENTS 3.4）。
   行结构与本页的 .mcpm-row 一致（圆点 + meta），只是没有操作区。 */
.mcpm-outside { box-sizing:border-box; min-width:0; display:flex; flex-direction:column; gap:8px; padding-top:4px; border-top:.5px solid var(--dsw-alias-border-l2); }
.mcpm-outsideHead { display:flex; align-items:center; gap:8px; min-width:0; }
.mcpm-outsideTitle { min-width:0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:16px; }
.mcpm-outsideHint { min-width:0; margin:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; overflow-wrap:anywhere; }
.mcpm-outsideRows { display:flex; flex-direction:column; gap:6px; min-width:0; margin:0; padding:0; list-style:none; }
.mcpm-outsideRow { box-sizing:border-box; display:flex; align-items:center; gap:10px; min-width:0; min-height:28px; }
/* 来源（loader 条目 id）比名称弱一档：它是"这条从哪来"的线索，不是服务器名。 */
.mcpm-outsideSource { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
.mcpm-meta { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }
.mcpm-name { font-size:13px; font-weight:500; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mcpm-dot { flex:none; width:6px; height:6px; border-radius:50%; }
/* 操作区必须单行：flex:none 才不会被左侧长文本压缩，去掉 wrap 才不会把"删除"折到下一行。 */
.mcpm-actions { display:flex; align-items:center; justify-content:flex-end; flex:none; gap:4px; margin-left:auto; }
/* 按钮 = 官方 .rowActions 的尺寸（28px / 12px / 0 10px），本来就是紧凑档。 */
.mcpm-btn { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; flex:none; white-space:nowrap; height:28px; min-width:44px; padding:0 10px; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-sm, 4px); background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; line-height:18px; cursor:pointer; }
.mcpm-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.mcpm-btn:active:not(:disabled) { background:var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover)); }
.mcpm-btn:focus-visible { outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset:1px; }
.mcpm-btn:disabled { opacity:.4; cursor:not-allowed; }
.mcpm-btn--primary { border-color:transparent; background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); color:var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base)); font-weight:500; }
.mcpm-btn--primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))); }
.mcpm-btn--danger { color:var(--dsw-alias-state-error-primary, #d9534f); }
/* 表单是卡片**内部**的面板：靠**底色**区分（官方 .addCard 的 bg-module-platform），
   自己**不带描边**——描边会和外层卡片叠成「卡片套卡片」，这正是之前丑的原因。 */
.mcpm-form { box-sizing:border-box; min-width:0; display:flex; flex-direction:column; gap:8px; padding:10px 12px; border-radius:var(--dsw-radius-lg, 8px); background:var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1)); }
.mcpm-formTitle { margin:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
.mcpm-field { display:flex; flex-direction:column; gap:4px; min-width:0; }
/* 官方 .fieldLabel：12px / 500 / label-secondary。 */
.mcpm-label { color:var(--dsw-alias-label-secondary); font-size:12px; font-weight:500; line-height:16px; }
/* 官方 .input：border-l4 + bg-layer-1 + radius-md，focus 只换描边不画 outline。 */
.mcpm-input { box-sizing:border-box; width:100%; height:28px; padding:0 8px; border:.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l3)); border-radius:var(--dsw-radius-md, 6px); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; line-height:18px; }
.mcpm-input::placeholder { color:var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))); }
.mcpm-input:focus-visible { border-color:var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline:none; }
/* 等宽只是字体，和「多行」无关；两者混用曾把 url 渲染成 56px 的大框。 */
.mcpm-input--mono { font-family:ui-monospace, monospace; }
.mcpm-textarea { height:auto; min-height:56px; padding:6px 8px; font-size:12px; line-height:16px; }
.mcpm-notice { box-sizing:border-box; min-width:0; padding:8px 12px; border:.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md, 6px); font-size:12px; line-height:16px; }
.mcpm-notice--error { color:var(--dsw-alias-state-error-primary, #d9534f); border-color:currentColor; }
.mcpm-actions--form { justify-content:flex-end; margin-left:0; }
/* 设置导航里「MCP」那一格。
   官方 navIcon(id) 是**硬编码 id→图标**、未知 id 一律兜底成齿轮
   （dsh-client-ui-settings-general/lib/client.js:244-267），而 settings.section 的注册契约
   只有 id/order/label、**没有 icon 字段**，所以只能渲染后给自己那一格打标记再覆盖：
     · display:none 让官方 <svg> 退出 flex 流（label 的位置因此不变，gap 也不多算一格）；
     · ::before + mask 画 MCP 标记，颜色走 currentColor（mask 只取 alpha）。
   React 的节点树一个都不动：不删、不换、不 append 到 body。 */
[data-shortcut-modal="settings"] button[data-mcpm-nav] > svg { display:none; }
[data-shortcut-modal="settings"] button[data-mcpm-nav]::before { content:""; flex:none; width:16px; height:16px; background-color:currentColor; -webkit-mask:url("${MCP_MARK_DATA_URI}") center/contain no-repeat; mask:url("${MCP_MARK_DATA_URI}") center/contain no-repeat; }
`

/**
 * 注入视觉层。幂等，但**不是「元素存在就跳过」**：客户端半边会热替换（`dsh-client-hmr`
 * 按 mtime/size 发新 rev），此时样式表元素还在、CSS 文本却变了——只按 id 跳过会让
 * 改过的样式永远不生效（实测踩过：导航那两行规则加了却没进页面，图标仍是齿轮）。
 * 所以存在时比对文本、不一致就原地更新，不重复 append。
 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ELEMENT_ID)
  if (existing !== null) {
    if (existing.textContent !== CSS) existing.textContent = CSS
    return
  }
  const element = document.createElement('style')
  element.id = STYLE_ELEMENT_ID
  element.textContent = CSS
  document.head.appendChild(element)
}
