import type { HostContext } from './service-types.ts';
export declare const name = "dsh-mcp-manager";
/** 依赖在 apply 内用 ctx.inject 声明，便于缺失服务时优雅降级。 */
export declare const inject: string[];
/**
 * 宿主插件体。
 * @param ctx - 宿主根上下文（形状见 ./service-types，只列我们真正用到的成员）。
 */
export declare function apply(ctx: HostContext): void;
