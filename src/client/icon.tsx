/**
 * 设置导航里「MCP」那一格的图标。
 *
 * 走官方 `settings.section.icon` 座位（DSH 0.2.2-alpha.3 起）：座位按 **section id** 认领
 * （`only: row.id`），所以我们注册的 `id` 必须与 `settings.section` 相同；owner props 是
 * `{ size, active }`，官方当前给 16。
 *
 * 为什么不再自己改 DOM：旧宿主没有这个座位，只能在渲染后给自己那一格打标记 + 两行 CSS；
 * 那套做法依赖官方 `<button><svg/><span/></button>` 的精确结构。0.2.2-alpha.3 把图标包进
 * `<span class="navIcon">` 之后，`button[data-mcpm-nav] > svg` 一条都不命中 —— 齿轮和标记
 * 同时显示（两个图标）。现在几何交给 React 渲染，官方结构怎么变都与本插件无关
 * （AGENTS 3.8 的 DOM 例外随之删除）。
 *
 * 颜色只写 `currentColor`：跟随按钮的 `color`，选中态由官方样式表负责，不需要 `active`。
 */
import type { ReactElement } from 'react'
import { MCP_MARK_PATHS, MCP_MARK_SIZE, MCP_MARK_STROKE_WIDTH, MCP_MARK_TRANSFORM, MCP_MARK_VIEW_BOX } from './mark.ts'
import { h } from './react.ts'

/** 座位给的 owner props（`settings.section.icon`）。 */
export interface McpNavIconProps {
  /** 请求的正方形边长（px）；缺省用标记的自然尺寸。 */
  size?: number
  /** 该页是否选中。标记是纯笔画 + currentColor，选中态不需要额外处理。 */
  active?: boolean
}

/**
 * MCP 标记（16x16 的三联弧线笔画），尺寸由座位给。
 * @param props - 座位给的 `size` / `active`。
 * @returns 一个 `<svg>` 元素。
 */
export function McpNavIcon({ size = MCP_MARK_SIZE }: McpNavIconProps): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={MCP_MARK_VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <g transform={MCP_MARK_TRANSFORM} strokeWidth={MCP_MARK_STROKE_WIDTH}>
        {MCP_MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}
