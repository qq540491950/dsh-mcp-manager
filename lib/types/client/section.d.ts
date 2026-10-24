/**
 * 设置面板里的一页：MCP 服务器管理。
 *
 * v0.4.0 数据模型：每台 MCP 都是 profile 补丁文件里的**普通顶层条目**——
 * 没有受控块，也没有"接管"概念：
 *   - `profile`    ：声明在本文件里，直接原地增删改；
 *   - `overridden` ：原始声明在别的层，profile 里已有覆写行，可编辑、可"还原"；
 *   - `external`   ：原始声明在别的层且还没有覆写行，保存/启停会自动追加覆写行，
 *                    原始声明无法由本插件删除。
 *
 * 两条**互斥**的错误通道（AGENTS 3.9）：
 *   formError   ← 表单提交失败，只渲染在那张表单里
 *   actionError ← 行内操作（启停/删除/检测）失败，只渲染在页面级
 */
import type { ReactElement } from 'react';
export declare function McpSection(): ReactElement;
