/** 创建请求诊断所需断言能力 */
import assert from "node:assert/strict";
/** 单元测试运行器 */
import test from "node:test";
/** 隔离发布服务的模块环境 */
import vm from "node:vm";
/** 加载 Node 内建模块 */
import { createRequire } from "node:module";
/** 转换真实发布服务以替换网络与认证依赖 */
import { buildSync } from "esbuild";
/** 与当前测试文件对应的模块加载器 */
const localRequire = createRequire(import.meta.url);
/** 使用真实发布代码捕获请求，不访问远端也不读取浏览器 Cookie */
function serviceFixture(markdown, returnedContent) {
  // 使用真实源码编译，保留业务处理和成功校验逻辑
  const compiled = buildSync({ entryPoints: ["src/services/import-markdown-doc.mjs"], bundle: false, format: "cjs", platform: "node", write: false }).outputFiles[0].text;
  // 记录提交给创建接口的请求，供正文完整性断言使用
  const requests = [];
  // 模拟 CJS 模块导出
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, process, console, require(name) {
    if (name === "node:fs/promises") return { readFile: async () => markdown };
    if (name === "node:util") return { promisify: () => async () => ({ stdout: JSON.stringify({ ok: true, cookies: { mock: "test-only" } }) }) };
    if (name.includes("joyspace-http")) return { requestJoySpaceJson: async (request) => {
      requests.push(request);
      if (request.url === "/v1/pages") return { id: "diagnostic-page" };
      return { content: returnedContent };
    } };
    return localRequire(name);
  } });
  return { publish: module.exports.publishMarkdownFile, requests };
}

/** 只含引用链接的正文，用于复现雅思笔记的结构，不保存真实业务内容 */
const linkOnlyBody = "[笔记甲](https://joyspace.jd.com/pages/a)\n[笔记乙](https://joyspace.jd.com/pages/b)\n[笔记丙](https://joyspace.jd.com/pages/c)\n";
/** 对应已回读到的标题但无正文响应结构 */
const titleOnlyResponse = [{ type: "p", children: [{ text: "测试引用上传" }] }];

/** 检查插件传入的已预处理正文是否被发布服务再次删除 */
test("已预处理的三行引用完整进入创建请求，未删除首块", async () => {
  // 捕获服务实际发出的创建请求
  const state = serviceFixture("磁盘正文不应被读取", titleOnlyResponse);
  await state.publish({ filePath: "/mock/root.md", markdown: linkOnlyBody, title: "测试引用上传", prepared: true, tenantCode: "CN.JD.GROUP" });
  assert.equal(state.requests[0].body.content[0].value, "# " + state.requests[0].body.title + "\n\n" + linkOnlyBody);
  assert.equal(state.requests[0].body.title, "测试引用上传");
});

/** 检查兼容磁盘入口是否错误删除没有 H1 的引用正文 */
test("无 H1 的三行引用在磁盘发布入口也完整保留", async () => {
  // 模拟带 YAML 但没有标题的笔记
  const state = serviceFixture("---\ntags: []\n---\n" + linkOnlyBody, titleOnlyResponse);
  await state.publish({ filePath: "/mock/root.md", tenantCode: "CN.JD.GROUP" });
  assert.equal(state.requests[0].body.content[0].value, "# " + state.requests[0].body.title + "\n\n" + linkOnlyBody);
});

/** 检查测试库的首段操作说明是否在本地发布服务中丢失 */
test("有 H1 的笔记正文标题、首段说明和后续引用全部保留", async () => {
  // 与测试2相同的标题、说明、章节及引用结构
  const body = "操作说明应保留。\n\n## 引用章节\n\n" + linkOnlyBody;
  // 模拟真实发布代码读取这份 Markdown
  const state = serviceFixture("# 测试标题\n\n" + body, titleOnlyResponse);
  await state.publish({ filePath: "/mock/root.md", tenantCode: "CN.JD.GROUP" });
  assert.equal(state.requests[0].body.content[0].value, "# root\n\n# 测试标题\n\n" + body);
});

/** 暴露正文缺失仍被判断成功的缺陷，此断言在修复前应失败 */
test("远端仅返回标题时，非空正文发布不得标记验证成功", async () => {
  // 标题存在但三篇引用正文全部缺失的响应
  const state = serviceFixture(linkOnlyBody, titleOnlyResponse);
  // 使用真实服务逻辑完成创建及回读验证
  const result = await state.publish({ filePath: "/mock/root.md", markdown: linkOnlyBody, title: "测试引用上传", prepared: true, tenantCode: "CN.JD.GROUP" });
  assert.equal(result.verified, false, "只有标题的响应不能证明引用正文上传成功");
});
