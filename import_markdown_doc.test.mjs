import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreatePagePayload,
  extractTeamFolderFromUrl,
  normalizeCreatedPageResponse,
  normalizeLocationFromBasicInfo,
} from "./import_markdown_doc.mjs";

/** 验证目标页面的团队和目录能被传入创建请求 */
test("从目标页面位置构建指定目录的创建请求", () => {
  /** JoySpace 目标页面返回的存放位置 */
  const location = normalizeLocationFromBasicInfo({
    team_id: "oqWK0kf3zlwLJKrRRmkHn",
    folder_id: "7Q75yL7Gd0Go8NdrAEmp",
  });
  /** 上传 Markdown 时提交给 JoySpace 的创建请求 */
  const payload = buildCreatePagePayload({
    title: "指定目录文档",
    markdown: "# 正文",
    ...location,
  });

  assert.equal(payload.teamId, "oqWK0kf3zlwLJKrRRmkHn");
  assert.equal(payload.folderId, "7Q75yL7Gd0Go8NdrAEmp");
});

/** 验证 JoySpace 返回 pageId 时仍能生成有效文档地址 */
test("创建响应兼容 pageId 字段", () => {
  /** 经过兼容处理的 JoySpace 新建文档 */
  const createdPage = normalizeCreatedPageResponse({ pageId: "new-page-id" });

  assert.equal(createdPage.pageId, "new-page-id");
  assert.equal(createdPage.link, "https://joyspace.jd.com/pages/new-page-id");
});

/** 验证历史 id 字段和接口自带链接仍保持兼容 */
test("创建响应保持 id 字段兼容", () => {
  /** 经过兼容处理的 JoySpace 历史响应 */
  const createdPage = normalizeCreatedPageResponse({
    id: "legacy-page-id",
    link: "https://joyspace.jd.com/doc/legacy-page-id",
  });

  assert.equal(createdPage.pageId, "legacy-page-id");
  assert.equal(createdPage.link, "https://joyspace.jd.com/doc/legacy-page-id");
});

/** 验证直接填写 JoySpace 目录链接时能提取准确位置 */
test("解析 JoySpace 团队目录链接", () => {
  /** 从团队目录链接中提取的目标位置 */
  const location = extractTeamFolderFromUrl(
    "https://joyspace.jd.com/teams/team-id/folder-id",
  );

  assert.deepEqual(location, {
    teamId: "team-id",
    folderId: "folder-id",
  });
});

/** 验证创建接口缺少文档 ID 时立即返回明确错误 */
test("创建响应缺少文档 ID 时拒绝继续验证", () => {
  assert.throws(
    () => normalizeCreatedPageResponse({ title: "缺少 ID" }),
    /id\/pageId/,
  );
});
