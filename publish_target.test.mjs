import test from "node:test";
import assert from "node:assert/strict";
import publishTarget from "./src/domain/publish-target.js";

/** 被测试的发布目录解析函数 */
const { resolveTargetPageUrl } = publishTarget;

/** 验证文档 YAML 中的目录配置优先于插件配置 */
test("优先使用文档 YAML 指定的发布目录", () => {
  assert.equal(
    resolveTargetPageUrl(
      { "joyspace-target-page-url": " https://joyspace.jd.com/teams/yaml/folder " },
      "https://joyspace.jd.com/teams/plugin/folder",
    ),
    "https://joyspace.jd.com/teams/yaml/folder",
  );
});

/** 验证未配置文档级目录时使用插件默认值 */
test("文档 YAML 未配置时使用插件发布目录", () => {
  assert.equal(
    resolveTargetPageUrl({}, " https://joyspace.jd.com/teams/plugin/folder "),
    "https://joyspace.jd.com/teams/plugin/folder",
  );
});

/** 验证空的文档级配置不会遮蔽插件默认值 */
test("文档 YAML 配置为空时回退到插件发布目录", () => {
  assert.equal(
    resolveTargetPageUrl(
      { "joyspace-target-page-url": "   " },
      "https://joyspace.jd.com/teams/plugin/folder",
    ),
    "https://joyspace.jd.com/teams/plugin/folder",
  );
});
