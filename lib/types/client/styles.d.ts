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
 * 纪律（都由 tools/verify.mjs 的 A11–A25 断言守住）：
 *   1. **绝不硬编码前景色**。深色主题下 `brand-primary` 近白色，曾把主按钮做成白底白字。
 *   2. **说明文字不能和按钮同处一个 flex 行**，否则按钮被压成竖排两字。
 *   3. **视觉不要写在 inline style 里**：inline 的 `background` 会压过 `:hover`，
 *      导致按钮没有 hover/focus 反馈（截图里"廉价感"的主因）。
 *   4. **尺寸也不要写 inline**：inline 会压过样式表，换紧凑档时看不到效果。
 */
/** 注入的 <style> 元素 id。 */
export declare const STYLE_ELEMENT_ID = "dsh-mcp-manager-styles";
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
export declare const MCP_MARK_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\"><g transform=\"translate(-0.44525 -0.50229) scale(0.0942473)\" stroke-width=\"10.61038\"><path d=\"M23.5996 85.2532L86.2021 22.6507C94.8457 14.0071 108.86 14.0071 117.503 22.6507C126.147 31.2942 126.147 45.3083 117.503 53.9519L70.2254 101.23\"/><path d=\"M70.8789 100.578L117.504 53.952C126.148 45.3083 140.163 45.3083 148.806 53.952L149.132 54.278C157.776 62.9216 157.776 76.9357 149.132 85.5792L92.5139 142.198C89.6327 145.079 89.6327 149.75 92.5139 152.631L104.14 164.257\"/><path d=\"M101.853 38.3013L55.553 84.6011C46.9094 93.2447 46.9094 107.258 55.553 115.902C64.1966 124.546 78.2106 124.546 86.8543 115.902L133.154 69.6025\"/></g></svg>";
/** class 名统一 `mcpm-` 前缀，避免与官方样式冲突。 */
export declare const CSS: string;
/**
 * 注入视觉层。幂等，但**不是「元素存在就跳过」**：客户端半边会热替换（`dsh-client-hmr`
 * 按 mtime/size 发新 rev），此时样式表元素还在、CSS 文本却变了——只按 id 跳过会让
 * 改过的样式永远不生效（实测踩过：导航那两行规则加了却没进页面，图标仍是齿轮）。
 * 所以存在时比对文本、不一致就原地更新，不重复 append。
 */
export declare function ensureStyles(): void;
