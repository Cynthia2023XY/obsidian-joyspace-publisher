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
  assert.equal(state.calls[0].markdown, "[[grandchild]]");
  assert.equal(state.calls[1].markdown, "[child](https://joyspace.jd.com/pages/child)");
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

/** 检查插件入口是否删除无 H1 的连续链接正文 */
test("插件预处理保留无 H1 的三行链接正文", () => {
  // 使用真实插件实例执行正文预处理
  const state = fixture();
  // 三个连续链接对应问题笔记的上传副本结构
  const body = "[甲](https://joyspace.jd.com/pages/a)\n[乙](https://joyspace.jd.com/pages/b)\n[丙](https://joyspace.jd.com/pages/c)\n";
  assert.equal(state.plugin.prepareJoySpaceMarkdown("---\ntags: []\n---\n" + body, state.root).markdown, body);
});

/** 检查插件入口是否误删标题后的操作说明 */
test("插件预处理保留 H1 和首段操作说明", () => {
  // 使用真实插件实例执行测试2结构的正文预处理
  const state = fixture();
  // 标题后的说明、章节和引用都属于正文
  const body = "操作说明应保留。\n\n## 引用章节\n\n[甲](https://joyspace.jd.com/pages/a)\n";
  assert.equal(state.plugin.prepareJoySpaceMarkdown("# 测试标题\n\n" + body, state.root).markdown, "# 测试标题\n\n" + body);
  assert.equal(state.plugin.prepareJoySpaceMarkdown(body, state.root).title, "root");
});

/** 验证旧设置不会改变任何正文标题层级 */
test("旧标题提升设置不再生效，一级到六级标题完整保留", () => {
  // 使用保存了旧设置的插件实例验证升级后的行为
  const state = fixture();
  state.plugin.settings.promoteSectionHeadings = true;
  // 覆盖所有 Markdown 标题等级及开头正文标题
  const body = "# 正文一级\n\n## 正文二级\n\n### 正文三级\n\n#### 正文四级\n\n##### 正文五级\n\n###### 正文六级\n";
  // 文件名与正文 H1 不同，页面标题仍取文件名
  const prepared = state.plugin.prepareJoySpaceMarkdown(body, state.root);
  assert.equal(prepared.title, "root");
  assert.equal(prepared.markdown, body);
});
