/** Obsidian 插件运行时提供的界面和文件系统能力 */
const { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
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

/** 插件首次启用时使用的默认配置 */
const DEFAULT_SETTINGS = {
  nodeExecutable: "",
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
    await this.ensureRuntimeReady();

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

  /** 自动检测并保存 Node 与 Python 的安装位置 */
  async detectRuntimePaths({ showNotice = false } = {}) {
    try {
      /** 登录 Shell 中检测到的 Node 安装位置 */
      const nodeExecutable = await this.detectExecutable("node");
      /** 登录 Shell 中检测到的 Python 安装位置 */
      const pythonExecutable = await this.detectExecutable("python3");
      /** 登录 Shell 中检测到的 WebCLI 安装位置 */
      let webcliExecutable = this.settings.webcliExecutable;
      try {
        webcliExecutable = await this.detectExecutable("webcli");
      } catch {
        webcliExecutable = this.settings.webcliExecutable;
      }

      this.settings.nodeExecutable = nodeExecutable;
      this.settings.pythonExecutable = pythonExecutable;
      this.settings.webcliExecutable = webcliExecutable;
      await this.saveSettings();

      if (showNotice) {
        new Notice(`已自动检测 Node、Python 和 WebCLI：\n${nodeExecutable}\n${pythonExecutable}\n${webcliExecutable || "未检测到 webcli"}`, 8000);
      }
      return true;
    } catch (error) {
      /** 对用户展示的自动检测失败原因 */
      const message = error?.message || String(error);
      console.error("[JoySpace Publisher] 自动检测运行环境失败：", error);
      if (showNotice) {
        new Notice(`自动检测 Node/Python 失败：${message}`, 10000);
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

  /** 为指定 Python 环境安装 JoySpace 登录态读取依赖 */
  async installBrowserCookieDependency(pythonExecutable) {
    await execFileAsync(pythonExecutable, ["-m", "pip", "install", "--user", "browser_cookie3"], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  }

  /** 自动检测运行环境并补齐上传所需的 Python 依赖 */
  async ensureRuntimeReady({ showNotice = false } = {}) {
    /** Node 与 Python 路径是否已完成检测 */
    const detected = await this.detectRuntimePaths({ showNotice: false });
    if (!detected) {
      if (showNotice) {
        new Notice("Node/Python 自动检测失败，请确认终端中可以执行 node 和 python3", 10000);
      }
      return false;
    }

    /** 当前插件配置中的 Python 可执行文件路径 */
    const pythonExecutable = this.settings.pythonExecutable.trim();
    if (!pythonExecutable) {
      if (showNotice) {
        new Notice("未检测到 Python 路径，无法安装 browser_cookie3", 10000);
      }
      return false;
    }

    /** 当前 Python 环境是否已经具备读取浏览器 Cookie 的依赖 */
    const hasDependency = await this.hasBrowserCookieDependency(pythonExecutable);
    if (hasDependency) {
      if (showNotice) {
        new Notice(`运行环境已就绪：\n${this.settings.nodeExecutable}\n${pythonExecutable}`, 8000);
      }
      return true;
    }

    try {
      if (showNotice) {
        new Notice("正在自动安装 browser_cookie3，请稍候...", 8000);
      }
      await this.installBrowserCookieDependency(pythonExecutable);

      /** 安装后再次确认依赖是否可被当前 Python 导入 */
      const installed = await this.hasBrowserCookieDependency(pythonExecutable);
      if (!installed) {
        throw new Error("browser_cookie3 安装完成后仍无法导入");
      }

      if (showNotice) {
        new Notice(`已安装 browser_cookie3，运行环境已就绪：\n${pythonExecutable}`, 8000);
      }
      return true;
    } catch (error) {
      /** 对用户展示的依赖安装失败原因 */
      const message = error?.stderr?.trim() || error?.message || String(error);
      console.error("[JoySpace Publisher] 自动安装 browser_cookie3 失败：", error);
      if (showNotice) {
        new Notice(`自动安装 browser_cookie3 失败：${message}`, 12000);
      }
      return false;
    }
  }

  /** 获取插件内置上传脚本的绝对路径 */
  resolveImportScriptPath(adapter) {
    /** 插件清单记录的目录路径 */
    const manifestDir = this.manifest.dir || `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    /** 插件目录的绝对路径 */
    const pluginDir = path.isAbsolute(manifestDir) ? manifestDir : adapter.getFullPath(manifestDir);
    return path.join(pluginDir, "import_markdown_doc.mjs");
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
    /** 用户配置的 Node 可执行文件路径或命令 */
    const nodeExecutable = this.settings.nodeExecutable.trim();
    /** 用户配置的 Python 可执行文件路径或命令 */
    const pythonExecutable = this.settings.pythonExecutable.trim();
    /** 实际使用的上传脚本绝对路径 */
    let importScriptPath = "";

    try {
      importScriptPath = this.resolveImportScriptPath(adapter);
      if (nodeExecutable.includes("/")) {
        await access(nodeExecutable);
      }
      if (pythonExecutable.includes("/")) {
        await access(pythonExecutable);
      }
      await access(importScriptPath);
    } catch {
      new Notice("Node、Python 可执行文件或 JoySpace 上传脚本不存在，请检查插件设置", 8000);
      return;
    }

    /** 当前 Python 是否已经安装读取 JoySpace 登录态所需依赖 */
    const hasCookieDependency = await this.hasBrowserCookieDependency(pythonExecutable);
    if (!hasCookieDependency) {
      try {
        new Notice("正在安装 JoySpace 上传依赖 browser_cookie3，请稍候...", 8000);
        await this.installBrowserCookieDependency(pythonExecutable);
      } catch (error) {
        /** 对用户展示的上传前依赖安装失败原因 */
        const message = error?.stderr?.trim() || error?.message || String(error);
        console.error("[JoySpace Publisher] 上传前安装 browser_cookie3 失败：", error);
        new Notice(`browser_cookie3 安装失败：${message}`, 12000);
        return;
      }
    }

    const originalMarkdown = await this.app.vault.read(activeFile);
    const prepared = this.prepareJoySpaceMarkdown(originalMarkdown, activeFile);

    /** 本次上传传递给导入脚本的命令参数 */
    const args = [importScriptPath, "--file", markdownPath, "--tenant-code", this.settings.tenantCode];
    if (this.settings.targetPageUrl.trim()) {
      args.push("--page-url", this.settings.targetPageUrl.trim());
    }
    if (this.settings.promoteSectionHeadings) {
      args.push("--promote-section-headings");
    }

    new Notice(`正在上传《${activeFile.basename}》到 JoySpace...`);

    try {
      /** 上传脚本返回的标准输出与错误输出 */
      const { stdout, stderr } = await execFileAsync(nodeExecutable, args, {
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          PYTHON: pythonExecutable,
        },
      });
      if (stderr.trim()) {
        console.warn("[JoySpace Publisher] 上传脚本警告：", stderr.trim());
      }

      /** 上传脚本返回的结构化结果 */
      const result = this.parseUploadResult(stdout, stderr);
      if (!result.link || !result.pageId) {
        throw new Error("上传脚本未返回有效的 JoySpace 文档地址");
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
        await shell.openExternal(result.link);
      }
    } catch (error) {
      /** 对用户展示的上传失败原因 */
      const message = error?.stderr?.trim() || error?.message || String(error);
      console.error("[JoySpace Publisher] 上传失败：", error);
      new Notice(`JoySpace 上传失败：${message}`, 10000);
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
        PATH: [this.settings.nodeExecutable.trim() ? path.dirname(this.settings.nodeExecutable.trim()) : "", process.env.PATH]
          .filter(Boolean)
          .join(path.delimiter),
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
      return url;
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
    const joyspaceUrl = this.resolveJoySpaceUrl(cache);
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

  /** 将上传脚本标准输出解析为结果，并为异常输出提供明确原因 */
  parseUploadResult(stdout, stderr) {
    /** 去除首尾空白后的上传脚本标准输出 */
    const normalizedStdout = String(stdout || "").trim();
    if (!normalizedStdout) {
      throw new Error(
        `上传脚本执行完成但未返回结果${stderr?.trim() ? `：${stderr.trim()}` : "，请确认内置脚本完整且插件已重新加载"}`,
      );
    }

    try {
      return JSON.parse(normalizedStdout);
    } catch {
      throw new Error(`上传脚本返回了无效 JSON：${normalizedStdout.slice(0, 300)}`);
    }
  }
};

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
      .setName("自动检测运行环境与依赖")
      .setDesc("使用登录 Shell 检测 node/python3，并自动安装 Python 依赖 browser_cookie3。")
      .addButton((button) =>
        button.setButtonText("重新检测并安装").onClick(async () => {
          /** 本次手动检测和依赖安装是否成功 */
          const ready = await this.plugin.ensureRuntimeReady({ showNotice: true });
          if (ready) {
            this.display();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Node 可执行文件")
      .setDesc("插件启用时通过 which node 自动填写，也可以手动修改。")
      .addText((text) =>
        text
          .setPlaceholder("自动检测中")
          .setValue(this.plugin.settings.nodeExecutable)
          .onChange(async (value) => {
            this.plugin.settings.nodeExecutable = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Python 可执行文件")
      .setDesc("插件启用时通过 which python3 自动填写，并会尝试为该 Python 自动安装 browser_cookie3。")
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
