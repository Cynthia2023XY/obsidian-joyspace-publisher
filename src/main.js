/** Obsidian 插件运行时提供的界面和文件系统能力 */
const { FileSystemAdapter, Modal, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
/** 用于执行现有 JoySpace 上传脚本的子进程能力 */
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
/** 用于验证运行环境路径是否存在的文件系统能力 */
const { access, mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
/** 用于拼接插件内置上传脚本路径的能力 */
const path = require("node:path");
/** 用于将子进程执行函数转换为 Promise 的工具 */
const { promisify } = require("node:util");
/** 用于上传成功后打开 JoySpace 页面的 Electron 能力 */
const { shell } = require("electron");
/** 已打包到主程序中的 JoySpace 发布能力 */
const { publishMarkdownFile } = require("./services/import-markdown-doc.mjs");
/** 已打包到主程序中的 JoySpace 拉取能力 */
const { pullJoySpaceDocumentFile } = require("./services/pull-joyspace-doc.mjs");

/** 一层引用收集与上传副本转换能力 */
const { collectNoteReferences, replaceNoteReferences } = require("./domain/note-references.js");

/** 文档 YAML 中用于指定 JoySpace 发布目录的字段名 */
const JOYSPACE_TARGET_PAGE_URL_KEY = "joyspace-target-page-url";

/** 按“文档 YAML 优先、插件配置兜底”的规则解析发布目录定位链接 */
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

/** 校验并规范化允许交给 WebCLI 或系统浏览器的 JoySpace 文档地址 */
const normalizeJoySpaceDocumentUrl = (value) => {
  /** 用户配置或文档属性中的候选地址 */
  const candidate = String(value || "").trim();
  if (!candidate) {
    return "";
  }
  /** 使用标准 URL 解析器得到的 JoySpace 地址 */
  const parsedUrl = new URL(candidate);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "joyspace.jd.com") {
    throw new Error("仅允许使用 https://joyspace.jd.com 下的文档链接");
  }
  if (!/^\/(?:pages|doc)\/[A-Za-z0-9_-]+\/?$/.test(parsedUrl.pathname)) {
    throw new Error("JoySpace 文档链接路径无效");
  }
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString();
};

/** 插件首次启用时使用的默认配置 */
const DEFAULT_SETTINGS = {
  pythonExecutable: "",
  targetPageUrl: "",
  tenantCode: "CN.JD.GROUP",
  promoteSectionHeadings: false,
  openAfterUpload: true,
  webcliExecutable: "",
};

/** 将回调形式的子进程执行函数转换为 Promise */
const execFileAsync = promisify(execFile);

/** 负责上传当前 Markdown 文档到 JoySpace 的 Obsidian 插件 */
module.exports = class JoySpacePublisherPlugin extends Plugin {
  /** 初始化插件命令、工具栏按钮和设置页 */
  async onload() {
    await this.loadSettings();
    void this.detectRuntimePaths();

    this.addRibbonIcon("upload-cloud", "发布/更新当前文档到 JoySpace", async () => {
      await this.publishOrUpdateActiveMarkdown();
    });

    this.addCommand({
      id: "publish-active-markdown-to-joyspace",
      name: "发布/更新当前文档到 JoySpace",
      checkCallback: (checking) => {
        /** 当前编辑器中打开的文件 */
        const activeFile = this.app.workspace.getActiveFile();
        /** 当前文件是否为可上传的 Markdown 文档 */
        const canPublish = activeFile?.extension === "md";
        if (canPublish && !checking) {
          void this.publishOrUpdateActiveMarkdown();
        }
        return canPublish;
      },
    });

    this.addCommand({
      id: "publish-active-markdown-with-references-to-joyspace",
      name: "发布/更新当前笔记及一层引用到 JoySpace",
      checkCallback: (checking) => {
        // 当前活动笔记是否适用引用发布命令
        const canPublish = this.app.workspace.getActiveFile()?.extension === "md";
        if (canPublish && !checking) void this.runActivePublish({ includeReferences: true });
        return canPublish;
      },
    });

    this.addCommand({
      id: "update-active-markdown-to-joyspace",
      name: "更新当前文档到已绑定 JoySpace 页面",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const canUpdate = activeFile?.extension === "md";
        if (canUpdate && !checking) {
          void this.updateActiveMarkdown();
        }
        return canUpdate;
      },
    });

    this.addCommand({
      id: "pull-joyspace-document-to-current-folder",
      name: "从 JoySpace 链接拉取文档到当前目录",
      callback: () => {
        new JoySpacePullModal(this.app, async (url) => {
          await this.pullJoySpaceDocument(url);
        }).open();
      },
    });

    this.addSettingTab(new JoySpacePublisherSettingTab(this.app, this));
  }

  /** 从 Obsidian 数据目录加载并补齐插件配置 */
  async loadSettings() {
    /** 本地保存的插件配置 */
    const savedSettings = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
  }

  /** 持久化当前插件配置 */
  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** 通过用户登录 Shell 执行 which，读取命令的实际安装位置 */
  async detectExecutable(commandName) {
    /** 当前用户配置的登录 Shell */
    const loginShell = process.env.SHELL || "/bin/zsh";
    /** which 命令返回的标准输出 */
    const { stdout } = await execFileAsync(loginShell, ["-lic", `which ${commandName}`], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    /** which 输出中的第一个有效路径 */
    const executablePath = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("/"));

    if (!executablePath) {
      throw new Error(`未检测到 ${commandName}，请确认登录 Shell 中可以执行 which ${commandName}`);
    }
    await access(executablePath);
    return executablePath;
  }

  /** 自动检测并保存 Python 与 WebCLI 的安装位置 */
  async detectRuntimePaths({ showNotice = false } = {}) {
    try {
      /** 登录 Shell 中检测到的 Python 安装位置 */
      const pythonExecutable = await this.detectExecutable("python3");
      /** 登录 Shell 中检测到的 WebCLI 安装位置 */
      let webcliExecutable = this.settings.webcliExecutable;
      try {
        webcliExecutable = await this.detectExecutable("webcli");
      } catch {
        webcliExecutable = this.settings.webcliExecutable;
      }

      this.settings.pythonExecutable = pythonExecutable;
      this.settings.webcliExecutable = webcliExecutable;
      await this.saveSettings();

      if (showNotice) {
        new Notice(`已检测 Python 和 WebCLI：\n${pythonExecutable}\n${webcliExecutable || "未检测到 webcli"}`, 8000);
      }
      return true;
    } catch (error) {
      /** 对用户展示的自动检测失败原因 */
      const message = error?.message || String(error);
      console.error("[JoySpace Publisher] 自动检测运行环境失败：", error);
      if (showNotice) {
        new Notice(`自动检测 Python 失败：${message}`, 10000);
      }
      return false;
    }
  }

  /** 检测指定 Python 环境是否已经安装 JoySpace 登录态读取依赖 */
  async hasBrowserCookieDependency(pythonExecutable) {
    try {
      await execFileAsync(pythonExecutable, ["-c", "import browser_cookie3"], {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** 检测 JoySpace 登录态读取所需的本地运行环境 */
  async ensureRuntimeReady({ showNotice = false } = {}) {
    /** Python 与 WebCLI 路径是否已完成检测 */
    const detected = await this.detectRuntimePaths({ showNotice: false });
    if (!detected) {
      if (showNotice) {
        new Notice("Python 自动检测失败，请确认终端中可以执行 python3", 10000);
      }
      return false;
    }

    /** 当前插件配置中的 Python 可执行文件路径 */
    const pythonExecutable = this.settings.pythonExecutable.trim();
    if (!pythonExecutable) {
      if (showNotice) {
        new Notice("未检测到 Python 路径，请先安装并配置 Python 3", 10000);
      }
      return false;
    }

    /** 当前 Python 环境是否已经具备读取浏览器 Cookie 的依赖 */
    const hasDependency = await this.hasBrowserCookieDependency(pythonExecutable);
    if (hasDependency) {
      if (showNotice) {
        new Notice(`运行环境已就绪：\n${pythonExecutable}`, 8000);
      }
      return true;
    }

    if (showNotice) {
      new Notice("未检测到 browser_cookie3。请在终端手动执行：python3 -m pip install --user browser_cookie3", 12000);
    }
    return false;
  }

  stripYamlFrontmatter(markdown) {
    return String(markdown || "").replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  }

  promoteSectionHeadingsForJoySpace(markdown) {
    const lines = String(markdown || "").split("\n");
    let inFence = false;
    return lines
      .map((line) => {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          return line;
        }
        if (inFence) {
          return line;
        }
        return line.replace(/^(#{2,6})(\s+)/, (match, hashes, space) => `${hashes.slice(1)}${space}`);
      })
      .join("\n");
  }

  extractTitleFromMarkdown(markdown, file) {
    const heading = String(markdown || "").match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
    return heading || file.basename || "untitled";
  }

  removeFirstH1(markdown) {
    return String(markdown || "").replace(/^\s*#\s+.+?\s*\r?\n+/, "");
  }

  prepareJoySpaceMarkdown(rawMarkdown, file) {
    const markdownWithoutFrontmatter = this.stripYamlFrontmatter(rawMarkdown);
    const title = this.extractTitleFromMarkdown(markdownWithoutFrontmatter, file);
    const bodyWithoutTitle = this.removeFirstH1(markdownWithoutFrontmatter);
    const markdown = this.settings.promoteSectionHeadings
      ? this.promoteSectionHeadingsForJoySpace(bodyWithoutTitle)
      : bodyWithoutTitle;
    const normalizedMarkdown = markdown.replace(/\r\n/g, "\n").trimEnd() + "\n";
    const hash = crypto.createHash("sha256").update(normalizedMarkdown, "utf8").digest("hex");
    return { title, markdown: normalizedMarkdown, hash };
  }

  getFrontmatterValue(cache, key) {
    const value = cache?.frontmatter?.[key];
    return typeof value === "string" ? value.trim() : value ? String(value).trim() : "";
  }

  async saveJoySpaceFrontmatter(file, values) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(values)) {
        frontmatter[key] = value;
      }
    });
  }

  /** 普通发布沿用当前笔记已保存的引用转换模式 */
  async publishOrUpdateActiveMarkdown() {
    await this.runActivePublish();
  }

  /** 兼容原有单篇发布入口 */
  async publishActiveMarkdown() {
    await this.runActivePublish();
  }

  /** 从当前笔记正文和宿主索引生成一层引用计划 */
  async readPublishPlan(file) {
    // 本次发布读取的正文快照与引用索引
    const raw = await this.app.vault.read(file);
    // 本次操作对应的笔记属性和索引
    const cache = this.app.metadataCache.getFileCache(file);
    return { raw, cache, ...collectNoteReferences(raw, file, cache,
      (linkpath, sourcePath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)) };
  }

  /** 执行单篇或一层引用发布，统一处理进度、失败和并发命令 */
  async runActivePublish({ includeReferences = false, updateOnly = false } = {}) {
    if (this.publishing) {
      new Notice("已有 JoySpace 发布任务正在执行，请等待完成");
      return;
    }
    // 固定本次发布对象，切换编辑器不会改变上传目标
    const file = this.app.workspace.getActiveFile();
    if (file?.extension !== "md") {
      new Notice("请先打开一个 Markdown 文档");
      return;
    }
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
      new Notice("JoySpace 上传仅支持 Obsidian 桌面端本地仓库");
      return;
    }
    this.publishing = true;
    // 已完成和当前执行对象用于报告部分成功
    const completed = [];
    // 当前正在执行的笔记路径，用于定位中途失败
    let current = file.path;
    try {
      // 当前文件绑定与持久化的转换模式
      const cache = this.app.metadataCache.getFileCache(file);
      if (updateOnly && !this.getFrontmatterValue(cache, "joyspace-page-id")) {
        throw new Error("当前文档未绑定 JoySpace 页面，请先发布一次");
      }
      // 是否保留一层引用转换模式
      const referenceMode = includeReferences || this.getFrontmatterValue(cache, "joyspace-reference-mode") === "direct";
      // 固定的一级引用发布计划
      const plan = referenceMode ? await this.readPublishPlan(file) : null;
      // 直接引用笔记与已发布地址的映射
      const urls = new Map();
      if (includeReferences) {
        // 预检所有直接引用，之后只对这一固定集合执行发布
        new Notice(`共 ${plan.files.length} 篇引用笔记；各篇使用自身发布目录配置，未配置时使用插件默认目录`, 8000);
        for (const [index, referenceFile] of plan.files.entries()) {
          current = referenceFile.path;
          new Notice(`正在处理引用 ${index + 1}/${plan.files.length}：${referenceFile.basename}`);
          // 引用笔记只沿用已有转换模式，不上传其下一级引用
          const result = await this.publishMarkdownNote(referenceFile);
          urls.set(referenceFile.path, result.link);
          completed.push(referenceFile.path);
        }
      } else if (plan) {
        // 普通更新只使用已绑定引用链接，不自动扩大上传范围
        for (const referenceFile of plan.files) {
          // 被引用笔记的已绑定页面地址
          const url = this.resolveJoySpaceUrl(this.app.metadataCache.getFileCache(referenceFile));
          if (!url) throw new Error(`引用笔记尚未绑定 JoySpace：${referenceFile.path}，请运行一层引用发布命令`);
          urls.set(referenceFile.path, url);
        }
      }
      current = file.path;
      // 上传期间若正文发生变化，停止主文档发布，避免错误覆盖
      if (plan && this.stripYamlFrontmatter(await this.app.vault.read(file)) !== this.stripYamlFrontmatter(plan.raw)) {
        throw new Error("当前笔记正文已变化，请重新执行发布");
      }
      // 指定文件的发布或更新结果
      const result = await this.publishMarkdownNote(file, plan ? {
        raw: replaceNoteReferences(plan.raw, plan.references, urls), referenceMode: true,
      } : {});
      new Notice(`JoySpace ${result.skipped ? "内容无变化" : "发布完成"}：${file.basename}；已处理 ${completed.length} 篇引用`, 8000);
      if (this.settings.openAfterUpload) await shell.openExternal(result.link);
    } catch (error) {
      console.error("[JoySpace Publisher] 发布失败：", error);
      new Notice(`JoySpace 发布停止：${current}\n${error?.message || String(error)}\n已完成：${completed.join("、") || "无"}；其余未执行，重试将复用已保存绑定`, 15000);
    } finally {
      this.publishing = false;
    }
  }

  /** 发布指定文件并及时保存绑定；不依赖活动编辑器，也不递归上传引用 */
  async publishMarkdownNote(file, { raw, referenceMode = false } = {}) {
    // 文件当前绑定决定创建或更新原页面
    const cache = this.app.metadataCache.getFileCache(file);
    // 已绑定的页面 ID，决定更新或新建
    const pageId = this.getFrontmatterValue(cache, "joyspace-page-id");
    // 本次发布使用的正文副本
    let source = raw ?? await this.app.vault.read(file);
    if (raw === undefined && this.getFrontmatterValue(cache, "joyspace-reference-mode") === "direct") {
      // 已使用引用转换的文件保持转换，但不继续发布引用对象
      const plan = await this.readPublishPlan(file);
      // 直接引用笔记与已发布地址的映射
      const urls = new Map();
      for (const referenceFile of plan.files) {
        // 被引用笔记的已绑定页面地址
        const url = this.resolveJoySpaceUrl(this.app.metadataCache.getFileCache(referenceFile));
        if (!url) throw new Error(`引用笔记尚未绑定 JoySpace：${referenceFile.path}`);
        urls.set(referenceFile.path, url);
      }
      source = replaceNoteReferences(plan.raw, plan.references, urls);
      referenceMode = true;
    }
    // 标题与最终上传正文共同决定同步状态
    const prepared = this.prepareJoySpaceMarkdown(source, file);
    prepared.hash = crypto.createHash("sha256").update(prepared.title + "\n" + prepared.markdown, "utf8").digest("hex");
    // 指定文件的发布或更新结果
    let result;
    if (pageId) {
      // 经过校验的已绑定 JoySpace 页面地址
      const link = this.resolveJoySpaceUrl(cache);
      if (this.getFrontmatterValue(cache, "joyspace-sync-hash") === prepared.hash) {
        result = { pageId, link, skipped: true };
      } else {
        await this.updateMarkdownNote(file, prepared, link, pageId);
        result = { pageId, link };
      }
    } else {
      // 新建页面所需 Python 依赖只在实际创建时检查
      const pythonExecutable = this.settings.pythonExecutable.trim();
      if (pythonExecutable.includes("/")) await access(pythonExecutable);
      if (!await this.hasBrowserCookieDependency(pythonExecutable)) {
        throw new Error("缺少 browser_cookie3，请手动安装并检查 Python 设置");
      }
      result = await publishMarkdownFile({
        filePath: this.app.vault.adapter.getFullPath(file.path),
        markdown: prepared.markdown, title: prepared.title, prepared: true,
        pageUrl: resolveTargetPageUrl(cache?.frontmatter, this.settings.targetPageUrl),
        tenantCode: this.settings.tenantCode, pythonExecutable,
      });
      if (!result.pageId || !result.link) throw new Error("发布服务未返回有效页面绑定");
      result.link = normalizeJoySpaceDocumentUrl(result.link);
      // 创建成功立即保留绑定，回读失败也能避免重试重复创建
      await this.saveJoySpaceFrontmatter(file, {
        "joyspace-page-id": result.pageId, "joyspace-url": result.link,
        "joyspace-reference-mode": referenceMode ? "direct" : "none",
      });
      if (!result.verified) throw new Error("页面已创建并保存绑定，但正文回读验证失败，请重试更新");
    }
    await this.saveJoySpaceFrontmatter(file, {
      "joyspace-page-id": result.pageId, "joyspace-url": result.link,
      "joyspace-sync-hash": prepared.hash, "joyspace-synced-at": new Date().toISOString(),
      "joyspace-reference-mode": referenceMode ? "direct" : "none",
    });
    return result;
  }

  getCurrentOutputDir(adapter) {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.parent?.path) {
      return adapter.getFullPath(activeFile.parent.path);
    }
    return adapter.getFullPath("/");
  }

  async pullJoySpaceDocument(url) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      new Notice("请输入 JoySpace 文档链接", 5000);
      return;
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("JoySpace 拉取仅支持 Obsidian 桌面端本地仓库");
      return;
    }

    const pythonExecutable = this.settings.pythonExecutable.trim();
    try {
      if (pythonExecutable.includes("/")) {
        await access(pythonExecutable);
      }
    } catch {
      new Notice("Python 可执行文件不存在，请检查插件设置", 8000);
      return;
    }

    const hasCookieDependency = await this.hasBrowserCookieDependency(pythonExecutable);
    if (!hasCookieDependency) {
      new Notice("缺少 browser_cookie3。请在终端手动执行：python3 -m pip install --user browser_cookie3", 12000);
      return;
    }

    const outputDir = this.getCurrentOutputDir(adapter);
    new Notice("正在从 JoySpace 拉取文档...");
    try {
      /** 内置拉取模块返回的结构化结果 */
      const result = await pullJoySpaceDocumentFile({
        url: normalizedUrl,
        outputDir,
        tenantCode: this.settings.tenantCode,
        pythonExecutable,
      });
      const vaultPath = adapter.getFullPath("/");
      const relativePath = path.relative(vaultPath, result.outputPath).split(path.sep).join("/");
      const createdFile = this.app.vault.getAbstractFileByPath(relativePath);
      if (createdFile) {
        await this.app.workspace.getLeaf(false).openFile(createdFile);
      }
      new Notice(`已拉取 JoySpace 文档：${result.title}`, 6000);
    } catch (error) {
      const message = error?.stderr?.trim() || error?.message || String(error);
      console.error("[JoySpace Publisher] 拉取失败：", error);
      new Notice(`JoySpace 拉取失败：${message}`, 12000);
    }
  }

  async execWebcli(args, cwd) {
    const webcliExecutable = this.settings.webcliExecutable.trim() || "webcli";
    /** WebCLI 同目录下提供给 env 查找的 Node 可执行文件目录 */
    const webcliRuntimeDirectory = path.dirname(path.resolve(webcliExecutable));
    const { stdout, stderr } = await execFileAsync(webcliExecutable, args, {
      cwd,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: [webcliRuntimeDirectory, process.env.PATH || ""].filter(Boolean).join(path.delimiter),
      },
    });
    if (stderr.trim()) {
      console.warn("[JoySpace Publisher] WebCLI 警告：", stderr.trim());
    }
    return stdout;
  }

  parseWebcliJson(stdout) {
    const normalizedStdout = String(stdout || "").trim();
    if (!normalizedStdout) {
      return null;
    }
    try {
      return JSON.parse(normalizedStdout);
    } catch {
      throw new Error(`WebCLI 返回了无效 JSON：${normalizedStdout.slice(0, 300)}`);
    }
  }

  resolveJoySpaceUrl(cache) {
    const url = this.getFrontmatterValue(cache, "joyspace-url");
    const pageId = this.getFrontmatterValue(cache, "joyspace-page-id");
    if (url) {
      return normalizeJoySpaceDocumentUrl(url);
    }
    if (pageId) {
      return `https://joyspace.jd.com/pages/${pageId}`;
    }
    return "";
  }

  extractLastBodyBlockIndex(inspectOutput) {
    const text = typeof inspectOutput === "string" ? inspectOutput : JSON.stringify(inspectOutput || "");
    const indexes = [...text.matchAll(/\[(\d+)]/g)].map((match) => Number(match[1])).filter((index) => index > 0);
    return indexes.length ? Math.max(...indexes) : 0;
  }

  /** 更新命令同样保留当前文档的引用转换模式 */
  async updateActiveMarkdown() {
    await this.runActivePublish({ updateOnly: true });
  }

  /** 将指定文档的最终上传副本写入已绑定页面 */
  async updateMarkdownNote(file, prepared, joyspaceUrl, pageId) {
    // 临时正文只供 WebCLI 读取，源文件始终保留本地双链
    const markdownDir = path.dirname(this.app.vault.adapter.getFullPath(file.path));
    // 本次更新专用的临时目录，结束后清理
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "joyspace-publisher-"));
    // 供 WebCLI 读取的正文副本路径
    const tempMarkdownPath = path.join(tempDir, `${file.basename}.md`);
    try {
      await writeFile(tempMarkdownPath, prepared.markdown, "utf8");
      // 读取更新前页面结构
      const inspectStdout = await this.execWebcli(["joyspace", "edit", joyspaceUrl, "--mode", "inspect", "-f", "json"], markdownDir);
      // 解析页面结构结果
      const inspectOutput = this.parseWebcliJson(inspectStdout) || inspectStdout;
      // 保留旧正文范围供写入后清理
      const lastBodyBlockIndex = this.extractLastBodyBlockIndex(inspectOutput);

      await this.execWebcli(
        ["joyspace", "edit", joyspaceUrl, "--mode", "write", "--content-file", tempMarkdownPath, "--position", "end", "-f", "json"],
        markdownDir,
      );

      if (lastBodyBlockIndex > 0) {
        await this.execWebcli(
          ["joyspace", "edit", joyspaceUrl, "--mode", "delete", "--at", `1-${lastBodyBlockIndex}`, "-f", "json"],
          markdownDir,
        );
      }

      await this.execWebcli(["joyspace", "rename", joyspaceUrl, "--name", prepared.title, "-f", "json"], markdownDir);
      // 回读更新后的页面
      const viewStdout = await this.execWebcli(["joyspace", "view", joyspaceUrl, "-f", "json"], markdownDir);
      // 核对页面身份和标题
      const viewText = JSON.stringify(this.parseWebcliJson(viewStdout) || viewStdout);
      if (!viewText.includes(pageId) || !viewText.includes(prepared.title)) {
        throw new Error("更新后回读验证失败，未确认页面 ID 和标题一致");
      }

    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

};

class JoySpacePullModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.url = "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "从 JoySpace 拉取文档" });

    new Setting(contentEl)
      .setName("JoySpace 文档链接")
      .setDesc("请输入 https://joyspace.jd.com/pages/... 普通文档链接。")
      .addText((text) => {
        text.setPlaceholder("https://joyspace.jd.com/pages/...").onChange((value) => {
          this.url = value.trim();
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void this.submit();
          }
        });
        window.setTimeout(() => text.inputEl.focus(), 50);
      });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("拉取到当前目录")
          .setCta()
          .onClick(async () => {
            await this.submit();
          }),
      )
      .addButton((button) =>
        button.setButtonText("取消").onClick(() => {
          this.close();
        }),
      );
  }

  async submit() {
    const url = this.url.trim();
    if (!url) {
      new Notice("请输入 JoySpace 文档链接", 5000);
      return;
    }
    this.close();
    await this.onSubmit(url);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** 展示和维护 JoySpace 上传配置的设置页 */
class JoySpacePublisherSettingTab extends PluginSettingTab {
  /** 保存插件实例，供设置项更新时持久化配置 */
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** 渲染插件设置项 */
  display() {
    /** 当前设置页的内容容器 */
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "JoySpace Publisher" });

    new Setting(containerEl)
      .setName("检测本地运行环境")
      .setDesc("检测 Python、browser_cookie3 和 WebCLI。插件不会安装或更新任何本地依赖。")
      .addButton((button) =>
        button.setButtonText("重新检测环境").onClick(async () => {
          /** 本次手动环境检测是否成功 */
          const ready = await this.plugin.ensureRuntimeReady({ showNotice: true });
          if (ready) {
            this.display();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Python 可执行文件")
      .setDesc("用于读取本机浏览器中的 JoySpace 登录态。browser_cookie3 需要由用户手动安装。")
      .addText((text) =>
        text
          .setPlaceholder("自动检测中")
          .setValue(this.plugin.settings.pythonExecutable)
          .onChange(async (value) => {
            this.plugin.settings.pythonExecutable = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("WebCLI 可执行文件")
      .setDesc("用于更新已绑定的 JoySpace 页面。插件启用时通过 which webcli 自动填写，也可以手动修改。")
      .addText((text) =>
        text
          .setPlaceholder("webcli")
          .setValue(this.plugin.settings.webcliExecutable)
          .onChange(async (value) => {
            this.plugin.settings.webcliExecutable = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("目标 JoySpace 页面")
      .setDesc("可选。上传文档会创建在该页面所在目录；留空则创建在私人空间根目录。")
      .addText((text) =>
        text
          .setPlaceholder("https://joyspace.jd.com/pages/...")
          .setValue(this.plugin.settings.targetPageUrl)
          .onChange(async (value) => {
            this.plugin.settings.targetPageUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("租户编码")
      .setDesc("默认使用中国大陆京东集团租户。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("CN.JD.GROUP", "CN.JD.GROUP")
          .addOption("TH.JD.GROUP", "TH.JD.GROUP")
          .addOption("ID.JD.GROUP", "ID.JD.GROUP")
          .addOption("SF.JD.GROUP", "SF.JD.GROUP")
          .setValue(this.plugin.settings.tenantCode)
          .onChange(async (value) => {
            this.plugin.settings.tenantCode = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("提升章节标题层级")
      .setDesc("上传时将 ## 转为 #、### 转为 ##，不会修改本地 Markdown。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.promoteSectionHeadings).onChange(async (value) => {
          this.plugin.settings.promoteSectionHeadings = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("发布或更新后打开 JoySpace")
      .setDesc("发布或更新成功后使用系统浏览器打开 JoySpace 文档。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openAfterUpload).onChange(async (value) => {
          this.plugin.settings.openAfterUpload = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
