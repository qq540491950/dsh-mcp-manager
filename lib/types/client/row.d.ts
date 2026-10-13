/**
 * 一条已有服务器的摘要行：圆点 + 名称 + 同一行内的三个控件。
 */
import type { ReactElement } from 'react';
import type { ServerSnapshot } from '../shared/types.ts';
export interface ServerRowProps {
    server: ServerSnapshot;
    /** 宿主能不能主动探测：决定"active 但没记录"是报「未检测」还是报绿。 */
    canProbe: boolean;
    busy: boolean;
    editing: boolean;
    onEdit: () => void;
    onToggle: () => void;
    onRemove: () => void;
}
export declare function ServerRow({ server, canProbe, busy, editing, onEdit, onToggle, onRemove, }: ServerRowProps): ReactElement;
