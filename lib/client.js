/**
 * 本文件由 `tools/build.ts` 从 `src/client/index.ts` 生成 —— **不要直接编辑**。
 *
 * 契约：classic script（不是 ESM）；执行时只向 `window.__ModuleLoader__.load` 注册一个 factory；
 * `id` 等于包名；`require` 只解析基座模块表（这里只用 react）。
 * 设计说明见 src/client/ 与 README.md。
 */
window.__ModuleLoader__.load({
	id: "@qq540491950/dsh-mcp-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply
});
module.exports = __toCommonJS(index_exports);

// src/shared/constants.ts
var ROUTE = "/api/mcp-manager";
var SECTION_ID = "mcp";
var SECTION_LABEL = "MCP";

// src/client/nav-mark.ts
var NAV_DIALOG_SELECTOR = '[data-shortcut-modal="settings"]';
var NAV_ATTRIBUTE = "data-mcpm-nav";
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
function markNavCell() {
  const noop = () => {
  };
  if (typeof document === "undefined") return noop;
  const doc = document;
  const body = doc.body;
  if (body === null) return noop;
  const api = globalThis;
  const Observer = api.MutationObserver;
  if (Observer === void 0) return noop;
  let marked = null;
  const sync = () => {
    if (marked !== null && marked.isConnected && marked.getAttribute(NAV_ATTRIBUTE) === "1") return;
    const cell = findNavCell();
    if (cell === null) return;
    cell.setAttribute(NAV_ATTRIBUTE, "1");
    marked = cell;
  };
  sync();
  const observer = new Observer(sync);
  observer.observe(body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (marked !== null && marked.isConnected) marked.removeAttribute(NAV_ATTRIBUTE);
    marked = null;
  };
}

// src/shared/guards.ts
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function asRecord(value) {
  return isRecord(value) ? value : {};
}
function asText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

// src/client/core/api.ts
var REQUEST_TIMEOUT_MS = 2e4;
var SETTLE_INTERVAL_MS = 200;
var SETTLE_ATTEMPTS = 10;
var TOOL_PREVIEW_LIMIT = 6;
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function signalOf() {
  const api = globalThis;
  const timeout = api.AbortSignal?.timeout;
  return typeof timeout === "function" ? timeout(REQUEST_TIMEOUT_MS) : void 0;
}
function describeError(error) {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `请求超时（${String(REQUEST_TIMEOUT_MS / 1e3)}s）：宿主没有在预期时间内完成写入，请稍后重试或查看 DSH 日志。`;
  }
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  if (typeof record.message === "string") return record.message;
  return typeof error === "string" ? error : "未知错误";
}
function unwrap(body, status) {
  const record = asRecord(body);
  if (record.ok !== true) {
    throw new Error(typeof record.error === "string" && record.error !== "" ? record.error : `HTTP ${String(status)}`);
  }
  return record.data;
}
function initOf(base, signal) {
  return signal === void 0 ? base : { ...base, signal };
}
async function getSnapshot() {
  const response = await fetch(ROUTE, initOf({ headers: { accept: "application/json" } }, signalOf()));
  const body = await response.json();
  return unwrap(body, response.status);
}
async function postOp(payload) {
  const response = await fetch(
    ROUTE,
    initOf(
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload)
      },
      signalOf()
    )
  );
  const body = await response.json();
  return unwrap(body, response.status);
}

// src/client/core/draft.ts
function targetOf(config) {
  if (config.transport === "stdio") {
    const args = Array.isArray(config.args) ? config.args.map((item) => asText(item)) : [];
    const parts = [asText(config.command), ...args].filter((part) => part !== "");
    return parts.join(" ") || "(未填写 command)";
  }
  return asText(config.url) || "(未填写 url)";
}
function pairsToText(value) {
  if (!isRecord(value)) return "";
  return Object.entries(value).map(([key, item]) => `${key}=${asText(item)}`).join("\n");
}
function draftOf(server) {
  const config = asRecord(server.config);
  const args = config.args;
  return {
    rowId: server.rowId,
    disabled: server.disabled === true,
    serverName: asText(config.serverName),
    transport: config.transport === "stdio" ? "stdio" : "streamable-http",
    url: asText(config.url),
    command: asText(config.command),
    args: Array.isArray(args) ? args.map((item) => asText(item)).join("\n") : "",
    env: pairsToText(config.env),
    headers: pairsToText(config.headers),
    cwd: asText(config.cwd)
  };
}
function serverOf(draft) {
  const base = {
    rowId: draft.rowId,
    disabled: draft.disabled,
    serverName: draft.serverName.trim(),
    transport: draft.transport
  };
  if (draft.transport === "stdio") {
    return { ...base, command: draft.command.trim(), args: draft.args, env: draft.env, cwd: draft.cwd.trim() };
  }
  return { ...base, url: draft.url.trim(), headers: draft.headers };
}
function serverOfExisting(server) {
  const config = asRecord(server.config);
  const flat = { ...config, rowId: server.rowId, disabled: server.disabled === true };
  if (config.env !== void 0) flat.env = pairsToText(config.env);
  if (config.headers !== void 0) flat.headers = pairsToText(config.headers);
  if (Array.isArray(config.args)) flat.args = config.args.map((item) => asText(item)).join("\n");
  return flat;
}
function supports(snapshot, capability) {
  return Array.isArray(snapshot?.capabilities) && snapshot.capabilities.includes(capability);
}
function suggestName(servers) {
  const taken = new Set(servers.map((server) => asRecord(server.config).serverName));
  for (let index = 1; index < 100; index += 1) {
    const candidate = `server-${String(index)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return "server";
}

// src/client/core/status.ts
var STATUS_IDLE = "var(--dsw-alias-state-idle-primary)";
var STATUS_WARN = "var(--dsw-alias-state-warn-primary, #d8a24a)";
var STATUS_ERROR = "var(--dsw-alias-state-error-primary, #d9534f)";
var STATUS_OK = "var(--dsw-alias-state-success-primary, #2ea043)";
function statusOf(server, canProbe) {
  if (server.disabled === true || server.phase === "stopped")
    return { color: STATUS_IDLE, text: "已停用", reason: null };
  const probe = server.probe;
  if (probe?.connected === true && server.phase === "active") return { color: STATUS_OK, text: "运行中", reason: null };
  if (probe?.connected === false) {
    return { color: STATUS_ERROR, text: "连接失败", reason: `检测：${probe.detail ?? "无响应"}` };
  }
  if (typeof server.error?.message === "string" && server.error.message !== "") {
    return { color: STATUS_ERROR, text: "连接异常", reason: failureText(server.error) };
  }
  if (server.phase === "failed") return { color: STATUS_ERROR, text: "加载失败", reason: null };
  if (server.phase === "pending" || server.phase === "loading") {
    return { color: STATUS_WARN, text: "启动中", reason: null };
  }
  if (server.phase === "active") {
    if (probe !== void 0) return { color: STATUS_OK, text: "运行中", reason: null };
    if (canProbe) return { color: STATUS_WARN, text: "未检测", reason: null };
    return { color: STATUS_OK, text: "运行中", reason: null };
  }
  return { color: STATUS_IDLE, text: "未启动", reason: null };
}
function settling(data) {
  return (data?.servers ?? []).some(
    (server) => server.disabled !== true && server.probe?.connected === true && server.phase !== "active" && server.phase !== "failed"
  );
}
function failureText(error) {
  const at = typeof error.at === "number" ? new Date(error.at) : null;
  const when = at !== null && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString() : "";
  const count = typeof error.count === "number" && error.count > 1 ? `已失败 ${String(error.count)} 次` : "";
  const head = [when, count].filter((part) => part !== "").join(" · ");
  const message = typeof error.message === "string" ? error.message : "";
  return head === "" ? message : `${head} · ${message}`;
}

// src/client/react.ts
var react = __toESM(require("react"), 1);
var h = react.createElement;
var Fragment2 = react.Fragment;
var useState2 = react.useState;
var useEffect2 = react.useEffect;
var useCallback2 = react.useCallback;
var useMemo2 = react.useMemo;

// src/client/form.tsx
var TRANSPORTS = ["streamable-http", "stdio"];
function Field({ label, value, onChange, placeholder, mono, multiline }) {
  const className = ["mcpm-input", mono ? "mcpm-input--mono" : null, multiline ? "mcpm-textarea" : null].filter(Boolean).join(" ");
  const shared = {
    className,
    value,
    placeholder,
    onChange: (event) => {
      onChange(event.target.value);
    }
  };
  return /* @__PURE__ */ h("label", { className: "mcpm-field" }, /* @__PURE__ */ h("span", { className: "mcpm-label" }, label), multiline ? /* @__PURE__ */ h("textarea", { ...shared, rows: 3, spellCheck: false }) : /* @__PURE__ */ h("input", { ...shared }));
}
function ServerForm({ draft, onDraft, onSubmit, onCancel, busy, error, isNew }) {
  const stdio = draft.transport === "stdio";
  return /* @__PURE__ */ h(
    "form",
    {
      className: "mcpm-form",
      onSubmit: (event) => {
        event.preventDefault();
        onSubmit();
      }
    },
    /* @__PURE__ */ h("div", { className: "mcpm-formTitle" }, isNew ? "新增 MCP 服务器" : `编辑 ${draft.serverName || "服务器"}`),
    /* @__PURE__ */ h(
      Field,
      {
        label: "名称（serverName，1-32 位字母数字下划线连字符）",
        value: draft.serverName,
        onChange: (value) => {
          onDraft({ ...draft, serverName: value });
        },
        placeholder: "context7"
      }
    ),
    /* @__PURE__ */ h("label", { className: "mcpm-field" }, /* @__PURE__ */ h("span", { className: "mcpm-label" }, "传输方式"), /* @__PURE__ */ h(
      "select",
      {
        className: "mcpm-input",
        value: draft.transport,
        onChange: (event) => {
          onDraft({ ...draft, transport: event.target.value });
        }
      },
      TRANSPORTS.map((transport) => /* @__PURE__ */ h("option", { key: transport, value: transport }, transport))
    )),
    stdio ? /* @__PURE__ */ h(Fragment2, null, /* @__PURE__ */ h(
      Field,
      {
        label: "command",
        value: draft.command,
        onChange: (value) => {
          onDraft({ ...draft, command: value });
        },
        placeholder: "npx",
        mono: true
      }
    ), /* @__PURE__ */ h(
      Field,
      {
        label: "args（每行一个）",
        value: draft.args,
        onChange: (value) => {
          onDraft({ ...draft, args: value });
        },
        placeholder: "-y\n@modelcontextprotocol/server-filesystem\nD:\\work",
        mono: true,
        multiline: true
      }
    ), /* @__PURE__ */ h(
      Field,
      {
        label: "env（每行 KEY=VALUE）",
        value: draft.env,
        onChange: (value) => {
          onDraft({ ...draft, env: value });
        },
        placeholder: "API_KEY=sk-...",
        mono: true,
        multiline: true
      }
    ), /* @__PURE__ */ h(
      Field,
      {
        label: "cwd（可选）",
        value: draft.cwd,
        onChange: (value) => {
          onDraft({ ...draft, cwd: value });
        },
        mono: true
      }
    )) : /* @__PURE__ */ h(Fragment2, null, /* @__PURE__ */ h(
      Field,
      {
        label: "url",
        value: draft.url,
        onChange: (value) => {
          onDraft({ ...draft, url: value });
        },
        placeholder: "https://mcp.context7.com/mcp",
        mono: true
      }
    ), /* @__PURE__ */ h(
      Field,
      {
        label: "headers（每行 KEY=VALUE，密钥会明文写进 profile 配置）",
        value: draft.headers,
        onChange: (value) => {
          onDraft({ ...draft, headers: value });
        },
        placeholder: "Authorization=Bearer ...",
        mono: true,
        multiline: true
      }
    )),
    error === null ? null : /* @__PURE__ */ h("div", { className: "mcpm-notice mcpm-notice--error" }, error),
    /* @__PURE__ */ h("div", { className: "mcpm-actions mcpm-actions--form" }, /* @__PURE__ */ h("button", { type: "button", className: "mcpm-btn", onClick: onCancel, disabled: busy }, "取消"), /* @__PURE__ */ h("button", { type: "submit", className: "mcpm-btn mcpm-btn--primary", disabled: busy }, isNew ? "添加" : "保存"))
  );
}

// src/client/row.tsx
function toolsBlock(tools, names, open, onToggle) {
  const total = typeof tools.count === "number" && Number.isFinite(tools.count) ? tools.count : names.length;
  const shown = open ? names : names.slice(0, TOOL_PREVIEW_LIMIT);
  const hidden = total - shown.length;
  const items = shown.map((tool) => /* @__PURE__ */ h("li", { className: "mcpm-tool", key: tool, title: tool }, tool));
  if (hidden > 0) {
    items.push(
      /* @__PURE__ */ h("li", { className: "mcpm-tool mcpm-tool--more", key: "__more" }, `+${String(hidden)} 个`)
    );
  }
  if (tools.truncated === true) {
    items.push(
      /* @__PURE__ */ h("li", { className: "mcpm-tool mcpm-tool--more", key: "__capped" }, "名单已截断")
    );
  }
  const collapsible = names.length > TOOL_PREVIEW_LIMIT;
  return /* @__PURE__ */ h("div", { className: "mcpm-tools" }, /* @__PURE__ */ h("div", { className: "mcpm-toolsHead" }, /* @__PURE__ */ h("span", { className: "mcpm-toolsCount" }, `工具 ${String(total)} 个`), collapsible ? /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "mcpm-toolsToggle",
      onClick: () => {
        onToggle();
      },
      "aria-expanded": open
    },
    open ? "收起" : `显示全部 ${String(names.length)} 个`
  ) : null), /* @__PURE__ */ h("ul", { className: "mcpm-toolsList" }, items));
}
function ServerRow({
  server,
  canProbe,
  busy,
  editing,
  onEdit,
  onToggle,
  onRemove
}) {
  const status = statusOf(server, canProbe);
  const [confirming, setConfirming] = useState2(false);
  const [toolsOpen, setToolsOpen] = useState2(false);
  const config = asRecord(server.config);
  const name = asText(config.serverName) || "(未命名)";
  const detail = `${status.text} · ${asText(config.transport) || "streamable-http"} · ${targetOf(config)}`;
  const enabled = server.disabled !== true;
  const reason = status.reason;
  const row = /* @__PURE__ */ h("div", { className: enabled ? "mcpm-row" : "mcpm-row mcpm-row--off" }, /* @__PURE__ */ h(
    "span",
    {
      className: "mcpm-dot",
      style: { background: status.color },
      title: status.text,
      "aria-label": status.text,
      role: "img"
    }
  ), /* @__PURE__ */ h("div", { className: "mcpm-meta" }, /* @__PURE__ */ h("div", { className: "mcpm-name", title: detail }, name)), /* @__PURE__ */ h("div", { className: "mcpm-actions" }, confirming ? /* @__PURE__ */ h(Fragment2, null, /* @__PURE__ */ h("button", { type: "button", className: "mcpm-btn mcpm-btn--danger", onClick: onRemove, disabled: busy }, "确认删除"), /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "mcpm-btn",
      onClick: () => {
        setConfirming(false);
      }
    },
    "取消"
  )) : /* @__PURE__ */ h(Fragment2, null, /* @__PURE__ */ h("button", { type: "button", className: "mcpm-btn", onClick: onEdit, disabled: busy }, editing ? "收起" : "编辑"), /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "mcpm-btn",
      title: enabled ? "停用这台服务器" : "启用这台服务器",
      onClick: onToggle,
      disabled: busy
    },
    enabled ? "停用" : "启用"
  ), /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "mcpm-btn mcpm-btn--danger",
      onClick: () => {
        setConfirming(true);
      },
      disabled: busy
    },
    "删除"
  ))));
  const tools = server.tools;
  const names = Array.isArray(tools?.names) ? tools.names.map((item) => asText(item)) : null;
  const toolsLine = tools === void 0 || names === null ? null : toolsBlock(tools, names, toolsOpen, () => {
    setToolsOpen(!toolsOpen);
  });
  return /* @__PURE__ */ h(Fragment2, null, row, reason === null ? null : /* @__PURE__ */ h("div", { className: "mcpm-rowError", role: "status", title: reason }, reason), toolsLine);
}

// src/client/section.tsx
function McpSection() {
  const [snapshot, setSnapshot] = useState2(null);
  const [loadError, setLoadError] = useState2(null);
  const [busy, setBusy] = useState2(false);
  const [editing, setEditing] = useState2(null);
  const [draft, setDraft] = useState2(null);
  const [formError, setFormError] = useState2(null);
  const [actionError, setActionError] = useState2(null);
  const [probing, setProbing] = useState2(false);
  const refresh = useCallback2(async () => {
    try {
      const data = await getSnapshot();
      setSnapshot(data);
      setLoadError(null);
      setActionError(null);
      return data;
    } catch (error) {
      setLoadError(describeError(error));
      return null;
    }
  }, []);
  const call = useCallback2(
    async (payload, after, onError, options) => {
      const silent = options?.silent === true;
      if (silent) setProbing(true);
      else setBusy(true);
      setFormError(null);
      setActionError(null);
      try {
        const data = await postOp(payload);
        setSnapshot(data);
        after?.(data);
        return data;
      } catch (error) {
        onError?.(describeError(error));
        return null;
      } finally {
        if (silent) setProbing(false);
        else setBusy(false);
      }
    },
    []
  );
  const servers = useMemo2(() => snapshot?.servers ?? [], [snapshot]);
  const detect = useCallback2(
    (options) => {
      void call({ op: "probe" }, void 0, setActionError, options);
    },
    [call]
  );
  const recheck = useCallback2(
    async (data) => {
      if (!supports(data, "probe")) return;
      let current = await call({ op: "probe" }, void 0, setActionError, { silent: true });
      for (let attempt = 0; attempt < SETTLE_ATTEMPTS && settling(current); attempt += 1) {
        await sleep(SETTLE_INTERVAL_MS);
        current = await refresh();
      }
    },
    [call, refresh]
  );
  const recheckAfter = useCallback2(
    (data) => {
      void recheck(data);
    },
    [recheck]
  );
  useEffect2(() => {
    const lifecycle = { cancelled: false };
    void (async () => {
      const data = await refresh();
      if (lifecycle.cancelled || !supports(data, "probe")) return;
      void recheck(data);
    })();
    return () => {
      lifecycle.cancelled = true;
    };
  }, [refresh, recheck]);
  const openNew = useCallback2(() => {
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
      disabled: false
    });
  }, [servers]);
  const closeForm = useCallback2(() => {
    setEditing(null);
    setFormError(null);
  }, []);
  const submit = useCallback2(() => {
    if (draft === null) return;
    const server = serverOf(draft);
    const next = editing === "new" ? [...servers.map((item) => serverOfExisting(item)), server] : servers.map(
      (item, index) => index === editing ? { ...serverOfExisting(item), ...server } : serverOfExisting(item)
    );
    const payload = { op: "save", servers: next };
    void call(
      { ...payload },
      (data) => {
        setEditing(null);
        setDraft(null);
        recheckAfter(data);
      },
      setFormError
    );
  }, [call, draft, editing, recheckAfter, servers]);
  const toggle = useCallback2(
    (server) => {
      const serverName = asText(asRecord(server.config).serverName);
      if (supports(snapshot, "setEnabled")) {
        void call({ op: "setEnabled", serverName, enabled: server.disabled === true }, recheckAfter, setActionError);
        return;
      }
      void call(
        {
          op: "save",
          servers: servers.map(
            (item) => item === server ? { ...serverOfExisting(item), disabled: item.disabled !== true } : serverOfExisting(item)
          )
        },
        recheckAfter,
        setActionError
      );
    },
    [call, recheckAfter, servers, snapshot]
  );
  const remove = useCallback2(
    (server) => {
      const serverName = asText(asRecord(server.config).serverName);
      if (supports(snapshot, "remove")) {
        void call({ op: "remove", serverName }, recheckAfter, setActionError);
        return;
      }
      void call(
        { op: "save", servers: servers.filter((item) => item !== server).map((item) => serverOfExisting(item)) },
        recheckAfter,
        setActionError
      );
    },
    [call, recheckAfter, servers, snapshot]
  );
  const configured = snapshot !== null && snapshot.configured !== false;
  const canProbe = supports(snapshot, "probe");
  const header = /* @__PURE__ */ h("div", { className: "mcpm-heading" }, /* @__PURE__ */ h("div", { className: "mcpm-titleRow" }, /* @__PURE__ */ h("h3", { className: "mcpm-title" }, "MCP 服务器"), /* @__PURE__ */ h("div", { className: "mcpm-actions" }, probing ? /* @__PURE__ */ h("span", { className: "mcpm-probing" }, "检测中…") : null, /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "mcpm-btn",
      onClick: () => {
        detect();
      },
      disabled: busy || probing || !configured || !canProbe,
      title: canProbe ? "现在向每台启用中的服务器发一次 MCP 握手" : "需要重启 DSH（宿主半边不热重载）后才能检测"
    },
    "检测"
  ), /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "mcpm-btn",
      onClick: () => {
        void refresh();
      },
      disabled: busy
    },
    "刷新"
  ), /* @__PURE__ */ h("button", { type: "button", className: "mcpm-btn mcpm-btn--primary", onClick: openNew, disabled: busy || !configured }, "新增"))), /* @__PURE__ */ h("p", { className: "mcpm-subtitle" }, "在这里增删改 MCP 服务器；每一项都会写成 @deepseek-ai/dsh-mcp-client 的一个 Loader 条目并立即生效。"));
  if (loadError !== null) {
    return /* @__PURE__ */ h("div", { className: "mcpm-page" }, header, /* @__PURE__ */ h("div", { className: "mcpm-notice mcpm-notice--error" }, `读取失败：${loadError}`), /* @__PURE__ */ h("div", { className: "mcpm-actions mcpm-actions--form" }, /* @__PURE__ */ h(
      "button",
      {
        type: "button",
        className: "mcpm-btn",
        onClick: () => {
          void refresh();
        }
      },
      "重试"
    )));
  }
  if (snapshot === null) {
    return /* @__PURE__ */ h("div", { className: "mcpm-page" }, header, /* @__PURE__ */ h("div", { className: "mcpm-notice" }, "正在读取…"));
  }
  return /* @__PURE__ */ h("div", { className: "mcpm-page" }, header, configured ? null : /* @__PURE__ */ h("div", { className: "mcpm-notice mcpm-notice--error" }, `未找到 group 条目「${snapshot.groupId}」（cordis:group）。它应由 dsh-mcp-manager bundle 自带：若刚安装完仍看到这句，说明 bundle 未正确安装、或这一层被 profile 里更高层的覆写行压掉了——请检查 profile 的 cordis.patch.yml 与 package.json 的 dsh.profile.bundles，再回到这里。`), actionError === null ? null : /* @__PURE__ */ h("div", { className: "mcpm-notice mcpm-notice--error" }, actionError), servers.length === 0 && editing === null ? /* @__PURE__ */ h("div", { className: "mcpm-empty" }, "还没有配置任何 MCP 服务器。") : /* @__PURE__ */ h("div", { className: "mcpm-rows" }, servers.map((server, index) => /* @__PURE__ */ h("div", { className: "mcpm-rowCard", key: server.rowId ?? `row-${String(index)}` }, /* @__PURE__ */ h(
    ServerRow,
    {
      server,
      canProbe,
      busy,
      editing: editing === index,
      onEdit: () => {
        if (editing === index) {
          closeForm();
          return;
        }
        setEditing(index);
        setFormError(null);
        setDraft(draftOf(server));
      },
      onToggle: () => {
        toggle(server);
      },
      onRemove: () => {
        remove(server);
      }
    }
  ), editing === index && draft !== null ? /* @__PURE__ */ h(
    ServerForm,
    {
      draft,
      onDraft: setDraft,
      onSubmit: submit,
      onCancel: closeForm,
      busy,
      error: formError,
      isNew: false
    }
  ) : null)), editing === "new" && draft !== null ? /* @__PURE__ */ h("div", { className: "mcpm-rowCard" }, /* @__PURE__ */ h(
    ServerForm,
    {
      draft,
      onDraft: setDraft,
      onSubmit: submit,
      onCancel: closeForm,
      busy,
      error: formError,
      isNew: true
    }
  )) : null));
}

// src/client/styles.ts
var STYLE_ELEMENT_ID = "dsh-mcp-manager-styles";
var MCP_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round"><g transform="translate(-0.44525 -0.50229) scale(0.0942473)" stroke-width="10.61038"><path d="M23.5996 85.2532L86.2021 22.6507C94.8457 14.0071 108.86 14.0071 117.503 22.6507C126.147 31.2942 126.147 45.3083 117.503 53.9519L70.2254 101.23"/><path d="M70.8789 100.578L117.504 53.952C126.148 45.3083 140.163 45.3083 148.806 53.952L149.132 54.278C157.776 62.9216 157.776 76.9357 149.132 85.5792L92.5139 142.198C89.6327 145.079 89.6327 149.75 92.5139 152.631L104.14 164.257"/><path d="M101.853 38.3013L55.553 84.6011C46.9094 93.2447 46.9094 107.258 55.553 115.902C64.1966 124.546 78.2106 124.546 86.8543 115.902L133.154 69.6025"/></g></svg>';
var MCP_MARK_DATA_URI = `data:image/svg+xml,${encodeURIComponent(MCP_MARK_SVG)}`;
var CSS = `
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
/* 工具名单：卡片内的第三块（行 → 原因 → 工具）。名字是标识符，用等宽字体；
   超过 TOOL_PREVIEW_LIMIT 就只留前几个 + 「+N 个」，由用户点开。 */
.mcpm-tools { display:flex; flex-direction:column; gap:6px; min-width:0; }
.mcpm-toolsHead { display:flex; align-items:center; gap:8px; min-width:0; }
.mcpm-toolsCount { min-width:0; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:12px; line-height:16px; }
.mcpm-toolsList { display:flex; flex-wrap:wrap; gap:4px; min-width:0; margin:0; padding:0; list-style:none; }
.mcpm-tool { box-sizing:border-box; min-width:0; max-width:100%; padding:1px 6px; border:.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-sm, 4px); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font-family:ui-monospace, monospace; font-size:12px; line-height:16px; overflow-wrap:anywhere; }
.mcpm-tool--more { color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
/* 「显示全部 / 收起」沿用紧凑档按钮尺寸（28px / 12px），不引入新档位。 */
.mcpm-toolsToggle { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; flex:none; white-space:nowrap; height:24px; padding:0 8px; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-sm, 4px); background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; line-height:18px; cursor:pointer; }
.mcpm-toolsToggle:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.mcpm-toolsToggle:focus-visible { outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset:1px; }
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

// src/client/index.ts
function apply(ctx) {
  ensureStyles();
  ctx.effect(markNavCell, "ui-mcp-manager: nav mark");
  ctx.inject(["slots"], (scope) => {
    scope.slots.inject("settings.section", () => {
      scope.slots.register(
        {
          name: "settings.section",
          id: SECTION_ID,
          // General 是 0，官方其它页在中间；900 让本页落在设置列表最下方。
          order: 900,
          label: () => SECTION_LABEL
        },
        McpSection
      );
    });
  });
}

		Object.defineProperty(module.exports, Symbol.toStringTag, { value: "Module" });
		return module.exports;
	}
});
