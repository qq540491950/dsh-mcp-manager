/**
 * 运行时状态 → 圆点颜色 / 文案 / 原因行。**纯函数**：不碰 React、不碰 DOM，
 * 所以自检可以直接 import 它做表驱动测试（这是 P2 抽出来的第一个模块）。
 *
 * 判定顺序**就是优先级**：
 *
 *   已停用(灰) → 检测通过(绿) → 检测失败(红) → 日志失败记录(红) → fiber FAILED(红)
 *   → 启动中(琥珀) → 无证据(琥珀「未检测」) → 其余(灰「未启动」)
 *
 * 三个关键点：
 *   1. **fiber ACTIVE 不等于能用**。`mcp-client` 默认 `failOnStartupError:false`，
 *      连接失败也不抛错（它会在后台按退避重试，最多 10 次后放弃并注销全部工具），
 *      所以 `phase` 会一直停在 'active' —— 只读相位就必然误报绿灯（实测过：TCP 拒绝的
 *      服务器显示「运行中」）。因此失败记录与主动检测都优先于 'active'。
 *   2. **检测优先于日志**：日志只能证明"过去失败过"，检测能证明"现在答不答"。
 *   3. **绿灯要有正面证据**。宿主支持探测（能力协商）时，"条目 active 但没有任何探测
 *      记录"只说明 apply 跑完了，不说明连得上 —— 此时报「未检测」而不是绿。写入配置
 *      （启停/删除/保存）会让宿主清掉旧记录，所以那之后必然经过这一态，
 *      由 `recheck` 补一次探测把它推回绿/红（见 section.tsx）。
 */
import type { FailureRecord, ServerSnapshot, Snapshot } from '../../shared/types'

/** 一条服务器的展示状态。`reason` 只有"红"的三种状态才有。 */
export interface StatusView {
  color: string
  text: string
  reason: string | null
}

/** 状态色：全部走官方 token，十六进制只作 var() fallback（AGENTS 3.1）。 */
export const STATUS_IDLE = 'var(--dsw-alias-state-idle-primary)'
export const STATUS_WARN = 'var(--dsw-alias-state-warn-primary, #d8a24a)'
export const STATUS_ERROR = 'var(--dsw-alias-state-error-primary, #d9534f)'
export const STATUS_OK = 'var(--dsw-alias-state-success-primary, #2ea043)'

/**
 * @param server - 快照里的一条服务器记录。
 * @param canProbe - 宿主是否声明了 `probe` 能力（旧宿主没有这条通道，只能退回相位判定）。
 */
export function statusOf(server: ServerSnapshot, canProbe: boolean): StatusView {
  if (server.disabled === true || server.phase === 'stopped')
    return { color: STATUS_IDLE, text: '已停用', reason: null }
  const probe = server.probe
  // 只有"条目活着 + 检测通过"才算真的可用（条目没挂上时工具也没注册，不能报绿）。
  if (probe?.connected === true && server.phase === 'active') return { color: STATUS_OK, text: '运行中', reason: null }
  if (probe?.connected === false) {
    return { color: STATUS_ERROR, text: '连接失败', reason: `检测：${probe.detail ?? '无响应'}` }
  }
  if (typeof server.error?.message === 'string' && server.error.message !== '') {
    return { color: STATUS_ERROR, text: '连接异常', reason: failureText(server.error) }
  }
  if (server.phase === 'failed') return { color: STATUS_ERROR, text: '加载失败', reason: null }
  if (server.phase === 'pending' || server.phase === 'loading') {
    return { color: STATUS_WARN, text: '启动中', reason: null }
  }
  if (server.phase === 'active') {
    // 有记录但探不了（stdio 走子进程，`connected === null`）：相位是唯一证据，照旧报绿。
    if (probe !== undefined) return { color: STATUS_OK, text: '运行中', reason: null }
    // 宿主能探测却没有任何记录 → 没有证据，不报绿（等 recheck 或用户点「检测」）。
    if (canProbe) return { color: STATUS_WARN, text: '未检测', reason: null }
    // 旧宿主没有探测通道，相位就是它唯一的证据（向后兼容）。
    return { color: STATUS_OK, text: '运行中', reason: null }
  }
  return { color: STATUS_IDLE, text: '未启动', reason: null }
}

/**
 * 还有服务器"探通了、但条目没挂上"吗？（相位稳定之前不能报绿）
 * `failed` 是终态，不必再等；其余非 active 的相位（pending/loading）都算没稳定。
 */
export function settling(data: Snapshot | null | undefined): boolean {
  return (data?.servers ?? []).some(
    (server) =>
      server.disabled !== true &&
      server.probe?.connected === true &&
      server.phase !== 'active' &&
      server.phase !== 'failed',
  )
}

/**
 * 失败记录 → 一行可读的原因：时间 +（多次时）次数 + mcp-client 的原文。
 * 时间戳是刻意的：那条记录可能来自上一次实例（例如改完配置刚重启、或已放弃重连），
 * 有具体时间才不会被当成"现在正在发生"。
 */
export function failureText(error: FailureRecord): string {
  const at = typeof error.at === 'number' ? new Date(error.at) : null
  const when = at !== null && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString() : ''
  const count = typeof error.count === 'number' && error.count > 1 ? `已失败 ${String(error.count)} 次` : ''
  const head = [when, count].filter((part) => part !== '').join(' · ')
  const message = typeof error.message === 'string' ? error.message : ''
  return head === '' ? message : `${head} · ${message}`
}
