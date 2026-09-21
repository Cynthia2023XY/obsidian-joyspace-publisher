import fs from "node:fs/promises";
import path from "node:path";
import { buildCookieHeader, resolveAuth } from "./import-markdown-doc.mjs";

const DEFAULT_JOYSPACE_API_BASE = "https://apijoyspace.jd.com";
const DEFAULT_TENANT_CODE = "CN.JD.GROUP";
const TENANT_CONFIG = Object.freeze({
  "CN.JD.GROUP": { teamHeaderId: "00046419" },
  "TH.JD.GROUP": { teamHeaderId: "00046420" },
  "ID.JD.GROUP": { teamHeaderId: "00046421" },
  "SF.JD.GROUP": { teamHeaderId: "00046422" },
});

function requireTenantConfig(tenantCode) {
  const config = TENANT_CONFIG[tenantCode];
  if (!config) {
    throw new Error(`Unsupported tenantCode "${tenantCode}". Expected one of ${Object.keys(TENANT_CONFIG).join(", ")}`);
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
  return String(title || "untitled")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "untitled";
}

async function uniqueMarkdownPath(outputDir, title) {
  const baseName = safeFileName(title);
  let filePath = path.join(outputDir, `${baseName}.md`);
  for (let index = 1; ; index += 1) {
    try {
      await fs.access(filePath);
      filePath = path.join(outputDir, `${baseName} (${index}).md`);
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
          const prefix = indent === 0 ? `${num}.` : indent === 1 ? `${String.fromCharCode(96 + num)}.` : indent === 2 ? `${toRoman(num)}.` : `${num})`;
          return [`${indentPad}${prefix} ${inline}`];
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
        const isFirstInGroup = !prev || prev.type !== "list" || prev.value !== "ordered" || (prev.orderedType === "ArabicDotArabic" && prev.header);
        counters._normal = isFirstInGroup ? 1 : (counters._normal || 0) + 1;
        prefix = `${counters._normal}. `;
      } else {
        prefix = "- ";
      }
      const next = index < siblings.length - 1 ? siblings[index + 1] : null;
      return [indentStr + prefix + inline, ...(!next || next.type !== "list" ? [""] : [])];
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
      return [`![](${node.url || ""})`, ...(mode === "top" ? [""] : [])];
    case "docfile": {
      const v = node.value || {};
      const prefix = v.pageType === 18 ? "sheets" : v.pageType === 21 ? "table" : "pages";
      const url = v.id ? `https://joyspace.jd.com/${prefix}/${v.id}` : "";
      const title = v.title || "(untitled)";
      return [url ? `[${title}](${url})` : title, ...(mode === "top" ? [""] : [])];
    }
    case "attachment": {
      const v = node.value || node.data || {};
      const fileName = String(v.fileName || v.name || node.name || "附件").trim();
      const url = v.url || v.link || "";
      return [url ? `[${fileName}](${url})` : fileName, ...(mode === "top" ? [""] : [])];
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
  return { title, markdown: `# ${title}\n\n${body}`.trimEnd() + "\n" };
}

async function requestJoySpaceJson({ method, url, cookieHeader, teamHeaderId, body }) {
  const response = await fetch(`${DEFAULT_JOYSPACE_API_BASE}${url}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "x-team-id": teamHeaderId,
    },
    body: body ? JSON.stringify(body) : undefined,
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

function parseArgs(argv) {
  const options = {
    url: "",
    outputDir: "",
    tenantCode: process.env.JMECHAT_TENANT_CODE || process.env.JMECHAT_tenantCode || DEFAULT_TENANT_CODE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--url") {
      options.url = next || "";
      index += 1;
    } else if (current === "--output-dir") {
      options.outputDir = next || "";
      index += 1;
    } else if (current === "--tenant-code") {
      options.tenantCode = next || options.tenantCode;
      index += 1;
    }
  }
  return options;
}

/** 拉取 JoySpace 普通文档并写入指定目录 */
async function pullJoySpaceDocumentFile(options) {
  if (!options.url) throw new Error("--url is required");
  if (!options.outputDir) throw new Error("--output-dir is required");
  const pageId = extractPageId(options.url);
  const auth = await resolveAuth(options);
  const cookieHeader = buildCookieHeader(auth);
  const { teamHeaderId } = requireTenantConfig(options.tenantCode);
  const data = await requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages/content",
    cookieHeader,
    teamHeaderId,
    body: { pageId },
  });
  if (Number(data?.pageType) !== 13) {
    throw new Error(`暂只支持 JoySpace 普通文档 pageType=13，当前 pageType=${data?.pageType ?? "unknown"}`);
  }
  const { title, markdown } = contentToMarkdown(data.content);
  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = await uniqueMarkdownPath(outputDir, title);
  const joyspaceUrl = `https://joyspace.jd.com/pages/${pageId}`;
  const fileContent = `---\njoyspace-page-id: ${yamlString(pageId)}\njoyspace-url: ${yamlString(joyspaceUrl)}\njoyspace-imported-at: ${yamlString(new Date().toISOString())}\n---\n\n${markdown}`;
  await fs.writeFile(outputPath, fileContent, "utf8");
  return { pageId, title, link: joyspaceUrl, outputPath };
}

export { contentToMarkdown, extractPageId, pullJoySpaceDocumentFile };
