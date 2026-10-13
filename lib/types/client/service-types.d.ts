/**
 * 客户端半边用到的 Service 形状 —— 与宿主那份同样的纪律：只列真正调用的成员。
 *
 * 为什么不用官方类型：本插件刻意只依赖一个 peer（`@deepseek-ai/cordis`），
 * 而 `settings.section` 的注册契约与 `ctx.effect` 的形状都是**实测**出来的（见 README 第 9 节）。
 * 把它们写成最小接口，官方契约变化时只影响这一个文件，而且不会把版本耦合带进产物。
 */
import type { ComponentType } from 'react';
/** 座位注册选项。`settings.section` 是 list 座位：只认 id / order / label。 */
export interface SlotRegistration {
    name: string;
    id: string;
    order: number;
    label: () => string;
}
/** `ctx.slots`：注入一个座位（可晚声明）+ 往里注册一个组件。 */
export interface SlotsService {
    inject(ownerKey: string, callback: () => void): void;
    register(options: SlotRegistration, component: ComponentType): void;
}
/** `ctx.inject([...], scope => …)` 回调收到的 scope。 */
export interface ClientScope {
    slots: SlotsService;
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
    effect(callback: () => unknown, label?: string): void;
    inject(services: string[], callback: (scope: ClientScope) => void): void;
}
