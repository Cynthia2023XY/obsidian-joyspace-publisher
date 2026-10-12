/** 插件编排测试断言能力 */
import assert from "node:assert/strict";
/** 测试运行器 */
import test from "node:test";
/** 隔离 Obsidian 宿主模块的运行环境 */
import vm from "node:vm";
/** 读取插件源码 */
import { readFileSync } from "node:fs";
/** 提供 Node 内建模块的加载能力 */
import { createRequire } from "node:module";
/** 相对当前测试文件加载领域模块 */
const nodeRequire = createRequire(import.meta.url);
/** 创建带有内存笔记和模拟远端发布的插件实例 */
function fixture({ failChild = false, verified = true } = {}) {
  // 主笔记与一级引用的模拟文件和正文
  const root = { path: "root.md", basename: "root", extension: "md" };
  // 主笔记直接引用的笔记
  const child = { path: "child.md", basename: "child", extension: "md" };
  // 模拟仓库中的原始笔记正文
  const bodies = new Map([[root.path, "[[child]]"], [child.path, "[[grandchild]]"]]);
  // 模拟仓库的引用索引和页面绑定
  const caches = new Map([[root.path, { links: [{ link: "child", original: "[[child]]", position: { start: { offset: 0 }, end: { offset: 9 } } }], frontmatter: {} }], [child.path, { frontmatter: {} }]]);
  // 记录远端创建与更新操作以核对顺序
  const calls = [];
  // 记录对用户展示的执行结果
  const notices = [];
  class Adapter { getFullPath(filePath) { return `/vault/${filePath}`; } }
  class Notice { constructor(message) { notices.push(message); } }
  // 隔离加载插件时的导出容器
  const module = { exports: {} };
  // 模拟宿主模块和远端发布能力
  const context = { module, console: { error() {}, info() {} }, URL, process, require(name) {
    if (name === "obsidian") return { FileSystemAdapter: Adapter, Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, Notice };
    if (name === "electron") return { shell: { openExternal() {} } };
    if (name === "./services/import-markdown-doc.mjs") return { publishMarkdownFile: async (options) => {
      calls.push(options);
      if (failChild && options.filePath.endsWith("child.md")) throw new Error("模拟引用失败");
      return { pageId: options.title, link: `https://joyspace.jd.com/pages/${options.title}`, verified };
    } };
    if (name === "./services/pull-joyspace-doc.mjs") return {};
    if (name === "./domain/note-references.js") return nodeRequire(name.replace("./", "./src/"));
    return nodeRequire(name);
  } };
  vm.runInNewContext(readFileSync(new URL("./src/main.js", import.meta.url), "utf8"), context);
  // 用于验证命令编排的插件实例
  const plugin = new module.exports();
  plugin.settings = { pythonExecutable: "python3", targetPageUrl: "", tenantCode: "CN.JD.GROUP", openAfterUpload: false };
  plugin.app = { workspace: { getActiveFile: () => root }, vault: { adapter: new Adapter(), read: async (file) => bodies.get(file.path) }, metadataCache: { getFileCache: (file) => caches.get(file.path), getFirstLinkpathDest: (link) => link === "child" ? child : null }, fileManager: { processFrontMatter: async (file, change) => change(caches.get(file.path).frontmatter) } };
  plugin.hasBrowserCookieDependency = async () => true;
  plugin.updateMarkdownNote = async (file, prepared) => calls.push({ update: file.path, markdown: prepared.markdown });
  return { plugin, calls, notices, caches, bodies, root, child };
}

/** 验证一级上传顺序、深度限制和普通更新的转换模式 */
test("引用先发布，主笔记后发布；普通更新不重复创建且保留转换", async () => {
  // 隔离的插件与模拟远端调用记录
  const state = fixture();
  await state.plugin.runActivePublish({ includeReferences: true });
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls[0].title, "child");
  assert.equal(state.calls[0].markdown, "[[grandchild]]\n");
  assert.equal(state.calls[1].markdown, "[child](https://joyspace.jd.com/pages/child)\n");
  assert.equal(state.bodies.get("root.md"), "[[child]]");
  await state.plugin.runActivePublish();
  assert.equal(state.calls.length, 2);
  state.bodies.set("root.md", "[[child]]\n新增正文");
  await state.plugin.runActivePublish({ updateOnly: true });
  assert.equal(state.calls[2].update, "root.md");
  assert.match(state.calls[2].markdown, /https:\/\/joyspace.jd.com\/pages\/child/);
});

/** 验证引用失败时不会继续上传主笔记 */
test("引用上传失败停止主笔记并释放任务锁", async () => {
  // 模拟一级引用发布失败
  const state = fixture({ failChild: true });
  await state.plugin.runActivePublish({ includeReferences: true });
  assert.equal(state.calls.length, 1);
  assert.equal(state.plugin.publishing, false);
  assert.equal(state.caches.get("root.md").frontmatter["joyspace-page-id"], undefined);
  assert.match(state.notices.at(-1), /模拟引用失败/);
});

/** 验证页面回读失败后绑定仍保存，重试不会重复创建 */
test("创建后回读失败保存绑定，重试更新原页面", async () => {
  // 创建成功但正文验证失败的场景
  const state = fixture({ verified: false });
  await state.plugin.runActivePublish({ includeReferences: true });
  assert.equal(state.caches.get("child.md").frontmatter["joyspace-page-id"], "child");
  assert.equal(state.caches.get("child.md").frontmatter["joyspace-sync-hash"], undefined);
  await state.plugin.runActivePublish({ includeReferences: true });
  assert.equal(state.calls[1].update, "child.md");
  assert.equal(state.calls.filter((call) => call.title === "child").length, 1);
});
