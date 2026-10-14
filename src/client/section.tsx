/**
 * 设置面板里的一页：MCP 服务器管理。
 *
 * 状态模型见 `core/status.ts`；这里只负责"什么时候去问宿主、问完怎么落到界面上"。
 *
 * 两条**互斥**的错误通道，各自只有一个渲染点（否则同一句话会出现两遍）：
 *   formError   ← 表单提交失败，只渲染在那张表单里（错误说的是这份草稿）
 *   actionError ← 行内操作（停用/删除/检测）失败，没有表单可挂，只渲染在页面级
 * `call()` 的第三个参数就是"写进哪条通道"，**必须只写一条**（AGENTS 3.9 / D21–D23）。
 */
import type { ReactElement } from 'react'
import { asRecord, asText } from '../shared/guards.ts'
import type { ServerSnapshot, Snapshot } from '../shared/types.ts'
import { describeError, getSnapshot, postOp, SETTLE_ATTEMPTS, SETTLE_INTERVAL_MS, sleep } from './core/api.ts'
import { draftOf, serverOf, serverOfExisting, supports, suggestName } from './core/draft.ts'
import type { Draft } from './core/draft.ts'
import { settling } from './core/status.ts'
import { ServerForm } from './form.tsx'
import { h, useCallback, useEffect, useMemo, useState } from './react.ts'
import { ServerRow } from './row.tsx'

/** 表单提交的载荷：`op: "save"` + 整份数组。 */
type SavePayload = { op: 'save'; servers: unknown[] }

export function McpSection(): ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // 后台检测进行中（自动检测不占用 busy，否则一进页面按钮全会灰一下）。
  const [probing, setProbing] = useState(false)

  /** 读一次快照；成功时返回 data（挂载时的自动检测要拿它做能力判断）。 */
  const refresh = useCallback(async (): Promise<Snapshot | null> => {
    try {
      const data = await getSnapshot()
      setSnapshot(data)
      setLoadError(null)
      // 重新读到权威快照后，上一次行内操作的报错已经过时。
      setActionError(null)
      return data
    } catch (error) {
      setLoadError(describeError(error))
      return null
    }
  }, [])

  /**
   * 唯一的写入入口。注意传的是**操作**而不是整份数组：
   * 「启停」「删除」由宿主按 serverName 定位那一行原地修改，字段不可能丢；
   * 只有表单提交才用整数组替换（`op: "save"`）。
   * @param payload - 请求体（`op` + 该操作需要的字段）。
   * @param after - 成功后的收尾动作；收到**这次响应里的快照**（写入之后的补探测要用它做能力判断）。
   * @param onError - 失败时把原因写进哪条通道；**必须只写一条**，否则会重复显示。
   * @param options.silent - 后台请求：只亮 `probing`，不锁住按钮。
   * @returns 成功时这次响应里的快照，失败时 null。
   */
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

  // `?? []` 每次渲染都会产生新数组，会让依赖它的 useCallback 每轮都换新 —— 用 useMemo 稳住。
  const servers = useMemo(() => snapshot?.servers ?? [], [snapshot])

  /** 主动检测。按钮走默认（锁住按钮），自动检测走 `{ silent: true }`（只亮「检测中…」）。 */
  const detect = useCallback(
    (options?: { silent?: boolean | undefined }): void => {
      void call({ op: 'probe' }, undefined, setActionError, options)
    },
    [call],
  )

  /**
   * **写入配置之后补一次检测**（启停 / 删除 / 保存都要，不只是"启用"）。
   *
   * 为什么必须有这一步：宿主每次写入都会清掉旧的失败与探测记录 —— 它们说的是**上一个
   * 实例**（见 host 的 commitRows）。于是"停用 → 再启用"之后，快照里一点正面证据
   * 都不剩，只剩相位；而相位 active 只说明 apply 跑完了，连不上也是 active
   * （AGENTS 3.10）。没有这一步就只能报一个假的绿灯，或者永远停在「未检测」。
   *
   * 两步：
   *   1. 主动探测（静默）——立刻知道"现在答不答"；
   *   2. 等相位稳定——Loader 重建子条目是异步的，"探通了但条目还没挂上"时不能报绿
   *      （那一刻工具还没注册），所以重读快照直到 active/failed 或次数用尽。
   *
   * @param data - 刚拿到的那份快照；用它做能力协商（闭包里的 snapshot 可能是旧值）。
   */
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

  /** 写入之后的收尾：`after` 回调是同步签名，异步的 recheck 在这里显式点火。 */
  const recheckAfter = useCallback(
    (data: Snapshot): void => {
      void recheck(data)
    },
    [recheck],
  )

  /**
   * **打开这一页就自动检测一次**（不再需要先点按钮）。
   *
   * 顺序是关键：先读快照（快、必成功），拿到 `capabilities` 再决定要不要发探测。
   * 宿主半边不热重载，旧宿主不认识 `probe` —— 先读快照才不会平白拿到
   * 一条「未知操作：probe」。自动检测用 silent 模式，所以列表先出来、按钮不灰。
   */
  useEffect(() => {
    // 用一个可变对象而不是 `let cancelled`：后者会被 TS 的控制流分析窄化成字面量 `false`，
    // 于是 `if (cancelled)` 被当成"永远为假"（lint 也会拦）。对象属性没有这个问题。
    const lifecycle = { cancelled: false }
    void (async (): Promise<void> => {
      const data = await refresh()
      if (lifecycle.cancelled || !supports(data, 'probe')) return
      void recheck(data)
    })()
    return (): void => {
      lifecycle.cancelled = true
    }
  }, [refresh, recheck])

  const openNew = useCallback((): void => {
    setEditing('new')
    setFormError(null)
    setDraft({
      serverName: suggestName(servers),
      transport: 'streamable-http',
      url: '',
      command: '',
      args: '',
      env: '',
      headers: '',
      cwd: '',
      disabled: false,
    })
  }, [servers])

  /** 收起表单：连同这份草稿的报错一起清掉，重开时不会看到上一份草稿的错误。 */
  const closeForm = useCallback((): void => {
    setEditing(null)
    setFormError(null)
  }, [])

  const submit = useCallback((): void => {
    if (draft === null) return
    const server = serverOf(draft)
    const next: unknown[] =
      editing === 'new'
        ? [...servers.map((item) => serverOfExisting(item)), server]
        : servers.map((item, index) =>
            index === editing ? { ...serverOfExisting(item), ...server } : serverOfExisting(item),
          )
    const payload: SavePayload = { op: 'save', servers: next }
    void call(
      { ...payload },
      (data): void => {
        setEditing(null)
        setDraft(null)
        // 保存会改 url/headers（或增删服务器）：旧记录被清掉，落盘后必须重新探一次。
        recheckAfter(data)
      },
      setFormError,
    )
  }, [call, draft, editing, recheckAfter, servers])

  /**
   * 启停一台。宿主支持定点操作时只给「目标状态」，**完全不碰配置字段**；
   * 否则退回整数组提交（env/headers 已转成旧宿主认识的文本形状）。
   *
   * 两种写法成功之后都要 `recheck`：宿主写入会清掉全部旧记录（不只有这一台），
   * 所以"停用 → 再启用"必须重新探测才知道连接性正不正常。
   */
  const toggle = useCallback(
    (server: ServerSnapshot): void => {
      const serverName = asText(asRecord(server.config).serverName)
      if (supports(snapshot, 'setEnabled')) {
        void call({ op: 'setEnabled', serverName, enabled: server.disabled === true }, recheckAfter, setActionError)
        return
      }
      void call(
        {
          op: 'save',
          servers: servers.map((item) =>
            item === server ? { ...serverOfExisting(item), disabled: item.disabled !== true } : serverOfExisting(item),
          ),
        },
        recheckAfter,
        setActionError,
      )
    },
    [call, recheckAfter, servers, snapshot],
  )

  /** 删除一台：同样优先定点操作；删完也要重探（其余服务器的旧记录同样被清掉）。 */
  const remove = useCallback(
    (server: ServerSnapshot): void => {
      const serverName = asText(asRecord(server.config).serverName)
      if (supports(snapshot, 'remove')) {
        void call({ op: 'remove', serverName }, recheckAfter, setActionError)
        return
      }
      void call(
        { op: 'save', servers: servers.filter((item) => item !== server).map((item) => serverOfExisting(item)) },
        recheckAfter,
        setActionError,
      )
    },
    [call, recheckAfter, servers, snapshot],
  )

  const configured = snapshot !== null && snapshot.configured !== false
  // 宿主半边不热重载：旧宿主不认识 `probe`，点了只会拿到「未知操作」。
  // 所以按能力协商决定这个按钮能不能点（AGENTS 1.2）。
  const canProbe = supports(snapshot, 'probe')

  const header = (
    <div className="mcpm-heading">
      {/* 第一行只放「标题 + 动作按钮」：两者垂直居中对齐，互不抢宽度。 */}
      <div className="mcpm-titleRow">
        <h3 className="mcpm-title">MCP 服务器</h3>
        <div className="mcpm-actions">
          {/* 「检测中…」：打开页面会自动检测（silent），这个提示让用户知道
              绿/红还在刷新中，而不是"就这样了"。 */}
          {probing ? <span className="mcpm-probing">检测中…</span> : null}
          {/* 检测：现在这一刻答不答（主动发一次 MCP 握手）；按钮是"再问一次"。
              刷新：只重读宿主快照（失败原因/相位是宿主事后写入的）。
              两个都要：保存那一刻的快照看不到事后日志，而日志也证明不了"现在"。 */}
          <button
            type="button"
            className="mcpm-btn"
            onClick={(): void => {
              detect()
            }}
            disabled={busy || probing || !configured || !canProbe}
            title={canProbe ? '现在向每台启用中的服务器发一次 MCP 握手' : '需要重启 DSH（宿主半边不热重载）后才能检测'}
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
          <button type="button" className="mcpm-btn mcpm-btn--primary" onClick={openNew} disabled={busy || !configured}>
            新增
          </button>
        </div>
      </div>
      {/* 说明文字另起一行、占满面板整宽（不再被按钮挤成窄列而碎断行）。 */}
      <p className="mcpm-subtitle">
        在这里增删改 MCP 服务器；每一项都会写成 @deepseek-ai/dsh-mcp-client 的一个 Loader 条目并立即生效。
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

  return (
    <div className="mcpm-page">
      {header}
      {configured ? null : (
        <div className="mcpm-notice mcpm-notice--error">
          {`未找到 group 条目「${snapshot.groupId}」（cordis:group）。它由 profile 自己的补丁层声明，不由插件自带（这样卸载插件不会影响已配置的 MCP）：请把这一行粘进 profile 的 cordis.patch.yml —— - insert: [{id: ${snapshot.groupId}, name: 'cordis:group', config: []}]`}
        </div>
      )}
      {/* 行内操作（停用/删除/检测）的报错：没有表单可挂，页面级是唯一位置。
          表单提交的报错**不**在这里渲染（它只出现在那张表单里）——同一句话两处渲染
          曾经被用户当成"重复提示"，而且页面级那条挂在别人卡片上方会误导归属。 */}
      {actionError === null ? null : <div className="mcpm-notice mcpm-notice--error">{actionError}</div>}
      {/* 每个服务器一张卡（对齐 ui-settings-models）：卡片头部是行本身，
          展开时在**同一张卡内**追加表单面板，不会在别处重复显示这一台。 */}
      {servers.length === 0 && editing === null ? (
        <div className="mcpm-empty">还没有配置任何 MCP 服务器。</div>
      ) : (
        <div className="mcpm-rows">
          {servers.map((server, index) => (
            <div className="mcpm-rowCard" key={server.rowId ?? `row-${String(index)}`}>
              <ServerRow
                server={server}
                // 绿灯需要正面证据：宿主能不能探测，决定"active 但没记录"是报未检测还是报绿。
                canProbe={canProbe}
                busy={busy}
                editing={editing === index}
                onEdit={(): void => {
                  // 再点一次就收起。
                  if (editing === index) {
                    closeForm()
                    return
                  }
                  setEditing(index)
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
              {editing === index && draft !== null ? (
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
          ))}
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
      )}
    </div>
  )
}
