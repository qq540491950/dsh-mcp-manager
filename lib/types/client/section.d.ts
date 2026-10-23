/**
 * 设置面板里的一页：MCP 服务器管理。
 *
 * v0.3.0 数据模型：每台 MCP 是 profile 里一条顶层 Loader 条目。
 *   - 本插件新增 → `- insert:` 行；
 *   - 本插件接管的外部条目 → `- id: X` 覆写行；
 *   - 未接管的外部条目 → 只读，点「接管」后才可编辑/启停。
 *
 * 两条**互斥**的错误通道（AGENTS 3.9）：
 *   formError   ← 表单提交失败，只渲染在那张表单里
 *   actionError ← 行内操作（接管/启停/删除/检测）失败，只渲染在页面级
 */
import type { ReactElement } from 'react';
export declare function McpSection(): ReactElement;
