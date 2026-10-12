/** 收集当前正文直接引用的 Markdown 文件，不遍历被引用文件 */
function collectNoteReferences(markdown, sourceFile, cache, resolveFile) {
  // 需要替换的引用位置和按完整路径去重后的目标笔记
  const references = [];
  // 按完整路径去重后的笔记集合
  const files = new Map();
  if (!cache) throw new Error(`笔记索引尚未就绪：${sourceFile.path}，请稍后重试`);
  for (const entry of [...(cache.links || []), ...(cache.embeds || [])]) {
    // 排除外部地址和当前笔记内的标题、块定位
    const link = entry.link || "";
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link) || link.startsWith("#")) continue;
    // Obsidian 链接的文件部分交给宿主按来源路径解析
    const linkpath = link.split("#")[0];
    // 宿主解析得到的目标笔记
    const file = resolveFile(linkpath, sourceFile.path);
    if (!file) {
      if (/\.[a-z0-9]+$/i.test(linkpath) && !/\.md$/i.test(linkpath)) continue;
      throw new Error(`找不到引用笔记：${linkpath}（来源：${sourceFile.path}）`);
    }
    if (file.extension !== "md" || file.path === sourceFile.path) continue;
    // 缓存必须与本次读取的正文一致，避免替换错误位置
    const start = entry.position.start.offset;
    // 引用在正文中的结束位置
    const end = entry.position.end.offset;
    if (markdown.slice(start, end) !== entry.original) {
      throw new Error(`笔记索引与正文不同步：${sourceFile.path}，请稍后重试`);
    }
    references.push({ start, end, file, displayText: entry.displayText || file.basename });
    files.set(file.path, file);
  }
  return { references, files: [...files.values()] };
}

/** 在上传副本中将直接引用转换为普通 Markdown 网页链接 */
function replaceNoteReferences(markdown, references, urls) {
  // 从后往前替换，保持缓存中的正文偏移有效
  let result = markdown;
  for (const reference of [...references].sort((left, right) => right.start - left.start)) {
    // 只有完整、成功的链接映射才能用于发布主笔记
    const url = urls.get(reference.file.path);
    if (!url) throw new Error(`引用笔记尚未发布：${reference.file.path}`);
    // 转义显示文字，避免别名中的方括号破坏 Markdown
    const label = reference.displayText.replace(/([\\\[\]])/g, "\\$1");
    // 仅将连续独占一行的笔记引用分为独立段落，避免服务端合并软换行
    const nextReference = references.find((candidate) => candidate.start > reference.end && /^[ \t]*\r?\n[ \t]*$/.test(markdown.slice(reference.end, candidate.start)));
    // 当前引用前没有正文、列表标记或引用块标记
    const linePrefix = markdown.slice(markdown.lastIndexOf("\n", reference.start - 1) + 1, reference.start);
    // 下一处引用后没有同一行的其他正文
    const nextLineEnd = nextReference ? markdown.indexOf("\n", nextReference.end) : -1;
    // 只检查真实源码位置，不匹配代码块或任意外部链接
    const nextLineSuffix = nextReference ? markdown.slice(nextReference.end, nextLineEnd < 0 ? markdown.length : nextLineEnd) : "";
    // 使用空行建立 Markdown 段落，不改变源笔记或普通行内引用
    const separator = nextReference && /^[ \t]*$/.test(linePrefix) && /^[ \t\r]*$/.test(nextLineSuffix) ? "\n" : "";
    result = result.slice(0, reference.start) + `[${label}](${url})${separator}` + result.slice(reference.end);
  }
  return result;
}

module.exports = { collectNoteReferences, replaceNoteReferences };
