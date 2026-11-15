/**
 * 视觉层：本页（MCP 设置页）的样式表。
 *
 * 导航那一格**不在这里**：图标已改走官方 `settings.section.icon` 座位、由 React 渲染
 * （`icon.tsx`）。0.2.1 及更早的宿主没有这个座位，才需要"渲染后打标记 + 两行 CSS"；
 * 那套做法在 0.2.2 上会画出两个图标（官方把图标包进了 `span.navIcon`，`> svg` 不再命中），
 * 已随版本升级删除。这里只剩本页自己的类，一个 `[data-shortcut-modal]` 选择器都没有。
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
/* 标题行：名称 · 来源说明 · 条目 id 同一行。来源与 id 是**纯文字**元数据（描边 chip 会像
   误放的按钮、压过真正的状态圆点），分隔点走 ::before/::after；三态含义在 title 里。
   挤压顺序：名称与 id 都可省略（min-width:0），来源说明只有两字、不收缩。 */
.mcpm-nameLine { flex:1 1 auto; min-width:0; display:flex; align-items:baseline; }
.mcpm-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; font-weight:500; line-height:18px; }
.mcpm-source { flex:none; color:var(--dsw-alias-label-secondary); font-size:11px; line-height:14px; white-space:nowrap; }
.mcpm-source::before, .mcpm-source::after { content:"·"; margin:0 5px; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.mcpm-entryId { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-family:ui-monospace, monospace; font-size:11px; line-height:14px; }
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
