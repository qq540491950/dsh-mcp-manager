/**
 * 表单：文本字段 + 服务器新增/编辑面板。
 */
import type { ReactElement } from 'react';
import type { Draft } from './core/draft';
export interface FieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string | undefined;
    /** 只换等宽字体。 */
    mono?: boolean | undefined;
    /** 换成真正的 `<textarea>`。 */
    multiline?: boolean | undefined;
}
/**
 * 文本字段。两个**互不相关**的开关：
 *   - `mono`      → 只影响字体（等宽，便于看标识符/URL/命令行）
 *   - `multiline` → 换成真正的 `<textarea>`
 * 曾经把两者混在一个 `mono` 上，导致 url 这种单行字段被渲染成 56px 的多行大框。
 */
export declare function Field({ label, value, onChange, placeholder, mono, multiline }: FieldProps): ReactElement;
export interface ServerFormProps {
    draft: Draft;
    onDraft: (draft: Draft) => void;
    onSubmit: () => void;
    onCancel: () => void;
    busy: boolean;
    error: string | null;
    isNew: boolean;
}
/** 服务器新增/编辑表单。 */
export declare function ServerForm({ draft, onDraft, onSubmit, onCancel, busy, error, isNew }: ServerFormProps): ReactElement;
