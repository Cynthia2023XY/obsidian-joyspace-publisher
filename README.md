# JoySpace Publisher

Publish, update, and import Markdown documents between Obsidian and JoySpace.

## Features

- Publish the active Markdown document to a JoySpace folder or private-space root.
- Update a previously bound JoySpace page and skip unchanged content.
- Override the default destination with `joyspace-target-page-url` in frontmatter.
- Import a JoySpace regular document into the current Obsidian folder.
- Optionally promote section headings and open the JoySpace page after publishing.

## Requirements

- Obsidian desktop.
- Python 3 with [`browser_cookie3`](https://pypi.org/project/browser-cookie3/) installed by the user.
- Chrome or another supported browser signed in to `joyspace.jd.com` and `jd.com`.
- `webcli` for updating pages that were already published.

The plugin never installs or updates local dependencies. Install the Python dependency manually when needed:

```bash
python3 -m pip install --user browser_cookie3
```

Use **Settings → JoySpace Publisher → Recheck environment** after changing Python or WebCLI.

## Installation

A release installation contains only:

```text
main.js
manifest.json
```

Copy those files into `<vault>/.obsidian/plugins/joyspace-publisher/`, then enable **JoySpace Publisher** under Community plugins.

## Usage

Open a Markdown document and run one of these commands:

- **Publish/update active document to JoySpace**
- **Update active document on the bound JoySpace page**
- **Import document from a JoySpace link into the current folder**

After the first successful publish, the plugin writes these fields to the document frontmatter:

```yaml
joyspace-page-id: "..."
joyspace-url: "https://joyspace.jd.com/pages/..."
joyspace-sync-hash: "..."
joyspace-synced-at: "..."
```

To override the default destination for one document, add:

```yaml
joyspace-target-page-url: "https://joyspace.jd.com/teams/<team-id>/<folder-id>"
```

## Privacy and network usage

- The plugin connects to `https://apijoyspace.jd.com` to create pages, inspect destination information, and retrieve regular-document content.
- It opens `https://joyspace.jd.com` links only after a successful operation and only when the corresponding setting is enabled.
- Publishing sends the active document title, Markdown body, selected tenant, and destination information to JoySpace.
- Importing sends the requested JoySpace page ID and saves the returned content inside the current vault.
- Authentication reads browser cookies for `jd.com` from supported local browser profiles through the user-installed `browser_cookie3` package. Cookies are used only to authenticate requests to JoySpace; the plugin does not write them to plugin settings, note files, or an author-controlled service.
- Updating an existing page invokes the locally installed `webcli` executable with an argument array. Reading browser login state invokes the configured Python executable. The plugin does not concatenate document content into a shell command.
- Temporary Markdown files used for WebCLI updates are created in the operating system temporary directory and removed after success or failure.
- The plugin contains no client-side analytics, telemetry, advertising, or author-controlled data collection service.
- Plugin settings remain in the vault's Obsidian plugin data after the plugin is disabled. Frontmatter written to notes also remains until the user removes it. Uninstalling the plugin directory removes its settings but does not alter note frontmatter.

## Development

```bash
npm install
npm test
npm run build
```

The production build bundles project-owned runtime modules into a single CommonJS `main.js`. `obsidian` and `electron` remain runtime externals provided by the desktop app.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Cynthia Ding.
