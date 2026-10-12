# JoySpace Publisher

简体中文 | [English](README-EN.md)

在 Obsidian 与 JoySpace 之间发布、更新和导入 Markdown 文档。

## 功能

- 将当前笔记发布到 JoySpace 指定目录或私人空间根目录。
- 更新已绑定的 JoySpace 页面，内容未变化时跳过更新。
- 使用专有命令，同时发布当前笔记及其一层引用，并将上传正文中的引用转换为 JoySpace 链接。
- 通过笔记 YAML 中的 `joyspace-target-page-url` 覆盖默认发布位置。
- 将 JoySpace 普通文档导入 Obsidian 当前目录。
- 页面标题使用 Markdown 文件名（不含 `.md`），正文保留首个 H1 和全部标题层级。
- 可选在发布成功后打开 JoySpace 页面。

## 使用要求

- Obsidian 桌面端。
- Python 3，以及由用户安装的 [`browser_cookie3`](https://pypi.org/project/browser-cookie3/)。
- Chrome 或其他受支持浏览器中已登录 `joyspace.jd.com` 和 `jd.com`。
- 更新已发布页面时需要安装 `webcli`。

插件不会安装或更新本地依赖。需要时请手动安装 Python 依赖：

```bash
python3 -m pip install --user browser_cookie3
```

修改 Python 或 WebCLI 环境后，在 **设置 → JoySpace Publisher → 检测本地运行环境 → 重新检测环境** 中重新检查。

## 安装

从 [GitHub Releases](https://github.com/Cynthia2023XY/obsidian-joyspace-publisher/releases) 下载以下两个附件：

```text
main.js
manifest.json
```

将它们放到 `<笔记库>/.obsidian/plugins/joyspace-publisher/`，然后在 Obsidian 的第三方插件设置中启用 **JoySpace Publisher**。

## 使用方法

打开一篇 Markdown 笔记，在命令面板执行以下命令之一：

- **发布/更新当前文档到 JoySpace**
- **发布/更新当前笔记及一层引用到 JoySpace**
- **更新当前文档到已绑定 JoySpace 页面**
- **从 JoySpace 链接拉取文档到当前目录**

首次发布成功后，插件会将以下字段写入笔记的 YAML 属性：

```yaml
joyspace-page-id: "..."
joyspace-url: "https://joyspace.jd.com/pages/..."
joyspace-sync-hash: "..."
joyspace-synced-at: "..."
```

如需为某篇笔记指定发布位置，可添加：

```yaml
joyspace-target-page-url: "https://joyspace.jd.com/teams/<team-id>/<folder-id>"
```

## 同时发布一层引用

执行 **发布/更新当前笔记及一层引用到 JoySpace**，插件会先处理当前笔记直接引用的 Markdown 笔记，再发布当前笔记，并将上传副本中的引用替换为 JoySpace 链接。同一篇笔记重复出现时只处理一次。

引用深度固定为一层：被引用笔记中的其他引用不会继续上传。自身引用、外部网址、图片和其他附件不纳入引用笔记上传。

支持双链、别名、Markdown 笔记链接和笔记嵌入。嵌入会转成普通链接；标题和块引用链接到整个页面，不定位到具体段落。例如：

```markdown
[[设计方案|查看设计]]
```

上传副本中的对应内容会转换为：

```markdown
[查看设计](https://joyspace.jd.com/pages/xxx)
```

本地笔记正文保留原来的 Obsidian 引用。每篇笔记优先使用自身的 `joyspace-target-page-url`，未配置时使用插件默认发布位置。

找不到引用笔记时，操作会在上传前停止。某篇引用上传失败时，当前笔记不会继续发布；已成功创建的页面会保留绑定，重试时复用。创建成功但正文回读验证失败时，也会先保存页面绑定。若本地属性写入失败，仍可能需要手动补回已创建页面的绑定信息。

当前笔记会保存 `joyspace-reference-mode: direct`。之后执行普通更新时，会使用引用笔记已绑定的 JoySpace 地址，保留链接转换效果，但不会额外上传引用笔记。新增引用或需要更新引用笔记内容时，请再次执行一层引用发布命令。同步哈希包含标题和最终上传正文。

## 隐私与网络访问

- 插件连接 `https://apijoyspace.jd.com`，用于创建页面、查询发布位置和获取普通文档内容。
- 仅在操作成功且开启相应设置时，通过系统浏览器打开 `https://joyspace.jd.com` 链接。
- 发布时会向 JoySpace 发送文档标题、Markdown 正文、所选租户和发布位置；一层引用命令还会发送直接引用的 Markdown 笔记。
- 导入时会发送目标 JoySpace 页面 ID，并将返回内容保存到当前笔记库。
- 认证通过用户安装的 `browser_cookie3` 读取本机受支持浏览器中的 `jd.com` Cookie。Cookie 仅用于 JoySpace 请求认证，不会写入插件设置、笔记文件或作者控制的服务。
- 更新已有页面时，通过参数数组调用本机安装的 `webcli`；读取浏览器登录态时调用配置的 Python。插件不会将文档正文拼接到 Shell 命令中。
- WebCLI 更新使用的临时 Markdown 文件保存在操作系统临时目录，成功或失败后都会清理。
- 插件不包含客户端分析、遥测、广告或作者控制的数据收集服务。
- 禁用插件后，设置仍保留在笔记库的插件数据中；已写入的 YAML 属性也会保留，直到用户手动移除。删除插件目录会移除设置，但不会更改笔记属性。

## 开发

```bash
npm install
npm test
npm run build
```

生产构建会将项目运行时模块打包为单个 CommonJS `main.js`。`obsidian` 和 `electron` 由 Obsidian 桌面运行环境提供，不包含在构建产物中。

## 许可证

采用 [MIT License](LICENSE)。Copyright © 2026 Cynthia Ding。
