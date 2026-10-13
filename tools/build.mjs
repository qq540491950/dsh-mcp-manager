/**
 * 构建脚本：`src/**` → 出厂产物 `lib/**`。
 *
 * 为什么需要它（而不是直接 tsc 输出）：
 *   宿主半边**运行时必须零 import**（AGENTS 2.1）—— 它由 Loader 以绝对路径/包名加载，
 *   裸模块说明符在磁盘路径上解析不到。所以相对模块（`src/shared/*`）必须被**内联进单文件**。
 *   esbuild 的 `bundle: true` 正好做这件事；tsc 会留下 `import '../shared/constants.js'`。
 *
 * 产物指纹：每次构建写 `lib/.build-manifest.json`（每个产物的 sha256 + 它依赖的每个 src 文件的 sha256）。
 *   自检的 E0 用它判断"产物是不是从当前 src 构建出来的" —— 改了 src 忘了 build 会立刻 FAIL，
 *   而不是让用户拿到一个与源码不符的产物。指纹里不放时间戳，保证可复现（CI 里 `git diff --exit-code lib/`）。
 *
 * 用法：`pnpm build`（只跑构建）；`pnpm check` 里由 typecheck 顺带产出 `lib/types/**`。
 */
import { build, version as esbuildVersion } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递归列出目录下的所有文件，返回相对仓库根的 POSIX 路径（排序后，保证 manifest 稳定）。 */
async function listFiles(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await listFiles(absolute)))
    else if (entry.isFile()) found.push(relative(root, absolute).split(sep).join('/'))
  }
  return found.sort()
}

/** 文件内容的 sha256（十六进制）。 */
async function hashOf(relativePath) {
  return createHash('sha256')
    .update(await readFile(join(root, relativePath)))
    .digest('hex')
}

/** 一个产物目标：产物路径 + 它的源码输入目录。 */
const targets = []

/** 宿主半边：ESM 单文件，src 内部模块全部内联，产物里不存在任何 import。 */
{
  const inputs = (await Promise.all(['src/host', 'src/shared'].map(listFiles))).flat()
  const outfile = 'lib/index.js'
  await build({
    entryPoints: [join(root, 'src/host/index.ts')],
    outfile: join(root, outfile),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // 不压缩：产物要能被 tools/verify.mjs 按文本断言（常量名、错误文案、探测预算都要可读）。
    minify: false,
    // esbuild 默认把非 ASCII 转义成 \uXXXX（charset 默认 ascii）。产物里全是中文错误文案，
    // 转义后既难读、也会让"按文案断言"的自检全部失效 —— 所以显式要求 UTF-8 输出。
    charset: 'utf8',
    // esbuild 默认丢掉注释。产物是"给 Loader 读的文件"，不是给人读的设计文档——
    // 设计说明留在 src/host/index.ts 与 README；这里只留一行"别直接改"的提示。
    banner: {
      js: [
        '/**',
        ' * 本文件由 `tools/build.mjs` 从 `src/host/index.ts` 生成 —— **不要直接编辑**。',
        ' * 设计说明（为什么零 import、为什么启停是定点操作、为什么探测要 8s）见 src/host/index.ts 与 README.md。',
        ' */',
      ].join('\n'),
    },
    logLevel: 'warning',
  })
  targets.push({ output: outfile, inputs })
}

// —— 写产物指纹 ——
const manifest = {
  tool: `esbuild@${esbuildVersion}`,
  // 每个目标：产物自己的 sha256 + 它依赖的每个 src 文件的 sha256。
  targets: await Promise.all(
    targets.map(async (target) => ({
      output: target.output,
      outputSha256: await hashOf(target.output),
      inputs: Object.fromEntries(await Promise.all(target.inputs.map(async (file) => [file, await hashOf(file)]))),
    })),
  ),
}
await mkdir(join(root, 'lib'), { recursive: true })
await writeFile(join(root, 'lib/.build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

for (const target of manifest.targets) {
  console.log(
    `built ${target.output}  (${target.outputSha256.slice(0, 12)}…, ${String(Object.keys(target.inputs).length)} inputs)`,
  )
}
