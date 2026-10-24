/**
 * v0.3 受控块的**遗留清理**（v0.4 起数据面不再使用 marker 块）。
 *
 * v0.3 把本插件写的行圈在 `# >>> dsh-mcp-manager:managed` 与 `# <<<` 之间，并在块内
 * 放一行 manifest 注释。v0.4 的条目寻址写入器（`patch-doc.ts`）把注释行当透明，
 * 所以 v0.3 遗留文件**不剥离也能正常读写**；这个模块只做启动时的一次性美化：
 * 删掉三行 marker/manifest 注释，块内的行原地保留为普通顶层条目。
 *
 * 纯函数、幂等：marker 不全 / 顺序错乱时原样返回（不猜意图），自检可以直接 import。
 */

export const MANAGED_START = '# >>> dsh-mcp-manager:managed'
export const MANAGED_END = '# <<< dsh-mcp-manager:managed'
export const MANAGED_MANIFEST_PREFIX = '# dsh-mcp-manager:manifest='

/**
 * 剥离 v0.3 marker 与 manifest 注释行，块内其余行原样保留。
 * 没有 marker / marker 不成对时原样返回（幂等）。
 */
export function stripManagedMarkers(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  let inside = false
  let changed = false
  for (const line of lines) {
    const trimmed = line.trimEnd()
    if (!inside && trimmed === MANAGED_START) {
      inside = true
      changed = true
      continue
    }
    if (inside && trimmed.startsWith(MANAGED_MANIFEST_PREFIX)) {
      changed = true
      continue
    }
    if (inside && trimmed === MANAGED_END) {
      inside = false
      changed = true
      continue
    }
    kept.push(line)
  }
  return changed ? kept.join('\n') : text
}
