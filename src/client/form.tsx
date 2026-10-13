/**
 * 表单：文本字段 + 服务器新增/编辑面板。
 */
import type { ChangeEvent, FormEvent, ReactElement } from 'react'
import type { Draft } from './core/draft'
import { Fragment, h } from './react'

/** 传输方式（顺序即下拉框顺序）。 */
const TRANSPORTS = ['streamable-http', 'stdio']

export interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string | undefined
  /** 只换等宽字体。 */
  mono?: boolean | undefined
  /** 换成真正的 `<textarea>`。 */
  multiline?: boolean | undefined
}

/**
 * 文本字段。两个**互不相关**的开关：
 *   - `mono`      → 只影响字体（等宽，便于看标识符/URL/命令行）
 *   - `multiline` → 换成真正的 `<textarea>`
 * 曾经把两者混在一个 `mono` 上，导致 url 这种单行字段被渲染成 56px 的多行大框。
 */
export function Field({ label, value, onChange, placeholder, mono, multiline }: FieldProps): ReactElement {
  const className = ['mcpm-input', mono ? 'mcpm-input--mono' : null, multiline ? 'mcpm-textarea' : null]
    .filter(Boolean)
    .join(' ')
  const shared = {
    className,
    value,
    placeholder,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      onChange(event.target.value)
    },
  }
  return (
    <label className="mcpm-field">
      <span className="mcpm-label">{label}</span>
      {/* 尺寸完全交给样式表，不留 inline 高度（inline 会压过 CSS）。 */}
      {multiline ? <textarea {...shared} rows={3} spellCheck={false} /> : <input {...shared} />}
    </label>
  )
}

export interface ServerFormProps {
  draft: Draft
  onDraft: (draft: Draft) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
  error: string | null
  isNew: boolean
}

/** 服务器新增/编辑表单。 */
export function ServerForm({ draft, onDraft, onSubmit, onCancel, busy, error, isNew }: ServerFormProps): ReactElement {
  const stdio = draft.transport === 'stdio'
  return (
    <form
      className="mcpm-form"
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="mcpm-formTitle">{isNew ? '新增 MCP 服务器' : `编辑 ${draft.serverName || '服务器'}`}</div>
      <Field
        label="名称（serverName，1-32 位字母数字下划线连字符）"
        value={draft.serverName}
        onChange={(value): void => {
          onDraft({ ...draft, serverName: value })
        }}
        placeholder="context7"
      />
      <label className="mcpm-field">
        <span className="mcpm-label">传输方式</span>
        <select
          className="mcpm-input"
          value={draft.transport}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
            onDraft({ ...draft, transport: event.target.value })
          }}
        >
          {TRANSPORTS.map((transport) => (
            <option key={transport} value={transport}>
              {transport}
            </option>
          ))}
        </select>
      </label>
      {stdio ? (
        <>
          <Field
            label="command"
            value={draft.command}
            onChange={(value): void => {
              onDraft({ ...draft, command: value })
            }}
            placeholder="npx"
            mono
          />
          <Field
            label="args（每行一个）"
            value={draft.args}
            onChange={(value): void => {
              onDraft({ ...draft, args: value })
            }}
            placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\work'}
            mono
            multiline
          />
          <Field
            label="env（每行 KEY=VALUE）"
            value={draft.env}
            onChange={(value): void => {
              onDraft({ ...draft, env: value })
            }}
            placeholder="API_KEY=sk-..."
            mono
            multiline
          />
          <Field
            label="cwd（可选）"
            value={draft.cwd}
            onChange={(value): void => {
              onDraft({ ...draft, cwd: value })
            }}
            mono
          />
        </>
      ) : (
        <>
          <Field
            label="url"
            value={draft.url}
            onChange={(value): void => {
              onDraft({ ...draft, url: value })
            }}
            placeholder="https://mcp.context7.com/mcp"
            mono
          />
          <Field
            label="headers（每行 KEY=VALUE，密钥会明文写进 profile 配置）"
            value={draft.headers}
            onChange={(value): void => {
              onDraft({ ...draft, headers: value })
            }}
            placeholder="Authorization=Bearer ..."
            mono
            multiline
          />
        </>
      )}
      {error === null ? null : <div className="mcpm-notice mcpm-notice--error">{error}</div>}
      <div className="mcpm-actions mcpm-actions--form">
        <button type="button" className="mcpm-btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" className="mcpm-btn mcpm-btn--primary" disabled={busy}>
          {isNew ? '添加' : '保存'}
        </button>
      </div>
    </form>
  )
}
