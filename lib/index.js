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

// src/shared/expr.ts
var JS_EXPR_PREFIX = "!!js ";
function isJsExpr(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "__jsExpr" && typeof value.__jsExpr === "string";
}
function textOf(value) {
  if (isJsExpr(value)) return `${JS_EXPR_PREFIX}${value.__jsExpr}`;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}
function valueOf(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith(JS_EXPR_PREFIX)) {
    return { __jsExpr: trimmed.slice(JS_EXPR_PREFIX.length) };
  }
  return trimmed;
}
function scalarOf(value) {
  if (isJsExpr(value)) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  throw new Error("值必须是字符串或 !!js 表达式");
}

// src/shared/managed-block.ts
var MANAGED_START = "# >>> dsh-mcp-manager:managed";
var MANAGED_END = "# <<< dsh-mcp-manager:managed";
var MANAGED_MANIFEST_PREFIX = "# dsh-mcp-manager:manifest=";
function stripManagedMarkers(text) {
  const lines = text.split("\n");
  const kept = [];
  let inside = false;
  let changed = false;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!inside && trimmed === MANAGED_START) {
      inside = true;
      changed = true;
      continue;
    }
    if (inside && trimmed.startsWith(MANAGED_MANIFEST_PREFIX)) {
      changed = true;
      continue;
    }
    if (inside && trimmed === MANAGED_END) {
      inside = false;
      changed = true;
      continue;
    }
    kept.push(line);
  }
  return changed ? kept.join("\n") : text;
}

// src/shared/patch-doc.ts
function splitLines(text) {
  const lines = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const start = offset;
    const end = offset + raw.length + 1;
    const trimmed = body.trimStart();
    lines.push({
      body,
      start,
      end: Math.min(end, text.length),
      indent: body.length - trimmed.length,
      blank: trimmed === "" || trimmed.startsWith("#")
    });
    offset += raw.length + 1;
  }
  return lines;
}
function isTopItem(line) {
  return line.indent === 0 && (line.body === "-" || line.body.startsWith("- ") || line.body.startsWith("-	"));
}
function keyOf(line) {
  const content = line.body.trimStart().slice(1).trim();
  const matched = /^([^:\s]+)\s*:(.*)$/.exec(content);
  if (matched === null) return void 0;
  return { key: matched[1] ?? "", rest: (matched[2] ?? "").trim() };
}
function scalarText(raw) {
  let value = raw.trim();
  if (value === "") return void 0;
  const quote = value[0];
  if ((quote === "'" || quote === '"') && value.length >= 2) {
    const end = value.lastIndexOf(quote);
    return end > 0 ? value.slice(1, end) : void 0;
  }
  const hash = value.indexOf(" #");
  if (hash >= 0) value = value.slice(0, hash).trim();
  return value === "" ? void 0 : value;
}
var JS_TAG_IN_FLOW = /(^|[{,[:]\s*)!!js\s*("(?:[^"\\]|\\.)*")/g;
function parseFlowLine(content) {
  const preprocessed = content.replace(
    JS_TAG_IN_FLOW,
    (_match, head, expr) => `${head}{"__jsExpr":${expr}}`
  );
  try {
    const value = JSON.parse(preprocessed);
    return isRecord(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function flowCloseLineOf(lines, startLine, lastLine) {
  let depth = 0;
  let quote;
  for (let index = startLine; index <= lastLine; index += 1) {
    const line = lines[index];
    if (line === void 0) break;
    const text = line.body;
    for (let cursor = 0; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (quote !== void 0) {
        if (char === "\\" && quote === '"') {
          cursor += 1;
          continue;
        }
        if (char === quote) quote = void 0;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === "{" || char === "[") depth += 1;
      else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) return index;
      } else if (char === "#" && (cursor === 0 || text[cursor - 1] === " " || text[cursor - 1] === "	")) {
        break;
      }
    }
  }
  return lastLine;
}
function joinFlowLines(lines, startLine, closeLine, stripPrefix) {
  const parts = [];
  for (let index = startLine; index <= closeLine; index += 1) {
    const line = lines[index];
    if (line === void 0) continue;
    parts.push(index === startLine ? line.body.trimStart().slice(stripPrefix.length).trim() : line.body.trim());
  }
  return parts.join(" ");
}
function scanPatchDoc(text) {
  const lines = splitLines(text);
  const entries = [];
  let unaddressable = 0;
  const idOfFirstLine = (line) => {
    const key = keyOf(line);
    if (key === void 0 || key.key !== "id") return void 0;
    return scalarText(key.rest);
  };
  for (let i = 0; i < lines.length; ) {
    const head = lines[i];
    if (head === void 0 || !isTopItem(head)) {
      i += 1;
      continue;
    }
    let extent = i + 1;
    while (extent < lines.length && !isTopItem(lines[extent])) extent += 1;
    while (extent > i + 1) {
      const last = lines[extent - 1];
      if (last !== void 0 && last.blank && last.indent === 0) extent -= 1;
      else break;
    }
    const rawEnd = extent < lines.length ? lines[extent].start : text.length;
    const first = head;
    const content = first.body.slice(1).trim();
    if (content.startsWith("{") || content.startsWith("[")) {
      const closeLine = flowCloseLineOf(lines, i, extent - 1);
      const parsed = parseFlowLine(joinFlowLines(lines, i, closeLine, "-"));
      if (parsed === void 0) {
        unaddressable += 1;
      } else if (Array.isArray(parsed.insert)) {
        const list = parsed.insert;
        let indexed = 0;
        for (let index = 0; index < list.length; index += 1) {
          const item = list[index];
          const id = isRecord(item) && typeof item.id === "string" ? item.id : void 0;
          if (id === void 0 || id === "") unaddressable += 1;
          else {
            entries.push({
              id,
              start: first.start,
              end: rawEnd,
              style: "insert",
              indent: 0,
              siblings: list.length,
              flow: { value: parsed, index }
            });
            indexed += 1;
          }
        }
        if (indexed === 0 && list.length === 0) {
        }
      } else {
        const id = typeof parsed.id === "string" ? parsed.id : void 0;
        if (id === void 0 || id === "") unaddressable += 1;
        else {
          entries.push({
            id,
            start: first.start,
            end: rawEnd,
            style: "override",
            indent: 0,
            siblings: 1,
            flow: { value: parsed, index: void 0 }
          });
        }
      }
      i = extent;
      continue;
    }
    const key = keyOf(first);
    if (key !== void 0 && key.key === "insert" && (key.rest === "" || key.rest === "[]")) {
      const nested = [];
      let nestedIndent = null;
      for (let m = i + 1; m < extent; m += 1) {
        const line = lines[m];
        if (line === void 0 || line.blank) continue;
        if (nestedIndent === null) {
          const inner = line.body.trimStart();
          if (line.indent > 0 && (inner.startsWith("- ") || inner === "-")) {
            nestedIndent = line.indent;
            nested.push(m);
          } else if (line.indent > 0) {
            break;
          }
          continue;
        }
        if (line.indent === nestedIndent) {
          const inner = line.body.trimStart();
          if (inner.startsWith("- ") || inner === "-") nested.push(m);
          else break;
        } else if (line.indent > nestedIndent) {
          continue;
        } else {
          break;
        }
      }
      for (let index = 0; index < nested.length; index += 1) {
        const startIndex = nested[index];
        const nextIndex = index + 1 < nested.length ? nested[index + 1] : void 0;
        const startLine = startIndex !== void 0 ? lines[startIndex] : void 0;
        if (startIndex === void 0 || startLine === void 0) continue;
        let endLine = nextIndex === void 0 ? extent : nextIndex;
        while (endLine > startIndex + 1) {
          const last = lines[endLine - 1];
          if (last !== void 0 && last.blank) endLine -= 1;
          else break;
        }
        const lastKept = lines[endLine - 1];
        const itemEnd = lastKept === void 0 ? startLine.end : lastKept.end;
        const nestedContent = startLine.body.trimStart().slice(1).trim();
        if (nestedContent.startsWith("{") || nestedContent.startsWith("[")) {
          const closeLine = flowCloseLineOf(lines, startIndex, endLine - 1);
          const parsed = parseFlowLine(joinFlowLines(lines, startIndex, closeLine, "-"));
          const id2 = parsed !== void 0 && typeof parsed.id === "string" ? parsed.id : void 0;
          if (id2 === void 0 || id2 === "" || parsed === void 0) unaddressable += 1;
          else {
            entries.push({
              id: id2,
              start: startLine.start,
              end: itemEnd,
              style: "insert",
              indent: startLine.indent,
              parent: { start: first.start, end: rawEnd },
              siblings: nested.length,
              flow: { value: parsed, index: void 0 }
            });
          }
          continue;
        }
        const id = idOfFirstLine(startLine);
        if (id === void 0) unaddressable += 1;
        else {
          entries.push({
            id,
            start: startLine.start,
            end: itemEnd,
            style: "insert",
            indent: startLine.indent,
            parent: { start: first.start, end: rawEnd },
            siblings: nested.length,
            flow: void 0
          });
        }
      }
      i = extent;
      continue;
    }
    if (key !== void 0 && key.key === "id") {
      const id = scalarText(key.rest);
      if (id === void 0 || id === "") unaddressable += 1;
      else {
        entries.push({
          id,
          start: first.start,
          end: rawEnd,
          style: "override",
          indent: 0,
          siblings: 1,
          flow: void 0
        });
      }
    } else {
      unaddressable += 1;
    }
    i = extent;
  }
  return { entries, unaddressable };
}
function flowScalar(value) {
  if (isJsExpr(value)) return `!!js ${JSON.stringify(value.__jsExpr)}`;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("patch 行不支持 NaN/Infinity");
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => flowScalar(item)).join(",")}]`;
  if (isRecord(value)) {
    const pairs = [];
    for (const [key, item] of Object.entries(value)) {
      if (item === void 0) continue;
      pairs.push(`${JSON.stringify(key)}:${flowScalar(item)}`);
    }
    return `{${pairs.join(",")}}`;
  }
  throw new Error("patch 行不支持的 YAML 值");
}
function entryItemOf(entry, style) {
  const item = { id: entry.id, name: MCP_PACKAGE, config: entry.config };
  if (style === "override") item.disabled = entry.disabled === true;
  else if (entry.disabled === true) item.disabled = true;
  return item;
}
function renderEntryItem(entry, style) {
  return `- ${flowScalar(entryItemOf(entry, style))}`;
}
function renderInsertLine(entry) {
  return `- ${flowScalar({ insert: [entryItemOf(entry, "insert")] })}`;
}
function renderKillLine() {
  return `- ${flowScalar({ id: GROUP_ID, name: "cordis:group", config: [] })}`;
}
function lacksSequenceRows(text) {
  const stripped = text.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n").trim();
  return stripped === "" || stripped === "[]";
}
function appendLines(text, lines) {
  const joined = lines.join("\n");
  if (lacksSequenceRows(text)) {
    const existing = text.split("\n");
    const index = existing.findIndex((line) => line.trim() === "[]");
    if (index >= 0) {
      existing[index] = joined;
      return existing.join("\n");
    }
  }
  const prefix = text === "" || text.endsWith("\n") ? text : `${text}
`;
  return `${prefix}${joined}
`;
}
function composeEdit(text, edits) {
  if (edits.length === 0) return text;
  if (edits.some((edit) => edit.op === "transform")) {
    if (edits.length !== 1) throw new Error("transform 不能与其他编辑混用");
    const only = edits[0];
    return only !== void 0 && only.op === "transform" ? only.transform(text) : text;
  }
  const appends = edits.filter((edit) => edit.op === "append");
  if (appends.length > 1) throw new Error("一次只允许一个 append");
  const hadRows = !lacksSequenceRows(text);
  const ranged = edits.filter(
    (edit) => edit.op === "replace" || edit.op === "delete"
  );
  const sorted = [...ranged].sort((a, b) => a.start - b.start);
  let previousEnd = -1;
  for (const edit of sorted) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      throw new Error("patch 编辑的区间必须是整数偏移");
    }
    if (edit.start < 0 || edit.end < edit.start || edit.end > text.length) {
      throw new Error(
        `patch 编辑区间越界：[${String(edit.start)}, ${String(edit.end)})，文件长度 ${String(text.length)}`
      );
    }
    if (edit.start < previousEnd) throw new Error("patch 编辑区间重叠；请刷新页面后重试");
    previousEnd = edit.end;
  }
  let next = text;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const edit = sorted[index];
    if (edit === void 0) continue;
    const chunk = next.slice(edit.start, edit.end);
    const replacement = edit.op === "delete" ? "" : `${edit.line}${chunk.endsWith("\n") ? "\n" : ""}`;
    next = `${next.slice(0, edit.start)}${replacement}${next.slice(edit.end)}`;
  }
  if (appends.length === 1) {
    const only = appends[0];
    if (only !== void 0 && only.lines.length > 0) next = appendLines(next, only.lines);
  }
  if (hadRows && ranged.length > 0 && lacksSequenceRows(next)) {
    const comments = next.split("\n").filter((line) => line.trimStart().startsWith("#")).join("\n").trimEnd();
    next = comments === "" ? "[]\n" : `${comments}
[]
`;
  }
  return next;
}

// src/host/rows.ts
function normalizeRow(server, base) {
  const source = asRecord(server);
  const baseConfig = asRecord(base);
  const transport = source.transport === "stdio" || source.transport === void 0 && baseConfig.transport === "stdio" ? "stdio" : "streamable-http";
  const serverName = asText(source.serverName).trim() || asText(baseConfig.serverName).trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    throw new Error(`serverName "${serverName}" 非法：只允许 1-32 位字母、数字、下划线、连字符`);
  }
  const config = { ...baseConfig, ...asRecord(server) };
  delete config.rowId;
  delete config.entryId;
  delete config.disabled;
  delete config.id;
  delete config.name;
  const baseUrl = baseConfig.url;
  const baseHeaders = baseConfig.headers;
  const baseCommand = baseConfig.command;
  const baseArgs = baseConfig.args;
  const baseEnv = baseConfig.env;
  const baseCwd = baseConfig.cwd;
  config.serverName = serverName;
  config.transport = transport;
  delete config.url;
  delete config.headers;
  delete config.command;
  delete config.args;
  delete config.env;
  delete config.cwd;
  const baseToolCallTimeoutMs = baseConfig.toolCallTimeoutMs;
  const baseFailOnStartupError = baseConfig.failOnStartupError;
  const baseMaxInstructionBytes = baseConfig.maxInstructionBytes;
  const baseReconnect = baseConfig.reconnect;
  delete config.toolCallTimeoutMs;
  delete config.failOnStartupError;
  delete config.maxInstructionBytes;
  delete config.reconnect;
  if (transport === "stdio") {
    const command = valueOf(textOf(source.command !== void 0 ? source.command : baseCommand));
    if (typeof command === "string" && command === "") {
      throw new Error(`服务器 "${serverName}" 使用 stdio，但 command 为空`);
    }
    config.command = command;
    const args = toStringArray(source.args !== void 0 ? source.args : baseArgs);
    if (args.length > 0) config.args = args;
    const env = toRecord(source.env !== void 0 ? source.env : baseEnv);
    if (env !== void 0) config.env = env;
    const cwd = valueOf(textOf(source.cwd !== void 0 ? source.cwd : baseCwd));
    if (typeof cwd !== "string" || cwd !== "") config.cwd = cwd;
  } else {
    const url = valueOf(textOf(source.url !== void 0 ? source.url : baseUrl));
    if (typeof url === "string" && url === "") {
      throw new Error(`服务器 "${serverName}" 使用 streamable-http，但 url 为空`);
    }
    config.url = url;
    const headers = toRecord(source.headers !== void 0 ? source.headers : baseHeaders);
    if (headers !== void 0) config.headers = headers;
  }
  const timeout = finiteNumber(source.toolCallTimeoutMs) ?? finiteNumber(baseToolCallTimeoutMs);
  if (timeout !== void 0) config.toolCallTimeoutMs = timeout;
  const failOnStartupError = typeof source.failOnStartupError === "boolean" ? source.failOnStartupError : typeof baseFailOnStartupError === "boolean" ? baseFailOnStartupError : void 0;
  if (failOnStartupError !== void 0) config.failOnStartupError = failOnStartupError;
  const maxInstructionBytes = positiveInteger(source.maxInstructionBytes) ?? positiveInteger(baseMaxInstructionBytes);
  if (maxInstructionBytes !== void 0) config.maxInstructionBytes = maxInstructionBytes;
  const reconnect = reconnectOf({ ...asRecord(baseReconnect), ...asRecord(source.reconnect) });
  if (reconnect !== void 0) config.reconnect = reconnect;
  const row = { name: MCP_PACKAGE, config };
  if (source.disabled === true) row.disabled = true;
  const rowId = readString(source, "entryId") ?? readString(source, "rowId");
  if (rowId !== void 0 && rowId !== "") row.id = rowId;
  return row;
}
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function positiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
function reconnectOf(value) {
  if (!isRecord(value)) return void 0;
  const next = {};
  if (typeof value.enabled === "boolean") next.enabled = value.enabled;
  for (const key of ["initialDelayMs", "maxDelayMs", "maxAttempts"]) {
    const item = value[key];
    if (typeof item === "number" && Number.isFinite(item)) next[key] = item;
  }
  return Object.keys(next).length > 0 ? next : void 0;
}
function toStringArray(value) {
  const rawList = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n").map((item) => item.trim()) : [];
  const result = [];
  for (const item of rawList) {
    if (isJsExpr(item)) {
      result.push(item);
      continue;
    }
    if (typeof item === "string") {
      const parsed = valueOf(item);
      if (typeof parsed === "string" && parsed === "") continue;
      result.push(parsed);
      continue;
    }
    if (typeof item === "number") {
      result.push(String(item));
      continue;
    }
    throw new Error("args 的每一项必须是字符串或 !!js 表达式");
  }
  return result;
}
function toRecord(value) {
  if (isRecord(value)) {
    const entries2 = Object.entries(value).map(([key, item]) => [key, scalarOf(item)]);
    return entries2.length === 0 ? void 0 : Object.fromEntries(entries2);
  }
  const pairs = Array.isArray(value) ? value.map((item) => String(item)) : typeof value === "string" ? value.split("\n") : [];
  const entries = pairs.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")).map((line) => {
    const at = line.indexOf("=");
    if (at <= 0) throw new Error(`环境变量/请求头行缺少 "="：${line}`);
    return [line.slice(0, at).trim(), valueOf(line.slice(at + 1))];
  });
  if (entries.length === 0) return void 0;
  return Object.fromEntries(entries);
}

// src/host/patch-writer.ts
var fs = process.getBuiltinModule("fs/promises");
var path = process.getBuiltinModule("path");
var crypto = process.getBuiltinModule("crypto");
var LOCK_RETRY_LIMIT = 200;
var LOCK_RETRY_DELAY_MS = 50;
var RENAME_RETRY_LIMIT = 8;
var RENAME_RETRY_INITIAL_MS = 20;
var RENAME_RETRY_MAX_MS = 200;
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function lockIsStale(lockPath) {
  try {
    const text = await fs.readFile(lockPath, "utf8");
    const pid = Number(text.trim());
    if (Number.isInteger(pid) && pid > 0) return !processAlive(pid);
    const info = await fs.stat(lockPath);
    return Date.now() - info.mtimeMs > 3e4;
  } catch {
    return true;
  }
}
async function withProfileLock(documentPath, operation) {
  const lockPath = path.join(path.dirname(documentPath), "package.json.lock");
  for (let attempt = 0; attempt < LOCK_RETRY_LIMIT; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(String(process.pid), "utf8");
        return await operation();
      } finally {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await lockIsStale(lockPath)) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
  throw new Error("等待 profile 写入锁超时；请稍后重试");
}
function transientRenameError(error) {
  if (process.platform !== "win32") return false;
  const code = error.code;
  return code === "EACCES" || code === "EBUSY" || code === "EPERM";
}
async function renameWithRetry(tempPath, targetPath) {
  let delay = RENAME_RETRY_INITIAL_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath);
      return;
    } catch (error) {
      if (!transientRenameError(error) || attempt >= RENAME_RETRY_LIMIT) throw error;
    }
    await sleep(delay);
    delay = Math.min(delay * 2, RENAME_RETRY_MAX_MS);
  }
}
async function writeFileAtomic(documentPath, content) {
  const tempPath = `${documentPath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 384, flag: "wx" });
    await renameWithRetry(tempPath, documentPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}
async function backupOf(documentPath) {
  const backupPath = `${documentPath}.mcp-manager.bak`;
  try {
    await fs.copyFile(documentPath, backupPath);
    return backupPath;
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function readPatch(documentPath) {
  return fs.readFile(documentPath, "utf8");
}
async function editPatch(options, edits) {
  const run = async () => {
    const before = await fs.readFile(options.documentPath, "utf8");
    const next = composeEdit(before, edits);
    if (next === before) return { documentPath: options.documentPath, text: before };
    const backupPath = await backupOf(options.documentPath);
    await writeFileAtomic(options.documentPath, next);
    return { documentPath: options.documentPath, backupPath, text: next };
  };
  return withProfileLock(options.documentPath, async () => {
    if (options.hmr?.runExclusive !== void 0) return options.hmr.runExclusive(run);
    return run();
  });
}

// src/host/index.ts
var FAILURE_MESSAGE_LIMIT = 500;
var FAILURE_SERVER_LIMIT = 64;
var MCP_LOG_LINE = /^mcp-client\(([^)]+)\):\s*([\s\S]*)$/;
var MCP_RECOVERED = /^reconnected and re-synced tools\b/;
var PROBE_TIMEOUT_MS = 8e3;
var PROBE_BODY_LIMIT = 160;
var PROBE_PROTOCOL_VERSION = "2025-11-25";
var PROBE_BODY_LIMIT_BYTES = 64 * 1024;
var PROBE_MAX_CHUNKS = 4;
var TOOL_NAME_LIMIT = 200;
var MCP_TOOL_PREFIX = "mcp__";
var FIBER_PHASE = ["pending", "loading", "active", "failed", "disposed", "unloading"];
var SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
var CAPABILITIES = [
  "patchInsert",
  "nativeRows",
  "add",
  "update",
  "remove",
  "setEnabled",
  "probe",
  "tools",
  "legacyMigration"
];
var name = "dsh-mcp-manager";
var inject = [];
function reasonOf(error) {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && cause.message !== "") return cause.message;
    return error.message;
  }
  return String(error);
}
function sleep2(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function apply(ctx) {
  ctx.inject(["connection", "configEditor", "loader"], (scope) => {
    const documentPath = scope.configEditor.documentPath;
    const hmr = typeof scope.get === "function" ? scope.get("hmr") : void 0;
    const failures = /* @__PURE__ */ new Map();
    const probes = /* @__PURE__ */ new Map();
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
    const toolsService = typeof scope.get === "function" ? scope.get("tools") : scope.tools;
    const toolsOf = (serverName) => {
      if (typeof toolsService?.schemas !== "function" || serverName === "") return void 0;
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
    const phaseOf = (entry) => entry.options.disabled === true ? "stopped" : entry.fiber === void 0 ? "pending" : FIBER_PHASE[entry.fiber.state] ?? "pending";
    const topLevelEntries = () => scope.configEditor.entries().filter((entry) => {
      if (entry.options.name !== MCP_PACKAGE) return false;
      const id = entry.options.id;
      return typeof id === "string" && id !== "";
    });
    const layersOf = () => new Map(scope.configEditor.configuration().map((layer) => [layer.entry.options.id ?? "", layer]));
    const rawConfigOf = (entry, layers) => {
      const layer = layers.get(entry.options.id ?? "");
      const override = layer?.override;
      if (isRecord(override) && Object.keys(override).length > 0) return override;
      if (isRecord(layer?.inherited)) return layer.inherited;
      return asRecord(entry.options.config);
    };
    const groupEntries = () => [...scope.loader.entries()].filter((entry) => entry.options.id === GROUP_ID);
    const groupRows = () => {
      const groups = groupEntries();
      if (groups.length !== 1) return [];
      const entry = groups[0];
      if (entry === void 0) return [];
      const layer = scope.configEditor.configuration().find((item) => item.entry.options.id === GROUP_ID);
      const raw = Array.isArray(layer?.override) ? layer.override : Array.isArray(layer?.inherited) ? layer.inherited : Array.isArray(entry.options.config) ? entry.options.config : [];
      return raw.map((item) => asRecord(item));
    };
    const legacyState = () => {
      const groups = groupEntries();
      if (groups.length > 1) return { state: "duplicated", count: groupRows().length };
      if (groups.length === 0) return { state: "none", count: 0 };
      const count = groupRows().length;
      return count > 0 ? { state: "needs-migration", count } : { state: "none", count: 0 };
    };
    const readDoc = async () => {
      try {
        const text = await readPatch(documentPath);
        return { scan: scanPatchDoc(text) };
      } catch (error) {
        return { scan: { entries: [], unaddressable: 0 }, patchError: reasonOf(error) };
      }
    };
    const requireDoc = async () => {
      const doc = await readDoc();
      if (doc.patchError !== void 0) {
        throw new Error(`无法读取 profile 补丁文件，写入已禁用：${doc.patchError}`);
      }
      return doc.scan;
    };
    const snapshot = async () => {
      const doc = await readDoc();
      const entries = topLevelEntries();
      const layers = layersOf();
      const declared = /* @__PURE__ */ new Map();
      if (doc.patchError === void 0) {
        for (const item of doc.scan.entries) {
          if (item.id === void 0) continue;
          const list = declared.get(item.id);
          if (list === void 0) declared.set(item.id, [item]);
          else list.push(item);
        }
      }
      const servers = entries.map((entry, index) => {
        const id = entry.options.id ?? "";
        const config = rawConfigOf(entry, layers);
        const serverName = asText(config.serverName);
        const ranges = declared.get(id) ?? [];
        const source = doc.patchError !== void 0 ? "external" : ranges.some((item) => item.style === "insert") ? "profile" : ranges.length > 0 ? "overridden" : "external";
        const server = {
          index,
          id,
          serverName,
          source,
          config,
          disabled: entry.options.disabled === true,
          phase: phaseOf(entry)
        };
        const failure = failures.get(serverName);
        if (failure !== void 0) server.error = { ...failure };
        const probe = probes.get(id);
        if (probe !== void 0) server.probe = { ...probe };
        const tools = toolsOf(serverName);
        if (tools !== void 0) server.tools = tools;
        return server;
      });
      return {
        servers,
        legacy: legacyState(),
        profilePath: documentPath,
        ...doc.patchError === void 0 ? {} : { patchError: doc.patchError },
        mcpPackage: MCP_PACKAGE,
        capabilities: CAPABILITIES
      };
    };
    const waitFor = async (predicate) => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (predicate()) return;
        await sleep2(100);
      }
    };
    const applyEdits = async (edits) => {
      await editPatch({ documentPath, hmr }, edits);
      failures.clear();
      probes.clear();
    };
    let writeQueue = Promise.resolve();
    const serialized = (operation) => {
      const run = writeQueue.then(operation, operation);
      writeQueue = run.then(
        () => void 0,
        () => void 0
      );
      return run;
    };
    const nameOf = (entry, layers) => asText(rawConfigOf(entry, layers).serverName);
    const assertNameFree = (name2, excludeId) => {
      const layers = layersOf();
      for (const entry of topLevelEntries()) {
        const id = entry.options.id ?? "";
        if (id === excludeId) continue;
        if (nameOf(entry, layers) === name2) {
          throw new Error(`MCP 服务器名重复："${name2}"；同一作用域内 serverName 必须唯一`);
        }
      }
    };
    const takenIds = (scan) => {
      const taken = /* @__PURE__ */ new Set();
      for (const entry of topLevelEntries()) {
        const id = entry.options.id;
        if (typeof id === "string" && id !== "") taken.add(id);
      }
      for (const item of scan.entries) if (item.id !== void 0) taken.add(item.id);
      return taken;
    };
    const uniqueId = (serverName, taken) => {
      const base = `mcp-${serverName}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48) || "mcp-server";
      let candidate = base;
      for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${String(suffix)}`;
      return candidate;
    };
    const canonicalText = (value) => {
      if (value === void 0) return "undefined";
      if (Array.isArray(value)) return `[${value.map((item) => canonicalText(item)).join(",")}]`;
      if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalText(value[key])}`).join(",")}}`;
      }
      return JSON.stringify(value);
    };
    const entryWriteEdit = (scan, entryId, config, disabled) => {
      const ranges = scan.entries.filter((item) => item.id === entryId);
      if (ranges.length > 1) {
        const inserts = ranges.filter((item) => item.style === "insert");
        const overrides = ranges.filter((item) => item.style === "override");
        const insert = inserts[0];
        const comparable = ranges.every((item) => item.flow?.value !== void 0);
        if (inserts.length === 1 && insert !== void 0 && overrides.length >= 1 && comparable && ranges.every((item) => {
          const value = item.flow?.value;
          return value?.name === MCP_PACKAGE && canonicalText(value.config) === canonicalText(config);
        })) {
          const line2 = renderEntryItem({ id: entryId, config, disabled }, insert.style);
          return [
            {
              op: "replace",
              start: insert.start,
              end: insert.end,
              line: insert.indent > 0 ? `${" ".repeat(insert.indent)}${line2}` : line2
            },
            ...overrides.map((item) => ({ op: "delete", start: item.start, end: item.end }))
          ];
        }
        throw new Error(
          `条目 "${entryId}" 在 profile 里被声明了 ${String(ranges.length)} 次；请先手工清理 cordis.patch.yml（每台 MCP 只保留一行声明）`
        );
      }
      const target = ranges[0];
      if (target === void 0) {
        return [{ op: "append", lines: [renderEntryItem({ id: entryId, config, disabled }, "override")] }];
      }
      if (target.flow !== void 0) {
        if (target.flow.index === void 0) {
          const line2 = renderEntryItem({ id: entryId, config, disabled }, target.style);
          return [
            {
              op: "replace",
              start: target.start,
              end: target.end,
              line: target.indent > 0 ? `${" ".repeat(target.indent)}${line2}` : line2
            }
          ];
        }
        const container = target.flow.value;
        const list = Array.isArray(container.insert) ? [...container.insert] : [];
        list[target.flow.index] = entryItemOf({ id: entryId, config, disabled }, "insert");
        return [{ op: "replace", start: target.start, end: target.end, line: `- ${flowScalar({ insert: list })}` }];
      }
      const line = renderEntryItem({ id: entryId, config, disabled }, target.style);
      return [
        {
          op: "replace",
          start: target.start,
          end: target.end,
          line: target.indent > 0 ? `${" ".repeat(target.indent)}${line}` : line
        }
      ];
    };
    const removalEdits = (scan, entryId) => {
      const ranges = scan.entries.filter((item) => item.id === entryId);
      if (ranges.length === 0) {
        throw new Error(
          `条目 "${entryId}" 的原始声明不在 profile 补丁文件里（由其他插件或补丁层声明），本插件无法删除；可以停用它`
        );
      }
      const edits = [];
      const done = /* @__PURE__ */ new Set();
      for (const range of ranges) {
        if (range.flow !== void 0 && range.flow.index !== void 0) {
          const container = range.flow.value;
          const list = (Array.isArray(container.insert) ? [...container.insert] : []).filter(
            (_item, index) => index !== range.flow?.index
          );
          if (list.length === 0) edits.push({ op: "delete", start: range.start, end: range.end });
          else
            edits.push({ op: "replace", start: range.start, end: range.end, line: `- ${flowScalar({ insert: list })}` });
          done.add(String(range.start));
          continue;
        }
        if (range.parent !== void 0 && range.siblings <= 1) {
          const key2 = `parent-${String(range.parent.start)}`;
          if (!done.has(key2)) {
            done.add(key2);
            edits.push({ op: "delete", start: range.parent.start, end: range.parent.end });
          }
          continue;
        }
        const key = String(range.start);
        if (!done.has(key)) {
          done.add(key);
          edits.push({ op: "delete", start: range.start, end: range.end });
        }
      }
      return edits;
    };
    const addServer = async (server) => {
      const scan = await requireDoc();
      const row = normalizeRow(server);
      const config = asRecord(row.config);
      assertNameFree(asText(config.serverName));
      const id = uniqueId(asText(config.serverName), takenIds(scan));
      await applyEdits([{ op: "append", lines: [renderInsertLine({ id, config, disabled: row.disabled === true })] }]);
      await waitFor(() => topLevelEntries().some((entry) => entry.options.id === id));
      return snapshot();
    };
    const updateServer = async (entryId, server) => {
      const scan = await requireDoc();
      const entries = topLevelEntries();
      const layers = layersOf();
      const entry = entries.find((item) => item.options.id === entryId);
      if (entry === void 0) throw new Error(`找不到 MCP 条目 "${entryId}"；请刷新页面后重试`);
      const row = normalizeRow({ ...asRecord(server), entryId }, rawConfigOf(entry, layers));
      const config = asRecord(row.config);
      assertNameFree(asText(config.serverName), entryId);
      await applyEdits(entryWriteEdit(scan, entryId, config, row.disabled === true));
      await waitFor(() => topLevelEntries().some((item) => item.options.id === entryId));
      return snapshot();
    };
    const setEnabled = async (entryId, enabled) => {
      const scan = await requireDoc();
      const entries = topLevelEntries();
      const layers = layersOf();
      const entry = entries.find((item) => item.options.id === entryId);
      if (entry === void 0) throw new Error(`找不到条目 "${entryId}"`);
      const config = rawConfigOf(entry, layers);
      await applyEdits(entryWriteEdit(scan, entryId, config, !enabled));
      await waitFor(() => topLevelEntries().some((item) => item.options.id === entryId));
      return snapshot();
    };
    const removeServer = async (entryId) => {
      const scan = await requireDoc();
      await applyEdits(removalEdits(scan, entryId));
      await waitFor(() => !topLevelEntries().some((entry) => entry.options.id === entryId));
      return snapshot();
    };
    const migrateLegacy = async () => {
      const scan = await requireDoc();
      const groups = groupEntries();
      if (groups.length > 1) throw new Error(`旧版 group 条目「${GROUP_ID}」被声明了两次；请先删掉 profile 里那一行`);
      if (groups.length === 0) return snapshot();
      const rows = groupRows();
      if (rows.length === 0) return snapshot();
      const entries = topLevelEntries();
      const layers = layersOf();
      const usedNames = new Set(entries.map((entry) => nameOf(entry, layers)));
      const taken = takenIds(scan);
      const lines = [];
      const expected = [];
      for (const row of rows) {
        if (row.name !== MCP_PACKAGE) {
          throw new Error("旧 group 里含有非 MCP 条目，无法自动迁移；请先手动处理");
        }
        const config = asRecord(row.config);
        const serverName = asText(config.serverName);
        if (!SERVER_NAME_PATTERN.test(serverName)) throw new Error(`旧容器里有非法 serverName：${serverName}`);
        if (usedNames.has(serverName)) throw new Error(`迁移时发现重复 serverName：${serverName}`);
        usedNames.add(serverName);
        const preferred = typeof row.id === "string" && row.id !== "" ? row.id : void 0;
        const id = preferred !== void 0 && !taken.has(preferred) ? preferred : uniqueId(serverName, taken);
        taken.add(id);
        lines.push(renderInsertLine({ id, config, disabled: row.disabled === true }));
        expected.push(id);
      }
      const edits = [{ op: "append", lines }];
      if (scan.entries.some((item) => item.id === GROUP_ID)) edits.push(...removalEdits(scan, GROUP_ID));
      else lines.push(renderKillLine());
      await applyEdits(edits);
      await waitFor(
        () => expected.every((id) => topLevelEntries().some((entry) => entry.options.id === id)) && groupRows().length === 0
      );
      return snapshot();
    };
    const jsonRpcMessage = (text) => {
      const candidates = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) candidates.push(trimmed.slice(5).trim());
        else if (trimmed !== "") candidates.push(trimmed);
      }
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
      for (const candidate of candidates) {
        try {
          const value = JSON.parse(candidate);
          if (isRecord(value) && value.jsonrpc === "2.0") return value;
        } catch {
        }
      }
      return void 0;
    };
    const readProbeBody = async (response) => {
      if (response.body === null) return "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      try {
        for (let index = 0; index < PROBE_MAX_CHUNKS && text.length < PROBE_BODY_LIMIT_BYTES; index += 1) {
          const { value, done } = await reader.read();
          if (done === true) break;
          if (value !== void 0) text += decoder.decode(value, { stream: true });
          if (jsonRpcMessage(text) !== void 0) break;
        }
        text += decoder.decode();
        return text.slice(0, PROBE_BODY_LIMIT_BYTES);
      } finally {
        try {
          void reader.cancel().catch(() => {
          });
        } catch {
        }
      }
    };
    const shortenBody = (text) => text.replace(/\s+/g, " ").trim().slice(0, PROBE_BODY_LIMIT);
    const probeConfig = async (config) => {
      const at = Date.now();
      if (isJsExpr(config.url)) {
        return { connected: null, status: null, detail: "url 是 !!js 表达式：条目激活前无法求值，暂不能探测", at };
      }
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
      for (const [key, value] of Object.entries(asRecord(config.headers))) {
        if (isJsExpr(value)) {
          return {
            connected: null,
            status: null,
            detail: `请求头 ${key} 是 !!js 表达式：条目激活前无法求值，暂不能探测`,
            at
          };
        }
        extraHeaders[key] = String(value);
      }
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
              protocolVersion: PROBE_PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "dsh-mcp-manager", version: "0.4.1" }
            }
          }),
          signal: controller.signal
        });
        const body = await readProbeBody(response);
        const status = response.status;
        if (!response.ok) {
          return {
            connected: false,
            status,
            detail: `HTTP ${String(status)}${body === "" ? "" : `：${shortenBody(body)}`}`,
            at
          };
        }
        const message = jsonRpcMessage(body);
        if (message !== void 0) {
          if ("error" in message) {
            const error = asRecord(message.error);
            const detail = [error.code, error.message].filter((item) => item !== void 0 && item !== "").join("：");
            return {
              connected: false,
              status,
              detail: `HTTP ${String(status)}，MCP initialize 被拒绝${detail === "" ? "" : `：${detail}`}`,
              at
            };
          }
          if ("result" in message) {
            const version = readString(asRecord(message.result), "protocolVersion");
            return {
              connected: true,
              status,
              detail: version === void 0 ? `HTTP ${String(status)}` : `HTTP ${String(status)}，MCP ${version}`,
              at
            };
          }
        }
        const type = response.headers.get("content-type") ?? "未知 content-type";
        return { connected: false, status, detail: `HTTP ${String(status)}，但响应不是 MCP（${type}）`, at };
      } catch (error) {
        return {
          connected: false,
          status: null,
          detail: controller.signal.aborted ? `超时（${String(PROBE_TIMEOUT_MS / 1e3)}s）：服务器没有响应` : `请求失败：${reasonOf(error)}`,
          at
        };
      } finally {
        clearTimeout(timer);
      }
    };
    const runProbes = async (only) => {
      const layers = layersOf();
      const targets = topLevelEntries().filter((entry) => {
        const id = entry.options.id ?? "";
        const name2 = nameOf(entry, layers);
        return entry.options.disabled !== true && (only === void 0 || id === only || name2 === only);
      });
      if (only !== void 0 && targets.length === 0) {
        throw new Error(`找不到启用中的 MCP 条目 "${only}"；配置可能已被外部修改，请刷新页面后重试`);
      }
      const results = await Promise.all(
        targets.map(async (entry) => {
          const id = entry.options.id ?? "";
          const evaluated = entry.fiber === void 0 ? rawConfigOf(entry, layers) : asRecord(entry.fiber.config);
          return [id, await probeConfig(evaluated)];
        })
      );
      for (const [id, result] of results) probes.set(id, result);
      return snapshot();
    };
    const respond = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
    const resolveEntryId = (payload) => {
      const id = readString(payload, "entryId");
      if (id !== void 0 && id !== "") return id;
      const serverName = readString(payload, "serverName");
      if (serverName !== void 0 && serverName !== "") {
        const layers = layersOf();
        const entry = topLevelEntries().find((item) => nameOf(item, layers) === serverName);
        if (entry?.options.id) return entry.options.id;
      }
      throw new Error("entryId 或 serverName 不能为空");
    };
    const handler = async (request) => {
      try {
        if (request.method === "GET") return respond(200, { ok: true, data: await snapshot() });
        const payload = asRecord(await request.json());
        switch (readString(payload, "op")) {
          case "add":
            return respond(200, { ok: true, data: await serialized(() => addServer(payload.server)) });
          case "update":
            return respond(200, {
              ok: true,
              data: await serialized(() => updateServer(resolveEntryId(payload), payload.server))
            });
          case "remove":
            return respond(200, { ok: true, data: await serialized(() => removeServer(resolveEntryId(payload))) });
          case "setEnabled":
            return respond(200, {
              ok: true,
              data: await serialized(() => setEnabled(resolveEntryId(payload), payload.enabled === true))
            });
          case "migrate":
            return respond(200, { ok: true, data: await serialized(migrateLegacy) });
          case "probe": {
            const target = readString(payload, "entryId") ?? readString(payload, "serverName");
            return respond(200, { ok: true, data: await runProbes(target) });
          }
          case "adopt":
          case "release":
            throw new Error(
              "v0.4.0 已移除「接管 / 取消接管」：profile 里的条目可直接编辑删除；外部条目保存或启停时会自动追加覆写行"
            );
          case "save":
          case "saveRows":
            throw new Error("客户端与宿主版本不一致：v0.4.0 已改用条目寻址协议；请刷新页面并重启 DSH");
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
    void serialized(async () => {
      try {
        await editPatch({ documentPath, hmr }, [{ op: "transform", transform: stripManagedMarkers }]);
      } catch {
      }
    }).catch(() => {
    });
  });
}
export {
  apply,
  inject,
  name
};
