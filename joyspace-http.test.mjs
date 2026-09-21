import assert from "node:assert/strict";
import test from "node:test";

import {
  createJoySpaceRequestOptions,
  parseJoySpaceResponse,
} from "./src/infrastructure/joyspace-http.mjs";

/** 验证 Node.js HTTPS 请求会保留 JoySpace 登录态和租户请求头 */
test("构建包含 Cookie 和租户信息的 Node HTTPS 请求", () => {
  /** 带认证信息的 JoySpace POST 请求参数 */
  const request = createJoySpaceRequestOptions({
    method: "POST",
    cookieHeader: "thor=test-token; pin=test-user",
    teamHeaderId: "00046419",
    body: { pageId: "page-id" },
  });

  assert.equal(request.method, "POST");
  assert.equal(request.headers.Cookie, "thor=test-token; pin=test-user");
  assert.equal(request.headers["x-team-id"], "00046419");
  assert.equal(request.headers["Content-Length"], Buffer.byteLength(request.payload));
});

/** 验证 JoySpace 成功响应只向业务层返回 data */
test("解析 JoySpace 成功响应", () => {
  /** 从成功响应中提取的业务数据 */
  const result = parseJoySpaceResponse({ status: "success", data: { id: "page-id" } }, "/v1/pages");

  assert.deepEqual(result, { id: "page-id" });
});

/** 验证 JoySpace 业务异常仍保留错误码和接口路径 */
test("解析 JoySpace 业务失败响应", () => {
  assert.throws(
    () => parseJoySpaceResponse({ status: "failed", errorCode: "403", errorMsg: "Forbidden" }, "/v3/pages/id/basic"),
    /403.*Forbidden.*\/v3\/pages\/id\/basic/,
  );
});
