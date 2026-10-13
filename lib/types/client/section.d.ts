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
import type { ReactElement } from 'react';
export declare function McpSection(): ReactElement;
