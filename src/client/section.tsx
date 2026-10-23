/**
 * 设置面板里的一页：MCP 服务器管理。
 *
 * v0.3.0 数据模型：每台 MCP 是 profile 里一条顶层 Loader 条目。
 *   - 本插件新增 → `- insert:` 行；
 *   - 本插件接管的外部条目 → `- id: X` 覆写行；
 *   - 未接管的外部条目 → 只读，点「接管」后才可编辑/启停。
 *
 * 两条**互斥**的错误通道（AGENTS 3.9）：
 *   formError   ← 表单提交失败，只渲染在那张表单里
 *   actionError ← 行内操作（接管/启停/删除/检测）失败，只渲染在页面级
 */
import type { ReactElement } from 'react'
import { asRecord, asText } from '../shared/guards.ts'
import type { ServerSnapshot, Snapshot } from '../shared/types.ts'
import { describeError, getSnapshot, postOp, SETTLE_ATTEMPTS, SETTLE_INTERVAL_MS, sleep } from './core/api.ts'
import { draftOf, serverOf, supports, suggestName } from './core/draft.ts'
import type { Draft } from './core/draft.ts'
import { settling } from './core/status.ts'
import { ServerForm } from './form.tsx'
import { Fragment, h, useCallback, useEffect, useMemo, useState } from './react.ts'
import { ServerRow } from './row.tsx'

function emptyDraft(): Draft {
  return {
    serverName: 'server-1',
    transport: 'streamable-http',
    url: '',
    command: '',
    args: '',
    env: '',
    headers: '',
    cwd: '',
    disabled: false,
  }
}

export function McpSection(): ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)

  const refresh = useCallback(async (): Promise<Snapshot | null> => {
    try {
      const data = await getSnapshot()
      setSnapshot(data)
      setLoadError(null)
      setActionError(null)
      return data
    } catch (error) {
      setLoadError(describeError(error))
      return null
    }
  }, [])

  const call = useCallback(
    async (
      payload: Record<string, unknown>,
      after?: (data: Snapshot) => void,
      onError?: (message: string) => void,
      options?: { silent?: boolean | undefined },
    ): Promise<Snapshot | null> => {
      const silent = options?.silent === true
      if (silent) setProbing(true)
      else setBusy(true)
      setFormError(null)
      setActionError(null)
      try {
        const data = await postOp(payload)
        setSnapshot(data)
        after?.(data)
        return data
      } catch (error) {
        onError?.(describeError(error))
        return null
      } finally {
        if (silent) setProbing(false)
        else setBusy(false)
      }
    },
    [],
  )

  const servers = useMemo(() => snapshot?.servers ?? [], [snapshot])
  const managed = useMemo(() => servers.filter((server) => server.source !== 'external'), [servers])
  const external = useMemo(() => servers.filter((server) => server.source === 'external'), [servers])

  const detect = useCallback(
    (options?: { silent?: boolean | undefined }): void => {
      void call({ op: 'probe' }, undefined, setActionError, options)
    },
    [call],
  )

  const recheck = useCallback(
    async (data: Snapshot | null): Promise<void> => {
      if (!supports(data, 'probe')) return
      let current = await call({ op: 'probe' }, undefined, setActionError, { silent: true })
      for (let attempt = 0; attempt < SETTLE_ATTEMPTS && settling(current); attempt += 1) {
        await sleep(SETTLE_INTERVAL_MS)
        current = await refresh()
      }
    },
    [call, refresh],
  )

  const recheckAfter = useCallback(
    (data: Snapshot): void => {
      void recheck(data)
    },
    [recheck],
  )

  useEffect(() => {
    const lifecycle = { cancelled: false }
    void (async (): Promise<void> => {
      const data = await refresh()
      if (lifecycle.cancelled || !supports(data, 'patchInsert') || !supports(data, 'probe')) return
      void recheck(data)
    })()
    return (): void => {
      lifecycle.cancelled = true
    }
  }, [refresh, recheck])

  const openNew = useCallback((): void => {
    setEditing('new')
    setFormError(null)
    setDraft({ ...emptyDraft(), serverName: suggestName(servers) })
  }, [servers])

  const closeForm = useCallback((): void => {
    setEditing(null)
    setFormError(null)
  }, [])

  const afterWrite = useCallback(
    (data: Snapshot): void => {
      setEditing(null)
      setDraft(null)
      recheckAfter(data)
    },
    [recheckAfter],
  )

  const submit = useCallback((): void => {
    if (draft === null) return
    const server = serverOf(draft)
    const duplicated = servers.some(
      (item) =>
        item.id !== editing && (item.serverName || asText(asRecord(item.config).serverName)) === server.serverName,
    )
    if (duplicated) {
      setFormError(`服务器名 "${server.serverName}" 已存在；同一作用域内 serverName 必须唯一。`)
      return
    }
    if (editing === 'new') {
      void call({ op: 'add', server }, afterWrite, setFormError)
      return
    }
    void call({ op: 'update', entryId: editing, server }, afterWrite, setFormError)
  }, [afterWrite, call, draft, editing, servers])

  const toggle = useCallback(
    (server: ServerSnapshot): void => {
      if (server.source === 'external') {
        setActionError('这是外部 MCP；请先点「接管」')
        return
      }
      void call(
        { op: 'setEnabled', entryId: server.id, enabled: server.disabled === true },
        recheckAfter,
        setActionError,
      )
    },
    [call, recheckAfter],
  )

  const remove = useCallback(
    (server: ServerSnapshot): void => {
      if (server.source === 'external') {
        setActionError('外部 MCP 的原条目不能由本插件删除；可先接管再取消接管')
        return
      }
      const op = server.source === 'override' ? 'release' : 'remove'
      void call({ op, entryId: server.id }, recheckAfter, setActionError)
    },
    [call, recheckAfter],
  )

  const adopt = useCallback(
    (server: ServerSnapshot): void => {
      void call({ op: 'adopt', entryId: server.id }, recheckAfter, setActionError)
    },
    [call, recheckAfter],
  )

  const migrate = useCallback((): void => {
    void call({ op: 'migrate' }, recheckAfter, setActionError)
  }, [call, recheckAfter])

  const canPatch = supports(snapshot, 'patchInsert') && snapshot?.patchError === undefined
  const canProbe = supports(snapshot, 'probe')
  const legacy = snapshot?.legacy
  const patchError = snapshot?.patchError
  const missing = snapshot?.missing ?? []

  const header = (
    <div className="mcpm-heading">
      <div className="mcpm-titleRow">
        <h3 className="mcpm-title">MCP 服务器</h3>
        <div className="mcpm-actions">
          {probing ? <span className="mcpm-probing">检测中…</span> : null}
          <button
            type="button"
            className="mcpm-btn"
            onClick={(): void => {
              detect()
            }}
            disabled={busy || probing || !canProbe || !canPatch}
            title={
              canProbe ? '现在向每台启用中的 MCP 条目发一次 MCP 握手' : '需要重启 DSH（宿主半边不热重载）后才能检测'
            }
          >
            检测
          </button>
          <button
            type="button"
            className="mcpm-btn"
            onClick={(): void => {
              void refresh()
            }}
            disabled={busy}
          >
            刷新
          </button>
          <button type="button" className="mcpm-btn mcpm-btn--primary" onClick={openNew} disabled={busy || !canPatch}>
            新增
          </button>
        </div>
      </div>
      <p className="mcpm-subtitle">新增的服务器写成顶层 insert 条目；外部条目可点「接管」追加覆写行，原声明保留。</p>
    </div>
  )

  if (loadError !== null) {
    return (
      <div className="mcpm-page">
        {header}
        <div className="mcpm-notice mcpm-notice--error">{`读取失败：${loadError}`}</div>
        <div className="mcpm-actions mcpm-actions--form">
          <button
            type="button"
            className="mcpm-btn"
            onClick={(): void => {
              void refresh()
            }}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  if (snapshot === null) {
    return (
      <div className="mcpm-page">
        {header}
        <div className="mcpm-notice">正在读取…</div>
      </div>
    )
  }

  if (!snapshot.capabilities.includes('patchInsert')) {
    return (
      <div className="mcpm-page">
        {header}
        <div className="mcpm-notice mcpm-notice--error">
          宿主半边仍是旧版本（不认 patchInsert）；请重启 DSH 后再管理 MCP。
        </div>
        <div className="mcpm-actions mcpm-actions--form">
          <button
            type="button"
            className="mcpm-btn"
            onClick={(): void => {
              void refresh()
            }}
          >
            刷新
          </button>
        </div>
      </div>
    )
  }

  const renderRow = (server: ServerSnapshot, isManaged: boolean): ReactElement => (
    <div className="mcpm-rowCard" key={server.id}>
      <ServerRow
        server={server}
        canProbe={canProbe}
        busy={busy || !canPatch}
        editing={isManaged && editing === server.id}
        onEdit={(): void => {
          if (!isManaged) return
          if (editing === server.id) {
            closeForm()
            return
          }
          setEditing(server.id)
          setFormError(null)
          setDraft(draftOf(server))
        }}
        onToggle={(): void => {
          toggle(server)
        }}
        onRemove={(): void => {
          remove(server)
        }}
        onAdopt={(): void => {
          adopt(server)
        }}
        onRelease={(): void => {
          remove(server)
        }}
      />
      {isManaged && editing === server.id && draft !== null ? (
        <ServerForm
          draft={draft}
          onDraft={setDraft}
          onSubmit={submit}
          onCancel={closeForm}
          busy={busy}
          error={formError}
          isNew={false}
        />
      ) : null}
    </div>
  )

  return (
    <div className="mcpm-page">
      {header}
      {patchError === undefined ? null : (
        <div className="mcpm-notice mcpm-notice--error">{`受控块损坏，写入已禁用：${patchError}`}</div>
      )}
      {legacy?.state === 'duplicated' ? (
        <div className="mcpm-notice mcpm-notice--error">
          旧版 group 条目「mcp-manager」被声明了两次；请删掉 profile 里手写的那一行，然后重启 DSH。
        </div>
      ) : null}
      {legacy?.state === 'needs-migration' ? (
        <div className="mcpm-notice">
          <span>{`发现旧版 group 里的 ${String(legacy.count)} 台 MCP。`}</span>
          <button type="button" className="mcpm-btn" onClick={migrate} disabled={busy || !canPatch}>
            迁移到顶层 insert
          </button>
        </div>
      ) : null}
      {missing.length === 0 ? null : (
        <div className="mcpm-notice mcpm-notice--error">
          {`manifest 里登记的条目已不在 Loader 中：${missing.join(', ')}；下一次写入会清理这些记录。`}
        </div>
      )}
      {actionError === null ? null : <div className="mcpm-notice mcpm-notice--error">{actionError}</div>}
      {servers.length === 0 && editing === null ? (
        <div className="mcpm-empty">还没有配置任何 MCP 服务器。</div>
      ) : (
        <>
          {managed.length === 0 ? null : <div className="mcpm-sectionTitle">本插件管理的 MCP</div>}
          {managed.length === 0 ? null : (
            <div className="mcpm-rows">{managed.map((server) => renderRow(server, true))}</div>
          )}
          {external.length === 0 ? null : (
            <>
              <div className="mcpm-sectionTitle">外部 MCP（未接管）</div>
              <p className="mcpm-subtitle">
                这些条目不是本插件创建的。点「接管」后，本插件会追加 `- id` 覆写行来编辑/启停；原声明保留。
              </p>
              <div className="mcpm-rows">{external.map((server) => renderRow(server, false))}</div>
            </>
          )}
        </>
      )}
      {editing === 'new' && draft !== null ? (
        <div className="mcpm-rowCard">
          <ServerForm
            draft={draft}
            onDraft={setDraft}
            onSubmit={submit}
            onCancel={closeForm}
            busy={busy}
            error={formError}
            isNew
          />
        </div>
      ) : null}
    </div>
  )
}
