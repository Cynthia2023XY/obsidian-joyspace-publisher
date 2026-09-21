import { request as httpsRequest } from "node:https";

/** JoySpace API 的固定服务地址 */
const JOYSPACE_API_BASE_URL = "https://apijoyspace.jd.com";
/** 单次 JoySpace 请求允许接收的最大响应体积 */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** 构建可由 Node.js HTTPS 客户端完整发送的认证请求参数 */
export function createJoySpaceRequestOptions({ method, cookieHeader, teamHeaderId, body }) {
  /** 序列化后的 JoySpace 请求正文 */
  const payload = body == null ? "" : JSON.stringify(body);
  /** 包含浏览器登录态与租户信息的请求头 */
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    "x-team-id": teamHeaderId,
  };
  if (payload) {
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  return { method, headers, payload };
}

/** 校验并提取 JoySpace API 的业务响应数据 */
export function parseJoySpaceResponse(json, url) {
  if (
    json?.status === "failed" ||
    json?.errCode ||
    (json?.errorCode && json.errorCode !== "0") ||
    (json?.code != null && json.code !== 0 && json.code !== "0")
  ) {
    /** JoySpace 业务失败时返回的错误码 */
    const errorCode = json.errCode || json.errorCode || json.code || "unknown";
    /** JoySpace 业务失败时返回的可读错误信息 */
    const errorMessage = json.errMsg || json.errorMsg || json.msg || json.message || json.error || "Unknown API error";
    throw new Error(`JoySpace API error ${errorCode}: ${errorMessage} (${url})`);
  }
  if (json?.status === "success" || json?.status === "0" || json?.status === 0) {
    return json.data;
  }
  return json?.data ?? json;
}

/** 通过 Node.js HTTPS 请求 JoySpace，避免 Chromium 丢弃手动设置的 Cookie 请求头 */
export async function requestJoySpaceJson({ method, url, cookieHeader, teamHeaderId, body }) {
  /** 解析后的 JoySpace API 完整地址 */
  const requestUrl = new URL(url, JOYSPACE_API_BASE_URL);
  if (requestUrl.origin !== JOYSPACE_API_BASE_URL) {
    throw new Error("JoySpace API 地址不受信任");
  }
  /** Node.js HTTPS 请求参数及序列化正文 */
  const { payload, ...requestOptions } = createJoySpaceRequestOptions({ method, cookieHeader, teamHeaderId, body });

  return new Promise((resolve, reject) => {
    /** 当前 JoySpace HTTPS 请求 */
    const request = httpsRequest(requestUrl, requestOptions, (response) => {
      /** 分段接收的响应内容 */
      const chunks = [];
      /** 当前累计响应字节数 */
      let responseBytes = 0;
      response.on("data", (chunk) => {
        /** 规范化后的响应数据块 */
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBytes += buffer.length;
        if (responseBytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("JoySpace 响应超过 10 MB 限制"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        /** JoySpace 返回的 HTTP 状态码 */
        const statusCode = response.statusCode || 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`${requestUrl.pathname}${requestUrl.search} HTTP ${statusCode} ${response.statusMessage || ""}`.trim()));
          return;
        }
        try {
          /** 合并并解析后的 JoySpace JSON 响应 */
          const json = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          resolve(parseJoySpaceResponse(json, `${requestUrl.pathname}${requestUrl.search}`));
        } catch (error) {
          reject(error);
        }
      });
      response.on("error", reject);
    });

    request.setTimeout(60_000, () => {
      request.destroy(new Error("JoySpace 请求超时"));
    });
    request.on("error", reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}
