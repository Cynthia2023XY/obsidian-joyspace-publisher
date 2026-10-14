/** 回读重试测试所需断言 */
import assert from "node:assert/strict";
/** 单元测试运行器 */
import test from "node:test";
/** 创建后正文验证与有限重试能力 */
import { verifyCreatedPageContent } from "./src/services/import-markdown-doc.mjs";

/** 正文延迟可用时应继续回读并最终标记成功 */
test("创建后先只有标题，稍后正文就绪时验证成功", async () => {
  // 模拟标题先落盘、正文稍后可读
  let reads = 0;
  // 捕获等待时长，测试中不实际休眠
  const waits = [];
  // 调用真实重试逻辑
  const result = await verifyCreatedPageContent({ hasBody: true, readContent: async () => ({ content: ++reads < 3 ? [{}] : [{}, {}] }), wait: async (delay) => waits.push(delay) });
  assert.equal(result.verified, true);
  assert.equal(reads, 3);
  assert.deepEqual(waits, [500, 1500]);
});

/** 瞬时请求错误恢复后应允许保存同步状态 */
test("回读瞬时异常后恢复正常", async () => {
  // 模拟第一次回读请求失败
  let reads = 0;
  // 第二次请求返回完整正文
  const result = await verifyCreatedPageContent({ hasBody: true, readContent: async () => { if (++reads === 1) throw new Error("HTTP 503"); return { content: [{}, {}] }; }, wait: async () => {} });
  assert.equal(result.verified, true);
  assert.equal(reads, 2);
});

/** 持续失败时应保留原因并在固定次数后停止 */
test("持续无权限时有限重试并返回真实原因", async () => {
  // 记录实际执行次数防止无限重试
  let reads = 0;
  // 模拟服务端持续拒绝回读
  const result = await verifyCreatedPageContent({ hasBody: true, readContent: async () => { reads++; throw new Error("NEED_ACCESS_RIGHT"); }, wait: async () => {} });
  assert.equal(result.verified, false);
  assert.equal(result.verificationError, "NEED_ACCESS_RIGHT");
  assert.equal(reads, 4);
});
