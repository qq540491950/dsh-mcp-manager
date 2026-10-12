/**
 * 浏览器半边（Client half）——DSH 自带的「懒 CJS」模块协议。
 *
 * 契约（实测自 @deepseek-ai/dsh-client-modules 与既有插件）：
 *   1. 这是一个普通 classic script，不是 ESM；执行时只做一件事：向
 *      `window.__ModuleLoader__` 注册一个 factory。
 *   2. factory 首次被 materialize 时执行，返回的 exports 就是模块导出。
 *   3. `id` 必须等于本包 package.json 的 `name`。
 *   4. `require` 只能取平台种子模块：react / react-dom / cordis /
 *      dsh-client-store / ui-slots / ui-primitives / ui-dockkit。
 *
 * 本插件做什么：往 `settings.section`（list 座位）注册一页 **MCP** 设置页，
 * `order: 900` 使它落在设置导航的**最下方**（General 是 0，其余官方页在中间）；
 * 并把自己在设置导航里那一格的**齿轮图标换成 MCP 官方标记**——注册契约没有 icon 字段，
 * 官方 `navIcon(id)` 对未知 id 一律兜底成齿轮，所以只能渲染后打标记 + 样式覆盖
 * （见下方 markNavCell 与 README 8.6；只 setAttribute，不动 React 的节点树）。
 *
 * 状态模型（四色，**不能只看 fiber 相位**）：
 *
 *   灰「已停用」   disabled / phase=stopped
 *   琥珀「启动中」 phase=pending|loading（mcp-client 的 apply 会 await 连接建立，握手期间就是 LOADING）
 *   绿「运行中」   主动检测通过 **且** 条目 active —— 只有这条路径才报绿
 *   红「连接失败」 主动检测失败（TCP 拒绝 / HTTP 401 / 超时 / 响应不是 MCP）
 *   红「连接异常」 宿主从 `ctx.logger` 捞到的 mcp-client 失败原文（时间 · 次数 · 原文）
 *   红「加载失败」 fiber FAILED（配置校验不过 / failOnStartupError:true）
 *   琥珀「未检测」 条目活着，但**这条通道还没有正面证据**（刚写入配置 / 刚打开页面 / 探测还没回来）
 *   灰「未启动」   没有活条目（absent/unloading/disposed）
 *
 * 为什么"fiber ACTIVE"不能直接报绿：mcp-client 默认 `failOnStartupError:false`，
 * 连不上也不抛错（后台退避重试 10 次后放弃并注销工具），phase 会永远停在 'active'。
 * 实测过：TCP 端口拒绝的服务器显示成绿色「运行中」。所以失败记录与主动检测都优先于它。
 * 旧宿主不带 `error`/`probe` 字段 → 退化成只看相位，天然向后兼容，不需要能力分支。
 *
 * **写入之后必须重新检测**（recheck）：宿主每次写入都会清掉旧记录（旧记录说的是上一个实例），
 * 于是"停用 → 再启用"之后快照里一点证据都没有。没有这一步就只能靠相位报绿 ——
 * 那正是用户反馈的"关掉再启动，不检测连接性还显示绿灯"。
 *
 * 间距/配色纪律：**紧凑档**，取自官方小号控件的实测值（见 README 8 节）：
 *
 *   shell .options   padding: 0 24px 24px        ← 左右与底部留白由外壳提供，页面不得重复叠加
 *   Button.sm        height:28px; font-size:12px; padding:0 10px;
 *                    border-radius:var(--dsw-radius-sm)   ← 本插件的按钮基准
 *   card             padding:6px 12px; border:.5px solid settings-card-stroke;
 *                    border-radius:var(--dsw-radius-lg); background:settings-card-fill
 *   row              min-height:34px; padding:3px 0; gap:10px
 *
 * 四条踩过的坑（都由 tools/verify.mjs 的 A11–A25 断言守住）：
 *   1. **绝不硬编码前景色**。深色主题下 `brand-primary` 近白色，曾把主按钮做成白底白字。
 *   2. **说明文字不能和按钮同处一个 flex 行**，否则按钮被压成竖排两字。
 *   3. **视觉不要写在 inline style 里**：inline 的 `background` 会压过 `:hover`，
 *      导致按钮没有 hover/focus 反馈（截图里"廉价感"的主因）。视觉走下面的 CSS。
 *   4. **尺寸也不要写 inline**：inline 会压过样式表，换紧凑档时看不到效果。
 */
window.__ModuleLoader__.load({
	id: "dsh-mcp-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");

		const h = react.createElement;
		const { useCallback, useEffect, useState } = react;

		const ROUTE = "/api/mcp-manager";
		const TRANSPORTS = ["streamable-http", "stdio"];
		const STYLE_ELEMENT_ID = "dsh-mcp-manager-styles";

		/**
		 * 座位身份。**设置导航那一格就是靠这个文本认出来的**（见 markNavCell），
		 * 所以 id / label 必须与注册处共用这两个常量，不能各写各的字面量。
		 */
		const SECTION_ID = "mcp";
		const SECTION_LABEL = "MCP";

		/** 官方设置面板的定位锚点：SettingsPanel 上写死的 data 属性，比 CSS-module 哈希名稳。 */
		const NAV_DIALOG_SELECTOR = '[data-shortcut-modal="settings"]';

		/** 打在「MCP」那一格上的标记属性；样式表按它覆盖官方图标。 */
		const NAV_ATTRIBUTE = "data-mcpm-nav";

		/**
		 * MCP 官方标记（三联弧线笔画）。几何逐字取自官方仓库
		 * `modelcontextprotocol/modelcontextprotocol` 的 `docs/favicon.svg`（那三条
		 * stroke-width=11.0667 / linecap=round 的 path），只加一层 translate+scale 缩进 16x16：
		 * 墨迹高 15、宽 13.4851（居中），有效描边 1.0——官方自然比例是 1.043，
		 * 但 16px 下笔画之间的缝只剩约 1px，4% 的加粗就会把缝糊死（实测覆盖率 0.169 → 0.242）。
		 *
		 * 同源的可读版本是 `assets/mcp-mark.svg`；自检逐字比对两份，防止漂移。
		 * 作为 CSS mask 用时只看 alpha：data URI 里的 `currentColor` 会退化成初始色，
		 * 真正的颜色由使用处的 `background-color:currentColor` 提供。
		 */
		const MCP_MARK_SVG =
			'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round"><g transform="translate(-0.44525 -0.50229) scale(0.0942473)" stroke-width="10.61038"><path d="M23.5996 85.2532L86.2021 22.6507C94.8457 14.0071 108.86 14.0071 117.503 22.6507C126.147 31.2942 126.147 45.3083 117.503 53.9519L70.2254 101.23"/><path d="M70.8789 100.578L117.504 53.952C126.148 45.3083 140.163 45.3083 148.806 53.952L149.132 54.278C157.776 62.9216 157.776 76.9357 149.132 85.5792L92.5139 142.198C89.6327 145.079 89.6327 149.75 92.5139 152.631L104.14 164.257"/><path d="M101.853 38.3013L55.553 84.6011C46.9094 93.2447 46.9094 107.258 55.553 115.902C64.1966 124.546 78.2106 124.546 86.8543 115.902L133.154 69.6025"/></g></svg>';

		/** 同一份几何的 data URI（给 CSS mask 用）；encodeURIComponent 负责转义引号与尖括号。 */
		const MCP_MARK_DATA_URI = `data:image/svg+xml,${encodeURIComponent(MCP_MARK_SVG)}`;

		/**
		 * 请求超时。没有它的话，一旦宿主侧的 reconcile 卡住，`fetch` 永不 settle，
		 * `busy` 永远为 true → **按钮永久发灰、状态也不变**（正是"点击停用置灰但状态不变"
		 * 最可能的一种成因）。有了它，超时会走 catch 把原因显示出来，按钮恢复可点。
		 */
		const REQUEST_TIMEOUT_MS = 20000;
		const signalOf = () =>
			typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
				? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
				: undefined;

		/**
		 * 写入之后等"条目重新挂上"的节奏：Loader 重建子条目是异步的（相位会走
		 * pending → loading → active），而绿灯要求"探测通过 **且** 条目 active"。
		 * 所以探通之后还要重读快照，直到相位稳定 —— 有界（约 2s），不是轮询。
		 */
		const SETTLE_INTERVAL_MS = 200;
		const SETTLE_ATTEMPTS = 10;

		/** 等下一轮快照（只用在写入之后的相位稳定上；平时不轮询，避免敲服务器）。 */
		function sleep(ms) {
			return new Promise((resolve) => setTimeout(resolve, ms));
		}

		/** 把任意异常整理成给用户看的一句话。 */
		function describeError(error) {
			if (error instanceof Error && error.name === "TimeoutError") {
				return `请求超时（${REQUEST_TIMEOUT_MS / 1000}s）：宿主没有在预期时间内完成写入，请稍后重试或查看 DSH 日志。`;
			}
			return error instanceof Error ? error.message : String(error);
		}

		/**
		 * 视觉层。class 名统一 `mcpm-` 前缀，避免与官方样式冲突。
		 *
		 * 采用**紧凑档**：数值取自官方小号控件
		 * （`ui-primitives/Button.module.css` 的 `.sm` = 28px 高 / 12px 字号 /
		 * `0 10px` 内边距 / `--dsw-radius-sm`），行高与间距随之收紧一档。
		 *
		 * 自适应：所有会在窄容器里溢出的地方都给 `min-width:0` + 省略号；
		 * 操作区 `flex:none` 且不换行，信息区吸收压缩——面板变窄时先省略文字，
		 * 而不是把按钮挤到第二行或撑破卡片。
		 */
		const CSS = `
.mcpm-page { box-sizing:border-box; width:100%; max-width:720px; min-width:0; display:flex; flex-direction:column; gap:12px; padding:4px 0; color:var(--dsw-alias-label-primary); font-size:13px; line-height:18px; }
.mcpm-heading { display:flex; flex-direction:column; gap:2px; min-width:0; }
.mcpm-titleRow { display:flex; align-items:center; justify-content:space-between; gap:10px; min-width:0; }
.mcpm-title { margin:0; font-size:13px; font-weight:500; line-height:18px; }
.mcpm-subtitle { margin:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
/* 「检测中…」：自动检测在后台跑，用这行小字说明"状态还在刷新"，而不是锁住按钮。 */
.mcpm-probing { min-width:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; white-space:nowrap; }
/* 每个服务器一张卡（对齐 ui-settings-models 的 .rows/.rowCard）。 */
.mcpm-rows { display:flex; flex-direction:column; gap:8px; margin:0; padding:0; list-style:none; }
.mcpm-rowCard { box-sizing:border-box; min-width:0; display:flex; flex-direction:column; gap:10px; border:.5px solid var(--dsw-alias-settings-card-stroke); border-radius:var(--dsw-radius-lg, 8px); background:var(--dsw-alias-settings-card-fill); padding:8px 12px; }
.mcpm-row { box-sizing:border-box; min-width:0; display:flex; align-items:center; gap:10px; min-height:28px; }
/* 停用的行整体压暗：只靠圆点颜色区分太弱，用户会以为"没生效"。 */
.mcpm-row--off .mcpm-name { color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.mcpm-row--off .mcpm-dot { opacity:.45; }
/* 失败原因：一行小字跟在行下面（仍在同一张卡内）。min-width:0 是自适应纪律；
   overflow-wrap:anywhere 让 fetch/路径这类长串在窄面板里也能断行，不撑破卡片。 */
.mcpm-rowError { min-width:0; color:var(--dsw-alias-state-error-primary, #d9534f); font-size:12px; line-height:16px; overflow-wrap:anywhere; }
.mcpm-empty { padding:8px 0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
.mcpm-meta { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }
.mcpm-name { font-size:13px; font-weight:500; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mcpm-dot { flex:none; width:6px; height:6px; border-radius:50%; }
/* 操作区必须单行：flex:none 才不会被左侧长文本压缩，去掉 wrap 才不会把"删除"折到下一行。 */
.mcpm-actions { display:flex; align-items:center; justify-content:flex-end; flex:none; gap:4px; margin-left:auto; }
/* 按钮 = 官方 .rowActions 的尺寸（28px / 12px / 0 10px），本来就是紧凑档。 */
.mcpm-btn { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; flex:none; white-space:nowrap; height:28px; min-width:44px; padding:0 10px; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-sm, 4px); background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; line-height:18px; cursor:pointer; }
.mcpm-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.mcpm-btn:active:not(:disabled) { background:var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover)); }
.mcpm-btn:focus-visible { outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset:1px; }
.mcpm-btn:disabled { opacity:.4; cursor:not-allowed; }
.mcpm-btn--primary { border-color:transparent; background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); color:var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base)); font-weight:500; }
.mcpm-btn--primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))); }
.mcpm-btn--danger { color:var(--dsw-alias-state-error-primary, #d9534f); }
/* 表单是卡片**内部**的面板：靠**底色**区分（官方 .addCard 的 bg-module-platform），
   自己**不带描边**——描边会和外层卡片叠成「卡片套卡片」，这正是之前丑的原因。 */
.mcpm-form { box-sizing:border-box; min-width:0; display:flex; flex-direction:column; gap:8px; padding:10px 12px; border-radius:var(--dsw-radius-lg, 8px); background:var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1)); }
.mcpm-formTitle { margin:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
.mcpm-field { display:flex; flex-direction:column; gap:4px; min-width:0; }
/* 官方 .fieldLabel：12px / 500 / label-secondary。 */
.mcpm-label { color:var(--dsw-alias-label-secondary); font-size:12px; font-weight:500; line-height:16px; }
/* 官方 .input：border-l4 + bg-layer-1 + radius-md，focus 只换描边不画 outline。 */
.mcpm-input { box-sizing:border-box; width:100%; height:28px; padding:0 8px; border:.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l3)); border-radius:var(--dsw-radius-md, 6px); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; line-height:18px; }
.mcpm-input::placeholder { color:var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))); }
.mcpm-input:focus-visible { border-color:var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); outline:none; }
/* 等宽只是字体，和「多行」无关；两者混用曾把 url 渲染成 56px 的大框。 */
.mcpm-input--mono { font-family:ui-monospace, monospace; }
.mcpm-textarea { height:auto; min-height:56px; padding:6px 8px; font-size:12px; line-height:16px; }
.mcpm-notice { box-sizing:border-box; min-width:0; padding:8px 12px; border:.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md, 6px); font-size:12px; line-height:16px; }
.mcpm-notice--error { color:var(--dsw-alias-state-error-primary, #d9534f); border-color:currentColor; }
.mcpm-actions--form { justify-content:flex-end; margin-left:0; }
/* 设置导航里「MCP」那一格。
   官方 navIcon(id) 是**硬编码 id→图标**、未知 id 一律兜底成齿轮
   （dsh-client-ui-settings-general/lib/client.js:244-267），而 settings.section 的注册契约
   只有 id/order/label、**没有 icon 字段**，所以只能渲染后给自己那一格打标记再覆盖：
     · display:none 让官方 <svg> 退出 flex 流（label 的位置因此不变，gap 也不多算一格）；
     · ::before + mask 画 MCP 标记，颜色走 currentColor（mask 只取 alpha）。
   React 的节点树一个都不动：不删、不换、不 append 到 body。 */
[data-shortcut-modal="settings"] button[data-mcpm-nav] > svg { display:none; }
[data-shortcut-modal="settings"] button[data-mcpm-nav]::before { content:""; flex:none; width:16px; height:16px; background-color:currentColor; -webkit-mask:url("${MCP_MARK_DATA_URI}") center/contain no-repeat; mask:url("${MCP_MARK_DATA_URI}") center/contain no-repeat; }
`;

		/**
		 * 注入视觉层。幂等，但**不是「元素存在就跳过」**：客户端半边会热替换（`dsh-client-hmr`
		 * 按 mtime/size 发新 rev），此时样式表元素还在、CSS 文本却变了——只按 id 跳过会让
		 * 改过的样式永远不生效（实测踩过：导航那两行规则加了却没进页面，图标仍是齿轮）。
		 * 所以存在时比对文本、不一致就原地更新，不重复 append。
		 */
		function ensureStyles() {
			if (typeof document === "undefined") return;
			const existing = document.getElementById(STYLE_ELEMENT_ID);
			if (existing !== null) {
				if (existing.textContent !== CSS) existing.textContent = CSS;
				return;
			}
			const element = document.createElement("style");
			element.id = STYLE_ELEMENT_ID;
			element.textContent = CSS;
			document.head.appendChild(element);
		}

		//#region 纯函数工具
		/** 一行服务器配置 → 目标摘要（URL 或命令行）。 */
		function targetOf(config) {
			if (config.transport === "stdio") {
				const args = Array.isArray(config.args) ? config.args : [];
				return [config.command, ...args].filter(Boolean).join(" ") || "(未填写 command)";
			}
			return config.url || "(未填写 url)";
		}

		/** 状态色：全部走官方 token，十六进制只作 var() fallback。 */
		const STATUS_IDLE = "var(--dsw-alias-state-idle-primary)";
		const STATUS_WARN = "var(--dsw-alias-state-warn-primary, #d8a24a)";
		const STATUS_ERROR = "var(--dsw-alias-state-error-primary, #d9534f)";
		const STATUS_OK = "var(--dsw-alias-state-success-primary, #2ea043)";

		/**
		 * 运行时状态 → 圆点颜色 / 文案 / 原因行。判定顺序**就是优先级**：
		 *
		 *   已停用(灰) → 检测通过(绿) → 检测失败(红) → 日志失败记录(红) → fiber FAILED(红)
		 *   → 启动中(琥珀) → 无证据(琥珀「未检测」) → 其余(灰「未启动」)
		 *
		 * 三个关键点：
		 *   1. **fiber ACTIVE 不等于能用**。`mcp-client` 默认 `failOnStartupError:false`，
		 *      连接失败也不抛错（它会在后台按退避重试，最多 10 次后放弃并注销全部工具），
		 *      所以 `phase` 会一直停在 'active' —— 只读相位就必然误报绿灯（实测过：TCP 拒绝的
		 *      服务器显示「运行中」）。因此失败记录与主动检测都优先于 'active'。
		 *   2. **检测优先于日志**：日志只能证明"过去失败过"，检测能证明"现在答不答"。
		 *   3. **绿灯要有正面证据**。宿主支持探测（能力协商）时，"条目 active 但没有任何探测
		 *      记录"只说明 apply 跑完了，不说明连得上 —— 此时报「未检测」而不是绿。写入配置
		 *      （启停/删除/保存）会让宿主清掉旧记录，所以那之后必然经过这一态，
		 *      由 `recheck` 补一次探测把它推回绿/红（见 recheck）。
		 *
		 * @param server - 快照里的一条服务器记录。
		 * @param canProbe - 宿主是否声明了 `probe` 能力（旧宿主没有这条通道，只能退回相位判定）。
		 */
		function statusOf(server, canProbe) {
			if (server.disabled === true || server.phase === "stopped") return { color: STATUS_IDLE, text: "已停用", reason: null };
			const probe = server.probe;
			// 只有"条目活着 + 检测通过"才算真的可用（条目没挂上时工具也没注册，不能报绿）。
			if (probe?.connected === true && server.phase === "active") return { color: STATUS_OK, text: "运行中", reason: null };
			if (probe?.connected === false) return { color: STATUS_ERROR, text: "连接失败", reason: `检测：${probe.detail ?? "无响应"}` };
			if (typeof server.error?.message === "string" && server.error.message !== "") {
				return { color: STATUS_ERROR, text: "连接异常", reason: failureText(server.error) };
			}
			if (server.phase === "failed") return { color: STATUS_ERROR, text: "加载失败", reason: null };
			if (server.phase === "pending" || server.phase === "loading") return { color: STATUS_WARN, text: "启动中", reason: null };
			if (server.phase === "active") {
				// 有记录但探不了（stdio 走子进程，`connected === null`）：相位是唯一证据，照旧报绿。
				if (probe !== undefined) return { color: STATUS_OK, text: "运行中", reason: null };
				// 宿主能探测却没有任何记录 → 没有证据，不报绿（等 recheck 或用户点「检测」）。
				if (canProbe === true) return { color: STATUS_WARN, text: "未检测", reason: null };
				// 旧宿主没有探测通道，相位就是它唯一的证据（向后兼容）。
				return { color: STATUS_OK, text: "运行中", reason: null };
			}
			return { color: STATUS_IDLE, text: "未启动", reason: null };
		}

		/**
		 * 还有服务器"探通了、但条目没挂上"吗？（相位稳定之前不能报绿）
		 * `failed` 是终态，不必再等；其余非 active 的相位（pending/loading）都算没稳定。
		 */
		function settling(data) {
			return (data?.servers ?? []).some(
				(server) =>
					server.disabled !== true &&
					server.probe?.connected === true &&
					server.phase !== "active" &&
					server.phase !== "failed",
			);
		}

		/**
		 * 失败记录 → 一行可读的原因：时间 +（多次时）次数 + mcp-client 的原文。
		 * 时间戳是刻意的：那条记录可能来自上一次实例（例如改完配置刚重启、或已放弃重连），
		 * 有具体时间才不会被当成"现在正在发生"。
		 */
		function failureText(error) {
			const at = typeof error?.at === "number" ? new Date(error.at) : null;
			const when = at !== null && Number.isNaN(at.getTime()) !== true ? at.toLocaleTimeString() : "";
			const count = typeof error?.count === "number" && error.count > 1 ? `已失败 ${error.count} 次` : "";
			const head = [when, count].filter((part) => part !== "").join(" · ");
			const message = typeof error?.message === "string" ? error.message : "";
			return head === "" ? message : `${head} · ${message}`;
		}

		/** 记录 ↔ 可编辑草稿的双向整理。 */
		function draftOf(server) {
			const config = server?.config ?? {};
			return {
				rowId: server?.rowId,
				disabled: server?.disabled === true,
				serverName: config.serverName ?? "",
				transport: config.transport === "stdio" ? "stdio" : "streamable-http",
				url: config.url ?? "",
				command: config.command ?? "",
				args: Array.isArray(config.args) ? config.args.join("\n") : "",
				env: pairsToText(config.env),
				headers: pairsToText(config.headers),
				cwd: config.cwd ?? "",
			};
		}

		/** 对象 → KEY=VALUE 多行文本。 */
		function pairsToText(record) {
			if (record === null || typeof record !== "object") return "";
			return Object.entries(record)
				.map(([key, value]) => `${key}=${String(value)}`)
				.join("\n");
		}

		/** 草稿 → 服务端契约的服务器对象。 */
		function serverOf(draft) {
			const base = {
				rowId: draft.rowId,
				disabled: draft.disabled,
				serverName: draft.serverName.trim(),
				transport: draft.transport,
			};
			if (draft.transport === "stdio") {
				return { ...base, command: draft.command.trim(), args: draft.args, env: draft.env, cwd: draft.cwd.trim() };
			}
			return { ...base, url: draft.url.trim(), headers: draft.headers };
		}

		/**
		 * 服务器记录 → **旧版宿主**认识的扁平形状（`op: "save"` 用）。
		 * 关键：env / headers / args 一律转成宿主认识的「多行文本 / 换行文本」。
		 * 快照里它们是对象，直接回传会被旧宿主的解析器当成"非字符串非数组"而**静默清空**
		 * ——线上就是这里把 context7 的 Authorization 头弄丢的。
		 */
		function serverOfExisting(server) {
			const config = server.config ?? {};
			const flat = { ...config, rowId: server.rowId, disabled: server.disabled === true };
			if (config.env !== undefined) flat.env = pairsToText(config.env);
			if (config.headers !== undefined) flat.headers = pairsToText(config.headers);
			if (Array.isArray(config.args)) flat.args = config.args.join("\n");
			return flat;
		}

		/** 能力协商：宿主是否支持「定点操作」。 */
		function supports(snapshot, capability) {
			return Array.isArray(snapshot?.capabilities) && snapshot.capabilities.includes(capability);
		}

		/** 新增时给一个不会撞车的默认名。 */
		function suggestName(servers) {
			const taken = new Set(servers.map((server) => server.config?.serverName));
			for (let index = 1; index < 100; index += 1) {
				const candidate = `server-${index}`;
				if (!taken.has(candidate)) return candidate;
			}
			return "server";
		}
		//#endregion

		//#region 表单
		/**
		 * 文本字段。两个**互不相关**的开关：
		 *   - `mono`      → 只影响字体（等宽，便于看标识符/URL/命令行）
		 *   - `multiline` → 换成真正的 `<textarea>`
		 * 曾经把两者混在一个 `mono` 上，导致 url 这种单行字段被渲染成 56px 的多行大框。
		 */
		function Field({ label, value, onChange, placeholder, mono, multiline }) {
			const className = ["mcpm-input", mono ? "mcpm-input--mono" : null, multiline ? "mcpm-textarea" : null]
				.filter(Boolean)
				.join(" ");
			const shared = {
				className,
				value,
				placeholder,
				onChange: (event) => onChange(event.target.value),
			};
			return h(
				"label",
				{ className: "mcpm-field" },
				h("span", { className: "mcpm-label" }, label),
				// 尺寸完全交给样式表，不留 inline 高度（inline 会压过 CSS）。
				multiline ? h("textarea", { ...shared, rows: 3, spellCheck: false }) : h("input", shared),
			);
		}

		/** 服务器新增/编辑表单。 */
		function ServerForm({ draft, onDraft, onSubmit, onCancel, busy, error, isNew }) {
			const stdio = draft.transport === "stdio";
			return h(
				"form",
				{
					className: "mcpm-form",
					onSubmit: (event) => {
						event.preventDefault();
						onSubmit();
					},
				},
				h("div", { className: "mcpm-formTitle" }, isNew ? "新增 MCP 服务器" : `编辑 ${draft.serverName || "服务器"}`),
				h(Field, {
					label: "名称（serverName，1-32 位字母数字下划线连字符）",
					value: draft.serverName,
					onChange: (value) => onDraft({ ...draft, serverName: value }),
					placeholder: "context7",
				}),
				h(
					"label",
					{ className: "mcpm-field" },
					h("span", { className: "mcpm-label" }, "传输方式"),
					h(
						"select",
						{
							className: "mcpm-input",
							value: draft.transport,
							onChange: (event) => onDraft({ ...draft, transport: event.target.value }),
						},
						TRANSPORTS.map((transport) => h("option", { key: transport, value: transport }, transport)),
					),
				),
				stdio
					? h(
							react.Fragment,
							null,
							h(Field, {
								label: "command",
								value: draft.command,
								onChange: (value) => onDraft({ ...draft, command: value }),
								placeholder: "npx",
								mono: true,
							}),
							h(Field, {
								label: "args（每行一个）",
								value: draft.args,
								onChange: (value) => onDraft({ ...draft, args: value }),
								placeholder: "-y\n@modelcontextprotocol/server-filesystem\nD:\\work",
								mono: true,
								multiline: true,
							}),
							h(Field, {
								label: "env（每行 KEY=VALUE）",
								value: draft.env,
								onChange: (value) => onDraft({ ...draft, env: value }),
								placeholder: "API_KEY=sk-...",
								mono: true,
								multiline: true,
							}),
							h(Field, {
								label: "cwd（可选）",
								value: draft.cwd,
								onChange: (value) => onDraft({ ...draft, cwd: value }),
								mono: true,
							}),
						)
					: h(
							react.Fragment,
							null,
							h(Field, {
								label: "url",
								value: draft.url,
								onChange: (value) => onDraft({ ...draft, url: value }),
								placeholder: "https://mcp.context7.com/mcp",
								mono: true,
							}),
							h(Field, {
								label: "headers（每行 KEY=VALUE，密钥会明文写进 profile 配置）",
								value: draft.headers,
								onChange: (value) => onDraft({ ...draft, headers: value }),
								placeholder: "Authorization=Bearer ...",
								mono: true,
								multiline: true,
							}),
						),
				error === null ? null : h("div", { className: "mcpm-notice mcpm-notice--error" }, error),
				h(
					"div",
					{ className: "mcpm-actions mcpm-actions--form" },
					h("button", { type: "button", className: "mcpm-btn", onClick: onCancel, disabled: busy }, "取消"),
					h(
						"button",
						{ type: "submit", className: "mcpm-btn mcpm-btn--primary", disabled: busy },
						isNew ? "添加" : "保存",
					),
				),
			);
		}
		//#endregion

		//#region 页面
		/** 设置面板里的一页：MCP 服务器管理。 */
		function McpSection() {
			const [snapshot, setSnapshot] = useState(null);
			const [loadError, setLoadError] = useState(null);
			const [busy, setBusy] = useState(false);
			const [editing, setEditing] = useState(null);
			const [draft, setDraft] = useState(null);
			// 两条**互斥**的错误通道，各自只有一个渲染点（否则同一句话会出现两遍）：
			//   formError   ← 表单提交失败，只渲染在那张表单里（错误说的是这份草稿）
			//   actionError ← 行内操作（停用/删除）失败，没有表单可挂，只渲染在页面级
			const [formError, setFormError] = useState(null);
			const [actionError, setActionError] = useState(null);
			// 后台检测进行中（自动检测不占用 busy，否则一进页面按钮全会灰一下）。
			const [probing, setProbing] = useState(false);

			/** 读一次快照；成功时返回 data（挂载时的自动检测要拿它做能力判断）。 */
			const refresh = useCallback(async () => {
				try {
					const response = await fetch(ROUTE, { headers: { accept: "application/json" }, signal: signalOf() });
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					setSnapshot(body.data);
					setLoadError(null);
					// 重新读到权威快照后，上一次行内操作的报错已经过时。
					setActionError(null);
					return body.data;
				} catch (error) {
					setLoadError(describeError(error));
					return null;
				}
			}, []);

			/**
			 * 唯一的写入入口。注意传的是**操作**而不是整份数组：
			 * 「启停」「删除」由宿主按 serverName 定位那一行原地修改，字段不可能丢；
			 * 只有表单提交才用整数组替换（`op: "save"`）。
			 * @param payload - 请求体（`op` + 该操作需要的字段）。
			 * @param after - 成功后的收尾动作；收到**这次响应里的快照**（写入之后的补探测要用它做能力判断）。
			 * @param onError - 失败时把原因写进哪条通道；**必须只写一条**，否则会重复显示。
			 * @param options.silent - 后台请求：只亮 `probing`，不锁住按钮。
			 * @returns 成功时这次响应里的快照，失败时 null。
			 */
			const call = useCallback(async (payload, after, onError, options) => {
				const silent = options?.silent === true;
				if (silent) setProbing(true);
				else setBusy(true);
				setFormError(null);
				setActionError(null);
				try {
					const response = await fetch(ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json", accept: "application/json" },
						body: JSON.stringify(payload),
						signal: signalOf(),
					});
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					setSnapshot(body.data);
					after?.(body.data);
					return body.data;
				} catch (error) {
					onError(describeError(error));
					return null;
				} finally {
					if (silent) setProbing(false);
					else setBusy(false);
				}
			}, []);

			const servers = snapshot?.servers ?? [];

			/** 主动检测。按钮走默认（锁住按钮），自动检测走 `{ silent: true }`（只亮「检测中…」）。 */
			const detect = useCallback((options) => call({ op: "probe" }, undefined, setActionError, options), [call]);

			/**
			 * **写入配置之后补一次检测**（启停 / 删除 / 保存都要，不只是"启用"）。
			 *
			 * 为什么必须有这一步：宿主每次写入都会清掉旧的失败与探测记录 —— 它们说的是**上一个
			 * 实例**（见 index.js 的 commitRows）。于是"停用 → 再启用"之后，快照里一点正面证据
			 * 都不剩，只剩相位；而相位 active 只说明 apply 跑完了，连不上也是 active
			 * （AGENTS 3.10）。没有这一步就只能报一个假的绿灯，或者永远停在「未检测」。
			 *
			 * 两步：
			 *   1. 主动探测（静默）——立刻知道"现在答不答"；
			 *   2. 等相位稳定——Loader 重建子条目是异步的，"探通了但条目还没挂上"时不能报绿
			 *      （那一刻工具还没注册），所以重读快照直到 active/failed 或次数用尽。
			 *
			 * @param data - 刚拿到的那份快照；用它做能力协商（闭包里的 snapshot 可能是旧值）。
			 */
			const recheck = useCallback(
				async (data) => {
					if (!supports(data, "probe")) return;
					let current = await call({ op: "probe" }, undefined, setActionError, { silent: true });
					for (let attempt = 0; attempt < SETTLE_ATTEMPTS && settling(current); attempt += 1) {
						await sleep(SETTLE_INTERVAL_MS);
						current = await refresh();
					}
				},
				[call, refresh],
			);

			/**
			 * **打开这一页就自动检测一次**（不再需要先点按钮）。
			 *
			 * 顺序是关键：先读快照（快、必成功），拿到 `capabilities` 再决定要不要发探测。
			 * 宿主半边不热重载，旧宿主不认识 `probe` —— 先读快照才不会平白拿到
			 * 一条「未知操作：probe」。自动检测用 silent 模式，所以列表先出来、按钮不灰。
			 */
			useEffect(() => {
				let cancelled = false;
				void (async () => {
					const data = await refresh();
					if (cancelled || !supports(data, "probe")) return;
					void recheck(data);
				})();
				return () => {
					cancelled = true;
				};
			}, [refresh, recheck]);

			const openNew = useCallback(() => {
				setEditing("new");
				setFormError(null);
				setDraft({
					serverName: suggestName(servers),
					transport: "streamable-http",
					url: "",
					command: "",
					args: "",
					env: "",
					headers: "",
					cwd: "",
					disabled: false,
				});
			}, [servers]);

			/** 收起表单：连同这份草稿的报错一起清掉，重开时不会看到上一份草稿的错误。 */
			const closeForm = useCallback(() => {
				setEditing(null);
				setFormError(null);
			}, []);

			const submit = useCallback(() => {
				if (draft === null) return;
				const server = serverOf(draft);
				const next =
					editing === "new"
						? [...servers.map(serverOfExisting), server]
						: servers.map((existing, index) =>
								index === editing ? { ...serverOfExisting(existing), ...server } : serverOfExisting(existing),
							);
				call(
					{ op: "save", servers: next },
					(data) => {
						setEditing(null);
						setDraft(null);
						// 保存会改 url/headers（或增删服务器）：旧记录被清掉，落盘后必须重新探一次。
						void recheck(data);
					},
					setFormError,
				);
			}, [call, draft, editing, recheck, servers]);

			/**
			 * 启停一台。宿主支持定点操作时只给「目标状态」，**完全不碰配置字段**；
			 * 否则退回整数组提交（env/headers 已转成旧宿主认识的文本形状）。
			 *
			 * 两种写法成功之后都要 `recheck`：宿主写入会清掉全部旧记录（不只有这一台），
			 * 所以"停用 → 再启用"必须重新探测才知道连接性正不正常。
			 */
			const toggle = useCallback(
				(server) => {
					const serverName = server.config?.serverName ?? "";
					if (supports(snapshot, "setEnabled")) {
						call({ op: "setEnabled", serverName, enabled: server.disabled === true }, recheck, setActionError);
						return;
					}
					call(
						{
							op: "save",
							servers: servers.map((item) =>
								item === server
									? { ...serverOfExisting(item), disabled: !(item.disabled === true) }
									: serverOfExisting(item),
							),
						},
						recheck,
						setActionError,
					);
				},
				[call, recheck, servers, snapshot],
			);

			/** 删除一台：同样优先定点操作；删完也要重探（其余服务器的旧记录同样被清掉）。 */
			const remove = useCallback(
				(server) => {
					const serverName = server.config?.serverName ?? "";
					if (supports(snapshot, "remove")) {
						call({ op: "remove", serverName }, recheck, setActionError);
						return;
					}
					call(
						{ op: "save", servers: servers.filter((item) => item !== server).map(serverOfExisting) },
						recheck,
						setActionError,
					);
				},
				[call, recheck, servers, snapshot],
			);

			const configured = snapshot !== null && snapshot.configured !== false;
			// 宿主半边不热重载：旧宿主不认识 `probe`，点了只会拿到「未知操作」。
			// 所以按能力协商决定这个按钮能不能点（AGENTS 1.2）。
			const canProbe = supports(snapshot, "probe");

			const header = h(
				"div",
				{ className: "mcpm-heading" },
				// 第一行只放「标题 + 动作按钮」：两者垂直居中对齐，互不抢宽度。
				h(
					"div",
					{ className: "mcpm-titleRow" },
					h("h3", { className: "mcpm-title" }, "MCP 服务器"),
					h(
						"div",
						{ className: "mcpm-actions" },
						// 「检测中…」：打开页面会自动检测（silent），这个提示让用户知道
						// 绿/红还在刷新中，而不是"就这样了"。
						probing ? h("span", { className: "mcpm-probing" }, "检测中…") : null,
						// 检测：现在这一刻答不答（主动发一次 MCP 握手）；按钮是"再问一次"。
						// 刷新：只重读宿主快照（失败原因/相位是宿主事后写入的）。
						// 两个都要：保存那一刻的快照看不到事后日志，而日志也证明不了"现在"。
						h(
							"button",
							{
								type: "button",
								className: "mcpm-btn",
								onClick: () => detect(),
								disabled: busy || probing || !configured || !canProbe,
								title: canProbe ? "现在向每台启用中的服务器发一次 MCP 握手" : "需要重启 DSH（宿主半边不热重载）后才能检测",
							},
							"检测",
						),
						h("button", { type: "button", className: "mcpm-btn", onClick: refresh, disabled: busy }, "刷新"),
						h(
							"button",
							{
								type: "button",
								className: "mcpm-btn mcpm-btn--primary",
								onClick: openNew,
								disabled: busy || !configured,
							},
							"新增",
						),
					),
				),
				// 说明文字另起一行、占满面板整宽（不再被按钮挤成窄列而碎断行）。
				h(
					"p",
					{ className: "mcpm-subtitle" },
					"在这里增删改 MCP 服务器；每一项都会写成 @deepseek-ai/dsh-mcp-client 的一个 Loader 条目并立即生效。",
				),
			);

			if (loadError !== null) {
				return h(
					"div",
					{ className: "mcpm-page" },
					header,
					h("div", { className: "mcpm-notice mcpm-notice--error" }, `读取失败：${loadError}`),
					h("div", { className: "mcpm-actions mcpm-actions--form" },
						h("button", { type: "button", className: "mcpm-btn", onClick: refresh }, "重试"),
					),
				);
			}

			if (snapshot === null) {
				return h("div", { className: "mcpm-page" }, header, h("div", { className: "mcpm-notice" }, "正在读取…"));
			}

			return h(
				"div",
				{ className: "mcpm-page" },
				header,
				configured
					? null
					: h(
							"div",
							{ className: "mcpm-notice mcpm-notice--error" },
							`未找到 group 条目「${snapshot.groupId}」。请先在 profile 的 cordis.patch.yml 里按插件 README 配置一个 cordis:group 条目，再回到这里。`,
						),
				// 行内操作（停用/删除）的报错：没有表单可挂，页面级是唯一位置。
				// 表单提交的报错**不**在这里渲染（它只出现在那张表单里）——同一句话两处渲染
				// 曾经被用户当成"重复提示"，而且页面级那条挂在别人卡片上方会误导归属。
				actionError === null ? null : h("div", { className: "mcpm-notice mcpm-notice--error" }, actionError),
				// 每个服务器一张卡（对齐 ui-settings-models）：卡片头部是行本身，
				// 展开时在**同一张卡内**追加表单面板，不会在别处重复显示这一台。
				servers.length === 0 && editing === null
					? h("div", { className: "mcpm-empty" }, "还没有配置任何 MCP 服务器。")
					: h(
							"div",
							{ className: "mcpm-rows" },
							servers.map((server, index) =>
								h(
									"div",
									{ className: "mcpm-rowCard", key: server.rowId ?? `row-${index}` },
									h(ServerRow, {
										server,
										// 绿灯需要正面证据：宿主能不能探测，决定"active 但没记录"是报未检测还是报绿。
										canProbe,
										busy,
										editing: editing === index,
										onEdit: () => {
											// 再点一次就收起。
											if (editing === index) {
												closeForm();
												return;
											}
											setEditing(index);
											setFormError(null);
											setDraft(draftOf(server));
										},
										onToggle: () => toggle(server),
										onRemove: () => remove(server),
									}),
									editing === index && draft !== null
										? h(ServerForm, {
												draft,
												onDraft: setDraft,
												onSubmit: submit,
												onCancel: closeForm,
												busy,
												error: formError,
												isNew: false,
											})
										: null,
								),
							),
							editing === "new" && draft !== null
								? h(
										"div",
										{ className: "mcpm-rowCard" },
										h(ServerForm, {
											draft,
											onDraft: setDraft,
											onSubmit: submit,
											onCancel: closeForm,
											busy,
											error: formError,
											isNew: true,
										}),
									)
								: null,
						),
			);
		}

		/** 一条已有服务器的摘要行：圆点 + 名称 + 同一行内的三个控件。 */
		function ServerRow({ server, canProbe, busy, editing, onEdit, onToggle, onRemove }) {
			const status = statusOf(server, canProbe);
			const [confirming, setConfirming] = useState(false);
			const config = server.config ?? {};
			const name = config.serverName || "(未命名)";
			// 传输方式与 URL 不占版面，只在名称的 tooltip 里给出，悬停即可看到。
			const detail = `${status.text} · ${config.transport ?? "streamable-http"} · ${targetOf(config)}`;
			const enabled = server.disabled !== true;
			// 原因行由 statusOf 给出：只有"红"的三种状态带原因（检测失败 / 日志记录 / 无）。
			// 绿或灰时不展示历史信息，避免"绿点 + 红字"这种自相矛盾的组合。
			const reason = status.reason;
			const row = h(
				"div",
				{ className: enabled ? "mcpm-row" : "mcpm-row mcpm-row--off" },
				h("span", {
					className: "mcpm-dot",
					style: { background: status.color },
					title: status.text,
					"aria-label": status.text,
					role: "img",
				}),
				h("div", { className: "mcpm-meta" }, h("div", { className: "mcpm-name", title: detail }, name)),
				h(
					"div",
					{ className: "mcpm-actions" },
					confirming
						? h(
								react.Fragment,
								null,
								h(
									"button",
									{ type: "button", className: "mcpm-btn mcpm-btn--danger", onClick: onRemove, disabled: busy },
									"确认删除",
								),
								h(
									"button",
									{ type: "button", className: "mcpm-btn", onClick: () => setConfirming(false) },
									"取消",
								),
							)
						: h(
								react.Fragment,
								null,
								h(
						"button",
						{ type: "button", className: "mcpm-btn", onClick: onEdit, disabled: busy },
						editing ? "收起" : "编辑",
					),
								h(
									"button",
									{
										type: "button",
										className: "mcpm-btn",
										title: enabled ? "停用这台服务器" : "启用这台服务器",
										onClick: onToggle,
										disabled: busy,
									},
									enabled ? "停用" : "启用",
								),
								h(
									"button",
									{
										type: "button",
										className: "mcpm-btn mcpm-btn--danger",
										onClick: () => setConfirming(true),
										disabled: busy,
									},
									"删除",
								),
							),
				),
			);
			// 原因行是**卡片内的第二个子项**（Fragment 不产生节点），操作区宽度不受影响；
			// title 放完整原文，避免窄面板里读不全。
			return h(
				react.Fragment,
				null,
				row,
				reason === null ? null : h("div", { className: "mcpm-rowError", role: "status", title: reason }, reason),
			);
		}
		//#endregion

		//#region 设置导航那一格（MCP 标记）
		/**
		 * 认出设置面板导航里属于本插件的那一格。
		 *
		 * 官方结构（dsh-client-ui-settings-general 的 SettingsRoot）：
		 * `[data-shortcut-modal="settings"] > nav > button > [svg, span(localized label)]`。
		 * 官方 class 名是 CSS-module 哈希（`wCInkW_navCell` 那类，会随构建变），所以这里
		 * **按我们自己注册的 label 文本**定位——它同时是唯一的锚点与幂等保证。
		 * @returns 那一格的 <button>；面板没开或找不到就 null。
		 */
		function findNavCell() {
			for (const dialog of document.querySelectorAll(NAV_DIALOG_SELECTOR)) {
				const nav = dialog.querySelector("nav");
				if (nav === null) continue;
				for (const cell of nav.querySelectorAll("button")) {
					const label = cell.lastElementChild;
					if (label !== null && label.tagName === "SPAN" && label.textContent === SECTION_LABEL) return cell;
				}
			}
			return null;
		}

		/**
		 * 给导航里那一格打标记，剩下的交给样式表（隐藏官方 svg、画 MCP 标记）。
		 *
		 * 只做 `setAttribute`：不增删 React 管的节点，所以重渲染不会打架；面板关闭后旧节点
		 * 自然失效，用 `isConnected` 判断何时该重新找。MutationObserver 挂在 body 上做
		 * 「找到就停」的同步——已标记且仍在文档里时只是一次属性读，不查 DOM。
		 * @returns 清理函数（注册进 ctx.effect，插件卸载或热替换时调用）。
		 */
		function markNavCell() {
			const noop = () => {};
			if (typeof document === "undefined" || document.body === null) return noop;
			if (typeof MutationObserver === "undefined") return noop;
			let marked = null;
			const sync = () => {
				if (marked !== null && marked.isConnected && marked.getAttribute(NAV_ATTRIBUTE) === "1") return;
				const cell = findNavCell();
				if (cell === null) return;
				cell.setAttribute(NAV_ATTRIBUTE, "1");
				marked = cell;
			};
			sync();
			const observer = new MutationObserver(sync);
			observer.observe(document.body, { childList: true, subtree: true });
			return () => {
				observer.disconnect();
				if (marked !== null && marked.isConnected) marked.removeAttribute(NAV_ATTRIBUTE);
				marked = null;
			};
		}
		//#endregion

		//#region 插件体
		/**
		 * 客户端插件体：在设置导航最下方注册一页 MCP 管理，并把导航那一格的齿轮换成 MCP 标记。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			// 幂等注入视觉层：inline style 的 background 会压过 :hover，
			// 所以视觉必须走 CSS，inline 只留布局。
			ensureStyles();
			// 导航那一格：注册契约里没有 icon 字段，只能渲染后自己覆盖。
			// ctx.effect 让 observer 与标记随插件卸载/热替换一起收掉。
			ctx.effect(markNavCell, "ui-mcp-manager: nav mark");
			// 只注入 slots：数据面走同源 fetch，不需要 remote / connection 注入。
			ctx.inject(["slots"], (scope) => {
				scope.slots.inject("settings.section", () =>
					scope.slots.register(
						{
							name: "settings.section",
							id: SECTION_ID,
							// General 是 0，官方其它页在中间；900 让本页落在设置列表最下方。
							order: 900,
							label: () => SECTION_LABEL,
						},
						McpSection,
					),
				);
			});
		}

		exports.apply = apply;
		return module.exports;
	},
});
