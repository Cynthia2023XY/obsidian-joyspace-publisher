var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
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

// src/services/import-markdown-doc.mjs
var import_markdown_doc_exports = {};
__export(import_markdown_doc_exports, {
  buildCookieHeader: () => buildCookieHeader,
  buildCreatePagePayload: () => buildCreatePagePayload,
  extractTeamFolderFromUrl: () => extractTeamFolderFromUrl,
  extractTitleFromMarkdown: () => extractTitleFromMarkdown,
  loadJdCookiesFromBrowser: () => loadJdCookiesFromBrowser,
  normalizeBrowserCookiePayload: () => normalizeBrowserCookiePayload,
  normalizeCookieMap: () => normalizeCookieMap,
  normalizeCreatedPageResponse: () => normalizeCreatedPageResponse,
  normalizeLocationFromBasicInfo: () => normalizeLocationFromBasicInfo,
  promoteSectionHeadingsForJoySpace: () => promoteSectionHeadingsForJoySpace,
  publishMarkdownFile: () => publishMarkdownFile,
  removeFirstH1: () => removeFirstH1,
  resolveAuth: () => resolveAuth,
  stripYamlFrontmatter: () => stripYamlFrontmatter
});
function requireTenantConfig(tenantCode) {
  const config = TENANT_CONFIG[tenantCode];
  if (!config) {
    throw new Error(
      `Unsupported tenantCode "${tenantCode}". Expected one of ${Object.keys(TENANT_CONFIG).join(", ")}`
    );
  }
  return config;
}
function normalizeCookieMap(cookies) {
  if (!cookies || typeof cookies !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(cookies).map(([name, value]) => [String(name || "").trim(), String(value || "").trim()]).filter(([name, value]) => name && value)
  );
}
function buildCookieHeader({ cookies = null, cookieHeader = "" }) {
  if (cookieHeader) {
    return cookieHeader;
  }
  const cookieMap = normalizeCookieMap(cookies);
  return Object.entries(cookieMap).map(([name, value]) => `${name}=${value}`).join("; ");
}
function formatErrorWithCause(error) {
  const message = error?.message || String(error);
  const cause = error?.cause?.message || error?.cause;
  return cause ? `${message} (${cause})` : message;
}
function normalizeBrowserCookiePayload(payload) {
  if (!payload || typeof payload !== "object" || payload.ok !== true) {
    return {
      cookies: {},
      source: "",
      error: payload?.error || "browser cookie payload not ok"
    };
  }
  const cookies = normalizeCookieMap(payload.cookies);
  if (Object.keys(cookies).length === 0) {
    return {
      cookies: {},
      source: payload.source || "",
      error: "browser cookie payload has no usable cookies"
    };
  }
  return {
    cookies,
    source: String(payload.source || "browser"),
    error: ""
  };
}
async function loadJdCookiesFromBrowser({ pythonCommand = process.env.PYTHON || "python3" } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      pythonCommand,
      ["-c", BROWSER_COOKIE3_SCRIPT],
      {
        timeout: 15e3,
        maxBuffer: 1024 * 1024
      }
    );
    const parsed = JSON.parse(stdout || "{}");
    const result = normalizeBrowserCookiePayload(parsed);
    if (result.error && stderr) {
      return { ...result, error: `${result.error}; ${stderr.trim()}` };
    }
    return result;
  } catch (error) {
    return {
      cookies: {},
      source: "",
      error: `browser_cookie3 lookup failed: ${formatErrorWithCause(error)}`
    };
  }
}
function extractTitleFromMarkdown(markdown, filePath) {
  const heading = markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }
  const stem = import_node_path.default.basename(filePath || "untitled.md", import_node_path.default.extname(filePath || "untitled.md"));
  return stem || "untitled";
}
function stripYamlFrontmatter(markdown) {
  const text = String(markdown || "");
  return text.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
}
function removeFirstH1(markdown) {
  return String(markdown || "").replace(/^\s*#\s+.+?\s*\r?\n+/, "");
}
function promoteSectionHeadingsForJoySpace(markdown) {
  const lines = String(markdown || "").split("\n");
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) {
      return line;
    }
    return line.replace(/^(#{2,6})(\s+)/, (match, hashes, space) => {
      return `${hashes.slice(1)}${space}`;
    });
  }).join("\n");
}
function normalizeLocationFromBasicInfo({ team_id, folder_id, teamId, folderId }) {
  const sourceTeamId = team_id ?? teamId;
  const sourceFolderId = folder_id ?? folderId;
  const normalizedTeamId = typeof sourceTeamId === "string" && sourceTeamId.trim().startsWith("$") ? "root" : sourceTeamId?.trim();
  const normalizedFolderId = sourceFolderId?.trim() || void 0;
  return {
    teamId: normalizedTeamId || "root",
    folderId: normalizedFolderId
  };
}
function buildCreatePagePayload({ title, markdown, teamId, folderId }) {
  const payload = {
    title,
    page_type: 13,
    teamId,
    content: [{ value: markdown }],
    contentType: "markdown"
  };
  if (folderId) {
    payload.folderId = folderId;
  }
  return payload;
}
async function resolveAuth({ pythonExecutable } = {}) {
  const browserCookies = await loadJdCookiesFromBrowser({ pythonCommand: pythonExecutable || process.env.PYTHON || "python3" });
  if (Object.keys(browserCookies.cookies).length > 0) {
    return {
      mode: "browser",
      cookieSource: browserCookies.source,
      cookies: browserCookies.cookies
    };
  }
  throw new Error(
    `Unable to resolve JoySpace auth from browser cookies. ${browserCookies.error || "No jd.com cookies found in supported browsers"}. Please install browser_cookie3 and login to joyspace.jd.com / jd.com in Chrome, then retry.`
  );
}
async function requestJoySpaceJson({ method, url, cookieHeader, teamHeaderId, body }) {
  const response = await fetch(`${DEFAULT_JOYSPACE_API_BASE}${url}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "x-team-id": teamHeaderId
    },
    body: body ? JSON.stringify(body) : void 0
  });
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  if (json?.status === "failed" || json?.errCode || json?.errorCode && json.errorCode !== "0" || json?.code != null && json.code !== 0 && json.code !== "0") {
    const errorCode = json.errCode || json.errorCode || json.code || "unknown";
    const errorMessage = json.errMsg || json.errorMsg || json.msg || json.message || json.error || "Unknown API error";
    throw new Error(`JoySpace API error ${errorCode}: ${errorMessage} (${url})`);
  }
  if (json?.status === "success" || json?.status === "0" || json?.status === 0) {
    return json.data;
  }
  return json.data ?? json;
}
function extractTeamFolderFromUrl(pageUrl) {
  const match = pageUrl.match(
    /joyspace\.jd\.com\/teams\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?/i
  );
  if (!match?.[1]) {
    return null;
  }
  return {
    teamId: match[1],
    folderId: match[2] || void 0
  };
}
function extractPageIdFromUrl(pageUrl) {
  const match = pageUrl.match(
    /joyspace\.jd\.com\/(?:pages|doc|sheets?|table|ppt|board|mind|meeting)\/([A-Za-z0-9_-]+)/i
  );
  if (!match?.[1]) {
    throw new Error(`Unable to extract JoySpace page id from URL: ${pageUrl}`);
  }
  return match[1];
}
async function resolveTargetLocation({ pageUrl, cookieHeader, teamHeaderId }) {
  if (!pageUrl) {
    return {
      teamId: "root",
      folderId: void 0,
      source: "private-space-root"
    };
  }
  const teamFolder = extractTeamFolderFromUrl(pageUrl);
  if (teamFolder) {
    return {
      ...teamFolder,
      source: pageUrl
    };
  }
  const pageId = extractPageIdFromUrl(pageUrl);
  const basicInfo = await requestJoySpaceJson({
    method: "GET",
    url: `/v3/pages/${pageId}/basic?sendRecent=0`,
    cookieHeader,
    teamHeaderId
  });
  const normalized = normalizeLocationFromBasicInfo(basicInfo || {});
  return {
    ...normalized,
    source: pageUrl
  };
}
async function createJoySpacePage({ markdown, title, location, cookieHeader, teamHeaderId }) {
  const payload = buildCreatePagePayload({
    title,
    markdown,
    teamId: location.teamId,
    folderId: location.folderId
  });
  return requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages",
    cookieHeader,
    teamHeaderId,
    body: payload
  });
}
async function verifyJoySpacePage({ pageId, cookieHeader, teamHeaderId }) {
  return requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages/content",
    cookieHeader,
    teamHeaderId,
    body: { pageId }
  });
}
function normalizeCreatedPageResponse(createResponse) {
  const created = createResponse && typeof createResponse === "object" ? createResponse : {};
  const pageId = String(created.id || created.pageId || "").trim();
  if (!pageId) {
    const responseKeys = Object.keys(created).join(", ") || "empty response";
    throw new Error(`JoySpace \u521B\u5EFA\u63A5\u53E3\u672A\u8FD4\u56DE id/pageId\uFF0C\u54CD\u5E94\u5B57\u6BB5\uFF1A${responseKeys}`);
  }
  return {
    created,
    pageId,
    link: created.link || `https://joyspace.jd.com/pages/${pageId}`
  };
}
async function publishMarkdownFile(options) {
  if (!options.filePath) {
    throw new Error("--file is required");
  }
  const originalMarkdown = await import_promises.default.readFile(options.filePath, "utf8");
  const markdownWithoutFrontmatter = stripYamlFrontmatter(originalMarkdown);
  const title = options.title || extractTitleFromMarkdown(markdownWithoutFrontmatter, options.filePath);
  const bodyWithoutTitle = removeFirstH1(markdownWithoutFrontmatter);
  const markdown = options.promoteSectionHeadings ? promoteSectionHeadingsForJoySpace(bodyWithoutTitle) : bodyWithoutTitle;
  const auth = await resolveAuth(options);
  const { teamHeaderId } = requireTenantConfig(options.tenantCode);
  const cookieHeader = buildCookieHeader(auth);
  const location = await resolveTargetLocation({
    pageUrl: options.pageUrl,
    cookieHeader,
    teamHeaderId
  });
  const createResponse = await createJoySpacePage({
    markdown,
    title,
    location,
    cookieHeader,
    teamHeaderId
  });
  const createdPage = normalizeCreatedPageResponse(createResponse);
  const created = createdPage.created;
  const verified = await verifyJoySpacePage({
    pageId: createdPage.pageId,
    cookieHeader,
    teamHeaderId
  });
  return {
    authMode: auth.mode,
    cookieSource: auth.cookieSource || void 0,
    pageId: createdPage.pageId,
    title: created.title || title,
    link: createdPage.link,
    teamId: created.team_id || created.teamId || location.teamId,
    folderId: created.folder_id || created.folderId || location.folderId || "",
    locationSource: location.source,
    promotedSectionHeadings: options.promoteSectionHeadings,
    verified: Array.isArray(verified?.content) && verified.content.length > 0
  };
}
var import_node_child_process, import_promises, import_node_path, import_node_util, DEFAULT_JOYSPACE_API_BASE, TENANT_CONFIG, execFileAsync, BROWSER_COOKIE3_SCRIPT;
var init_import_markdown_doc = __esm({
  "src/services/import-markdown-doc.mjs"() {
    import_node_child_process = require("node:child_process");
    import_promises = __toESM(require("node:fs/promises"), 1);
    import_node_path = __toESM(require("node:path"), 1);
    import_node_util = require("node:util");
    DEFAULT_JOYSPACE_API_BASE = "https://apijoyspace.jd.com";
    TENANT_CONFIG = Object.freeze({
      "CN.JD.GROUP": { teamHeaderId: "00046419", ddAppId: "ee" },
      "TH.JD.GROUP": { teamHeaderId: "00046420", ddAppId: "th.ee" },
      "ID.JD.GROUP": { teamHeaderId: "00046421", ddAppId: "id.ee" },
      "SF.JD.GROUP": { teamHeaderId: "00046422", ddAppId: "sf.ee" }
    });
    execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
    BROWSER_COOKIE3_SCRIPT = String.raw`
import json
import sys

LOADERS = ["chrome", "chromium", "firefox", "edge", "brave", "vivaldi"]

try:
    import browser_cookie3
except Exception as exc:
    print(json.dumps({
        "ok": False,
        "error": "browser_cookie3 import failed: " + str(exc),
        "attempts": [],
    }, ensure_ascii=False))
    sys.exit(0)

def collect(loader_name):
    loader = getattr(browser_cookie3, loader_name, None)
    if not callable(loader):
        return {}, "loader unavailable"
    try:
        cookie_dict = {}
        for cookie in loader(domain_name="jd.com"):
            name = str(getattr(cookie, "name", "") or "")
            value = str(getattr(cookie, "value", "") or "")
            if name and value:
                cookie_dict[name] = value
        return cookie_dict, None
    except Exception as exc:
        return {}, str(exc)

attempts = []

# Match relay-d2c-b: Chrome jd.com cookie jar is the validated first path.
cookies, error = collect("chrome")
attempts.append({"loader": "chrome", "count": len(cookies), "error": error})
if cookies:
    print(json.dumps({
        "ok": True,
        "source": "chrome",
        "cookies": cookies,
        "attempts": attempts,
    }, ensure_ascii=False))
    sys.exit(0)

for loader_name in LOADERS:
    if loader_name == "chrome":
        continue
    cookies, error = collect(loader_name)
    attempts.append({"loader": loader_name, "count": len(cookies), "error": error})
    if cookies:
        print(json.dumps({
            "ok": True,
            "source": loader_name,
            "cookies": cookies,
            "attempts": attempts,
        }, ensure_ascii=False))
        sys.exit(0)

print(json.dumps({
    "ok": False,
    "error": "No jd.com cookies found in supported browsers",
    "attempts": attempts,
}, ensure_ascii=False))
`;
  }
});

// src/services/pull-joyspace-doc.mjs
var pull_joyspace_doc_exports = {};
__export(pull_joyspace_doc_exports, {
  contentToMarkdown: () => contentToMarkdown,
  extractPageId: () => extractPageId,
  pullJoySpaceDocumentFile: () => pullJoySpaceDocumentFile
});
function requireTenantConfig2(tenantCode) {
  const config = TENANT_CONFIG2[tenantCode];
  if (!config) {
    throw new Error(`Unsupported tenantCode "${tenantCode}". Expected one of ${Object.keys(TENANT_CONFIG2).join(", ")}`);
  }
  return config;
}
function extractPageId(input) {
  const match = String(input || "").match(/joyspace\.jd\.com\/(?:pages|doc)\/([A-Za-z0-9_-]+)/i) || String(input || "").match(/^([A-Za-z0-9_-]+)$/);
  if (!match?.[1]) {
    throw new Error(`Unable to extract JoySpace page id from: ${input}`);
  }
  return match[1];
}
function safeFileName(title) {
  return String(title || "untitled").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}
async function uniqueMarkdownPath(outputDir, title) {
  const baseName = safeFileName(title);
  let filePath = import_node_path2.default.join(outputDir, `${baseName}.md`);
  for (let index = 1; ; index += 1) {
    try {
      await import_promises2.default.access(filePath);
      filePath = import_node_path2.default.join(outputDir, `${baseName} (${index}).md`);
    } catch {
      return filePath;
    }
  }
}
function yamlString(value) {
  return JSON.stringify(String(value || ""));
}
function toRoman(num) {
  const vals = [10, 9, 5, 4, 1];
  const syms = ["x", "ix", "v", "iv", "i"];
  let result = "";
  for (let i = 0; i < vals.length; i += 1) {
    while (num >= vals[i]) {
      result += syms[i];
      num -= vals[i];
    }
  }
  return result;
}
function serializeInlineNodes(children) {
  if (!Array.isArray(children)) return "";
  let result = "";
  for (const node of children) {
    if (node.type === "link") {
      result += `[${serializeInlineNodes(node.children)}](${node.url || ""})`;
      continue;
    }
    if (node.type === "docfile" && node.value) {
      const v = node.value;
      const prefix = v.pageType === 18 ? "sheets" : v.pageType === 21 ? "table" : "pages";
      const url = v.id ? `https://joyspace.jd.com/${prefix}/${v.id}` : "";
      const title = v.title || "(untitled)";
      result += url ? `[${title}](${url})` : title;
      continue;
    }
    if (node.type === "img") {
      result += `![](${node.url || ""})`;
      continue;
    }
    if (node.type === "mention") {
      const v = node.value || node.data || {};
      const name = v.name || v.nickname || v.text || "";
      const acct = v.username || v.erp || v.id || "";
      result += acct && acct !== name ? `@${name}(${acct})` : `@${name}`;
      continue;
    }
    if (node.type === "equation" || node.type === "formula") {
      result += `$${node.value?.formula || node.data?.formula || node.text || ""}$`;
      continue;
    }
    if (node.type === "date") {
      const v = node.value || node.data || {};
      result += v.date || v.text || "";
      continue;
    }
    if (node.type === "tag") {
      const v = node.value || node.data || {};
      result += `#${v.name || v.text || ""}`;
      continue;
    }
    if (node.text == null) {
      if (node.children) result += serializeInlineNodes(node.children);
      continue;
    }
    let text = node.text;
    if (!text) continue;
    if (node.code) text = `\`${text}\``;
    if (node.bold && node.italic) text = `***${text}***`;
    else if (node.bold) text = `**${text}**`;
    else if (node.italic) text = `*${text}*`;
    if (node.strike) text = `~~${text}~~`;
    if (node.bgColor) text = `<mark style="background:${node.bgColor}">${text}</mark>`;
    else if (node.highlight) text = `<mark>${text}</mark>`;
    result += text;
  }
  return result;
}
function serializeBlocksToMarkdown(blocks, ctx = {}) {
  if (!Array.isArray(blocks)) return "";
  const lines = [];
  const counters = {};
  for (let i = 0; i < blocks.length; i += 1) {
    lines.push(...serializeBlock(blocks[i], { ...ctx, mode: "top", counters, siblings: blocks, index: i }));
  }
  const collapsed = [];
  for (const line of lines) {
    if (line === "" && collapsed.length > 0 && collapsed[collapsed.length - 1] === "") continue;
    collapsed.push(line);
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") collapsed.pop();
  return collapsed.join("\n");
}
function serializeCellContent(blocks, compact) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const counters = { _prevIndent: -1 };
  const parts = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.type === "p") {
      for (const key of Object.keys(counters)) {
        if (key !== "_prevIndent") counters[key] = 0;
      }
      counters._prevIndent = -1;
    }
    parts.push(...serializeBlock(block, { mode: "cell", headerOffset: 0, counters, siblings: blocks, index: i }));
  }
  return parts.filter(Boolean).join(compact ? " " : " <br>").replace(/\n/g, " ").replace(/\|/g, "\\|");
}
function serializeBlock(node, ctx) {
  const type = node?.type || "p";
  const { mode, headerOffset = 0, counters, siblings = [], index = 0 } = ctx;
  switch (type) {
    case "p": {
      const inline = serializeInlineNodes(node.children);
      if (mode === "cell") return [inline];
      if (node.header) {
        if (!inline) return [];
        return ["#".repeat(Math.min(node.header + headerOffset, 6)) + " " + inline, ""];
      }
      return [inline, ""];
    }
    case "list": {
      const inline = serializeInlineNodes(node.children);
      if (mode === "cell") {
        const indent = node.indent || 0;
        const indentPad = "&emsp;".repeat(indent);
        if (node.value === "ordered") {
          const prev = index > 0 ? siblings[index - 1] : null;
          const prevIsListSameLevel = prev && prev.type === "list" && prev.value === "ordered" && (prev.indent || 0) === indent;
          const prevIsListChild = prev && prev.type === "list" && (prev.indent || 0) > indent;
          if (!prevIsListSameLevel && !prevIsListChild) counters[indent] = 0;
          if (indent < (counters._prevIndent ?? -1)) {
            for (const key of Object.keys(counters)) {
              if (key !== "_prevIndent" && Number(key) > indent) counters[key] = 0;
            }
          }
          counters[indent] = (counters[indent] || 0) + 1;
          counters._prevIndent = indent;
          const num = counters[indent];
          const prefix2 = indent === 0 ? `${num}.` : indent === 1 ? `${String.fromCharCode(96 + num)}.` : indent === 2 ? `${toRoman(num)}.` : `${num})`;
          return [`${indentPad}${prefix2} ${inline}`];
        }
        counters._prevIndent = node.indent || 0;
        return [`${indentPad}- ${inline}`];
      }
      const indentStr = "  ".repeat(node.indent || node.depth || 0);
      let prefix;
      if (node.checked != null || node.todoChecked != null) {
        prefix = `- [${node.checked || node.todoChecked ? "x" : " "}] `;
      } else if (node.value === "ordered") {
        const prev = index > 0 ? siblings[index - 1] : null;
        const isFirstInGroup = !prev || prev.type !== "list" || prev.value !== "ordered" || prev.orderedType === "ArabicDotArabic" && prev.header;
        counters._normal = isFirstInGroup ? 1 : (counters._normal || 0) + 1;
        prefix = `${counters._normal}. `;
      } else {
        prefix = "- ";
      }
      const next = index < siblings.length - 1 ? siblings[index + 1] : null;
      return [indentStr + prefix + inline, ...!next || next.type !== "list" ? [""] : []];
    }
    case "block-code": {
      const codeParts = [];
      for (const line of node.children || []) {
        codeParts.push(line.type === "block-code-line" ? serializeInlineNodes(line.children) : serializeInlineNodes([line]));
      }
      if (mode === "cell") return ["`" + codeParts.join("; ") + "`"];
      return ["```" + (node.lang || ""), ...codeParts, "```", ""];
    }
    case "block-quote":
      return mode === "cell" ? [`"${serializeInlineNodes(node.children)}"`] : ["> " + serializeInlineNodes(node.children), ""];
    case "table": {
      const rows = (node.children || []).filter((row) => row.type === "table-row");
      if (mode === "cell") {
        return ["<table>" + rows.map((row, rowIndex) => "<tr>" + (row.children || []).filter((cell) => cell.type === "table-cell").map((cell) => `<${rowIndex === 0 ? "th" : "td"}>${serializeCellContent(cell.children, true)}</${rowIndex === 0 ? "th" : "td"}>`).join("") + "</tr>").join("") + "</table>"];
      }
      const lines = [];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const cells = (rows[rowIndex].children || []).filter((cell) => cell.type === "table-cell").map((cell) => serializeCellContent(cell.children));
        lines.push("| " + cells.join(" | ") + " |");
        if (rowIndex === 0) lines.push("| " + cells.map(() => "---").join(" | ") + " |");
      }
      lines.push("");
      return lines;
    }
    case "divider":
      return mode === "cell" ? [] : ["---", ""];
    case "img":
      return [`![](${node.url || ""})`, ...mode === "top" ? [""] : []];
    case "docfile": {
      const v = node.value || {};
      const prefix = v.pageType === 18 ? "sheets" : v.pageType === 21 ? "table" : "pages";
      const url = v.id ? `https://joyspace.jd.com/${prefix}/${v.id}` : "";
      const title = v.title || "(untitled)";
      return [url ? `[${title}](${url})` : title, ...mode === "top" ? [""] : []];
    }
    case "attachment": {
      const v = node.value || node.data || {};
      const fileName = String(v.fileName || v.name || node.name || "\u9644\u4EF6").trim();
      const url = v.url || v.link || "";
      return [url ? `[${fileName}](${url})` : fileName, ...mode === "top" ? [""] : []];
    }
    default: {
      const inline = serializeInlineNodes(node.children);
      if (mode === "cell") return [inline || ""];
      return inline ? [inline, ""] : [""];
    }
  }
}
function contentToMarkdown(content) {
  const nodes = Array.isArray(content) ? content : [];
  const title = serializeInlineNodes(nodes[0]?.children).trim() || "untitled";
  const body = serializeBlocksToMarkdown(nodes.slice(1), { headerOffset: 1 });
  return { title, markdown: `# ${title}

${body}`.trimEnd() + "\n" };
}
async function requestJoySpaceJson2({ method, url, cookieHeader, teamHeaderId, body }) {
  const response = await fetch(`${DEFAULT_JOYSPACE_API_BASE2}${url}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "x-team-id": teamHeaderId
    },
    body: body ? JSON.stringify(body) : void 0
  });
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  if (json?.status === "success" || json?.status === "0" || json?.status === 0) {
    return json.data;
  }
  if (json?.errorCode && json.errorCode !== "0") {
    throw new Error(json.errorMsg || json.errMsg || `${url} failed`);
  }
  return json.data ?? json;
}
async function pullJoySpaceDocumentFile(options) {
  if (!options.url) throw new Error("--url is required");
  if (!options.outputDir) throw new Error("--output-dir is required");
  const pageId = extractPageId(options.url);
  const auth = await resolveAuth(options);
  const cookieHeader = buildCookieHeader(auth);
  const { teamHeaderId } = requireTenantConfig2(options.tenantCode);
  const data = await requestJoySpaceJson2({
    method: "POST",
    url: "/v1/pages/content",
    cookieHeader,
    teamHeaderId,
    body: { pageId }
  });
  if (Number(data?.pageType) !== 13) {
    throw new Error(`\u6682\u53EA\u652F\u6301 JoySpace \u666E\u901A\u6587\u6863 pageType=13\uFF0C\u5F53\u524D pageType=${data?.pageType ?? "unknown"}`);
  }
  const { title, markdown } = contentToMarkdown(data.content);
  const outputDir = import_node_path2.default.resolve(options.outputDir);
  await import_promises2.default.mkdir(outputDir, { recursive: true });
  const outputPath = await uniqueMarkdownPath(outputDir, title);
  const joyspaceUrl = `https://joyspace.jd.com/pages/${pageId}`;
  const fileContent = `---
joyspace-page-id: ${yamlString(pageId)}
joyspace-url: ${yamlString(joyspaceUrl)}
joyspace-imported-at: ${yamlString((/* @__PURE__ */ new Date()).toISOString())}
---

${markdown}`;
  await import_promises2.default.writeFile(outputPath, fileContent, "utf8");
  return { pageId, title, link: joyspaceUrl, outputPath };
}
var import_promises2, import_node_path2, DEFAULT_JOYSPACE_API_BASE2, TENANT_CONFIG2;
var init_pull_joyspace_doc = __esm({
  "src/services/pull-joyspace-doc.mjs"() {
    import_promises2 = __toESM(require("node:fs/promises"), 1);
    import_node_path2 = __toESM(require("node:path"), 1);
    init_import_markdown_doc();
    DEFAULT_JOYSPACE_API_BASE2 = "https://apijoyspace.jd.com";
    TENANT_CONFIG2 = Object.freeze({
      "CN.JD.GROUP": { teamHeaderId: "00046419" },
      "TH.JD.GROUP": { teamHeaderId: "00046420" },
      "ID.JD.GROUP": { teamHeaderId: "00046421" },
      "SF.JD.GROUP": { teamHeaderId: "00046422" }
    });
  }
});

// src/main.js
var { FileSystemAdapter, Modal, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
var { execFile: execFile2 } = require("node:child_process");
var crypto = require("node:crypto");
var { access, mkdtemp, rm, writeFile } = require("node:fs/promises");
var os = require("node:os");
var path3 = require("node:path");
var { promisify: promisify2 } = require("node:util");
var { shell } = require("electron");
var { publishMarkdownFile: publishMarkdownFile2 } = (init_import_markdown_doc(), __toCommonJS(import_markdown_doc_exports));
var { pullJoySpaceDocumentFile: pullJoySpaceDocumentFile2 } = (init_pull_joyspace_doc(), __toCommonJS(pull_joyspace_doc_exports));
var JOYSPACE_TARGET_PAGE_URL_KEY = "joyspace-target-page-url";
var resolveTargetPageUrl = (frontmatter, pluginTargetPageUrl) => {
  const documentTargetPageUrl = frontmatter?.[JOYSPACE_TARGET_PAGE_URL_KEY];
  const normalizedDocumentTargetPageUrl = typeof documentTargetPageUrl === "string" ? documentTargetPageUrl.trim() : "";
  const normalizedPluginTargetPageUrl = typeof pluginTargetPageUrl === "string" ? pluginTargetPageUrl.trim() : "";
  return normalizedDocumentTargetPageUrl || normalizedPluginTargetPageUrl;
};
var normalizeJoySpaceDocumentUrl = (value) => {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return "";
  }
  const parsedUrl = new URL(candidate);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "joyspace.jd.com") {
    throw new Error("\u4EC5\u5141\u8BB8\u4F7F\u7528 https://joyspace.jd.com \u4E0B\u7684\u6587\u6863\u94FE\u63A5");
  }
  if (!/^\/(?:pages|doc)\/[A-Za-z0-9_-]+\/?$/.test(parsedUrl.pathname)) {
    throw new Error("JoySpace \u6587\u6863\u94FE\u63A5\u8DEF\u5F84\u65E0\u6548");
  }
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString();
};
var DEFAULT_SETTINGS = {
  pythonExecutable: "",
  targetPageUrl: "",
  tenantCode: "CN.JD.GROUP",
  promoteSectionHeadings: false,
  openAfterUpload: true,
  webcliExecutable: ""
};
var execFileAsync2 = promisify2(execFile2);
module.exports = class JoySpacePublisherPlugin extends Plugin {
  /** 初始化插件命令、工具栏按钮和设置页 */
  async onload() {
    await this.loadSettings();
    void this.detectRuntimePaths();
    this.addRibbonIcon("upload-cloud", "\u53D1\u5E03/\u66F4\u65B0\u5F53\u524D\u6587\u6863\u5230 JoySpace", async () => {
      await this.publishOrUpdateActiveMarkdown();
    });
    this.addCommand({
      id: "publish-active-markdown-to-joyspace",
      name: "\u53D1\u5E03/\u66F4\u65B0\u5F53\u524D\u6587\u6863\u5230 JoySpace",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const canPublish = activeFile?.extension === "md";
        if (canPublish && !checking) {
          void this.publishOrUpdateActiveMarkdown();
        }
        return canPublish;
      }
    });
    this.addCommand({
      id: "update-active-markdown-to-joyspace",
      name: "\u66F4\u65B0\u5F53\u524D\u6587\u6863\u5230\u5DF2\u7ED1\u5B9A JoySpace \u9875\u9762",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const canUpdate = activeFile?.extension === "md";
        if (canUpdate && !checking) {
          void this.updateActiveMarkdown();
        }
        return canUpdate;
      }
    });
    this.addCommand({
      id: "pull-joyspace-document-to-current-folder",
      name: "\u4ECE JoySpace \u94FE\u63A5\u62C9\u53D6\u6587\u6863\u5230\u5F53\u524D\u76EE\u5F55",
      callback: () => {
        new JoySpacePullModal(this.app, async (url) => {
          await this.pullJoySpaceDocument(url);
        }).open();
      }
    });
    this.addSettingTab(new JoySpacePublisherSettingTab(this.app, this));
  }
  /** 从 Obsidian 数据目录加载并补齐插件配置 */
  async loadSettings() {
    const savedSettings = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
  }
  /** 持久化当前插件配置 */
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** 通过用户登录 Shell 执行 which，读取命令的实际安装位置 */
  async detectExecutable(commandName) {
    const loginShell = process.env.SHELL || "/bin/zsh";
    const { stdout } = await execFileAsync2(loginShell, ["-lic", `which ${commandName}`], {
      timeout: 15e3,
      maxBuffer: 1024 * 1024
    });
    const executablePath = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("/"));
    if (!executablePath) {
      throw new Error(`\u672A\u68C0\u6D4B\u5230 ${commandName}\uFF0C\u8BF7\u786E\u8BA4\u767B\u5F55 Shell \u4E2D\u53EF\u4EE5\u6267\u884C which ${commandName}`);
    }
    await access(executablePath);
    return executablePath;
  }
  /** 自动检测并保存 Python 与 WebCLI 的安装位置 */
  async detectRuntimePaths({ showNotice = false } = {}) {
    try {
      const pythonExecutable = await this.detectExecutable("python3");
      let webcliExecutable = this.settings.webcliExecutable;
      try {
        webcliExecutable = await this.detectExecutable("webcli");
      } catch {
        webcliExecutable = this.settings.webcliExecutable;
      }
      this.settings.pythonExecutable = pythonExecutable;
      this.settings.webcliExecutable = webcliExecutable;
      await this.saveSettings();
      if (showNotice) {
        new Notice(`\u5DF2\u68C0\u6D4B Python \u548C WebCLI\uFF1A
${pythonExecutable}
${webcliExecutable || "\u672A\u68C0\u6D4B\u5230 webcli"}`, 8e3);
      }
      return true;
    } catch (error) {
      const message = error?.message || String(error);
      console.error("[JoySpace Publisher] \u81EA\u52A8\u68C0\u6D4B\u8FD0\u884C\u73AF\u5883\u5931\u8D25\uFF1A", error);
      if (showNotice) {
        new Notice(`\u81EA\u52A8\u68C0\u6D4B Python \u5931\u8D25\uFF1A${message}`, 1e4);
      }
      return false;
    }
  }
  /** 检测指定 Python 环境是否已经安装 JoySpace 登录态读取依赖 */
  async hasBrowserCookieDependency(pythonExecutable) {
    try {
      await execFileAsync2(pythonExecutable, ["-c", "import browser_cookie3"], {
        timeout: 15e3,
        maxBuffer: 1024 * 1024
      });
      return true;
    } catch {
      return false;
    }
  }
  /** 检测 JoySpace 登录态读取所需的本地运行环境 */
  async ensureRuntimeReady({ showNotice = false } = {}) {
    const detected = await this.detectRuntimePaths({ showNotice: false });
    if (!detected) {
      if (showNotice) {
        new Notice("Python \u81EA\u52A8\u68C0\u6D4B\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4\u7EC8\u7AEF\u4E2D\u53EF\u4EE5\u6267\u884C python3", 1e4);
      }
      return false;
    }
    const pythonExecutable = this.settings.pythonExecutable.trim();
    if (!pythonExecutable) {
      if (showNotice) {
        new Notice("\u672A\u68C0\u6D4B\u5230 Python \u8DEF\u5F84\uFF0C\u8BF7\u5148\u5B89\u88C5\u5E76\u914D\u7F6E Python 3", 1e4);
      }
      return false;
    }
    const hasDependency = await this.hasBrowserCookieDependency(pythonExecutable);
    if (hasDependency) {
      if (showNotice) {
        new Notice(`\u8FD0\u884C\u73AF\u5883\u5DF2\u5C31\u7EEA\uFF1A
${pythonExecutable}`, 8e3);
      }
      return true;
    }
    if (showNotice) {
      new Notice("\u672A\u68C0\u6D4B\u5230 browser_cookie3\u3002\u8BF7\u5728\u7EC8\u7AEF\u624B\u52A8\u6267\u884C\uFF1Apython3 -m pip install --user browser_cookie3", 12e3);
    }
    return false;
  }
  stripYamlFrontmatter(markdown) {
    return String(markdown || "").replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  }
  promoteSectionHeadingsForJoySpace(markdown) {
    const lines = String(markdown || "").split("\n");
    let inFence = false;
    return lines.map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      return line.replace(/^(#{2,6})(\s+)/, (match, hashes, space) => `${hashes.slice(1)}${space}`);
    }).join("\n");
  }
  extractTitleFromMarkdown(markdown, file) {
    const heading = String(markdown || "").match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
    return heading || file.basename || "untitled";
  }
  removeFirstH1(markdown) {
    return String(markdown || "").replace(/^\s*#\s+.+?\s*\r?\n+/, "");
  }
  prepareJoySpaceMarkdown(rawMarkdown, file) {
    const markdownWithoutFrontmatter = this.stripYamlFrontmatter(rawMarkdown);
    const title = this.extractTitleFromMarkdown(markdownWithoutFrontmatter, file);
    const bodyWithoutTitle = this.removeFirstH1(markdownWithoutFrontmatter);
    const markdown = this.settings.promoteSectionHeadings ? this.promoteSectionHeadingsForJoySpace(bodyWithoutTitle) : bodyWithoutTitle;
    const normalizedMarkdown = markdown.replace(/\r\n/g, "\n").trimEnd() + "\n";
    const hash = crypto.createHash("sha256").update(normalizedMarkdown, "utf8").digest("hex");
    return { title, markdown: normalizedMarkdown, hash };
  }
  getFrontmatterValue(cache, key) {
    const value = cache?.frontmatter?.[key];
    return typeof value === "string" ? value.trim() : value ? String(value).trim() : "";
  }
  async saveJoySpaceFrontmatter(file, values) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(values)) {
        frontmatter[key] = value;
      }
    });
  }
  async publishOrUpdateActiveMarkdown() {
    const activeFile = this.app.workspace.getActiveFile();
    const cache = activeFile ? this.app.metadataCache.getFileCache(activeFile) : null;
    const pageId = this.getFrontmatterValue(cache, "joyspace-page-id");
    if (pageId) {
      await this.updateActiveMarkdown();
      return;
    }
    await this.publishActiveMarkdown();
  }
  /** 上传当前打开的 Markdown 文件并反馈执行结果 */
  async publishActiveMarkdown() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A Markdown \u6587\u6863");
      return;
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("JoySpace \u4E0A\u4F20\u4EC5\u652F\u6301 Obsidian \u684C\u9762\u7AEF\u672C\u5730\u4ED3\u5E93");
      return;
    }
    const markdownPath = adapter.getFullPath(activeFile.path);
    const pythonExecutable = this.settings.pythonExecutable.trim();
    try {
      if (pythonExecutable.includes("/")) {
        await access(pythonExecutable);
      }
    } catch {
      new Notice("Python \u53EF\u6267\u884C\u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u8BBE\u7F6E", 8e3);
      return;
    }
    const hasCookieDependency = await this.hasBrowserCookieDependency(pythonExecutable);
    if (!hasCookieDependency) {
      new Notice("\u7F3A\u5C11 browser_cookie3\u3002\u8BF7\u5728\u7EC8\u7AEF\u624B\u52A8\u6267\u884C\uFF1Apython3 -m pip install --user browser_cookie3", 12e3);
      return;
    }
    const originalMarkdown = await this.app.vault.read(activeFile);
    const prepared = this.prepareJoySpaceMarkdown(originalMarkdown, activeFile);
    const cache = this.app.metadataCache.getFileCache(activeFile);
    const targetPageUrl = resolveTargetPageUrl(cache?.frontmatter, this.settings.targetPageUrl);
    new Notice(`\u6B63\u5728\u4E0A\u4F20\u300A${activeFile.basename}\u300B\u5230 JoySpace...`);
    try {
      const result = await publishMarkdownFile2({
        filePath: markdownPath,
        pageUrl: targetPageUrl,
        tenantCode: this.settings.tenantCode,
        promoteSectionHeadings: this.settings.promoteSectionHeadings,
        pythonExecutable
      });
      if (!result.link || !result.pageId) {
        throw new Error("\u53D1\u5E03\u670D\u52A1\u672A\u8FD4\u56DE\u6709\u6548\u7684 JoySpace \u6587\u6863\u5730\u5740");
      }
      await this.saveJoySpaceFrontmatter(activeFile, {
        "joyspace-page-id": result.pageId,
        "joyspace-url": result.link,
        "joyspace-sync-hash": prepared.hash,
        "joyspace-synced-at": (/* @__PURE__ */ new Date()).toISOString()
      });
      new Notice(`\u5DF2\u4E0A\u4F20\u5230 JoySpace\uFF1A${result.title || activeFile.basename}`, 6e3);
      console.info("[JoySpace Publisher] \u4E0A\u4F20\u6210\u529F\uFF1A", result);
      if (this.settings.openAfterUpload) {
        await shell.openExternal(normalizeJoySpaceDocumentUrl(result.link));
      }
    } catch (error) {
      const message = error?.stderr?.trim() || error?.message || String(error);
      console.error("[JoySpace Publisher] \u4E0A\u4F20\u5931\u8D25\uFF1A", error);
      new Notice(`JoySpace \u4E0A\u4F20\u5931\u8D25\uFF1A${message}`, 1e4);
    }
  }
  getCurrentOutputDir(adapter) {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.parent?.path) {
      return adapter.getFullPath(activeFile.parent.path);
    }
    return adapter.getFullPath("/");
  }
  async pullJoySpaceDocument(url) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      new Notice("\u8BF7\u8F93\u5165 JoySpace \u6587\u6863\u94FE\u63A5", 5e3);
      return;
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("JoySpace \u62C9\u53D6\u4EC5\u652F\u6301 Obsidian \u684C\u9762\u7AEF\u672C\u5730\u4ED3\u5E93");
      return;
    }
    const pythonExecutable = this.settings.pythonExecutable.trim();
    try {
      if (pythonExecutable.includes("/")) {
        await access(pythonExecutable);
      }
    } catch {
      new Notice("Python \u53EF\u6267\u884C\u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u8BBE\u7F6E", 8e3);
      return;
    }
    const hasCookieDependency = await this.hasBrowserCookieDependency(pythonExecutable);
    if (!hasCookieDependency) {
      new Notice("\u7F3A\u5C11 browser_cookie3\u3002\u8BF7\u5728\u7EC8\u7AEF\u624B\u52A8\u6267\u884C\uFF1Apython3 -m pip install --user browser_cookie3", 12e3);
      return;
    }
    const outputDir = this.getCurrentOutputDir(adapter);
    new Notice("\u6B63\u5728\u4ECE JoySpace \u62C9\u53D6\u6587\u6863...");
    try {
      const result = await pullJoySpaceDocumentFile2({
        url: normalizedUrl,
        outputDir,
        tenantCode: this.settings.tenantCode,
        pythonExecutable
      });
      const vaultPath = adapter.getFullPath("/");
      const relativePath = path3.relative(vaultPath, result.outputPath).split(path3.sep).join("/");
      const createdFile = this.app.vault.getAbstractFileByPath(relativePath);
      if (createdFile) {
        await this.app.workspace.getLeaf(false).openFile(createdFile);
      }
      new Notice(`\u5DF2\u62C9\u53D6 JoySpace \u6587\u6863\uFF1A${result.title}`, 6e3);
    } catch (error) {
      const message = error?.stderr?.trim() || error?.message || String(error);
      console.error("[JoySpace Publisher] \u62C9\u53D6\u5931\u8D25\uFF1A", error);
      new Notice(`JoySpace \u62C9\u53D6\u5931\u8D25\uFF1A${message}`, 12e3);
    }
  }
  async execWebcli(args, cwd) {
    const webcliExecutable = this.settings.webcliExecutable.trim() || "webcli";
    const { stdout, stderr } = await execFileAsync2(webcliExecutable, args, {
      cwd,
      timeout: 12e4,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env
      }
    });
    if (stderr.trim()) {
      console.warn("[JoySpace Publisher] WebCLI \u8B66\u544A\uFF1A", stderr.trim());
    }
    return stdout;
  }
  parseWebcliJson(stdout) {
    const normalizedStdout = String(stdout || "").trim();
    if (!normalizedStdout) {
      return null;
    }
    try {
      return JSON.parse(normalizedStdout);
    } catch {
      throw new Error(`WebCLI \u8FD4\u56DE\u4E86\u65E0\u6548 JSON\uFF1A${normalizedStdout.slice(0, 300)}`);
    }
  }
  resolveJoySpaceUrl(cache) {
    const url = this.getFrontmatterValue(cache, "joyspace-url");
    const pageId = this.getFrontmatterValue(cache, "joyspace-page-id");
    if (url) {
      return normalizeJoySpaceDocumentUrl(url);
    }
    if (pageId) {
      return `https://joyspace.jd.com/pages/${pageId}`;
    }
    return "";
  }
  extractLastBodyBlockIndex(inspectOutput) {
    const text = typeof inspectOutput === "string" ? inspectOutput : JSON.stringify(inspectOutput || "");
    const indexes = [...text.matchAll(/\[(\d+)]/g)].map((match) => Number(match[1])).filter((index) => index > 0);
    return indexes.length ? Math.max(...indexes) : 0;
  }
  async updateActiveMarkdown() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A Markdown \u6587\u6863");
      return;
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("JoySpace \u66F4\u65B0\u4EC5\u652F\u6301 Obsidian \u684C\u9762\u7AEF\u672C\u5730\u4ED3\u5E93");
      return;
    }
    const cache = this.app.metadataCache.getFileCache(activeFile);
    const pageId = this.getFrontmatterValue(cache, "joyspace-page-id");
    let joyspaceUrl = "";
    try {
      joyspaceUrl = this.resolveJoySpaceUrl(cache);
    } catch (error) {
      const message = error?.message || String(error);
      new Notice(`JoySpace \u6587\u6863\u94FE\u63A5\u65E0\u6548\uFF1A${message}`, 8e3);
      return;
    }
    if (!pageId || !joyspaceUrl) {
      new Notice("\u5F53\u524D\u6587\u6863\u672A\u7ED1\u5B9A JoySpace \u9875\u9762\uFF0C\u8BF7\u5148\u53D1\u5E03\u4E00\u6B21", 8e3);
      return;
    }
    const originalMarkdown = await this.app.vault.read(activeFile);
    const prepared = this.prepareJoySpaceMarkdown(originalMarkdown, activeFile);
    const lastHash = this.getFrontmatterValue(cache, "joyspace-sync-hash");
    if (lastHash && lastHash === prepared.hash) {
      new Notice("\u5185\u5BB9\u65E0\u53D8\u5316\uFF0C\u65E0\u9700\u66F4\u65B0 JoySpace", 5e3);
      return;
    }
    const markdownPath = adapter.getFullPath(activeFile.path);
    const markdownDir = path3.dirname(markdownPath);
    const tempDir = await mkdtemp(path3.join(os.tmpdir(), "joyspace-publisher-"));
    const tempMarkdownPath = path3.join(tempDir, `${activeFile.basename}.md`);
    new Notice(`\u6B63\u5728\u66F4\u65B0 JoySpace\uFF1A\u300A${activeFile.basename}\u300B...`);
    try {
      await writeFile(tempMarkdownPath, prepared.markdown, "utf8");
      const inspectStdout = await this.execWebcli(["joyspace", "edit", joyspaceUrl, "--mode", "inspect", "-f", "json"], markdownDir);
      const inspectOutput = this.parseWebcliJson(inspectStdout) || inspectStdout;
      const lastBodyBlockIndex = this.extractLastBodyBlockIndex(inspectOutput);
      await this.execWebcli(
        ["joyspace", "edit", joyspaceUrl, "--mode", "write", "--content-file", tempMarkdownPath, "--position", "end", "-f", "json"],
        markdownDir
      );
      if (lastBodyBlockIndex > 0) {
        await this.execWebcli(
          ["joyspace", "edit", joyspaceUrl, "--mode", "delete", "--at", `1-${lastBodyBlockIndex}`, "-f", "json"],
          markdownDir
        );
      }
      await this.execWebcli(["joyspace", "rename", joyspaceUrl, "--name", prepared.title, "-f", "json"], markdownDir);
      const viewStdout = await this.execWebcli(["joyspace", "view", joyspaceUrl, "-f", "json"], markdownDir);
      const viewText = JSON.stringify(this.parseWebcliJson(viewStdout) || viewStdout);
      if (!viewText.includes(pageId) || !viewText.includes(prepared.title)) {
        throw new Error("\u66F4\u65B0\u540E\u56DE\u8BFB\u9A8C\u8BC1\u5931\u8D25\uFF0C\u672A\u786E\u8BA4\u9875\u9762 ID \u548C\u6807\u9898\u4E00\u81F4");
      }
      await this.saveJoySpaceFrontmatter(activeFile, {
        "joyspace-page-id": pageId,
        "joyspace-url": joyspaceUrl,
        "joyspace-sync-hash": prepared.hash,
        "joyspace-synced-at": (/* @__PURE__ */ new Date()).toISOString()
      });
      new Notice(`\u5DF2\u66F4\u65B0 JoySpace\uFF1A${prepared.title}`, 6e3);
      if (this.settings.openAfterUpload) {
        await shell.openExternal(joyspaceUrl);
      }
    } catch (error) {
      const message = error?.stderr?.trim() || error?.message || String(error);
      console.error("[JoySpace Publisher] \u66F4\u65B0\u5931\u8D25\uFF1A", error);
      new Notice(`JoySpace \u66F4\u65B0\u5931\u8D25\uFF1A${message}`, 12e3);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
};
var JoySpacePullModal = class extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.url = "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u4ECE JoySpace \u62C9\u53D6\u6587\u6863" });
    new Setting(contentEl).setName("JoySpace \u6587\u6863\u94FE\u63A5").setDesc("\u8BF7\u8F93\u5165 https://joyspace.jd.com/pages/... \u666E\u901A\u6587\u6863\u94FE\u63A5\u3002").addText((text) => {
      text.setPlaceholder("https://joyspace.jd.com/pages/...").onChange((value) => {
        this.url = value.trim();
      });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit();
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 50);
    });
    new Setting(contentEl).addButton(
      (button) => button.setButtonText("\u62C9\u53D6\u5230\u5F53\u524D\u76EE\u5F55").setCta().onClick(async () => {
        await this.submit();
      })
    ).addButton(
      (button) => button.setButtonText("\u53D6\u6D88").onClick(() => {
        this.close();
      })
    );
  }
  async submit() {
    const url = this.url.trim();
    if (!url) {
      new Notice("\u8BF7\u8F93\u5165 JoySpace \u6587\u6863\u94FE\u63A5", 5e3);
      return;
    }
    this.close();
    await this.onSubmit(url);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var JoySpacePublisherSettingTab = class extends PluginSettingTab {
  /** 保存插件实例，供设置项更新时持久化配置 */
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /** 渲染插件设置项 */
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "JoySpace Publisher" });
    new Setting(containerEl).setName("\u68C0\u6D4B\u672C\u5730\u8FD0\u884C\u73AF\u5883").setDesc("\u68C0\u6D4B Python\u3001browser_cookie3 \u548C WebCLI\u3002\u63D2\u4EF6\u4E0D\u4F1A\u5B89\u88C5\u6216\u66F4\u65B0\u4EFB\u4F55\u672C\u5730\u4F9D\u8D56\u3002").addButton(
      (button) => button.setButtonText("\u91CD\u65B0\u68C0\u6D4B\u73AF\u5883").onClick(async () => {
        const ready = await this.plugin.ensureRuntimeReady({ showNotice: true });
        if (ready) {
          this.display();
        }
      })
    );
    new Setting(containerEl).setName("Python \u53EF\u6267\u884C\u6587\u4EF6").setDesc("\u7528\u4E8E\u8BFB\u53D6\u672C\u673A\u6D4F\u89C8\u5668\u4E2D\u7684 JoySpace \u767B\u5F55\u6001\u3002browser_cookie3 \u9700\u8981\u7531\u7528\u6237\u624B\u52A8\u5B89\u88C5\u3002").addText(
      (text) => text.setPlaceholder("\u81EA\u52A8\u68C0\u6D4B\u4E2D").setValue(this.plugin.settings.pythonExecutable).onChange(async (value) => {
        this.plugin.settings.pythonExecutable = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName("WebCLI \u53EF\u6267\u884C\u6587\u4EF6").setDesc("\u7528\u4E8E\u66F4\u65B0\u5DF2\u7ED1\u5B9A\u7684 JoySpace \u9875\u9762\u3002\u63D2\u4EF6\u542F\u7528\u65F6\u901A\u8FC7 which webcli \u81EA\u52A8\u586B\u5199\uFF0C\u4E5F\u53EF\u4EE5\u624B\u52A8\u4FEE\u6539\u3002").addText(
      (text) => text.setPlaceholder("webcli").setValue(this.plugin.settings.webcliExecutable).onChange(async (value) => {
        this.plugin.settings.webcliExecutable = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName("\u76EE\u6807 JoySpace \u9875\u9762").setDesc("\u53EF\u9009\u3002\u4E0A\u4F20\u6587\u6863\u4F1A\u521B\u5EFA\u5728\u8BE5\u9875\u9762\u6240\u5728\u76EE\u5F55\uFF1B\u7559\u7A7A\u5219\u521B\u5EFA\u5728\u79C1\u4EBA\u7A7A\u95F4\u6839\u76EE\u5F55\u3002").addText(
      (text) => text.setPlaceholder("https://joyspace.jd.com/pages/...").setValue(this.plugin.settings.targetPageUrl).onChange(async (value) => {
        this.plugin.settings.targetPageUrl = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName("\u79DF\u6237\u7F16\u7801").setDesc("\u9ED8\u8BA4\u4F7F\u7528\u4E2D\u56FD\u5927\u9646\u4EAC\u4E1C\u96C6\u56E2\u79DF\u6237\u3002").addDropdown(
      (dropdown) => dropdown.addOption("CN.JD.GROUP", "CN.JD.GROUP").addOption("TH.JD.GROUP", "TH.JD.GROUP").addOption("ID.JD.GROUP", "ID.JD.GROUP").addOption("SF.JD.GROUP", "SF.JD.GROUP").setValue(this.plugin.settings.tenantCode).onChange(async (value) => {
        this.plugin.settings.tenantCode = value;
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName("\u63D0\u5347\u7AE0\u8282\u6807\u9898\u5C42\u7EA7").setDesc("\u4E0A\u4F20\u65F6\u5C06 ## \u8F6C\u4E3A #\u3001### \u8F6C\u4E3A ##\uFF0C\u4E0D\u4F1A\u4FEE\u6539\u672C\u5730 Markdown\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.promoteSectionHeadings).onChange(async (value) => {
        this.plugin.settings.promoteSectionHeadings = value;
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName("\u53D1\u5E03\u6216\u66F4\u65B0\u540E\u6253\u5F00 JoySpace").setDesc("\u53D1\u5E03\u6216\u66F4\u65B0\u6210\u529F\u540E\u4F7F\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u6253\u5F00 JoySpace \u6587\u6863\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.openAfterUpload).onChange(async (value) => {
        this.plugin.settings.openAfterUpload = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
