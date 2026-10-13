import type { ClientContext } from './service-types';
/**
 * 客户端插件体：在设置导航最下方注册一页 MCP 管理，并把导航那一格的齿轮换成 MCP 标记。
 * @param ctx - 客户端根上下文。
 */
export declare function apply(ctx: ClientContext): void;
