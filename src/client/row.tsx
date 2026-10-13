/**
 * 一条已有服务器的摘要行：圆点 + 名称 + 同一行内的三个控件。
 */
import type { ReactElement } from 'react'
import { asRecord, asText } from '../shared/guards.ts'
import type { ServerSnapshot, ToolRecord } from '../shared/types.ts'
import { TOOL_PREVIEW_LIMIT } from './core/api.ts'
import { targetOf } from './core/draft.ts'
import { statusOf } from './core/status.ts'
import { Fragment, h, useState } from './react.ts'

export interface ServerRowProps {
  server: ServerSnapshot
  /** 宿主能不能主动探测：决定"active 但没记录"是报「未检测」还是报绿。 */
  canProbe: boolean
  busy: boolean
  editing: boolean
  onEdit: () => void
  onToggle: () => void
  onRemove: () => void
}

/**
 * 工具名单那块（卡片内的第三个子项）。
 * 抽成普通函数而不是组件：它只是把 ServerRow 的状态渲染出来，不需要自己的 hook，
 * 也不该在树上多一层。
 */
function toolsBlock(tools: ToolRecord, names: string[], open: boolean, onToggle: () => void): ReactElement {
  const total = typeof tools.count === 'number' && Number.isFinite(tools.count) ? tools.count : names.length
  const shown = open ? names : names.slice(0, TOOL_PREVIEW_LIMIT)
  const hidden = total - shown.length
  const items = shown.map((tool) => (
    <li className="mcpm-tool" key={tool} title={tool}>
      {tool}
    </li>
  ))
  if (hidden > 0) {
    items.push(
      <li className="mcpm-tool mcpm-tool--more" key="__more">
        {`+${String(hidden)} 个`}
      </li>,
    )
  }
  if (tools.truncated === true) {
    items.push(
      <li className="mcpm-tool mcpm-tool--more" key="__capped">
        名单已截断
      </li>,
    )
  }
  const collapsible = names.length > TOOL_PREVIEW_LIMIT
  return (
    <div className="mcpm-tools">
      <div className="mcpm-toolsHead">
        <span className="mcpm-toolsCount">{`工具 ${String(total)} 个`}</span>
        {collapsible ? (
          <button
            type="button"
            className="mcpm-toolsToggle"
            onClick={(): void => {
              onToggle()
            }}
            aria-expanded={open}
          >
            {open ? '收起' : `显示全部 ${String(names.length)} 个`}
          </button>
        ) : null}
      </div>
      <ul className="mcpm-toolsList">{items}</ul>
    </div>
  )
}

export function ServerRow({
  server,
  canProbe,
  busy,
  editing,
  onEdit,
  onToggle,
  onRemove,
}: ServerRowProps): ReactElement {
  const status = statusOf(server, canProbe)
  const [confirming, setConfirming] = useState(false)
  // 工具名单默认折叠到 TOOL_PREVIEW_LIMIT 个（状态只属于这一行，展开/收起互不影响）。
  const [toolsOpen, setToolsOpen] = useState(false)
  const config = asRecord(server.config)
  const name = asText(config.serverName) || '(未命名)'
  // 传输方式与 URL 不占版面，只在名称的 tooltip 里给出，悬停即可看到。
  const detail = `${status.text} · ${asText(config.transport) || 'streamable-http'} · ${targetOf(config)}`
  const enabled = server.disabled !== true
  // 原因行由 statusOf 给出：只有"红"的三种状态带原因（检测失败 / 日志记录 / 无）。
  // 绿或灰时不展示历史信息，避免"绿点 + 红字"这种自相矛盾的组合。
  const reason = status.reason
  const row = (
    <div className={enabled ? 'mcpm-row' : 'mcpm-row mcpm-row--off'}>
      {/* 唯一的 inline 样式：圆点颜色走官方 token（AGENTS 3.1 / 3.2）。 */}
      <span
        className="mcpm-dot"
        style={{ background: status.color }}
        title={status.text}
        aria-label={status.text}
        role="img"
      />
      <div className="mcpm-meta">
        <div className="mcpm-name" title={detail}>
          {name}
        </div>
      </div>
      <div className="mcpm-actions">
        {confirming ? (
          <>
            <button type="button" className="mcpm-btn mcpm-btn--danger" onClick={onRemove} disabled={busy}>
              确认删除
            </button>
            <button
              type="button"
              className="mcpm-btn"
              onClick={(): void => {
                setConfirming(false)
              }}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button type="button" className="mcpm-btn" onClick={onEdit} disabled={busy}>
              {editing ? '收起' : '编辑'}
            </button>
            <button
              type="button"
              className="mcpm-btn"
              title={enabled ? '停用这台服务器' : '启用这台服务器'}
              onClick={onToggle}
              disabled={busy}
            >
              {enabled ? '停用' : '启用'}
            </button>
            <button
              type="button"
              className="mcpm-btn mcpm-btn--danger"
              onClick={(): void => {
                setConfirming(true)
              }}
              disabled={busy}
            >
              删除
            </button>
          </>
        )}
      </div>
    </div>
  )
  // 原因行是**卡片内的第二个子项**（Fragment 不产生节点），操作区宽度不受影响；
  // title 放完整原文，避免窄面板里读不全。
  // 工具名单是第三个子项：只在宿主给了 `tools`（含 names 数组）时出现——旧宿主没有
  // 这个字段，就不渲染这块，天然向后兼容。
  const tools = server.tools
  const names = Array.isArray(tools?.names) ? (tools.names as unknown[]).map((item) => asText(item)) : null
  const toolsLine =
    tools === undefined || names === null
      ? null
      : toolsBlock(tools, names, toolsOpen, () => {
          setToolsOpen(!toolsOpen)
        })
  return (
    <>
      {row}
      {reason === null ? null : (
        <div className="mcpm-rowError" role="status" title={reason}>
          {reason}
        </div>
      )}
      {toolsLine}
    </>
  )
}
