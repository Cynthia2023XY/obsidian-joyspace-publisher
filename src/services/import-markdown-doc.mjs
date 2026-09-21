import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
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

export function removeFirstH1(markdown) {
  return String(markdown || "").replace(/^\s*#\s+.+?\s*\r?\n+/, "");
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

/** 统一 JoySpace 页面基础信息中的团队和目录字段 */
export function normalizeLocationFromBasicInfo({ team_id, folder_id, teamId, folderId }) {
  /** 兼容 JoySpace 基础信息可能返回的驼峰团队字段 */
  const sourceTeamId = team_id ?? teamId;
  /** 兼容 JoySpace 基础信息可能返回的驼峰目录字段 */
  const sourceFolderId = folder_id ?? folderId;
  /** 用于创建文档的规范化团队 ID */
  const normalizedTeamId =
    typeof sourceTeamId === "string" && sourceTeamId.trim().startsWith("$")
      ? "root"
      : sourceTeamId?.trim();
  /** 用于创建文档的规范化目录 ID */
  const normalizedFolderId = sourceFolderId?.trim() || undefined;

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

/** 从用户本机浏览器读取 JoySpace 请求所需登录态 */
async function resolveAuth({ pythonExecutable } = {}) {
  /** 指定 Python 环境读取到的浏览器 Cookie 结果 */
  const browserCookies = await loadJdCookiesFromBrowser({ pythonCommand: pythonExecutable || process.env.PYTHON || "python3" });
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
  if (
    json?.status === "failed" ||
    json?.errCode ||
    (json?.errorCode && json.errorCode !== "0") ||
    (json?.code != null && json.code !== 0 && json.code !== "0")
  ) {
    /** JoySpace 业务失败时返回的错误码 */
    const errorCode = json.errCode || json.errorCode || json.code || "unknown";
    /** JoySpace 业务失败时返回的可读错误信息 */
    const errorMessage =
      json.errMsg ||
      json.errorMsg ||
      json.msg ||
      json.message ||
      json.error ||
      "Unknown API error";
    throw new Error(`JoySpace API error ${errorCode}: ${errorMessage} (${url})`);
  }
  if (json?.status === "success" || json?.status === "0" || json?.status === 0) {
    return json.data;
  }
  return json.data ?? json;
}

/** 从 JoySpace 团队或目录链接中提取新文档的直接存放位置 */
export function extractTeamFolderFromUrl(pageUrl) {
  /** 团队链接中的团队 ID 与可选目录 ID 匹配结果 */
  const match = pageUrl.match(
    /joyspace\.jd\.com\/teams\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?/i,
  );
  if (!match?.[1]) {
    return null;
  }
  return {
    teamId: match[1],
    folderId: match[2] || undefined,
  };
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

  /** 直接从团队或目录链接解析出的存放位置 */
  const teamFolder = extractTeamFolderFromUrl(pageUrl);
  if (teamFolder) {
    return {
      ...teamFolder,
      source: pageUrl,
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

/** 统一 JoySpace 创建接口的多种返回字段，避免创建成功后丢失页面地址 */
export function normalizeCreatedPageResponse(createResponse) {
  /** JoySpace 创建接口返回的文档数据 */
  const created = createResponse && typeof createResponse === "object" ? createResponse : {};
  /** 同时兼容新旧接口的文档 ID 字段 */
  const pageId = String(created.id || created.pageId || "").trim();
  if (!pageId) {
    /** 用于排查接口升级的创建响应字段列表 */
    const responseKeys = Object.keys(created).join(", ") || "empty response";
    throw new Error(`JoySpace 创建接口未返回 id/pageId，响应字段：${responseKeys}`);
  }

  return {
    created,
    pageId,
    link: created.link || `https://joyspace.jd.com/pages/${pageId}`,
  };
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

/** 使用已解析的选项创建并验证 JoySpace 页面 */
async function publishMarkdownFile(options) {
  if (!options.filePath) {
    throw new Error("--file is required");
  }

  const originalMarkdown = await fs.readFile(options.filePath, "utf8");
  /** 去除文档属性后的待上传正文，避免 Obsidian 元数据出现在 JoySpace 页面中 */
  const markdownWithoutFrontmatter = stripYamlFrontmatter(originalMarkdown);
  const title = options.title || extractTitleFromMarkdown(markdownWithoutFrontmatter, options.filePath);
  const bodyWithoutTitle = removeFirstH1(markdownWithoutFrontmatter);
  const markdown = options.promoteSectionHeadings
    ? promoteSectionHeadingsForJoySpace(bodyWithoutTitle)
    : bodyWithoutTitle;
  const auth = await resolveAuth(options);
  const { teamHeaderId } = requireTenantConfig(options.tenantCode);
  const cookieHeader = buildCookieHeader(auth);
  const location = await resolveTargetLocation({
    pageUrl: options.pageUrl,
    cookieHeader,
    teamHeaderId,
  });

  /** JoySpace 创建接口的原始文档数据 */
  const createResponse = await createJoySpacePage({
    markdown,
    title,
    location,
    cookieHeader,
    teamHeaderId,
  });
  /** 兼容 id/pageId 后的新建 JoySpace 文档信息 */
  const createdPage = normalizeCreatedPageResponse(createResponse);
  /** JoySpace 创建接口返回的原始字段 */
  const created = createdPage.created;
  const verified = await verifyJoySpacePage({
    pageId: createdPage.pageId,
    cookieHeader,
    teamHeaderId,
  });

  return {
    authMode: auth.mode,
    cookieSource: auth.cookieSource || undefined,
    pageId: createdPage.pageId,
    title: created.title || title,
    link: createdPage.link,
    teamId: created.team_id || created.teamId || location.teamId,
    folderId: created.folder_id || created.folderId || location.folderId || "",
    locationSource: location.source,
    promotedSectionHeadings: options.promoteSectionHeadings,
    verified: Array.isArray(verified?.content) && verified.content.length > 0,
  };
}

export { publishMarkdownFile, resolveAuth };
