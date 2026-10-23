/**
 * 受控的 profile patch 写入器。
 *
 * 为什么存在：MCP 需要是**顶层 Loader 条目**，而 `ctx.configEditor.edit()` 只能改
 * 已存在条目、不能新增/删除。`loader.create()/remove()` 又会整份重写 YAML（AGENTS 2.3）。
 * 所以这里只替换 `cordis.patch.yml` 中两个 marker 之间的受控块，块外一个字节都不动。
 *
 * 纪律（AGENTS 2.4 的新版本）：
 *   - 只允许 `replaceManagedBlock()` / `removeManagedBlock()`；
 *   - 写入必须拿 `<profile>/package.json.lock`（与 configEditor 同一个锁文件）；
 *   - 原子写（同目录临时文件 + rename），失败保留原文件；
 *   - 写前留一份 `cordis.patch.yml.mcp-manager.bak`；
 *   - 任何 marker/manifest 异常都拒绝写入，不猜测用户意图。
 *
 * 本文件不写静态 import：运行时只用 Node 内置模块，通过 `process.getBuiltinModule()` 取。
 */
import {
  locateManagedBlock,
  removeManagedBlock,
  renderManagedBlock,
  replaceManagedBlock,
} from '../shared/managed-block.ts'
import type { ManagedBlockState, ManagedManifest } from '../shared/managed-block.ts'

import type * as cryptoModule from 'node:crypto'
import type * as fsPromises from 'node:fs/promises'
import type * as pathModule from 'node:path'

export interface HmrLike {
  runExclusive?: (<T>(operation: () => Promise<T>) => Promise<T>) | undefined
}

export interface PatchWriterOptions {
  /** `cordis.patch.yml` 的绝对路径（来自 configEditor.documentPath）。 */
  documentPath: string
  /** 可选的 HMR 串行化入口；没有就只靠文件锁。 */
  hmr?: HmrLike | undefined
}

export interface PatchWriteResult {
  documentPath: string
  backupPath?: string | undefined
  text: string
}

const fs: typeof fsPromises = process.getBuiltinModule('fs/promises')
const path: typeof pathModule = process.getBuiltinModule('path')
const crypto: typeof cryptoModule = process.getBuiltinModule('crypto')

const LOCK_RETRY_LIMIT = 200
const LOCK_RETRY_DELAY_MS = 50
const RENAME_RETRY_LIMIT = 8
const RENAME_RETRY_INITIAL_MS = 20
const RENAME_RETRY_MAX_MS = 200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}

async function lockIsStale(lockPath: string): Promise<boolean> {
  try {
    const text = await fs.readFile(lockPath, 'utf8')
    const pid = Number(text.trim())
    if (Number.isInteger(pid) && pid > 0) return !processAlive(pid)
    const info = await fs.stat(lockPath)
    return Date.now() - info.mtimeMs > 30_000
  } catch {
    return true
  }
}

/** 用与 `dsh-atomic-write` 相同的 `package.json.lock` 串行化 read-modify-write。 */
async function withProfileLock<T>(documentPath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = path.join(path.dirname(documentPath), 'package.json.lock')
  for (let attempt = 0; attempt < LOCK_RETRY_LIMIT; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      try {
        await handle.writeFile(String(process.pid), 'utf8')
        return await operation()
      } finally {
        await handle.close()
        await fs.rm(lockPath, { force: true })
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
      if (await lockIsStale(lockPath)) {
        await fs.rm(lockPath, { force: true })
        continue
      }
      await sleep(LOCK_RETRY_DELAY_MS)
    }
  }
  throw new Error('等待 profile 写入锁超时；请稍后重试')
}

function transientRenameError(error: unknown): boolean {
  if (process.platform !== 'win32') return false
  const code = (error as { code?: string }).code
  return code === 'EACCES' || code === 'EBUSY' || code === 'EPERM'
}

async function renameWithRetry(tempPath: string, targetPath: string): Promise<void> {
  let delay = RENAME_RETRY_INITIAL_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath)
      return
    } catch (error) {
      if (!transientRenameError(error) || attempt >= RENAME_RETRY_LIMIT) throw error
    }
    await sleep(delay)
    delay = Math.min(delay * 2, RENAME_RETRY_MAX_MS)
  }
}

/** 同目录临时文件 + rename，读者只看到旧版或完整新版。 */
async function writeFileAtomic(documentPath: string, content: string): Promise<void> {
  const tempPath = `${documentPath}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await renameWithRetry(tempPath, documentPath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }
}

async function backupOf(documentPath: string): Promise<string | undefined> {
  const backupPath = `${documentPath}.mcp-manager.bak`
  try {
    await fs.copyFile(documentPath, backupPath)
    return backupPath
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined
    throw error
  }
}

/** 读取当前 profile patch 原文。 */
export async function readPatch(documentPath: string): Promise<string> {
  return fs.readFile(documentPath, 'utf8')
}

/**
 * 读取并验证当前受控块，返回 manifest 与原文。
 * marker 损坏、manifest 不一致时抛错，调用方必须把错误展示给用户。
 */
export async function inspectPatch(documentPath: string): Promise<{
  text: string
  manifest: ManagedManifest | undefined
}> {
  const text = await readPatch(documentPath)
  const block = locateManagedBlock(text)
  return { text, manifest: block?.manifest }
}

/**
 * 用新的受控块替换 profile patch。
 *
 * 空状态会删除整个块；如果文件因此没有条目，保留合法的 `[]`。
 */
export async function writeManagedBlock(
  options: PatchWriterOptions,
  state: ManagedBlockState,
): Promise<PatchWriteResult> {
  const run = async (): Promise<PatchWriteResult> => {
    const before = await fs.readFile(options.documentPath, 'utf8')
    const next =
      state.records.length === 0 && state.legacyGroup !== true
        ? removeManagedBlock(before)
        : replaceManagedBlock(before, renderManagedBlock(state))
    if (next === before) return { documentPath: options.documentPath, text: before }
    const backupPath = await backupOf(options.documentPath)
    await writeFileAtomic(options.documentPath, next)
    return { documentPath: options.documentPath, backupPath, text: next }
  }
  return withProfileLock(options.documentPath, async () => {
    if (options.hmr?.runExclusive !== undefined) return options.hmr.runExclusive(run)
    return run()
  })
}
