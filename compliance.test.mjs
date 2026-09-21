import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** 读取插件主源码用于验证发布合规约束 */
const readMainSource = () => readFile(new URL("./src/main.js", import.meta.url), "utf8");

/** 验证插件源码不会调用 pip 安装 Python 依赖 */
test("缺少 browser_cookie3 时只提示用户手动安装", async () => {
  /** 当前插件入口源码 */
  const source = await readMainSource();

  assert.doesNotMatch(source, /execFileAsync\([^\n]+\[\s*["']-m["']\s*,\s*["']pip["']\s*,\s*["']install["']/s);
  assert.doesNotMatch(source, /installBrowserCookieDependency/);
  assert.match(source, /插件不会安装或更新任何本地依赖/);
});

/** 验证生产入口调用的是被打包模块而不是插件目录中的额外脚本 */
test("生产运行时不解析额外发布脚本路径", async () => {
  /** 当前插件入口源码 */
  const source = await readMainSource();

  assert.doesNotMatch(source, /resolveImportScriptPath|resolvePullScriptPath|resolvePluginFilePath/);
  assert.match(source, /publishMarkdownFile/);
  assert.match(source, /pullJoySpaceDocumentFile/);
});

/** 验证 JoySpace 认证请求不会使用会过滤 Cookie 头的渲染进程 fetch */
test("JoySpace API 统一使用 Node HTTPS 客户端", async () => {
  /** 发布服务源码 */
  const publishSource = await readFile(new URL("./src/services/import-markdown-doc.mjs", import.meta.url), "utf8");
  /** 拉取服务源码 */
  const pullSource = await readFile(new URL("./src/services/pull-joyspace-doc.mjs", import.meta.url), "utf8");
  /** Node HTTPS 基础设施源码 */
  const httpSource = await readFile(new URL("./src/infrastructure/joyspace-http.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(publishSource, /\bfetch\s*\(/);
  assert.doesNotMatch(pullSource, /\bfetch\s*\(/);
  assert.match(httpSource, /node:https/);
  assert.match(httpSource, /Cookie: cookieHeader/);
});
