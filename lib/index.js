/**
 * 本文件由 `tools/build.ts` 从 `src/host/index.ts` 生成 —— **不要直接编辑**。
 * 设计说明（为什么零 import、为什么启停是定点操作、为什么探测要 8s）见 src/host/index.ts 与 README.md。
 */

// src/shared/constants.ts
var ROUTE = "/api/mcp-manager";
var GROUP_ID = "mcp-manager";
var MCP_PACKAGE = "@deepseek-ai/dsh-mcp-client";

// src/shared/guards.ts
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function asRecord(value) {
  return isRecord(value) ? value : {};
}
function readString(source, key) {
  const value = source[key];
  return typeof value === "string" ? value : void 0;
}
function asText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

// src/host/rows.ts
function normalizeRow(server) {
  const source = asRecord(server);
  const transport = source.transport === "stdio" ? "stdio" : "streamable-http";
  const serverName = asText(source.serverName).trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    throw new Error(`serverName "${serverName}" 非法：只允许 1-32 位字母、数字、下划线、连字符`);
  }
  const config = { serverName, transport };
  if (transport === "stdio") {
    const command = asText(source.command).trim();
    if (command === "") throw new Error(`服务器 "${serverName}" 使用 stdio，但 command 为空`);
    config.command = command;
    const args = toStringArray(source.args);
    if (args.length > 0) config.args = args;
    const env = toRecord(source.env);
    if (env !== void 0) config.env = env;
    if (typeof source.cwd === "string" && source.cwd !== "") config.cwd = source.cwd;
  } else {
    const url = asText(source.url).trim();
    if (url === "") throw new Error(`服务器 "${serverName}" 使用 streamable-http，但 url 为空`);
    config.url = url;
    const headers = toRecord(source.headers);
    if (headers !== void 0) config.headers = headers;
  }
  if (typeof source.toolCallTimeoutMs === "number" && Number.isFinite(source.toolCallTimeoutMs)) {
    config.toolCallTimeoutMs = source.toolCallTimeoutMs;
  }
  const row = { name: MCP_PACKAGE, config };
  if (source.disabled === true) row.disabled = true;
  const rowId = readString(source, "rowId");
  if (rowId !== void 0 && rowId !== "") row.id = rowId;
  return row;
}
function toStringArray(value) {
  if (Array.isArray(value)) {
    const list = value;
    return list.map((item) => String(item)).filter((item) => item !== "");
  }
  if (typeof value !== "string") return [];
  return value.split("\n").map((item) => item.trim()).filter((item) => item !== "");
}
function toRecord(value) {
  if (isRecord(value)) {
    const entries2 = Object.entries(value).map(([key, item]) => [key, String(item)]);
    return entries2.length === 0 ? void 0 : Object.fromEntries(entries2);
  }
  const pairs = Array.isArray(value) ? value.map((item) => String(item)) : typeof value === "string" ? value.split("\n") : [];
  const entries = pairs.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")).map((line) => {
    const at = line.indexOf("=");
    if (at <= 0) throw new Error(`环境变量/请求头行缺少 "="：${line}`);
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  });
  if (entries.length === 0) return void 0;
  return Object.fromEntries(entries);
}

// src/host/index.ts
var FAILURE_MESSAGE_LIMIT = 500;
var FAILURE_SERVER_LIMIT = 64;
var MCP_LOG_LINE = /^mcp-client\(([^)]+)\):\s*([\s\S]*)$/;
var MCP_RECOVERED = /^reconnected and re-synced tools\b/;
var PROBE_TIMEOUT_MS = 8e3;
var PROBE_BODY_LIMIT = 160;
var TOOL_NAME_LIMIT = 200;
var MCP_TOOL_PREFIX = "mcp__";
var FIBER_PHASE = ["pending", "loading", "active", "failed", "disposed", "unloading"];
var name = "dsh-mcp-manager";
var inject = [];
var MISSING_GROUP = `找不到 group 条目 "${GROUP_ID}"（cordis:group）。它应由 dsh-mcp-manager bundle 自带：若刚安装完仍看到这句，说明 bundle 未正确安装、或这一层被 profile 里更高层的覆写行压掉了；请检查 profile 的 cordis.patch.yml 与 package.json 的 dsh.profile.bundles。`;
function reasonOf(error) {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && cause.message !== "") return cause.message;
    return error.message;
  }
  return String(error);
}
function apply(ctx) {
  ctx.inject(["connection", "configEditor", "loader"], (scope) => {
    const groupEntry = () => scope.configEditor.entries().find((entry) => entry.options.id === GROUP_ID);
    const failures = /* @__PURE__ */ new Map();
    const captureLog = (message) => {
      const line = message.args?.[0];
      if (typeof line !== "string") return;
      const matched = MCP_LOG_LINE.exec(line);
      if (matched === null) return;
      const serverName = matched[1] ?? "";
      if (serverName === "") return;
      const detail = (matched[2] ?? "").trim();
      if (message.type === "error" || message.type === "warn") {
        const previous = failures.get(serverName);
        failures.delete(serverName);
        failures.set(serverName, {
          message: detail.slice(0, FAILURE_MESSAGE_LIMIT),
          level: message.type,
          at: typeof message.ts === "number" ? message.ts : Date.now(),
          count: (previous?.count ?? 0) + 1
        });
        while (failures.size > FAILURE_SERVER_LIMIT) {
          const oldest = failures.keys().next().value;
          if (oldest === void 0) break;
          failures.delete(oldest);
        }
        return;
      }
      if (message.type === "info" && MCP_RECOVERED.test(detail)) failures.delete(serverName);
    };
    if (typeof scope.logger?.exporter === "function") {
      scope.logger.exporter({ levels: { default: 3 }, export: captureLog });
    }
    const probes = /* @__PURE__ */ new Map();
    const toolsService = typeof scope.get === "function" ? scope.get("tools") : scope.tools;
    const toolsOf = (serverName) => {
      if (typeof toolsService?.schemas !== "function" || serverName === "") {
        return void 0;
      }
      const prefix = `${MCP_TOOL_PREFIX}${serverName}__`;
      const matched = [];
      for (const schema of toolsService.schemas()) {
        const raw = schema?.name;
        const toolName = typeof raw === "string" ? raw : "";
        if (toolName.startsWith(prefix)) matched.push(toolName);
      }
      matched.sort();
      const truncated = matched.length > TOOL_NAME_LIMIT;
      return { count: matched.length, names: truncated ? matched.slice(0, TOOL_NAME_LIMIT) : matched, truncated };
    };
    const shortenBody = (text) => text.replace(/\s+/g, " ").trim().slice(0, PROBE_BODY_LIMIT);
    const firstChunk = async (response) => {
      if (response.body === null) return "";
      const reader = response.body.getReader();
      try {
        const { value } = await reader.read();
        return value === void 0 ? "" : new TextDecoder().decode(value);
      } finally {
        try {
          void reader.cancel().catch(() => {
          });
        } catch {
        }
      }
    };
    const probeServer = async (row) => {
      const config = asRecord(isRecord(row) ? row.config : void 0);
      const at = Date.now();
      const url = readString(config, "url");
      if (readString(config, "transport") !== "streamable-http" || url === void 0 || url === "") {
        return {
          connected: null,
          status: null,
          detail: "仅能探测 streamable-http（stdio 走子进程，无法从宿主探测）",
          at
        };
      }
      const extraHeaders = {};
      for (const [key, value] of Object.entries(asRecord(config.headers))) extraHeaders[key] = String(value);
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            ...extraHeaders,
            "content-type": "application/json",
            accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "dsh-mcp-manager", version: "0.1.0" }
            }
          }),
          signal: controller.signal
        });
        const body = await firstChunk(response);
        const status = response.status;
        if (!response.ok) {
          return {
            connected: false,
            status,
            detail: `HTTP ${String(status)}${body === "" ? "" : `：${shortenBody(body)}`}`,
            at
          };
        }
        if (/"jsonrpc"\s*:/.test(body)) return { connected: true, status, detail: `HTTP ${String(status)}`, at };
        const type = response.headers.get("content-type") ?? "未知 content-type";
        return { connected: false, status, detail: `HTTP ${String(status)}，但响应不是 MCP（${type}）`, at };
      } catch (error) {
        const reason = reasonOf(error);
        return {
          connected: false,
          status: null,
          detail: controller.signal.aborted ? `超时（${String(PROBE_TIMEOUT_MS / 1e3)}s）：服务器没有响应` : `请求失败：${reason}`,
          at
        };
      } finally {
        clearTimeout(timer);
      }
    };
    const declaredRows = () => {
      const entry = groupEntry();
      if (entry === void 0) return void 0;
      const layer = scope.configEditor.configuration().find((row) => row.entry.options.id === GROUP_ID);
      const override = layer?.override;
      const raw = Array.isArray(override) && override.length > 0 ? override : layer?.inherited ?? entry.options.config;
      return Array.isArray(raw) ? raw : [];
    };
    const runProbes = async (only) => {
      const rows = declaredRows();
      if (rows === void 0) throw new Error(MISSING_GROUP);
      const targets = rows.map((row) => ({ name: asText(asRecord(row.config).serverName), row })).filter((item) => item.name !== "" && item.row.disabled !== true && (only === void 0 || item.name === only));
      if (only !== void 0 && targets.length === 0) {
        throw new Error(`找不到启用中的 MCP 服务器 "${only}"；配置可能已被外部修改，请刷新页面后重试`);
      }
      const results = await Promise.all(targets.map(async (item) => [item.name, await probeServer(item.row)]));
      for (const [serverName, result] of results) probes.set(serverName, result);
      return snapshot();
    };
    const liveChildren = () => {
      const found = /* @__PURE__ */ new Map();
      for (const entry of scope.loader.entries()) {
        if (entry.options.name !== MCP_PACKAGE) continue;
        const config = asRecord(entry.options.config);
        const key = typeof config.serverName === "string" ? config.serverName : entry.options.id;
        if (key === void 0) continue;
        found.set(key, {
          id: entry.options.id,
          phase: entry.options.disabled === true ? "stopped" : entry.fiber === void 0 ? "pending" : FIBER_PHASE[entry.fiber.state] ?? "pending"
        });
      }
      return found;
    };
    const snapshot = () => {
      const rows = declaredRows();
      const live = liveChildren();
      return {
        groupId: GROUP_ID,
        configured: rows !== void 0,
        mcpPackage: MCP_PACKAGE,
        // 能力协商：客户端据此决定用「宿主侧定点操作」还是退回整数组提交。
        // 宿主半边不参与热重载（Node 的 ESM 缓存按 URL 生效，且本目录不在
        // dsh-hmr 的监听根里），所以客户端必须能同时说两代协议。
        // `lastError` = 快照里的 `servers[].error`（失败原文）；旧宿主不报这个能力，
        // 新客户端也只是读不到字段而已，所以不需要按能力分支。
        // `probe` = `op:"probe"` 主动探测 + 快照里的 `servers[].probe`（现在这一刻答不答）。
        // `tools` = 快照里的 `servers[].tools`（这台服务器**当前注册**的工具名单）。
        // 旧宿主不认识 `tools`：客户端拿不到这个字段就不渲染那块，天然向前兼容。
        capabilities: ["setEnabled", "remove", "save", "lastError", "probe", "tools"],
        servers: (rows ?? []).map((row, index) => {
          const config = asRecord(row.config);
          const serverName = typeof config.serverName === "string" ? config.serverName : "";
          const status = live.get(serverName);
          const failure = failures.get(serverName);
          const probe = probes.get(serverName);
          const tools = toolsOf(serverName);
          const server = {
            index,
            rowId: typeof row.id === "string" ? row.id : void 0,
            disabled: row.disabled === true,
            config,
            phase: status?.phase ?? "absent"
          };
          if (failure !== void 0) server.error = { ...failure };
          if (probe !== void 0) server.probe = { ...probe };
          if (tools !== void 0) server.tools = tools;
          return server;
        })
      };
    };
    const commitRows = async (rows) => {
      const entry = groupEntry();
      if (entry === void 0) throw new Error(MISSING_GROUP);
      if (!Array.isArray(rows)) throw new Error("rows 必须是数组");
      const list = rows;
      await scope.configEditor.edit(entry, () => list);
      failures.clear();
      probes.clear();
      return snapshot();
    };
    const locate = (serverName) => {
      const rows = declaredRows();
      if (rows === void 0) throw new Error(MISSING_GROUP);
      const target = asText(serverName);
      const index = rows.findIndex((row) => (asRecord(row.config).serverName ?? "") === target);
      if (index < 0) {
        throw new Error(`找不到名为 "${target}" 的 MCP 服务器；配置可能已被外部修改，请刷新页面后重试`);
      }
      return { rows, index };
    };
    const patchRow = async (serverName, change) => {
      const { rows, index } = locate(serverName);
      return commitRows(rows.map((row, at) => at === index ? change(row) : row));
    };
    const setEnabled = (serverName, enabled) => patchRow(serverName, (row) => {
      const next = { ...row };
      if (enabled) delete next.disabled;
      else next.disabled = true;
      return next;
    });
    const removeServer = async (serverName) => {
      const { rows, index } = locate(serverName);
      return commitRows(rows.filter((_row, at) => at !== index));
    };
    const saveAll = async (servers) => {
      if (!Array.isArray(servers)) throw new Error("servers 必须是数组");
      const list = servers;
      return commitRows(list.map((server) => normalizeRow(server)));
    };
    const respond = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
    const handler = async (request) => {
      try {
        if (request.method === "GET") return respond(200, { ok: true, data: snapshot() });
        const payload = asRecord(await request.json());
        switch (readString(payload, "op")) {
          case "setEnabled":
            return respond(200, {
              ok: true,
              data: await setEnabled(payload.serverName, payload.enabled === true)
            });
          case "remove":
            return respond(200, { ok: true, data: await removeServer(payload.serverName) });
          case "probe":
            return respond(200, { ok: true, data: await runProbes(readString(payload, "serverName")) });
          case "save":
            return respond(200, { ok: true, data: await saveAll(payload.servers) });
          default:
            return respond(400, { ok: false, error: `未知操作：${String(payload.op)}` });
        }
      } catch (error) {
        return respond(409, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    };
    scope.connection.fetch.register({
      path: ROUTE,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: handler
    });
  });
}
export {
  apply,
  inject,
  name
};
