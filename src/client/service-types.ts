/**
 * 客户端半边用到的 Service 形状 —— 与宿主那份同样的纪律：只列真正调用的成员。
 *
 * 为什么不用官方类型：本插件刻意只依赖一个 peer（`@deepseek-ai/cordis`），
 * 而座位契约与 `ctx.effect` 的形状都是**实测**出来的（见 README 第 9 节）。
 * 把它们写成最小接口，官方契约变化时只影响这一个文件，而且不会把版本耦合带进产物。
 */
import type { ComponentType } from 'react'

/** `settings.section` 的注册选项：list 座位，认 id / order / label。 */
export interface SlotRegistration {
  name: string
  id: string
  order: number
  label: () => string
}

/**
 * `settings.section.icon` 的注册选项（DSH 0.2.2-alpha.3 起）。
 *
 * list 座位、`inline: true`，**只按 id 认领**：官方渲染时传
 * `{ only: row.id, fallback: navIcon(row.id) }`，所以 `id` 必须等于目标 section 的 id，
 * 否则永远不渲染。`order`/`label` 对图标没有意义（官方也不显示），故意不收。
 */
export interface IconSlotRegistration {
  name: string
  id: string
}

/** `ctx.slots`：为一个座位注入"等它声明"的回调，并往里注册一个组件。 */
export interface SlotsService {
  /**
   * 等 `slotKey` 这个座位**被声明**再执行 `callback`；座位不存在（旧宿主）就永远不执行，
   * 不会抛错。declaration 回收（热替换/卸载）时会先 dispose 上一次的回调产物。
   */
  inject(slotKey: string, callback: () => void): void
  register(options: SlotRegistration | IconSlotRegistration, component: ComponentType): void
}

/** `ctx.inject([...], scope => …)` 回调收到的 scope。 */
export interface ClientScope {
  slots: SlotsService
}

/** 客户端根上下文：只用到 effect 与 inject。 */
export interface ClientContext {
  /**
   * 注册一个随插件卸载 / 热替换一起收掉的资源；回调返回清理函数（也可以什么都不返回）。
   * 官方客户端插件就是 `ctx.effect(() => disposer, label)`。
   *
   * 返回类型写 `unknown` 而不是 `(() => void) | void`：`void` 出现在联合类型里是 lint 违规，
   * 而这里本来就不关心返回值 —— 有清理函数就用，没有就算了。
   */
  effect(callback: () => unknown, label?: string): void
  inject(services: string[], callback: (scope: ClientScope) => void): void
}
