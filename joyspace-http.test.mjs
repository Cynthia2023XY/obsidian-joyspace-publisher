import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";

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

/** 验证渲染进程的浏览器 URL 不会直接传入旧版 Node HTTPS 客户端 */
test("浏览器 URL 环境下以字符串发送地址并保留认证与正文", async () => {
  // 模拟与 Node URL 不同的浏览器地址对象
  class BrowserURL {
    constructor(url, base) {
      // 浏览器对象仅暴露请求所需的公开地址字段
      const parsed = new URL(url, base);
      this.href = parsed.href;
      this.origin = parsed.origin;
      this.pathname = parsed.pathname;
      this.search = parsed.search;
    }
  }
  // 在浏览器 URL 环境中执行实际请求实现，不发送网络请求
  const source = await readFile(new URL("./src/infrastructure/joyspace-http.mjs", import.meta.url), "utf8");
  // 模拟 Node 请求，校验参数并返回成功响应
  const httpsRequest = (url, options, callback) => {
    assert.equal(typeof url, "string");
    assert.equal(url, "https://apijoyspace.jd.com/v1/pages?test=1");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Cookie, "test-cookie");
    assert.equal(options.headers["x-team-id"], "test-team");
    // 收集发送正文并同步模拟响应生命周期
    const request = new EventEmitter();
    let payload = "";
    request.setTimeout = () => request;
    request.write = (chunk) => { payload += chunk; };
    request.end = () => {
      assert.equal(payload, '{"title":"测试文档"}');
      assert.equal(options.headers["Content-Length"], Buffer.byteLength(payload));
      // 返回完整的业务成功数据，验证原有解包行为
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit("data", Buffer.from('{"status":"success","data":{"id":"test-page"}}'));
      response.emit("end");
    };
    return request;
  };
  // 只移除模块声明，保留生产实现并注入隔离的宿主替身
  const implementation = source.replace(/^import .*;\n/m, "").replace(/export /g, "");
  // 取得隔离环境中的真实请求入口
  const requestJson = runInNewContext(implementation + "\nrequestJoySpaceJson", { URL: BrowserURL, Buffer, httpsRequest });
  // 校验响应数据没有因兼容性调整而变化
  const result = await requestJson({ method: "POST", url: "/v1/pages?test=1", cookieHeader: "test-cookie", teamHeaderId: "test-team", body: { title: "测试文档" } });
  assert.equal(result.id, "test-page");
});
