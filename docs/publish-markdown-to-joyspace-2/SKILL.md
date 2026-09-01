---
name: publish-markdown-to-joyspace
description: Use when a user wants to create a JoySpace document from a local Markdown file, import Markdown into JoySpace, publish a TRD or requirement Markdown as a JoySpace page, or save local `.md` content into JoySpace.
---

# Publish Markdown To Joyspace

Use this skill when a user wants a local Markdown file turned into a new JoySpace document.

## Runtime Requirements

- A readable local `.md` file path.
- A JoySpace/JD login state available in a local browser cookie jar.
- `python3` with `browser_cookie3` installed.
  - Install with `python3 -m pip install browser_cookie3` if missing.
  - Chrome is the validated first source; other supported browsers are fallback sources.

## Scope

This skill creates a new JoySpace page. It does not edit, append to, or replace an existing page in place.

Default behavior:

- Create the document in the JoySpace private space root.

Optional behavior:

- If the user provides a JoySpace page or folder URL, derive the destination `teamId` and `folderId` from that location and create the new document there.

## Workflow

1. Confirm the Markdown file path exists locally.
2. Resolve the target save location.
   - No target URL: use private space root.
   - Target JoySpace URL: fetch page basic info and derive `teamId` and `folderId`.
3. Import with the bundled script:

```bash
node scripts/import_markdown_doc.js --file /abs/path/doc.md
```

When publishing a TRD, promote section headings for JoySpace display:

```bash
node scripts/import_markdown_doc.js --file /abs/path/trd.md --promote-section-headings
```

This upload-time conversion keeps the local Markdown unchanged, and sends JoySpace content with headings promoted one level: `## -> #`, `### -> ##`, and so on. Existing `#` headings and fenced code blocks are preserved.

Use optional flags only when needed:

```bash
node scripts/import_markdown_doc.js \
  --file /abs/path/doc.md \
  --title "Document Title" \
  --page-url https://joyspace.jd.com/pages/<page_id> \
  --promote-section-headings \
  --tenant-code CN.JD.GROUP
```

Resolve `scripts/` relative to this skill directory. If the agent runs commands from another working directory, use the absolute path to this skill's `scripts/import_markdown_doc.js`.

4. Read the JSON result printed to stdout.
5. Verify success from the script result.
   - `link` must be present.
   - `pageId` must be present.
   - `promotedSectionHeadings` shows whether heading promotion was applied.
   - `verified` should be true when JoySpace content verification succeeds.
6. Return the created JoySpace document link and destination details.

## Auth Rules

- Auth is resolved only through relay-style browser cookies: Python `browser_cookie3` reads `jd.com` cookies, Chrome first.
- Do not use `ME_TOKEN`, `SSO_TOKEN`, `~/.joyclaw/openclaw.json`, startup token, local HiOffice exchange, or Playwright browser state as alternate auth paths.
- If browser-cookie auth fails, stop and tell the user to install `browser_cookie3` and log in to `joyspace.jd.com` / `jd.com` in Chrome.

## Output Requirements

Final response must include:

- Created JoySpace URL.
- Source Markdown file path.
- Destination `teamId` and `folderId`.
- Browser cookie source, such as `chrome`.
- Whether content verification succeeded.

If verification fails, say whether page creation failed or only content verification failed.

## API Reference

Read `references/joyspace-api.md` before changing the script or troubleshooting JoySpace API behavior.

Bundled scripts:

- `scripts/import_markdown_doc.js`: primary import path.
- `scripts/serve_markdown.js`: small local Markdown server kept for tests and manual experiments; not part of the primary import workflow.

## Set Table Column Widths to Auto-fit

After publishing a Markdown document, JoySpace renders tables with fixed, equally-split column widths. For TRD documents with many tables, this often results in poor readability.

Use the bundled script to change all table columns to auto-fit width:

```bash
node scripts/set_table_autofit.mjs --page-url https://joyspace.jd.com/pages/<pageId>
```

Optional flag:

```bash
node scripts/set_table_autofit.mjs --page-url https://joyspace.jd.com/pages/<pageId> --tenant-code CN.JD.GROUP
```

### When to use

- After publishing a TRD or any document with multiple Markdown tables.
- When tables appear cramped because JoySpace assigns equal fixed widths to all columns.

### How it works

The script reads the existing page content (richtext blocks), sets every table block's `width` array to `["auto", "auto", ...]`, recreates the page with the modified content, and deletes the old page. The page URL changes, but title, team, and folder are preserved.

### Output

The script prints a JSON result to stdout containing:

- `success`: whether the operation completed
- `oldPageId` / `newPageId`: the swapped page IDs
- `link`: the new page URL
- `tableCount`: number of tables modified
- `oldDeleted`: whether the old page was deleted (manual deletion needed if `false`)

### Failure handling

- If the page has no tables, the script returns `recreated: false` and the original page is left untouched.
- If old page deletion fails, `oldDeleted` is `false`; the user should delete the old page manually.

## Failure Mode

- Missing Markdown path: ask for it.
- File not found: report the path and stop.
- Cookie loading failure: do not try alternate auth modes.
- Target URL cannot be parsed: ask for a valid JoySpace page or folder URL.
- JoySpace API failure: report the API error and do not fabricate a link.
