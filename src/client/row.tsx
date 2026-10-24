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
  /** 这一行的启停意图还没落地（快照确认 + 相位稳定）：行内操作保持禁用，防重复点击。 */
  pending: boolean
  editing: boolean
  onEdit: () => void
  onToggle: () => void
  onRemove: () => void
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

/**
 * 来源说明：`profile` = 声明在 profile 补丁文件里（可原地编辑删除）；
 * `overridden` = 原始声明在别的层、这里只有覆写行（可"还原"）；
 * `external` = 原始声明在别的层且还没有覆写行（无法由此删除）。
 * 渲染成**纯文字**元数据：描边 chip 看起来像误放的按钮、压过真正的状态圆点；
 * 三态的含义放 title，悬停可见。
 */
const SOURCE_LABELS: Record<ServerSnapshot['source'], string> = {
  profile: '本地',
  overridden: '覆写',
  external: '外部',
}

const SOURCE_TITLES: Record<ServerSnapshot['source'], string> = {
  profile: '声明在 profile 补丁文件里：可直接编辑、启停、删除',
  overridden: '原始声明在别的插件或补丁层，这里只有一条覆写行；「还原」会删掉覆写行、恢复原配置',
  external: '原始声明在别的插件或补丁层：编辑或启停会自动追加覆写行，原始声明无法由此删除',
}

function SourceLabel({ source }: { source: ServerSnapshot['source'] }): ReactElement {
  return (
    <span className="mcpm-source" title={SOURCE_TITLES[source]}>
      {SOURCE_LABELS[source]}
    </span>
  )
}

export function ServerRow({
  server,
  canProbe,
  busy,
  pending,
  editing,
  onEdit,
  onToggle,
  onRemove,
}: ServerRowProps): ReactElement {
  const locked = busy || pending
  const status = statusOf(server, canProbe)
  const [confirming, setConfirming] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const config = asRecord(server.config)
  const name = server.serverName || asText(config.serverName) || server.id || '(未命名)'
  const detail = `${status.text} · ${asText(config.transport) || 'streamable-http'} · ${targetOf(config)}`
  const enabled = server.disabled !== true
  const external = server.source === 'external'
  const overridden = server.source === 'overridden'
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
      <div className="mcpm-nameLine">
        <span className="mcpm-name" title={detail}>
          {name}
        </span>
        <SourceLabel source={server.source} />
        <span className="mcpm-entryId" title={`Loader 条目 id：${server.id}`}>
          {server.id}
        </span>
      </div>
      <div className="mcpm-actions">
        {confirming ? (
          <>
            <button type="button" className="mcpm-btn mcpm-btn--danger" onClick={onRemove} disabled={locked}>
              {overridden ? '确认还原' : '确认删除'}
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
            <button type="button" className="mcpm-btn" onClick={onEdit} disabled={locked}>
              {editing ? '收起' : '编辑'}
            </button>
            <button
              type="button"
              className="mcpm-btn"
              title={enabled ? '停用这台服务器' : '启用这台服务器'}
              onClick={onToggle}
              disabled={locked}
            >
              {enabled ? '停用' : '启用'}
            </button>
            {external ? (
              <button
                type="button"
                className="mcpm-btn mcpm-btn--danger"
                disabled
                title="原始声明不在 profile 补丁文件里（由其他插件或补丁层声明），无法由此删除；可以停用"
              >
                删除
              </button>
            ) : (
              <button
                type="button"
                className="mcpm-btn mcpm-btn--danger"
                onClick={(): void => {
                  setConfirming(true)
                }}
                disabled={locked}
                title={overridden ? '删除覆写行，恢复外部原配置' : '从 profile 补丁文件里删除这台服务器'}
              >
                {overridden ? '还原' : '删除'}
              </button>
            )}
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
