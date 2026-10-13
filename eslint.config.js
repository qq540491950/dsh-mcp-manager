/**
 * ESLint 扁平配置。
 *
 * 分工（不要重复防护，也别留盲区）：
 *   · **能机检的纪律** → 这里 + tsconfig：半边隔离、禁 any、禁碰 DOM、禁运行时 import、禁 console。
 *   · **只能看产物/文本的纪律** → 继续由 tools/verify.ts 守（CSS 数值、inline style 禁令、
 *     座位注册契约、产物形状、包清单）。那些断言针对的是**出厂产物**，比 lint 更贴近用户拿到的东西。
 *   · **纯逻辑正确性** → tools/verify.ts 的 F 区（直接 import src 里的纯函数）。
 *
 * 注：`lib/**` 是产物，不 lint；`tools/**` 已经是 TypeScript，但**仍然不 lint** ——
 * 它是"测试替身 + 断言"风格的代码（假 DOM、假 React、按序号取下标、故意造多余变量），
 * 严格 lint 规则在这里只会产出风格噪音。它的保障来自 `tsc`（tsconfig.tools*.json）与它自己。
 */
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/** 需要类型信息的文件范围（其余 JS 配置只走基础规则）。 */
const TYPED = ['src/**/*.{ts,tsx}']

/**
 * 把"踩过的坑"写成机检规则（AGENTS 3.1 / 3.2 / 3.8）。
 * 抽成常量是因为 `no-restricted-syntax` 在后面的 override 里会**整体替换**，不是追加 ——
 * 宿主那一段必须自己带上这几条，否则会被静默关掉。
 */
const BASE_RESTRICTED_SYNTAX = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: '禁止注入 HTML（AGENTS 3.2）。',
  },
  {
    selector: "MemberExpression[object.name='document'][property.name='body']",
    message: '禁止碰 document.body：唯一的 DOM 例外在 src/client/nav-mark.ts（AGENTS 3.8）。',
  },
  {
    selector: "MemberExpression[object.name='window'][property.name='__ModuleLoader__']",
    message: '__ModuleLoader__ 包装由 tools/build.ts 注入，源码里不得手写。',
  },
]

/**
 * 宿主半边：**运行时零 import**。
 *
 * 判据是"裸模块说明符"，不是"有没有 import"：相对 import（`../shared/constants`）会被
 * `tools/build.ts` 内联进单文件，产物里一个都不剩（verify A8 守产物）；裸说明符在磁盘路径上
 * 根本解析不到（AGENTS 2.1）。`import type` 被编译期擦除，所以放行。
 */
const HOST_BARE_IMPORT = {
  selector: "ImportDeclaration[source.value=/^[^./]/]:not([importKind='type'])",
  message: '宿主半边运行时零 import：相对 import 由打包器内联，裸模块说明符只能 import type（AGENTS 2.1）。',
}

export default [
  {
    ignores: ['lib/**', 'node_modules/**', 'tools/**', 'docs/**', 'assets/**', '.github/**'],
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: TYPED })),
  {
    files: TYPED,
    languageOptions: {
      parserOptions: {
        // 用 projectService 而不是写死 project 列表：加一个新的 tsconfig 时不用回来改这里。
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // 类型卫生
      // 用 separate-type-imports（默认值）：`import type {...}` 是**声明级**的 type-only，
      // 宿主那条"裸说明符只能 import type"的选择器才认得出来。
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // React（客户端半边）
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // 通用
      'no-console': 'error',
      eqeqeq: ['error', 'always'],

      // 把"踩过的坑"写成机检规则（选择器见文件头 BASE_RESTRICTED_SYNTAX）
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED_SYNTAX],
    },
  },
  {
    // 全仓库唯一的 DOM 例外：设置导航里"我们自己那一格"的标记（AGENTS 3.8）。
    // 例外必须小到看得见，所以只有这一个文件被放行。
    files: ['src/client/nav-mark.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // 宿主半边：**运行时零 import**（判据与理由见文件头 HOST_BARE_IMPORT）。
    files: ['src/host/**/*.ts'],
    rules: {
      // no-restricted-syntax 是整体替换：必须自己带上通用那几条。
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED_SYNTAX, HOST_BARE_IMPORT],
    },
  },
  {
    // 客户端半边：不许把 Harness 的 Client 包当运行时模块 require
    // （它们随版本变、一个抛错就整格白屏；类型可以 import type）。
    files: ['src/client/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@deepseek-ai/dsh-client-*', '@deepseek-ai/dsh-client-*/**'],
              allowTypeImports: true,
              message: '客户端产物只解析基座模块（react 等）；Harness Client 包会随版本变，禁止运行时依赖。',
            },
          ],
        },
      ],
    },
  },
]
