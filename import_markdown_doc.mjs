import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const DEFAULT_JOYSPACE_API_BASE = "https://apijoyspace.jd.com";
const DEFAULT_TENANT_CODE = "CN.JD.GROUP";

const TENANT_CONFIG = Object.freeze({
  "CN.JD.GROUP": { teamHeaderId: "00046419", ddAppId: "ee" },
  "TH.JD.GROUP": { teamHeaderId: "00046420", ddAppId: "th.ee" },
  "ID.JD.GROUP": { teamHeaderId: "00046421", ddAppId: "id.ee" },
  "SF.JD.GROUP": { teamHeaderId: "00046422", ddAppId: "sf.ee" },
});
const execFileAsync = promisify(execFile);
const BROWSER_COOKIE3_SCRIPT = String.raw`
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

function requireTenantConfig(tenantCode) {
  const config = TENANT_CONFIG[tenantCode];
  if (!config) {
    throw new Error(
      `Unsupported tenantCode "${tenantCode}". Expected one of ${Object.keys(TENANT_CONFIG).join(", ")}`,
    );
  }
  return config;
}

export function normalizeCookieMap(cookies) {
  if (!cookies || typeof cookies !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(cookies)
      .map(([name, value]) => [String(name || "").trim(), String(value || "").trim()])
      .filter(([name, value]) => name && value),
  );
}

export function buildCookieHeader({ cookies = null, cookieHeader = "" }) {
  if (cookieHeader) {
    return cookieHeader;
  }
  const cookieMap = normalizeCookieMap(cookies);
  return Object.entries(cookieMap)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function formatErrorWithCause(error) {
  const message = error?.message || String(error);
  const cause = error?.cause?.message || error?.cause;
  return cause ? `${message} (${cause})` : message;
}

export function normalizeBrowserCookiePayload(payload) {
  if (!payload || typeof payload !== "object" || payload.ok !== true) {
    return {
      cookies: {},
      source: "",
      error: payload?.error || "browser cookie payload not ok",
    };
  }
  const cookies = normalizeCookieMap(payload.cookies);
  if (Object.keys(cookies).length === 0) {
    return {
      cookies: {},
      source: payload.source || "",
      error: "browser cookie payload has no usable cookies",
    };
  }
  return {
    cookies,
    source: String(payload.source || "browser"),
    error: "",
  };
}

export async function loadJdCookiesFromBrowser({ pythonCommand = process.env.PYTHON || "python3" } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      pythonCommand,
      ["-c", BROWSER_COOKIE3_SCRIPT],
      {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      },
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
      error: `browser_cookie3 lookup failed: ${formatErrorWithCause(error)}`,
    };
  }
}

export function extractTitleFromMarkdown(markdown, filePath) {
  const heading = markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  const stem = path.basename(filePath || "untitled.md", path.extname(filePath || "untitled.md"));
  return stem || "untitled";
}

/** 移除文档开头的 Obsidian/YAML 属性块，避免内部属性被同步到 JoySpace 正文 */
export function stripYamlFrontmatter(markdown) {
  /** 当前待上传的 Markdown 原文 */
  const text = String(markdown || "");
  return text.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
}

export function promoteSectionHeadingsForJoySpace(markdown) {
  const lines = String(markdown || "").split("\n");
  let inFence = false;

  return lines
    .map((line) => {
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
    })
    .join("\n");
}

export function normalizeLocationFromBasicInfo({ team_id, folder_id }) {
  const normalizedTeamId =
    typeof team_id === "string" && team_id.trim().startsWith("$") ? "root" : team_id?.trim();
  const normalizedFolderId = folder_id?.trim() || undefined;

  return {
    teamId: normalizedTeamId || "root",
    folderId: normalizedFolderId,
  };
}

export function buildCreatePagePayload({ title, markdown, teamId, folderId }) {
  const payload = {
    title,
    page_type: 13,
    teamId,
    content: [{ value: markdown }],
    contentType: "markdown",
  };

  if (folderId) {
    payload.folderId = folderId;
  }

  return payload;
}

async function resolveAuth() {
  const browserCookies = await loadJdCookiesFromBrowser();
  if (Object.keys(browserCookies.cookies).length > 0) {
    return {
      mode: "browser",
      cookieSource: browserCookies.source,
      cookies: browserCookies.cookies,
    };
  }

  throw new Error(
    `Unable to resolve JoySpace auth from browser cookies. ${browserCookies.error || "No jd.com cookies found in supported browsers"}. Please install browser_cookie3 and login to joyspace.jd.com / jd.com in Chrome, then retry.`,
  );
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

function extractPageIdFromUrl(pageUrl) {
  const match = pageUrl.match(
    /joyspace\.jd\.com\/(?:pages|doc|sheets?|table|ppt|board|mind|meeting)\/([A-Za-z0-9_-]+)/i,
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
      folderId: undefined,
      source: "private-space-root",
    };
  }

  const pageId = extractPageIdFromUrl(pageUrl);
  const basicInfo = await requestJoySpaceJson({
    method: "GET",
    url: `/v3/pages/${pageId}/basic?sendRecent=0`,
    cookieHeader,
    teamHeaderId,
  });

  const normalized = normalizeLocationFromBasicInfo(basicInfo || {});
  return {
    ...normalized,
    source: pageUrl,
  };
}

async function createJoySpacePage({ markdown, title, location, cookieHeader, teamHeaderId }) {
  const payload = buildCreatePagePayload({
    title,
    markdown,
    teamId: location.teamId,
    folderId: location.folderId,
  });

  return requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages",
    cookieHeader,
    teamHeaderId,
    body: payload,
  });
}

async function verifyJoySpacePage({ pageId, cookieHeader, teamHeaderId }) {
  return requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages/content",
    cookieHeader,
    teamHeaderId,
    body: { pageId },
  });
}

function parseArgs(argv) {
  const options = {
    filePath: "",
    title: "",
    pageUrl: "",
    teamId: "",
    folderId: "",
    promoteSectionHeadings: false,
    tenantCode:
      process.env.JMECHAT_TENANT_CODE ||
      process.env.JMECHAT_tenantCode ||
      DEFAULT_TENANT_CODE,
  };
  const removedAuthOptions = new Set(["--device-id", "--startup-token", "--config"]);

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (removedAuthOptions.has(current)) {
      throw new Error(
        `当前脚本统一使用 relay-d2c-b 的浏览器 cookie 方式，不再支持认证参数: ${current}`,
      );
    }
    switch (current) {
      case "--promote-section-headings":
        options.promoteSectionHeadings = true;
        break;
      case "--file":
        options.filePath = next || "";
        index += 1;
        break;
      case "--title":
        options.title = next || "";
        index += 1;
        break;
      case "--page-url":
        options.pageUrl = next || "";
        index += 1;
        break;
      case "--tenant-code":
        options.tenantCode = next || options.tenantCode;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.filePath) {
    throw new Error("--file is required");
  }

  const originalMarkdown = await fs.readFile(options.filePath, "utf8");
  /** 去除文档属性后的待上传正文，避免 Obsidian 元数据出现在 JoySpace 页面中 */
  const markdownWithoutFrontmatter = stripYamlFrontmatter(originalMarkdown);
  const title = options.title || extractTitleFromMarkdown(markdownWithoutFrontmatter, options.filePath);
  const markdown = options.promoteSectionHeadings
    ? promoteSectionHeadingsForJoySpace(markdownWithoutFrontmatter)
    : markdownWithoutFrontmatter;
  const auth = await resolveAuth(options);
  const { teamHeaderId } = requireTenantConfig(options.tenantCode);
  const cookieHeader = buildCookieHeader(auth);
  const location = await resolveTargetLocation({
    pageUrl: options.pageUrl,
    cookieHeader,
    teamHeaderId,
  });

  const created = await createJoySpacePage({
    markdown,
    title,
    location,
    cookieHeader,
    teamHeaderId,
  });
  const verified = await verifyJoySpacePage({
    pageId: created.id,
    cookieHeader,
    teamHeaderId,
  });

  console.log(
    JSON.stringify(
      {
        authMode: auth.mode,
        cookieSource: auth.cookieSource || undefined,
        pageId: created.id,
        title: created.title || title,
        link: created.link || `https://joyspace.jd.com/pages/${created.id}`,
        teamId: created.team_id || location.teamId,
        folderId: created.folder_id || location.folderId || "",
        locationSource: location.source,
        promotedSectionHeadings: options.promoteSectionHeadings,
        verified: Array.isArray(verified?.content) && verified.content.length > 0,
      },
      null,
      2,
    ),
  );
}

/** 当前模块经过 Node 解析后的真实文件路径，用于兼容软链接插件目录 */
const currentModuleRealPath = realpathSync(fileURLToPath(import.meta.url));
/** 命令行入口脚本经过真实路径解析后的文件路径，用于判断当前模块是否为直接执行入口 */
const invokedScriptRealPath = process.argv[1] ? realpathSync(path.resolve(process.argv[1])) : "";
/** 当前脚本是否由命令行直接执行，用于避免被测试导入时触发上传流程 */
const isDirectCliInvocation = invokedScriptRealPath === currentModuleRealPath;

if (isDirectCliInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { resolveAuth };
