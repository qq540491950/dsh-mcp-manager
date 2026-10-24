/** 一条 MCP 服务器的摘要行：圆点 + 名称 + 来源标记 + 行内操作。 */
import type { ReactElement } from 'react';
import type { ServerSnapshot } from '../shared/types.ts';
export interface ServerRowProps {
    server: ServerSnapshot;
    /** 宿主能不能主动探测：决定"active 但没记录"是报「未检测」还是报绿。 */
    canProbe: boolean;
    busy: boolean;
    /** 这一行的启停意图还没落地（快照确认 + 相位稳定）：行内操作保持禁用，防重复点击。 */
    pending: boolean;
    editing: boolean;
    onEdit: () => void;
    onToggle: () => void;
    onRemove: () => void;
}
export declare function ServerRow({ server, canProbe, busy, pending, editing, onEdit, onToggle, onRemove, }: ServerRowProps): ReactElement;
