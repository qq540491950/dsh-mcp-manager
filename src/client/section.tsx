/**
 * 设置面板里的一页：MCP 服务器管理。
 *
 * v0.4.0 数据模型：每台 MCP 都是 profile 补丁文件里的**普通顶层条目**——
 * 没有受控块，也没有"接管"概念：
 *   - `profile`    ：声明在本文件里，直接原地增删改；
 *   - `overridden` ：原始声明在别的层，profile 里已有覆写行，可编辑、可"还原"；
 *   - `external`   ：原始声明在别的层且还没有覆写行，保存/启停会自动追加覆写行，
 *                    原始声明无法由本插件删除。
 *
 * 两条**互斥**的错误通道（AGENTS 3.9）：
 *   formError   ← 表单提交失败，只渲染在那张表单里
 *   actionError ← 行内操作（启停/删除/检测）失败，只渲染在页面级
 */
import type { ReactElement } from 'react'
import { asRecord, asText } from '../shared/guards.ts'
import type { ServerSnapshot, Snapshot } from '../shared/types.ts'
import {
  describeError,
  getSnapshot,
  INTENT_ATTEMPTS,
  postOp,
  SETTLE_INTERVAL_MS,
  SETTLE_SCHEDULE_MS,
  sleep,
} from './core/api.ts'
import { draftOf, serverOf, supports, suggestName } from './core/draft.ts'
import type { Draft } from './core/draft.ts'
import { settling } from './core/status.ts'
import { ServerForm } from './form.tsx'
import { h, useCallback, useEffect, useMemo, useState } from './react.ts'
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
  /** 正在落地启停意图的条目 id：从点击到"快照确认 + 相位稳定"为止，该行按钮保持禁用。 */
  const [toggling, setToggling] = useState<string | null>(null)

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

  const detect = useCallback(
    (options?: { silent?: boolean | undefined }): void => {
      void call({ op: 'probe' }, undefined, setActionError, options)
    },
    [call],
  )

  /**
   * 一次启停的意图：写入后 `dsh-hmr` 重放补丁是异步的，宿主返回的快照可能还是
   * 写入前的旧状态（表现为"点了停用/启用没反应"）。带着意图重读快照到落地为止，
   * 再走探测与相位稳定那一套；窗口有界（INTENT_ATTEMPTS × 200ms），不是轮询。
   */
  const recheck = useCallback(
    async (data: Snapshot | null, intent?: { entryId: string; disabled: boolean }): Promise<void> => {
      let current = data
      if (intent !== undefined) {
        for (let attempt = 0; attempt < INTENT_ATTEMPTS; attempt += 1) {
          const entry = (current?.servers ?? []).find((item) => item.id === intent.entryId)
          if (entry !== undefined && (entry.disabled === true) === intent.disabled) break
          await sleep(SETTLE_INTERVAL_MS)
          current = await refresh()
        }
      }
      if (!supports(current, 'probe')) return
      let probed = await call({ op: 'probe' }, undefined, setActionError, { silent: true })
      for (const delay of SETTLE_SCHEDULE_MS) {
        if (!settling(probed)) break
        await sleep(delay)
        probed = await refresh()
      }
    },
    [call, refresh],
  )

  /**
   * 窗口切回可见时补一次读：衰减长尾（共 ≈30s）仍可能短于 `mcp-client` 首连退避的
   * 总时长（500ms 起步翻倍 × 10 次，可达几分钟）——长尾耗尽后行会停在「启动中」，
   * 用户切走再切回来，这一拍就把已经激活的状态接住。仍是事件驱动的有界补读。
   */
  useEffect(() => {
    const api = globalThis as {
      document?: {
        visibilityState?: string | undefined
        addEventListener?: ((type: string, listener: () => void) => void) | undefined
        removeEventListener?: ((type: string, listener: () => void) => void) | undefined
      } | undefined
    }
    const doc = api.document
    if (doc === undefined) return
    const { addEventListener, removeEventListener } = doc
    if (addEventListener === undefined || removeEventListener === undefined) return
    const onVisible = (): void => {
      if (doc.visibilityState !== 'visible') return
      void refresh().then((data) => {
        if (!settling(data)) return
        return recheck(data)
      })
    }
    addEventListener('visibilitychange', onVisible)
    return (): void => {
      removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, recheck])

  const recheckAfter = useCallback(
    (data: Snapshot, intent?: { entryId: string; disabled: boolean }): void => {
      void recheck(data, intent)
    },
    [recheck],
  )

  useEffect(() => {
    const lifecycle = { cancelled: false }
    void (async (): Promise<void> => {
      const data = await refresh()
      if (lifecycle.cancelled || !supports(data, 'nativeRows') || !supports(data, 'probe')) return
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
      const enabled = server.disabled === true
      setToggling(server.id)
      void call(
        { op: 'setEnabled', entryId: server.id, enabled },
        (data) => {
          // 意图落地 + 相位稳定之前，这一行的按钮必须保持禁用：宿主返回的快照是
          // 重放前的旧状态，此刻行还显示旧的启停文案，放开按钮就是在邀请重复点击。
          void recheck(data, { entryId: server.id, disabled: !enabled })
            .catch(() => {})
            .finally(() => {
              setToggling((current) => (current === server.id ? null : current))
            })
        },
        (message) => {
          setToggling((current) => (current === server.id ? null : current))
          setActionError(message)
        },
      )
    },
    [call, recheck],
  )

  const remove = useCallback(
    (server: ServerSnapshot): void => {
      void call({ op: 'remove', entryId: server.id }, recheckAfter, setActionError)
    },
    [call, recheckAfter],
  )

  const migrate = useCallback((): void => {
    void call({ op: 'migrate' }, recheckAfter, setActionError)
  }, [call, recheckAfter])

  const canPatch = supports(snapshot, 'nativeRows') && snapshot?.patchError === undefined
  const canProbe = supports(snapshot, 'probe')
  const legacy = snapshot?.legacy
  const patchError = snapshot?.patchError

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
      <p className="mcpm-subtitle">
        列表就是 profile 补丁文件里的顶层条目；「本地」条目直接增删改，「外部」条目保存或启停时会自动追加覆写行。
      </p>
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

  if (!snapshot.capabilities.includes('nativeRows')) {
    return (
      <div className="mcpm-page">
        {header}
        <div className="mcpm-notice mcpm-notice--error">
          宿主半边仍是旧版本（不认 nativeRows）；请重启 DSH 后再管理 MCP。
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

  const renderRow = (server: ServerSnapshot): ReactElement => (
    <div className="mcpm-rowCard" key={server.id}>
      <ServerRow
        server={server}
        canProbe={canProbe}
        busy={busy || !canPatch}
        pending={toggling === server.id}
        editing={editing === server.id}
        onEdit={(): void => {
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
      />
      {editing === server.id && draft !== null ? (
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
        <div className="mcpm-notice mcpm-notice--error">{`无法解析 profile 补丁文件，写入已禁用：${patchError}`}</div>
      )}
      {legacy?.state === 'duplicated' ? (
        <div className="mcpm-notice mcpm-notice--error">
          旧版 group 条目「mcp-manager」被声明了两次；请删掉 profile 里手写的那一行，然后重启 DSH。
        </div>
      ) : null}
      {legacy?.state === 'needs-migration' ? (
        <div className="mcpm-notice">
          <span>{`发现旧版 group 容器里的 ${String(legacy.count)} 台 MCP。`}</span>
          <button type="button" className="mcpm-btn" onClick={migrate} disabled={busy || !canPatch}>
            迁移为顶层条目
          </button>
        </div>
      ) : null}
      {actionError === null ? null : <div className="mcpm-notice mcpm-notice--error">{actionError}</div>}
      {servers.length === 0 && editing === null ? (
        <div className="mcpm-empty">还没有配置任何 MCP 服务器。</div>
      ) : (
        <div className="mcpm-rows">{servers.map((server) => renderRow(server))}</div>
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
