import type { ClientContext } from './service-types.ts';
/**
 * 客户端插件体：在设置导航最下方注册一页 MCP 管理，并给这一页注册 MCP 官方标记作图标。
 * @param ctx - 客户端根上下文。
 */
export declare function apply(ctx: ClientContext): void;
