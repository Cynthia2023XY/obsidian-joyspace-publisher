/** 文档 YAML 中用于指定 JoySpace 发布目录的字段名 */
const JOYSPACE_TARGET_PAGE_URL_KEY = "joyspace-target-page-url";

/**
 * 按“文档 YAML 优先、插件配置兜底”的规则解析发布目录定位链接。
 * YAML 值为空时视为未配置，继续使用插件设置。
 */
const resolveTargetPageUrl = (frontmatter, pluginTargetPageUrl) => {
  /** 当前文档 YAML 中配置的 JoySpace 目录定位链接 */
  const documentTargetPageUrl = frontmatter?.[JOYSPACE_TARGET_PAGE_URL_KEY];
  /** 清理空白后的文档级目录定位链接 */
  const normalizedDocumentTargetPageUrl =
    typeof documentTargetPageUrl === "string" ? documentTargetPageUrl.trim() : "";
  /** 清理空白后的插件级默认目录定位链接 */
  const normalizedPluginTargetPageUrl =
    typeof pluginTargetPageUrl === "string" ? pluginTargetPageUrl.trim() : "";

  return normalizedDocumentTargetPageUrl || normalizedPluginTargetPageUrl;
};

module.exports = {
  JOYSPACE_TARGET_PAGE_URL_KEY,
  resolveTargetPageUrl,
};
