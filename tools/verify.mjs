/**
 * dsh-mcp-manager 自检程序（纯 Node，零依赖）。
 *
 * 覆盖三组断言：
 *   A. 包清单契约（dsh.client.platform / exports["./client"] / 模块 id 与包名一致）
 *   B. 宿主半边行为（路由注册、GET 快照、POST 全量写入、非法输入拒绝）
 *   C. 客户端半边行为（懒 CJS 协议、只 require 种子模块、settings.section 注册契约）
 *
 * 用法：node tools/verify.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
const failures = []

/** 断言辅助。 */
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    return
  }
  failures.push(`${label}${detail === '' ? '' : ` — ${detail}`}`)
}

/** 深度相等（够用的 JSON 形状比较）。 */
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const hostSource = await readFile(join(root, 'lib', 'index.js'), 'utf8')
const clientSource = await readFile(join(root, 'lib', 'client.js'), 'utf8')

//#region A. 包清单
check('A1 package name', manifest.name === 'dsh-mcp-manager', manifest.name)
check('A2 exports["./client"]', manifest.exports?.['./client'] === './lib/client.js', String(manifest.exports?.['./client']))
check('A3 dsh.client.platform === "web"', manifest.dsh?.client?.platform === 'web', JSON.stringify(manifest.dsh))
check('A4 main points at lib/index.js', manifest.main === 'lib/index.js', String(manifest.main))
check("A5 客户端 bundle 用包名注册模块 id", clientSource.includes(`id: "dsh-mcp-manager"`))
check('A6 客户端 bundle 是 classic script（无 ESM 语法）', !/^\s*(import|export)\s/m.test(clientSource))
check(
  'A7 只 require 平台种子模块',
  [...clientSource.matchAll(/require\((?:"|')([^"']+)(?:"|')\)/g)].every(([, specifier]) =>
    ['react', 'react-dom', 'cordis', 'dsh-client-store', 'ui-slots', 'ui-primitives', 'ui-dockkit', '@deepseek-ai/dsh-client-ui-primitives'].includes(specifier),
  ),
  [...clientSource.matchAll(/require\((?:"|')([^"']+)(?:"|')\)/g)].map(([, s]) => s).join(', '),
)
check('A8 宿主半边零 import（磁盘路径解析不到裸模块）', !/^\s*import\s/m.test(hostSource))
check('A9 两半边的路由字面量一致', hostSource.includes("'/api/mcp-manager'") && clientSource.includes('"/api/mcp-manager"'))
check('A10 两半边的组条目 id 一致', hostSource.includes("'mcp-manager'") && clientSource.includes('mcp-manager'))

// 主题适配护栏：硬编码颜色在深色主题下会造成「白底白字」这类不可见文本。
// 规则：客户端里的十六进制颜色只允许作为 var() 的 fallback 出现。
// 先剥掉注释（注释里可以自由讨论 #fff），再剥 var()，最后扫描残留颜色。
{
  const code = clientSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  let stripped = code
  for (let pass = 0; pass < 8; pass += 1) {
    const next = stripped.replace(/var\([^()]*\)/g, 'var()')
    if (next === stripped) break
    stripped = next
  }
  const bare = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(([hex]) => hex)
  check('A11 无裸硬编码颜色（必须是 var() 的 fallback）', bare.length === 0, bare.join(', '))
  check(
    'A12 主按钮前景色用 foreground token',
    /\.mcpm-btn--primary\s*\{[^}]*color:var\(--dsw-alias-label-primary-foreground/.test(code),
  )
  // 视觉必须走 CSS class：inline 的 background 会压过 :hover，导致没有悬停反馈。
  check('A12b 视觉层是注入的样式表', code.includes('STYLE_ELEMENT_ID') && code.includes('document.head.appendChild'))
  check('A12c 按钮有 hover 反馈', /\.mcpm-btn:hover:not\(:disabled\)/.test(code))
}

// 间距护栏：**紧凑档**，数值取自官方小号控件（`Button.module.css` 的 `.sm`）。
{
  // 只保留代码本身（剥掉注释）再做声明匹配。
  const code = clientSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  // 锚定到行首，否则 `.mcpm-row--off .mcpm-name {}` 会先被匹配到。
  const ruleOf = (cls) => code.match(new RegExp('(?:^|\\n)\\s*\\' + cls + '\\s*\\{[^}]*\\}'))?.[0] ?? ''
  const missing = (pairs) => pairs.filter(([cls, decl]) => !ruleOf(cls).includes(decl))

  const metrics = [
    ['.mcpm-page', 'padding:4px 0'], // 左右/底部留白由设置外壳的 0 24px 24px 提供，不能重复叠加
    ['.mcpm-page', 'gap:12px'],
    ['.mcpm-page', 'line-height:18px'],
    ['.mcpm-page', 'max-width:720px'], // 官方 ui-settings-models .section 的上限
    ['.mcpm-rows', 'gap:8px'], // 官方 .rows：一卡一服务器
    ['.mcpm-rowCard', 'padding:8px 12px'],
    ['.mcpm-rowCard', 'border:.5px solid var(--dsw-alias-settings-card-stroke)'],
    ['.mcpm-rowCard', 'border-radius:var(--dsw-radius-lg'],
    ['.mcpm-rowCard', 'background:var(--dsw-alias-settings-card-fill)'],
    ['.mcpm-row', 'min-height:28px'],
    ['.mcpm-btn', 'height:28px'],
    ['.mcpm-btn', 'min-width:44px'],
    ['.mcpm-btn', 'padding:0 10px'],
    ['.mcpm-btn', 'font-size:12px'],
    ['.mcpm-btn', 'border:.5px solid var(--dsw-alias-border-l3)'],
    ['.mcpm-btn', 'border-radius:var(--dsw-radius-sm'],
  ]
  const badMetrics = missing(metrics)
  check('A15 紧凑档尺寸（对齐官方 .sm / .rowActions）', badMetrics.length === 0, badMetrics.map(([c, d]) => `${c} { ${d} }`).join('; '))
  // 表单面板照抄官方 ui-settings-models：靠**底色**分层，不靠描边。
  const formMetrics = [
    ['.mcpm-form', 'background:var(--dsw-alias-bg-module-platform'],
    ['.mcpm-form', 'border-radius:var(--dsw-radius-lg'],
    ['.mcpm-input', 'border:.5px solid var(--dsw-alias-border-l4'],
    ['.mcpm-input', 'background:var(--dsw-alias-bg-layer-1)'],
    ['.mcpm-label', 'color:var(--dsw-alias-label-secondary)'],
    ['.mcpm-label', 'font-weight:500'],
  ]
  const badForm = missing(formMetrics)
  check('A31 表单面板对齐官方 models 页', badForm.length === 0, badForm.map(([c, d]) => `${c} { ${d} }`).join('; '))
  // 外壳已有 24px 底部内边距；页面自己再垫 24px 会变成 48px。
  check('A16 页面不重复叠加外壳的底部留白', !/padding:\s*[^;]*24px/.test(ruleOf('.mcpm-page')))
  // 操作区必须单行：一旦允许 wrap，空间不足时"删除"会被折到下一行。
  check('A17 操作区不换行（控件并排一行）', !/\.mcpm-actions\s*\{[^}]*flex-wrap/.test(code))
  // 传输方式与 URL 不占版面（只在名称 tooltip 里提供）。
  check('A18 行内不渲染 URL/传输方式详情', !clientSource.includes('mcpm-target'))
  check('A19 启停用是按钮（不再是 switch）', !clientSource.includes('mcpm-switch') && /enabled \? "停用" : "启用"/.test(clientSource))
  // 自适应：主体填满容器且可被压缩，长文本走省略号；卡片裁掉溢出，圆角不被分隔线破坏。
  const adaptive = [
    ['.mcpm-page', 'width:100%'],
    ['.mcpm-page', 'min-width:0'],
    // flex 子项默认 min-width:auto，内容一宽就会撑破容器 → 每个块级子项都要显式归零。
    ['.mcpm-form', 'min-width:0'],
    ['.mcpm-rowCard', 'min-width:0'],
    ['.mcpm-notice', 'min-width:0'],
    ['.mcpm-field', 'min-width:0'],
    ['.mcpm-meta', 'min-width:0'],
    ['.mcpm-meta', 'flex:1 1 auto'],
    ['.mcpm-name', 'text-overflow:ellipsis'],
    ['.mcpm-actions', 'flex:none'],
  ]
  const badAdaptive = missing(adaptive)
  check('A26 自适应主体（填满 + 可压缩 + 省略号 + 不撑破）', badAdaptive.length === 0, badAdaptive.map(([c, d]) => `${c} { ${d} }`).join('; '))
  // inline 的尺寸会压过样式表，改档位时看不到效果（踩过：输入框 inline height 36px）。
  check('A27 不在 inline style 里写尺寸', !/style:\s*\{[^}]*\b(height|fontSize|padding|lineHeight)\s*:/.test(code))
  // 「等宽」与「多行」必须分离：混用会把 url 这种单行字段渲染成 56px 的大框。
  check(
    'A28 mono 与 multiline 分离',
    /multiline\s*\?\s*h\("textarea"/.test(clientSource) &&
      /mcpm-input--mono/.test(code) &&
      !clientSource.includes('mono ? "mcpm-input mcpm-textarea"'),
  )
  // 一卡一服务器：表单面板展开在**同一张卡内**，不在别处重复显示这一台。
  {
    const at = clientSource.indexOf('className: "mcpm-rows"')
    const rowsBlock = clientSource.slice(at, clientSource.indexOf('//#endregion', at) === -1 ? at + 2600 : at + 2600)
    check(
      'A29 每个服务器一张卡，表单展开在同一张卡内',
      at > 0 && rowsBlock.includes('mcpm-rowCard') && rowsBlock.includes('ServerForm'),
    )
    check('A30 编辑按钮可收起', clientSource.includes('editing ? "收起" : "编辑"'))
    // 按**属性语法**匹配，否则 box-sizing:border-box 里的 "border" 会误报。
    const formRule = code.match(/(?:^|\n)\s*\.mcpm-form\s*\{[^}]*\}/)?.[0] ?? ''
    // 只匹配描边类属性（border / border-top / border-width…），不能误伤 border-radius。
    const strokeProp = /[;{]\s*border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?\s*:/
    check(
      'A30b 表单面板不带描边（靠底色分层，否则卡片套卡片）',
      formRule !== '' && !strokeProp.test(formRule) && /background:var\(--dsw-alias-bg-module-platform/.test(formRule),
      formRule,
    )
  }
  // 行内操作必须是「宿主侧定点操作」，不能把整份数组回传——回传会因字段形状差异静默丢字段。
  check(
    'A20 客户端用定点操作而非整数组回传',
    clientSource.includes('op: "setEnabled"') && clientSource.includes('op: "remove"') && clientSource.includes('op: "save"'),
  )
  check(
    'A21 宿主支持三种操作',
    hostSource.includes("case 'setEnabled'") && hostSource.includes("case 'remove'") && hostSource.includes("case 'save'"),
  )
  // 已实测的字段丢失根因：toRecord 不认「快照回传的对象」形状。
  check('A22 toRecord 认对象形状（否则 headers/env 被静默清空）', /typeof value === 'object' && !Array\.isArray\(value\)/.test(hostSource))
  // 宿主半边不参与热重载，所以客户端必须能同时说两代协议。
  check('A23 客户端做能力协商', /supports\(snapshot,\s*"setEnabled"\)/.test(clientSource) && clientSource.includes('capabilities'))
  check('A24 宿主声明 capabilities', hostSource.includes("capabilities: ['setEnabled', 'remove', 'save']"))
  // 退回整数组提交时，env/headers 必须转成旧宿主认识的文本形状，否则又会被清空。
  {
    const block = clientSource.slice(clientSource.indexOf('function serverOfExisting'), clientSource.indexOf('function supports'))
    check(
      'A25 回退路径把 env/headers/args 转成文本',
      block.includes('flat.env = pairsToText') && block.includes('flat.headers = pairsToText') && block.includes('flat.args = config.args.join'),
    )
  }
}

// 布局护栏：动作按钮与长说明文字不能挤在同一个 flex 行里抢宽度。
{
  check('A13 标题行与说明文字分层（heading/titleRow）', clientSource.includes('mcpm-heading') && clientSource.includes('mcpm-titleRow'))
  const headerBlock = clientSource.slice(clientSource.indexOf('const header = h('), clientSource.indexOf('if (loadError !== null)'))
  const rowAt = headerBlock.indexOf('mcpm-titleRow')
  const subtitleAt = headerBlock.indexOf('mcpm-subtitle')
  check('A14 说明文字在标题行之外', rowAt >= 0 && subtitleAt > rowAt)
}
//#endregion

//#region B. 宿主半边
const host = await import(new URL('../lib/index.js', import.meta.url).href)
check('B1 导出 name', host.name === 'dsh-mcp-manager', String(host.name))
check('B2 导出 apply', typeof host.apply === 'function')

/** 造一个够用的假宿主上下文；写入会落到 state，因此可以连续操作。 */
function makeHostCtx({ configRows = [], mcpChildren = [] } = {}) {
  const captured = { deps: null, route: null, writes: [] }
  const state = { rows: structuredClone(configRows) }
  const groupEntry = {
    options: { id: 'mcp-manager', name: 'cordis:group', get config() { return state.rows } },
  }
  const ctx = {
    inject(deps, callback) {
      captured.deps = deps
      callback({
        effect: (factory) => factory(),
        configEditor: {
          entries: () => [groupEntry],
          configuration: () => [{ entry: groupEntry, inherited: state.rows, override: undefined }],
          edit: async (entry, change) => {
            const next = change(state.rows, state.rows)
            captured.writes.push(structuredClone(next))
            state.rows = next
          },
        },
        loader: {
          entries: () =>
            mcpChildren.map((child) => ({
              options: { id: child.id, name: '@deepseek-ai/dsh-mcp-client', config: child.config },
              fiber: child.state === 2 ? { state: 2 } : undefined,
            })),
        },
        connection: {
          fetch: {
            register: (route) => {
              captured.route = route
              return async () => {}
            },
          },
        },
      })
    },
  }
  return { ctx, captured, groupEntry }
}

{
  const { ctx, captured } = makeHostCtx({
    configRows: [
      { id: 'abc123', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp' } },
      { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'fs', transport: 'stdio', command: 'npx' }, disabled: true },
    ],
    mcpChildren: [{ id: 'abc123', config: { serverName: 'context7' }, state: 2 }],
  })
  host.apply(ctx)
  check('B3 声明了三个依赖', same(captured.deps, ['connection', 'configEditor', 'loader']), JSON.stringify(captured.deps))
  check('B4 注册了路由', captured.route !== null)
  check('B5 路由路径', captured.route?.path === '/api/mcp-manager', String(captured.route?.path))
  check('B6 路由方法', same(captured.route?.methods, ['GET', 'POST']), JSON.stringify(captured.route?.methods))
  check('B7 路由带 requestBody 模式', captured.route?.requestBody === 'buffered', String(captured.route?.requestBody))
  check('B7b 路由路径符合 /api/<name> 约定', /^\/api\/[^/]+$/.test(String(captured.route?.path ?? '')))

  const getResponse = await captured.route.fetch(new Request('http://localhost/api/mcp-manager', { method: 'GET' }))
  const getBody = await getResponse.json()
  check('B8 GET 200', getResponse.status === 200, String(getResponse.status))
  check('B9 GET 汇报 configured', getBody.data?.configured === true)
  check('B9b GET 声明 capabilities', same(getBody.data?.capabilities, ['setEnabled', 'remove', 'save']), JSON.stringify(getBody.data?.capabilities))
  check('B10 GET 列出 2 台服务器', getBody.data?.servers?.length === 2, JSON.stringify(getBody.data?.servers?.length))
  check('B11 第一台运行中', getBody.data?.servers?.[0]?.phase === 'active', String(getBody.data?.servers?.[0]?.phase))
  check('B12 第二台 disabled', getBody.data?.servers?.[1]?.disabled === true)
  check('B13 第二台未加载', getBody.data?.servers?.[1]?.phase === 'absent', String(getBody.data?.servers?.[1]?.phase))

  const saveResponse = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', {
      method: 'POST',
      body: JSON.stringify({
        op: 'save',
        servers: [
          { rowId: 'abc123', serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp', headers: 'Authorization=Bearer x' },
          { serverName: 'fs', transport: 'stdio', command: 'npx', args: '-y\npkg', env: 'A=1\n# comment\nB=2' },
        ],
      }),
    }),
  )
  const saveBody = await saveResponse.json()
  check('B14 POST 200', saveResponse.status === 200, `${String(saveResponse.status)} ${JSON.stringify(saveBody)}`)
  const written = captured.writes.at(-1)
  check('B15 写的是数组', Array.isArray(written), JSON.stringify(written))
  check('B16 保留 rowId', written?.[0]?.id === 'abc123', JSON.stringify(written?.[0]))
  check('B17 条目名是 mcp 包', written?.[0]?.name === '@deepseek-ai/dsh-mcp-client')
  check('B18 headers 解析成对象', same(written?.[0]?.config?.headers, { Authorization: 'Bearer x' }), JSON.stringify(written?.[0]?.config?.headers))
  check('B19 args 按行拆分', same(written?.[1]?.config?.args, ['-y', 'pkg']), JSON.stringify(written?.[1]?.config?.args))
  check('B20 env 忽略注释行', same(written?.[1]?.config?.env, { A: '1', B: '2' }), JSON.stringify(written?.[1]?.config?.env))

  const badName = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', {
      method: 'POST',
      body: JSON.stringify({ op: 'save', servers: [{ serverName: 'bad name!', transport: 'streamable-http', url: 'x' }] }),
    }),
  )
  check('B21 非法 serverName → 409', badName.status === 409, String(badName.status))

  const badUrl = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', {
      method: 'POST',
      body: JSON.stringify({ op: 'save', servers: [{ serverName: 'ok', transport: 'streamable-http', url: '' }] }),
    }),
  )
  check('B22 空 url → 409', badUrl.status === 409, String(badUrl.status))

  const badOp = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', { method: 'POST', body: JSON.stringify({ op: 'nope' }) }),
  )
  check('B23 未知操作 → 400', badOp.status === 400, String(badOp.status))
  check('B24 非法写入没有落盘', captured.writes.length === 1, String(captured.writes.length))
}

{
  // 组条目缺失时必须给出可读报错，而不是静默失败。
  const captured = { route: null }
  host.apply({
    inject(_deps, callback) {
      callback({
        effect: (factory) => factory(),
        configEditor: { entries: () => [], configuration: () => [], edit: async () => {} },
        loader: { entries: () => [] },
        connection: { fetch: { register: (route) => { captured.route = route; return async () => {} } } },
      })
    },
  })
  const response = await captured.route.fetch(new Request('http://localhost/api/mcp-manager', { method: 'GET' }))
  const body = await response.json()
  check('B25 组条目缺失时 configured=false', body.data?.configured === false, JSON.stringify(body.data))
  const save = await captured.route.fetch(
    new Request('http://localhost/api/mcp-manager', { method: 'POST', body: JSON.stringify({ op: 'save', servers: [] }) }),
  )
  check('B26 组条目缺失时写入 → 409', save.status === 409, String(save.status))
}

{
  // 回归测试（线上 bug）：行内「停用」必须只改 disabled，
  // 且**绝不能丢掉 headers/env**——曾经的整数组回传 + 字段形状差异会把
  // context7 的 Authorization 头静默清空。
  const context7 = {
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      serverName: 'context7',
      transport: 'streamable-http',
      url: 'https://mcp.context7.com/mcp',
      headers: { Authorization: 'Bearer secret' },
    },
  }
  const other = {
    name: '@deepseek-ai/dsh-mcp-client',
    config: { serverName: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } },
  }
  const { ctx, captured } = makeHostCtx({ configRows: [context7, other] })
  host.apply(ctx)
  const post = (payload) =>
    captured.route.fetch(new Request('http://localhost/api/mcp-manager', { method: 'POST', body: JSON.stringify(payload) }))

  const off = await post({ op: 'setEnabled', serverName: 'context7', enabled: false })
  const offBody = await off.json()
  check('B27 停用 → 200', off.status === 200, `${String(off.status)} ${JSON.stringify(offBody)}`)
  const offRows = captured.writes.at(-1)
  check('B28 停用确实写入了 disabled', offRows?.[0]?.disabled === true, JSON.stringify(offRows?.[0]))
  check(
    'B29 停用保留了 headers',
    same(offRows?.[0]?.config?.headers, { Authorization: 'Bearer secret' }),
    JSON.stringify(offRows?.[0]?.config),
  )
  check('B30 停用没有动另一行', same(offRows?.[1], other), JSON.stringify(offRows?.[1]))
  check('B31 响应里 context7 已是停用', offBody.data?.servers?.[0]?.disabled === true, JSON.stringify(offBody.data?.servers?.[0]))

  const on = await post({ op: 'setEnabled', serverName: 'context7', enabled: true })
  const onBody = await on.json()
  check('B32 启用 → 200', on.status === 200, String(on.status))
  const onRows = captured.writes.at(-1)
  check('B33 启用移除了 disabled', !('disabled' in (onRows?.[0] ?? {})), JSON.stringify(onRows?.[0]))
  check(
    'B34 启用仍然保留 headers',
    same(onRows?.[0]?.config?.headers, { Authorization: 'Bearer secret' }),
    JSON.stringify(onRows?.[0]?.config),
  )
  check('B35 响应里 context7 已启用', onBody.data?.servers?.[0]?.disabled === false, JSON.stringify(onBody.data?.servers?.[0]))

  const gone = await post({ op: 'remove', serverName: 'fs' })
  const goneBody = await gone.json()
  check('B36 删除 → 200 且只剩一台', gone.status === 200 && goneBody.data?.servers?.length === 1, JSON.stringify(goneBody.data?.servers))
  check('B37 删掉的是 fs，context7 完好', goneBody.data?.servers?.[0]?.config?.serverName === 'context7', JSON.stringify(goneBody.data?.servers))

  const miss = await post({ op: 'setEnabled', serverName: 'nope', enabled: false })
  check('B38 名字找不到 → 409', miss.status === 409, String(miss.status))

  // 表单路径仍需接受「快照回传的对象形状」，否则编辑保存也会清空 headers。
  const form = await post({
    op: 'save',
    servers: [
      {
        serverName: 'context7',
        transport: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        headers: { Authorization: 'Bearer kept' },
      },
    ],
  })
  const formRows = captured.writes.at(-1)
  check('B39 表单提交也保留对象形状的 headers', form.status === 200 && same(formRows?.[0]?.config?.headers, { Authorization: 'Bearer kept' }), JSON.stringify(formRows?.[0]?.config))

  // 回退路径（宿主半边尚未重载时走的就是它）：客户端发的是「多行文本」形状。
  const fallback = await post({
    op: 'save',
    servers: [
      {
        serverName: 'context7',
        transport: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        headers: 'Authorization=Bearer text-shape',
        disabled: true,
      },
      { serverName: 'fs', transport: 'stdio', command: 'npx', args: '-y\npkg', env: 'A=1\nB=2' },
    ],
  })
  const fbRows = captured.writes.at(-1)
  check(
    'B40 回退路径：文本形状 headers 解析成对象',
    fallback.status === 200 && same(fbRows?.[0]?.config?.headers, { Authorization: 'Bearer text-shape' }),
    JSON.stringify(fbRows?.[0]?.config),
  )
  check('B41 回退路径：disabled 落盘', fbRows?.[0]?.disabled === true, JSON.stringify(fbRows?.[0]))
  check(
    'B42 回退路径：文本 args/env 解析正确',
    same(fbRows?.[1]?.config?.args, ['-y', 'pkg']) && same(fbRows?.[1]?.config?.env, { A: '1', B: '2' }),
    JSON.stringify(fbRows?.[1]?.config),
  )
}
//#endregion

//#region C. 客户端半边
const registered = []
const sandbox = {
  window: { __ModuleLoader__: { load: (definition) => registered.push(definition) } },
  console,
}
sandbox.globalThis = sandbox
vm.runInNewContext(clientSource, sandbox, { filename: 'lib/client.js' })

check('C1 注册了一个模块', registered.length === 1, String(registered.length))
const definition = registered[0]
check('C2 模块 id 等于包名', definition?.id === manifest.name, String(definition?.id))
check('C3 factory 是函数', typeof definition?.factory === 'function')

const fakeReact = {
  createElement: () => null,
  Fragment: { $$typeof: Symbol.for('react.fragment') },
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}
const stubRequire = (specifier) => {
  if (specifier === 'react') return fakeReact
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error(`unexpected require: ${specifier}`)
}
const clientExports = definition.factory(stubRequire)
check('C4 导出 apply', typeof clientExports.apply === 'function')

const registrations = []
const injectedNames = []
clientExports.apply({
  inject(names, callback) {
    injectedNames.push(...names)
    callback({
      slots: {
        inject: (name, register) => {
          register()
          void name
        },
        register: (options, component) => {
          registrations.push({ options, component })
        },
      },
    })
  },
})

check('C5 只注入 slots', same(injectedNames, ['slots']), JSON.stringify(injectedNames))
check('C6 注册了一个座位条目', registrations.length === 1, String(registrations.length))
const { options, component } = registrations[0] ?? {}
check('C7 座位名', options?.name === 'settings.section', String(options?.name))
check('C8 条目 id', options?.id === 'mcp', String(options?.id))
check('C9 order 落在最下方（>= 官方页）', typeof options?.order === 'number' && options.order >= 500, String(options?.order))
check('C10 label 可解析', (typeof options?.label === 'function' ? options.label() : options?.label) === 'MCP')
check('C11 组件是函数', typeof component === 'function')
//#endregion

//#region D. 客户端渲染（迷你渲染器：真正递归展开函数组件，不只是 grep 源码）
{
  const reactFragment = Symbol.for('react.fragment')
  let hookValues = []
  let hookIndex = 0

  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: reactFragment,
    // 状态由场景提供：按组件名取一组值，按调用顺序发。设置函数是 no-op。
    useState: (initial) => {
      const value = hookIndex < hookValues.length ? hookValues[hookIndex] : initial
      hookIndex += 1
      return [value, () => {}]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }

  /** 把 element 树展开成宿主元素树（函数组件会被真正调用）。 */
  function render(node, values) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return { type: '#text', props: { text: String(node) }, children: [] }
    if (Array.isArray(node)) return node.map((child) => render(child, values)).filter(Boolean)
    if (typeof node.type === 'function') {
      hookValues = values[node.type.name] ?? []
      hookIndex = 0
      return render(node.type(node.props), values)
    }
    const children = (node.children ?? []).flat().map((child) => render(child, values)).filter(Boolean)
    return { type: node.type, props: node.props, children }
  }

  const walk = (tree, visit) => {
    for (const node of Array.isArray(tree) ? tree : [tree]) {
      if (node === null || typeof node !== 'object') continue
      visit(node)
      walk(node.children ?? [], visit)
    }
  }
  const collect = (tree, pick) => {
    const out = []
    walk(tree, (node) => {
      const value = pick(node)
      if (value !== undefined && value !== null) out.push(value)
    })
    return out
  }
  const classesOf = (tree) => collect(tree, (n) => (typeof n.props?.className === 'string' ? n.props.className : undefined))
  const textsOf = (tree) => collect(tree, (n) => (n.type === '#text' ? n.props.text : undefined))
  const typesOf = (tree) => collect(tree, (n) => (typeof n.type === 'string' ? n.type : undefined))
  const hasClass = (tree, cls) => classesOf(tree).some((value) => value.split(/\s+/).includes(cls))

  /** 用给定场景渲染 McpSection。 */
  const renderSection = (values) => {
    let sectionComponent = null
    const fresh = definition.factory((specifier) => (specifier === 'react' ? fakeReact : {}))
    fresh.apply({
      inject: (_names, callback) =>
        callback({
          slots: {
            inject: (_name, register) => register(),
            register: (_options, registered) => {
              sectionComponent = registered
            },
          },
        }),
    })
    hookValues = []
    hookIndex = 0
    return render(fakeReact.createElement(sectionComponent, {}), values)
  }

  const server = {
    index: 0,
    disabled: false,
    config: { serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp' },
    phase: 'active',
  }
  const snapshot = { groupId: 'mcp-manager', configured: true, capabilities: ['setEnabled', 'remove', 'save'], servers: [server] }
  const emptySnapshot = { ...snapshot, servers: [] }
  const draft = {
    disabled: false,
    serverName: 'context7',
    transport: 'streamable-http',
    url: 'https://mcp.context7.com/mcp',
    command: '',
    args: '',
    env: '',
    headers: 'Authorization=Bearer x',
    cwd: '',
  }

  // D1–D3 列表视图
  const list = renderSection({ McpSection: [snapshot, null, false, null, null, null] })
  check('D1 列表视图：一卡一服务器', hasClass(list, 'mcpm-rows') && hasClass(list, 'mcpm-rowCard') && hasClass(list, 'mcpm-row'))
  check('D2 列表视图不含表单面板', !hasClass(list, 'mcpm-form'))
  {
    const texts = textsOf(list)
    check('D3 行内三个动作按钮', ['编辑', '停用', '删除'].every((label) => texts.includes(label)), texts.join('|'))
  }

  // D4–D7 展开编辑：表单必须在**同一张卡内**
  const editing = renderSection({ McpSection: [snapshot, null, false, 0, draft, null] })
  check('D4 展开后出现表单面板', hasClass(editing, 'mcpm-form'))
  {
    // 找到 rowCard 节点，确认表单是它的后代（而不是兄弟/别处）。
    let cardHasForm = false
    walk(editing, (node) => {
      if (typeof node.props?.className === 'string' && node.props.className.includes('mcpm-rowCard')) {
        if (hasClass(node.children, 'mcpm-form')) cardHasForm = true
      }
    })
    check('D5 表单就在那张卡片内部', cardHasForm)
  }
  check('D6 展开时按钮变成「收起」', textsOf(editing).includes('收起'))
  {
    // url 是单行 input，headers 是多行 textarea —— 直接守住 mono/multiline 那个坑。
    const types = typesOf(editing)
    check('D7 url 用 input、headers 用 textarea', types.includes('input') && types.includes('textarea'), types.filter((t) => t === 'input' || t === 'textarea').join(','))
  }
  check('D8 展开时不会重复显示第二张同名卡', classesOf(editing).filter((c) => c.includes('mcpm-rowCard')).length === 1)

  // D9 新增：末尾追加一张只含表单的卡
  const adding = renderSection({ McpSection: [snapshot, null, false, 'new', draft, null] })
  check('D9 新增时追加一张只含表单的卡', classesOf(adding).filter((c) => c.includes('mcpm-rowCard')).length === 2 && hasClass(adding, 'mcpm-form'))

  // D10–D12 空 / 载入 / 错误
  check('D10 空列表走无边框 .mcpm-empty', hasClass(renderSection({ McpSection: [emptySnapshot, null, false, null, null, null] }), 'mcpm-empty'))
  check('D11 载入态', textsOf(renderSection({ McpSection: [null, null, false, null, null, null] })).includes('正在读取…'))
  check('D12 错误态', hasClass(renderSection({ McpSection: [null, 'boom', false, null, null, null] }), 'mcpm-notice--error'))

  // D13 组条目缺失
  check(
    'D13 未配置 group 时给出可读提示',
    textsOf(renderSection({ McpSection: [{ ...snapshot, configured: false }, null, false, null, null, null] })).some((t) => t.includes('cordis:group')),
  )
}
//#endregion

const total = passed + failures.length
if (failures.length === 0) {
  console.log(`PASS ${String(passed)}/${String(total)}`)
} else {
  console.log(`FAIL ${String(failures.length)}/${String(total)}`)
  for (const failure of failures) console.log(`  ✗ ${failure}`)
  process.exitCode = 1
}
