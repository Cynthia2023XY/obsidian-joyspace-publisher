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

  async publishOrUpdateActiveMarkdown() {
    const activeFile = this.app.workspace.getActiveFile();
    const cache = activeFile ? this.app.metadataCache.getFileCache(activeFile) : null;
    const pageId = this.getFrontmatterValue(cache, "joyspace-page-id");
    if (pageId) {
      await this.updateActiveMarkdown();
      return;
    }
    await this.publishActiveMarkdown();
  }

  /** 上传当前打开的 Markdown 文件并反馈执行结果 */
  async publishActiveMarkdown() {
    /** 当前编辑器中打开的文件 */
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("请先打开一个 Markdown 文档");
      return;
    }

    /** 当前仓库使用的文件适配器 */
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("JoySpace 上传仅支持 Obsidian 桌面端本地仓库");
      return;
    }

    /** 当前 Markdown 文件的绝对路径 */
    const markdownPath = adapter.getFullPath(activeFile.path);
    /** 用户配置的 Python 可执行文件路径或命令 */
    const pythonExecutable = this.settings.pythonExecutable.trim();

    try {
      if (pythonExecutable.includes("/")) {
        await access(pythonExecutable);
      }
    } catch {
      new Notice("Python 可执行文件不存在，请检查插件设置", 8000);
      return;
    }

    /** 当前 Python 是否已经安装读取 JoySpace 登录态所需依赖 */
    const hasCookieDependency = await this.hasBrowserCookieDependency(pythonExecutable);
    if (!hasCookieDependency) {
      new Notice("缺少 browser_cookie3。请在终端手动执行：python3 -m pip install --user browser_cookie3", 12000);
      return;
    }

    const originalMarkdown = await this.app.vault.read(activeFile);
    const prepared = this.prepareJoySpaceMarkdown(originalMarkdown, activeFile);
    /** 当前文档的 YAML 元数据缓存 */
    const cache = this.app.metadataCache.getFileCache(activeFile);
    /** 按文档 YAML 优先级解析后的 JoySpace 目录定位链接 */
    const targetPageUrl = resolveTargetPageUrl(cache?.frontmatter, this.settings.targetPageUrl);

    new Notice(`正在上传《${activeFile.basename}》到 JoySpace...`);

    try {
      /** 内置发布模块返回的结构化结果 */
      const result = await publishMarkdownFile({
        filePath: markdownPath,
        pageUrl: targetPageUrl,
        tenantCode: this.settings.tenantCode,
        promoteSectionHeadings: this.settings.promoteSectionHeadings,
        pythonExecutable,
      });
      if (!result.link || !result.pageId) {
        throw new Error("发布服务未返回有效的 JoySpace 文档地址");
      }

      await this.saveJoySpaceFrontmatter(activeFile, {
        "joyspace-page-id": result.pageId,
        "joyspace-url": result.link,
        "joyspace-sync-hash": prepared.hash,
        "joyspace-synced-at": new Date().toISOString(),
      });

      new Notice(`已上传到 JoySpace：${result.title || activeFile.basename}`, 6000);
      console.info("[JoySpace Publisher] 上传成功：", result);

      if (this.settings.openAfterUpload) {
        await shell.openExternal(normalizeJoySpaceDocumentUrl(result.link));
      }
    } catch (error) {
      /** 对用户展示的上传失败原因 */
      const message = error?.stderr?.trim() || error?.message || String(error);
      console.error("[JoySpace Publisher] 上传失败：", error);
      new Notice(`JoySpace 上传失败：${message}`, 10000);
    }
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
    const { stdout, stderr } = await execFileAsync(webcliExecutable, args, {
      cwd,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
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

  async updateActiveMarkdown() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("请先打开一个 Markdown 文档");
      return;
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("JoySpace 更新仅支持 Obsidian 桌面端本地仓库");
      return;
    }

    const cache = this.app.metadataCache.getFileCache(activeFile);
    const pageId = this.getFrontmatterValue(cache, "joyspace-page-id");
    /** 校验后用于 WebCLI 更新的 JoySpace 文档地址 */
    let joyspaceUrl = "";
    try {
      joyspaceUrl = this.resolveJoySpaceUrl(cache);
    } catch (error) {
      /** 无效 frontmatter 地址对应的用户提示 */
      const message = error?.message || String(error);
      new Notice(`JoySpace 文档链接无效：${message}`, 8000);
      return;
    }
    if (!pageId || !joyspaceUrl) {
      new Notice("当前文档未绑定 JoySpace 页面，请先发布一次", 8000);
      return;
    }

    const originalMarkdown = await this.app.vault.read(activeFile);
    const prepared = this.prepareJoySpaceMarkdown(originalMarkdown, activeFile);
    const lastHash = this.getFrontmatterValue(cache, "joyspace-sync-hash");
    if (lastHash && lastHash === prepared.hash) {
      new Notice("内容无变化，无需更新 JoySpace", 5000);
      return;
    }

    const markdownPath = adapter.getFullPath(activeFile.path);
    const markdownDir = path.dirname(markdownPath);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "joyspace-publisher-"));
    const tempMarkdownPath = path.join(tempDir, `${activeFile.basename}.md`);

    new Notice(`正在更新 JoySpace：《${activeFile.basename}》...`);

    try {
      await writeFile(tempMarkdownPath, prepared.markdown, "utf8");
      const inspectStdout = await this.execWebcli(["joyspace", "edit", joyspaceUrl, "--mode", "inspect", "-f", "json"], markdownDir);
      const inspectOutput = this.parseWebcliJson(inspectStdout) || inspectStdout;
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
      const viewStdout = await this.execWebcli(["joyspace", "view", joyspaceUrl, "-f", "json"], markdownDir);
      const viewText = JSON.stringify(this.parseWebcliJson(viewStdout) || viewStdout);
      if (!viewText.includes(pageId) || !viewText.includes(prepared.title)) {
        throw new Error("更新后回读验证失败，未确认页面 ID 和标题一致");
      }

      await this.saveJoySpaceFrontmatter(activeFile, {
        "joyspace-page-id": pageId,
        "joyspace-url": joyspaceUrl,
        "joyspace-sync-hash": prepared.hash,
        "joyspace-synced-at": new Date().toISOString(),
      });

      new Notice(`已更新 JoySpace：${prepared.title}`, 6000);
      if (this.settings.openAfterUpload) {
        await shell.openExternal(joyspaceUrl);
      }
    } catch (error) {
      const message = error?.stderr?.trim() || error?.message || String(error);
      console.error("[JoySpace Publisher] 更新失败：", error);
      new Notice(`JoySpace 更新失败：${message}`, 12000);
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
