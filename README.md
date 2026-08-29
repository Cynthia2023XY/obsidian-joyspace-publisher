# JoySpace Publisher

Obsidian 桌面端插件：一键将当前 Markdown 文档上传为新的 JoySpace 文档。

## 功能

- 左侧工具栏点击上传当前 Markdown。
- 命令面板执行“上传当前文档到 JoySpace”。
- 默认上传到 JoySpace 私人空间根目录。
- 可指定一个 JoySpace 页面，将新文档创建到该页面所在目录。
- 可在上传时提升章节标题层级。
- 上传成功后可自动打开 JoySpace 文档。

## 分发文件

将以下文件一起发送给使用者，不能只发送上传脚本：

```text
main.js
manifest.json
import_markdown_doc.mjs
README.md
```

内置上传脚本使用 `.mjs` 扩展名，Node 会自动按照 ES Module 执行，不需要额外的 `package.json`。

## 安装

将本目录复制或软链接到 Obsidian 仓库：

```bash
ln -s \
  /Users/dingxinyi.2/Documents/practice/obsidian-joyspace-publisher \
  "<你的仓库路径>/.obsidian/plugins/joyspace-publisher"
```

然后在 Obsidian 的“设置 → 第三方插件”中启用 `JoySpace Publisher`。

## 运行要求

- Obsidian 桌面端。
- 本机可执行 `node` 和 `python3`。
- Chrome 已登录 `joyspace.jd.com` / `jd.com`。
- 插件目录中存在内置的 `import_markdown_doc.mjs`。

插件始终自动使用内置脚本，不需要配置上传脚本路径。

插件启用时会通过用户登录 Shell 自动执行：

```bash
which node
which python3
```

检测结果会自动写入插件设置，并会检查当前 Python 是否已安装 `browser_cookie3`。如果缺少该依赖，插件会自动执行：

```bash
python3 -m pip install --user browser_cookie3
```

更换 Node 或 Python 后，可以在设置页点击“重新检测并安装”。如果首次启用时受网络或权限影响没有安装成功，点击上传时插件也会再次尝试安装依赖。

## 使用

打开一个 Markdown 文档，然后点击左侧上传图标，或在命令面板执行：

```text
JoySpace Publisher: 上传当前文档到 JoySpace
```
