/**
 * 与宿主通信的那一层：路由、超时预算、请求/响应整理。**不碰 React**。
 *
 * 协议（与宿主 `src/host/index.ts` 一一对应）：
 *   GET  /api/mcp-manager            → { ok: true, data: Snapshot }
 *   POST /api/mcp-manager { op, ... } → { ok: true, data: Snapshot } / { ok: false, error }
 *
 * 写入一律传**操作**而不是整份数组：「启停」「删除」由宿主按 serverName 定位那一行原地改，
 * 字段不可能丢（AGENTS 2.5）；只有表单提交才用整数组替换（`op: "save"`）。
 */
import { ROUTE } from '../../shared/constants.ts'
import { asRecord } from '../../shared/guards.ts'
import type { Snapshot } from '../../shared/types.ts'

/**
 * 请求超时。没有它的话，一旦宿主侧的 reconcile 卡住，`fetch` 永不 settle，
 * `busy` 永远为 true → **按钮永久发灰、状态也不变**（正是"点击停用置灰但状态不变"
 * 最可能的一种成因）。有了它，超时会走 catch 把原因显示出来，按钮恢复可点。
 */
export const REQUEST_TIMEOUT_MS = 20000

/**
 * 写入之后等"条目重新挂上"的节奏：Loader 重建子条目是异步的（相位会走
 * pending → loading → active），而绿灯要求"探测通过 **且** 条目 active"。
 * 所以探通之后还要重读快照，直到相位稳定 —— 有界（约 2s），不是轮询。
 */
export const SETTLE_INTERVAL_MS = 200
export const SETTLE_ATTEMPTS = 10

/**
 * 工具名单**折叠前**最多同时显示几个名字。
 *
 * 一台服务器动辄几十个工具，全部铺开会把卡片撑得看不见别的行；6 个刚好能看出
 * 命名风格又不占地方。超过这个数就在末尾给「+N 个」和「显示全部 / 收起」。
 */
export const TOOL_PREVIEW_LIMIT = 6

/** 等下一轮快照（只用在写入之后的相位稳定上；平时不轮询，避免敲服务器）。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 请求超时信号。老浏览器可能没有 `AbortSignal.timeout` —— 按**运行时事实**收窄，
 * 而不是按 lib.dom 的声明（声明说它一定在，实际不一定）。
 */
export function signalOf(): AbortSignal | undefined {
  const api = globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } | undefined }
  const timeout = api.AbortSignal?.timeout
  return typeof timeout === 'function' ? timeout(REQUEST_TIMEOUT_MS) : undefined
}

/** 把任意异常整理成给用户看的一句话。 */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `请求超时（${String(REQUEST_TIMEOUT_MS / 1000)}s）：宿主没有在预期时间内完成写入，请稍后重试或查看 DSH 日志。`
  }
  if (error instanceof Error) return error.message
  // 非 Error 的抛出物（字符串/对象）：尽量给一句人话，不要 `String(x)` 变成 "[object Object]"。
  const record = asRecord(error)
  if (typeof record.message === 'string') return record.message
  return typeof error === 'string' ? error : '未知错误'
}

/**
 * 把响应体拆成快照；`ok !== true` 就抛出宿主给的原文。
 *
 * `data` 这里有一次断言：宿主返回的就是我们自己的快照形状（同一个仓库的两半边），
 * 所以这里按结构信任；真正不可信的是快照**内部**的字段，那些在读取处一律走收窄守卫。
 */
function unwrap(body: unknown, status: number): Snapshot {
  const record = asRecord(body)
  if (record.ok !== true) {
    throw new Error(typeof record.error === 'string' && record.error !== '' ? record.error : `HTTP ${String(status)}`)
  }
  return record.data as Snapshot
}

/**
 * 组装 fetch init。`signal` 只在**存在时**才写进去：`exactOptionalPropertyTypes` 下
 * 不能把 `undefined` 赋给可选属性（RequestInit.signal 只接受 AbortSignal | null）。
 */
function initOf(base: RequestInit, signal: AbortSignal | undefined): RequestInit {
  return signal === undefined ? base : { ...base, signal }
}

/** 读一次快照（GET）。 */
export async function getSnapshot(): Promise<Snapshot> {
  const response = await fetch(ROUTE, initOf({ headers: { accept: 'application/json' } }, signalOf()))
  const body: unknown = await response.json()
  return unwrap(body, response.status)
}

/** 发一次写操作（POST）。 */
export async function postOp(payload: Record<string, unknown>): Promise<Snapshot> {
  const response = await fetch(
    ROUTE,
    initOf(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      },
      signalOf(),
    ),
  )
  const body: unknown = await response.json()
  return unwrap(body, response.status)
}
