#!/usr/bin/env node

/**
 * set_table_autofit.mjs
 *
 * 将 Joyspace 页面中所有表格的列宽设置为自适应（auto）。
 *
 * 实现原理：
 * 1. 通过 GET /v3/pages/<id>/basic 获取页面元信息（标题、位置）
 * 2. 通过 POST /v1/pages/content 获取页面完整内容（richtext blocks）
 * 3. 遍历 content 中 type=table 的 block，将其 width 数组每项改为 "auto"
 * 4. 通过 POST /v1/pages 以 richtext 格式重新创建页面
 * 5. 通过 DELETE /v1/pages/<id> 删除旧页面
 *
 * 用法：
 *   node set_table_autofit.mjs --page-url https://joyspace.jd.com/pages/<pageId>
 *   node set_table_autofit.mjs --page-url https://joyspace.jd.com/pages/<pageId> --tenant-code CN.JD.GROUP
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

// ---------- Constants ----------

/** @type {string} JoySpace API 基地址 */
const DEFAULT_JOYSPACE_API_BASE = "https://apijoyspace.jd.com";

/** @type {string} 默认租户代码 */
const DEFAULT_TENANT_CODE = "CN.JD.GROUP";

/** @type {Record<string, { teamHeaderId: string }>} 租户配置映射 */
const TENANT_CONFIG = Object.freeze({
  "CN.JD.GROUP": { teamHeaderId: "00046419" },
  "TH.JD.GROUP": { teamHeaderId: "00046420" },
  "ID.JD.GROUP": { teamHeaderId: "00046421" },
  "SF.JD.GROUP": { teamHeaderId: "00046422" },
});

const execFileAsync = promisify(execFile);

// ---------- Auth helpers (reuse from import_markdown_doc.js) ----------

/**
 * Python browser_cookie3 脚本，用于从浏览器中提取 jd.com 的 cookie。
 * 与 import_markdown_doc.js 中的认证逻辑完全一致。
 * @type {string}
 */
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

// ---------- Cookie utilities ----------

/**
 * 规范化 cookie map，去除空键空值
 * @param {Record<string, string>} cookies - 原始 cookie 对象
 * @returns {Record<string, string>} 规范化后的 cookie 对象
 */
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

/**
 * 从浏览器 cookie 中加载 jd.com 的认证信息
 * @param {{ pythonCommand?: string }} options - 可选的 Python 命令路径
 * @returns {Promise<{ cookies: Record<string, string>, source: string, error: string }>}
 */
export async function loadJdCookiesFromBrowser({ pythonCommand = process.env.PYTHON || "python3" } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      pythonCommand,
      ["-c", BROWSER_COOKIE3_SCRIPT],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout || "{}");
    if (!parsed || parsed.ok !== true) {
      return { cookies: {}, source: "", error: parsed?.error || "browser cookie payload not ok" };
    }
    const cookies = normalizeCookieMap(parsed.cookies);
    if (Object.keys(cookies).length === 0) {
      return { cookies: {}, source: parsed.source || "", error: "browser cookie payload has no usable cookies" };
    }
    return { cookies, source: String(parsed.source || "browser"), error: "" };
  } catch (error) {
    const message = error?.message || String(error);
    const cause = error?.cause?.message || error?.cause;
    return {
      cookies: {},
      source: "",
      error: `browser_cookie3 lookup failed: ${cause ? `${message} (${cause})` : message}`,
    };
  }
}

/**
 * 构建 Cookie 请求头
 * @param {Record<string, string>} cookies - cookie 对象
 * @returns {string} 格式化的 Cookie 头字符串
 */
export function buildCookieHeader(cookies) {
  const cookieMap = normalizeCookieMap(cookies);
  return Object.entries(cookieMap)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/**
 * 校验 tenantCode 并返回对应配置
 * @param {string} tenantCode - 租户代码
 * @returns {{ teamHeaderId: string }} 租户配置
 */
export function requireTenantConfig(tenantCode) {
  const config = TENANT_CONFIG[tenantCode];
  if (!config) {
    throw new Error(
      `Unsupported tenantCode "${tenantCode}". Expected one of ${Object.keys(TENANT_CONFIG).join(", ")}`,
    );
  }
  return config;
}

// ---------- JoySpace API helpers ----------

/**
 * 通用 JoySpace API 请求
 * @param {{ method: string, url: string, cookieHeader: string, teamHeaderId: string, body?: object }} params
 * @returns {Promise<any>} 解析后的 API 响应 data
 */
export async function requestJoySpaceJson({ method, url, cookieHeader, teamHeaderId, body }) {
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

/**
 * 从 Joyspace URL 中提取 pageId
 * @param {string} pageUrl - Joyspace 页面 URL
 * @returns {string} 提取的 pageId
 */
export function extractPageIdFromUrl(pageUrl) {
  const match = pageUrl.match(
    /joyspace\.jd\.com\/(?:pages|doc|sheets?|table|ppt|board|mind|meeting)\/([A-Za-z0-9_-]+)/i,
  );
  if (!match?.[1]) {
    throw new Error(`Unable to extract JoySpace page id from URL: ${pageUrl}`);
  }
  return match[1];
}

/**
 * 规范化 team_id：私有空间 team_id 以 $ 开头的转为 root
 * @param {string|undefined} teamId - 原始 team_id
 * @returns {string} 规范化后的 teamId
 */
export function normalizeTeamId(teamId) {
  return typeof teamId === "string" && teamId.trim().startsWith("$") ? "root" : teamId?.trim() || "root";
}

// ---------- Core: set table auto-fit ----------

/**
 * 递归深拷贝对象（用于复制 content blocks）
 * @param {any} obj - 需要深拷贝的对象
 * @returns {any} 深拷贝后的新对象
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 将 content 中所有表格的 width 设置为自适应（auto）
 * @param {Array<object>} content - Joyspace 页面 content blocks
 * @returns {{ modifiedContent: Array<object>, tableCount: number, details: Array<{ id: string, oldWidth: Array, newWidth: Array<string> }> }}
 */
export function applyTableAutoFit(content) {
  const modifiedContent = deepClone(content);
  const details = [];

  for (const block of modifiedContent) {
    if (block.type === "table" && Array.isArray(block.width)) {
      const oldWidth = [...block.width];
      block.width = oldWidth.map(() => "auto");
      details.push({
        id: block.id,
        oldWidth,
        newWidth: [...block.width],
      });
    }
  }

  return { modifiedContent, tableCount: details.length, details };
}

// ---------- Main flow ----------

/**
 * 主流程：获取页面内容 → 修改表格列宽 → 重新创建页面 → 删除旧页面
 * @param {{ pageUrl: string, tenantCode?: string }} options - 参数选项
 * @returns {Promise<object>} 操作结果 JSON
 */
async function setTableAutoFit({ pageUrl, tenantCode }) {
  const { teamHeaderId } = requireTenantConfig(tenantCode);

  // 1. 认证：从浏览器 cookie 获取 JoySpace 认证
  const browserCookies = await loadJdCookiesFromBrowser();
  if (!Object.keys(browserCookies.cookies).length) {
    throw new Error(
      `Unable to resolve JoySpace auth: ${browserCookies.error || "No jd.com cookies found"}. Please install browser_cookie3 and login to joyspace.jd.com / jd.com in Chrome.`,
    );
  }
  const cookieHeader = buildCookieHeader(browserCookies.cookies);

  // 2. 提取 pageId
  const pageId = extractPageIdFromUrl(pageUrl);

  // 3. 获取页面基本信息（标题、位置）
  const basicInfo = await requestJoySpaceJson({
    method: "GET",
    url: `/v3/pages/${pageId}/basic?sendRecent=0`,
    cookieHeader,
    teamHeaderId,
  });

  const title = basicInfo?.title || "";
  const teamId = normalizeTeamId(basicInfo?.team_id);
  const folderId = basicInfo?.folder_id?.trim() || undefined;

  // 4. 获取页面完整内容
  const contentData = await requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages/content",
    cookieHeader,
    teamHeaderId,
    body: { pageId },
  });

  const content = contentData?.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(`Page ${pageId} has no content or content is empty`);
  }

  // 5. 修改所有表格列宽为 auto
  const { modifiedContent, tableCount, details } = applyTableAutoFit(content);

  // 如果页面中没有表格，直接返回当前页面信息不做修改
  if (tableCount === 0) {
    return {
      success: true,
      oldPageId: pageId,
      newPageId: pageId,
      link: `https://joyspace.jd.com/pages/${pageId}`,
      title,
      teamId,
      folderId: folderId || "",
      tableCount: 0,
      details: [],
      recreated: false,
      oldDeleted: false,
      authMode: "browser",
      cookieSource: browserCookies.source,
    };
  }

  // 6. 以 richtext 格式创建新页面
  const createPayload = {
    title,
    page_type: 13,
    teamId,
    content: modifiedContent,
    contentType: "richtext",
  };
  if (folderId) {
    createPayload.folderId = folderId;
  }

  const created = await requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages",
    cookieHeader,
    teamHeaderId,
    body: createPayload,
  });

  const newPageId = created?.id;
  const newLink = created?.link || `https://joyspace.jd.com/pages/${newPageId}`;

  // 7. 删除旧页面（失败不阻塞流程）
  let oldDeleted = false;
  try {
    await requestJoySpaceJson({
      method: "DELETE",
      url: `/v1/pages/${pageId}`,
      cookieHeader,
      teamHeaderId,
    });
    oldDeleted = true;
  } catch (_deleteError) {
    // 旧页面删除失败不阻塞流程，可手动删除
    oldDeleted = false;
  }

  return {
    success: true,
    oldPageId: pageId,
    newPageId,
    link: newLink,
    title,
    teamId,
    folderId: folderId || "",
    tableCount,
    details,
    recreated: true,
    oldDeleted,
    authMode: "browser",
    cookieSource: browserCookies.source,
  };
}

// ---------- CLI ----------

/**
 * 解析命令行参数
 * @param {string[]} argv - 命令行参数数组
 * @returns {{ pageUrl: string, tenantCode: string }} 解析后的选项
 */
function parseArgs(argv) {
  const options = {
    pageUrl: "",
    tenantCode: process.env.JMECHAT_TENANT_CODE || process.env.JMECHAT_tenantCode || DEFAULT_TENANT_CODE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
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

/**
 * CLI 入口函数
 * @returns {Promise<void>}
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.pageUrl) {
    throw new Error("--page-url is required. Usage: node set_table_autofit.mjs --page-url https://joyspace.jd.com/pages/<pageId>");
  }

  const result = await setTableAutoFit(options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}


