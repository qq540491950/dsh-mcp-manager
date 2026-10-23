/** 一条 MCP 服务器的摘要行：圆点 + 名称 + 来源标记 + 行内操作。 */
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
  onAdopt: () => void
  onRelease: () => void
}

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

function SourceBadge({ source }: { source: ServerSnapshot['source'] }): ReactElement | null {
  if (source === 'insert') return <span className="mcpm-source mcpm-source--insert">insert</span>
  if (source === 'override') return <span className="mcpm-source mcpm-source--override">覆写</span>
  return <span className="mcpm-source mcpm-source--external">外部</span>
}

export function ServerRow({
  server,
  canProbe,
  busy,
  editing,
  onEdit,
  onToggle,
  onRemove,
  onAdopt,
  onRelease,
}: ServerRowProps): ReactElement {
  const status = statusOf(server, canProbe)
  const [confirming, setConfirming] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const config = asRecord(server.config)
  const name = server.serverName || asText(config.serverName) || server.id || '(未命名)'
  const detail = `${status.text} · ${asText(config.transport) || 'streamable-http'} · ${targetOf(config)}`
  const enabled = server.disabled !== true
  const external = server.source === 'external'
  const override = server.source === 'override'
  const reason = status.reason

  const row = (
    <div className={enabled ? 'mcpm-row' : 'mcpm-row mcpm-row--off'}>
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
        <div className="mcpm-sourceLine" title={`Loader 条目 id：${server.id}`}>
          <SourceBadge source={server.source} />
          <span className="mcpm-entryId">{server.id}</span>
        </div>
      </div>
      <div className="mcpm-actions">
        {external ? (
          <button
            type="button"
            className="mcpm-btn"
            onClick={onAdopt}
            disabled={busy}
            title="追加一条 - id 覆写行来编辑/启停这台外部 MCP；原声明保留"
          >
            接管
          </button>
        ) : confirming ? (
          <>
            <button
              type="button"
              className="mcpm-btn mcpm-btn--danger"
              onClick={override ? onRelease : onRemove}
              disabled={busy}
            >
              {override ? '确认取消接管' : '确认删除'}
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
              title={override ? '删除本插件的覆写行，恢复外部原配置' : '删除这条 insert 条目'}
            >
              {override ? '取消接管' : '删除'}
            </button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="mcpm-rowBody">
      {row}
      {reason === null ? null : <div className="mcpm-rowError">{reason}</div>}
      {server.tools === undefined
        ? null
        : toolsBlock(server.tools, server.tools.names, toolsOpen, () => {
            setToolsOpen((open) => !open)
          })}
    </div>
  )
}
