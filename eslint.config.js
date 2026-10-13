/**
 * ESLint 扁平配置。
 *
 * 分工（不要重复防护，也别留盲区）：
 *   · **能机检的纪律** → 这里 + tsconfig：半边隔离、禁 any、禁碰 DOM、禁运行时 import、禁 console。
 *   · **只能看产物/文本的纪律** → 继续由 tools/verify.mjs 守（CSS 数值、inline style 禁令、
 *     座位注册契约、产物形状、包清单）。那些断言针对的是**出厂产物**，比 lint 更贴近用户拿到的东西。
 *   · **纯逻辑正确性** → tools/verify.mjs 的 E 区（直接 import src 里的纯函数）。
 *
 * 注：`lib/**` 是产物，不 lint；`tools/**` 是自检脚本（零依赖、自成一套风格），也不 lint。
 */
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/** 需要类型信息的文件范围（其余 JS 配置只走基础规则）。 */
const TYPED = ['src/**/*.{ts,tsx}']

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
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
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

      // 把"踩过的坑"写成机检规则（AGENTS 3.1 / 3.2 / 3.8）
      'no-restricted-syntax': [
        'error',
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
          message: '__ModuleLoader__ 包装由 tools/build.mjs 注入，源码里不得手写。',
        },
      ],
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
    // 宿主半边：**运行时零 import**。
    // 本文件由 Loader 以绝对路径 / 包名加载，裸模块说明符在磁盘路径上解析不到（AGENTS 2.1）；
    // 相对 import 会被打包器内联，源码里可以写，产物里必须消失（verify A8 守产物）。
    files: ['src/host/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**', '!./**', '!../**'],
              allowTypeImports: true,
              message: '宿主半边运行时零 import：只用注入进来的 Service + 全局 fetch/Request/Response（AGENTS 2.1）。',
            },
          ],
        },
      ],
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
