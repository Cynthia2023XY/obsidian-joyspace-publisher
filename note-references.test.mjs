/** 引用解析回归测试所需断言能力 */
import assert from "node:assert/strict";
/** Node 测试运行能力 */
import test from "node:test";
/** 被验证的一层引用领域逻辑 */
import referencesDomain from "./src/domain/note-references.js";
/** 引用解析与替换方法 */
const { collectNoteReferences, replaceNoteReferences } = referencesDomain;
/** 测试使用的主笔记 */
const root = { path: "folder/root.md", basename: "root", extension: "md" };
/** 测试使用的被引用笔记 */
const child = { path: "folder/child.md", basename: "child", extension: "md" };
/** 按实际源码位置构建宿主引用缓存 */
function entry(markdown, original, link, displayText) {
  // 缓存原文的起始偏移
  const start = markdown.indexOf(original);
  return { original, link, displayText, position: { start: { offset: start }, end: { offset: start + original.length } } };
}

/** 验证重复引用、别名和笔记嵌入共享一篇上传目标 */
test("一层引用去重并替换所有位置，保留原文", () => {
  // 多种引用语法构成的正文快照
  const raw = "[[child|方案]] 与 ![[child]] 和 [说明](child.md)";
  // 模拟宿主返回的笔记引用索引
  const cache = { links: [entry(raw, "[[child|方案]]", "child", "方案"), entry(raw, "[说明](child.md)", "child.md", "说明")], embeds: [entry(raw, "![[child]]", "child")] };
  // 解析得到的一层引用与文件集合
  const plan = collectNoteReferences(raw, root, cache, () => child);
  assert.deepEqual(plan.files, [child]);
  assert.equal(replaceNoteReferences(raw, plan.references, new Map([[child.path, "https://joyspace.jd.com/pages/x"]])), "[方案](https://joyspace.jd.com/pages/x) 与 [child](https://joyspace.jd.com/pages/x) 和 [说明](https://joyspace.jd.com/pages/x)");
  assert.equal(raw, "[[child|方案]] 与 ![[child]] 和 [说明](child.md)");
});

/** 验证循环、自引用和附件不会扩大直接引用集合 */
test("不遍历引用笔记，排除自身、外部地址和附件", () => {
  // 被引用笔记的内容不会被解析器读取
  const raw = "[[child]] [[root]] [[#标题]] [网站](https://example.com) ![[image.png]]";
  // 模拟宿主返回的笔记引用索引
  const cache = { links: [entry(raw, "[[child]]", "child"), entry(raw, "[[root]]", "root"), entry(raw, "[[#标题]]", "#标题"), entry(raw, "[网站](https://example.com)", "https://example.com")], embeds: [entry(raw, "![[image.png]]", "image.png")] };
  // 解析得到的一层引用与文件集合
  const plan = collectNoteReferences(raw, root, cache, (link) => link === "child" ? child : link === "root" ? root : { extension: "png" });
  assert.deepEqual(plan.files, [child]);
});

/** 验证无法解析的笔记和过期索引会在上传前阻止执行 */
test("缺失笔记、索引过期和缺失链接映射明确报错", () => {
  // 单个引用对应的正文和宿主缓存
  const raw = "[[child]]";
  // 模拟宿主返回的笔记引用索引
  const cache = { links: [entry(raw, raw, "child")] };
  assert.throws(() => collectNoteReferences(raw, root, cache, () => null), /找不到引用笔记/);
  assert.throws(() => collectNoteReferences("changed", root, cache, () => child), /不同步/);
  // 解析得到的一层引用与文件集合
  const plan = collectNoteReferences(raw, root, cache, () => child);
  assert.throws(() => replaceNoteReferences(raw, plan.references, new Map()), /尚未发布/);
});
