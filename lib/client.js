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
 * `order: 900` 使它落在设置导航的**最下方**（General 是 0，其余官方页在中间）。
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
		 * 请求超时。没有它的话，一旦宿主侧的 reconcile 卡住，`fetch` 永不 settle，
		 * `busy` 永远为 true → **按钮永久发灰、状态也不变**（正是"点击停用置灰但状态不变"
		 * 最可能的一种成因）。有了它，超时会走 catch 把原因显示出来，按钮恢复可点。
		 */
		const REQUEST_TIMEOUT_MS = 20000;
		const signalOf = () =>
			typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
				? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
				: undefined;

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
/* 每个服务器一张卡（对齐 ui-settings-models 的 .rows/.rowCard）。 */
.mcpm-rows { display:flex; flex-direction:column; gap:8px; margin:0; padding:0; list-style:none; }
.mcpm-rowCard { box-sizing:border-box; min-width:0; display:flex; flex-direction:column; gap:10px; border:.5px solid var(--dsw-alias-settings-card-stroke); border-radius:var(--dsw-radius-lg, 8px); background:var(--dsw-alias-settings-card-fill); padding:8px 12px; }
.mcpm-row { box-sizing:border-box; min-width:0; display:flex; align-items:center; gap:10px; min-height:28px; }
/* 停用的行整体压暗：只靠圆点颜色区分太弱，用户会以为"没生效"。 */
.mcpm-row--off .mcpm-name { color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.mcpm-row--off .mcpm-dot { opacity:.45; }
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
`;

		/** 幂等注入样式表；由 apply 调用一次。 */
		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
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

		/** 运行时状态 → 圆点颜色与文案。 */
		function statusOf(server) {
			if (server.disabled) return { color: "var(--dsw-alias-state-idle-primary)", text: "已停用" };
			if (server.phase === "active") return { color: "var(--dsw-alias-state-success-primary, #2ea043)", text: "运行中" };
			if (server.phase === "absent") return { color: "var(--dsw-alias-state-error-primary, #d9534f)", text: "未加载" };
			return { color: "var(--dsw-alias-state-idle-primary)", text: server.phase === "pending" ? "启动中" : "未运行" };
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
			const [saveError, setSaveError] = useState(null);

			const refresh = useCallback(async () => {
				try {
					const response = await fetch(ROUTE, { headers: { accept: "application/json" }, signal: signalOf() });
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					setSnapshot(body.data);
					setLoadError(null);
				} catch (error) {
					setLoadError(describeError(error));
				}
			}, []);

			useEffect(() => {
				refresh();
			}, [refresh]);

			const servers = snapshot?.servers ?? [];

			/**
			 * 唯一的写入入口。注意传的是**操作**而不是整份数组：
			 * 「启停」「删除」由宿主按 serverName 定位那一行原地修改，字段不可能丢；
			 * 只有表单提交才用整数组替换（`op: "save"`）。
			 */
			const call = useCallback(async (payload, after) => {
				setBusy(true);
				setSaveError(null);
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
					after?.();
				} catch (error) {
					setSaveError(describeError(error));
				} finally {
					setBusy(false);
				}
			}, []);

			const openNew = useCallback(() => {
				setEditing("new");
				setSaveError(null);
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

			const submit = useCallback(() => {
				if (draft === null) return;
				const server = serverOf(draft);
				const next =
					editing === "new"
						? [...servers.map(serverOfExisting), server]
						: servers.map((existing, index) =>
								index === editing ? { ...serverOfExisting(existing), ...server } : serverOfExisting(existing),
							);
				call({ op: "save", servers: next }, () => {
					setEditing(null);
					setDraft(null);
				});
			}, [call, draft, editing, servers]);

			/**
			 * 启停一台。宿主支持定点操作时只给「目标状态」，**完全不碰配置字段**；
			 * 否则退回整数组提交（env/headers 已转成旧宿主认识的文本形状）。
			 */
			const toggle = useCallback(
				(server) => {
					const serverName = server.config?.serverName ?? "";
					if (supports(snapshot, "setEnabled")) {
						call({ op: "setEnabled", serverName, enabled: server.disabled === true });
						return;
					}
					call({
						op: "save",
						servers: servers.map((item) =>
							item === server
								? { ...serverOfExisting(item), disabled: !(item.disabled === true) }
								: serverOfExisting(item),
						),
					});
				},
				[call, servers, snapshot],
			);

			/** 删除一台：同样优先定点操作。 */
			const remove = useCallback(
				(server) => {
					const serverName = server.config?.serverName ?? "";
					if (supports(snapshot, "remove")) {
						call({ op: "remove", serverName });
						return;
					}
					call({ op: "save", servers: servers.filter((item) => item !== server).map(serverOfExisting) });
				},
				[call, servers, snapshot],
			);

			const configured = snapshot !== null && snapshot.configured !== false;

			const header = h(
				"div",
				{ className: "mcpm-heading" },
				// 第一行只放「标题 + 动作按钮」：两者垂直居中对齐，互不抢宽度。
				h(
					"div",
					{ className: "mcpm-titleRow" },
					h("h3", { className: "mcpm-title" }, "MCP 服务器"),
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
				saveError === null ? null : h("div", { className: "mcpm-notice mcpm-notice--error" }, saveError),
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
										busy,
										editing: editing === index,
										onEdit: () => {
											// 再点一次就收起。
											if (editing === index) {
												setEditing(null);
												return;
											}
											setEditing(index);
											setSaveError(null);
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
												onCancel: () => setEditing(null),
												busy,
												error: saveError,
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
											onCancel: () => setEditing(null),
											busy,
											error: saveError,
											isNew: true,
										}),
									)
								: null,
						),
			);
		}

		/** 一条已有服务器的摘要行：圆点 + 名称 + 同一行内的三个控件。 */
		function ServerRow({ server, busy, editing, onEdit, onToggle, onRemove }) {
			const status = statusOf(server);
			const [confirming, setConfirming] = useState(false);
			const config = server.config ?? {};
			const name = config.serverName || "(未命名)";
			// 传输方式与 URL 不占版面，只在名称的 tooltip 里给出，悬停即可看到。
			const detail = `${status.text} · ${config.transport ?? "streamable-http"} · ${targetOf(config)}`;
			const enabled = server.disabled !== true;
			return h(
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
		}
		//#endregion

		//#region 插件体
		/**
		 * 客户端插件体：在设置导航最下方注册一页 MCP 管理。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			// 幂等注入视觉层：inline style 的 background 会压过 :hover，
			// 所以视觉必须走 CSS，inline 只留布局。
			ensureStyles();
			// 只注入 slots：数据面走同源 fetch，不需要 remote / connection 注入。
			ctx.inject(["slots"], (scope) => {
				scope.slots.inject("settings.section", () =>
					scope.slots.register(
						{
							name: "settings.section",
							id: "mcp",
							// General 是 0，官方其它页在中间；900 让本页落在设置列表最下方。
							order: 900,
							label: () => "MCP",
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
