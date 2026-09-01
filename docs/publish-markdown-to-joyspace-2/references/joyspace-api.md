# JoySpace API Notes

This skill relies on relay-style browser cookie loading for JoySpace API requests.

## Important limitation

This skill uses one authentication path only: Python `browser_cookie3` reads `jd.com` cookies from the local browser cookie jar.

Required runtime state:

- `python3`
- `browser_cookie3`
- a logged-in `joyspace.jd.com` / `jd.com` session in Chrome or another supported local browser

Do not use `ME_TOKEN`, `SSO_TOKEN`, `~/.joyclaw/openclaw.json`, startup token, HiOffice, or CDP/browser automation as fallback auth paths.

## Private space default

For private-space pages, JoySpace `basic` responses can return:

- `team_id: "$<current_user_id>"`
- `folder_id: ""`

The existing JoySpace plugin normalizes team IDs starting with `$` into `root`, so this skill should create private-space docs with:

```json
{
  "teamId": "root"
}
```

and no `folderId`.

## Resolve target folder from an open page

Request:

```http
GET https://apijoyspace.jd.com/v3/pages/<page_id>/basic?sendRecent=0
```

Useful fields in the response:

- `team_id`
- `folder_id`
- `title`
- `full_name`

If `team_id` starts with `$`, normalize it to `root`.

## Create a markdown-backed normal doc

Request:

```http
POST https://apijoyspace.jd.com/v1/pages
Content-Type: application/json
```

Body:

```json
{
  "title": "文档标题",
  "page_type": 13,
  "teamId": "<team_id>",
  "content": [
    { "value": "# 标题\n\n正文" }
  ],
  "contentType": "markdown"
}
```

Only include `folderId` when it is non-empty.

## Direct import helper

Primary script:

```bash
node scripts/import_markdown_doc.js --file /abs/path/doc.md
```

For TRD publishing, promote section headings at upload time:

```bash
node scripts/import_markdown_doc.js --file /abs/path/trd.md --promote-section-headings
```

Heading promotion changes `##` to `#`, `###` to `##`, and so on. Existing `#` headings and fenced code blocks are preserved. The local file is not modified.

Optional overrides:

```bash
node scripts/import_markdown_doc.js \
  --file /abs/path/doc.md \
  --page-url https://joyspace.jd.com/pages/<page_id> \
  --promote-section-headings \
  --tenant-code CN.JD.GROUP
```

Output is JSON containing:

- `authMode`
- `cookieSource`
- `pageId`
- `link`
- `teamId`
- `folderId`
- `promotedSectionHeadings`
- `verified`

## Verify created content

Request:

```http
POST https://apijoyspace.jd.com/v1/pages/content
Content-Type: application/json
```

Body:

```json
{
  "pageId": "<new_page_id>"
}
```

Expected result:

- `status: "success"`
- `data.content` contains parsed blocks from the markdown input.

## Helper server

The helper server is kept for standalone local markdown serving tests and manual experiments. It is not part of the primary import auth path.

Example:

```bash
node scripts/serve_markdown.js --file /abs/path/doc.md --port 8765
```

It serves:

- `GET /md` -> markdown file contents
- `OPTIONS /md` -> CORS preflight response

Default allowed origin is `https://joyspace.jd.com`.



## Set table column widths to auto-fit

JoySpace converts Markdown tables into richtext blocks where each table has a `width` array (e.g. `[384, 384]` for a 2-column table). These numeric widths produce fixed, equally-split columns that may look cramped or misaligned.

To make all tables auto-fit their content, use the bundled script:

```bash
node scripts/set_table_autofit.mjs --page-url https://joyspace.jd.com/pages/<pageId>
```

Optional flag:

```bash
node scripts/set_table_autofit.mjs --page-url https://joyspace.jd.com/pages/<pageId> --tenant-code CN.JD.GROUP
```

### What the script does

1. Fetches the page content via `POST /v1/pages/content` (richtext blocks).
2. Replaces every `table` block's `width` array with `"auto"` per column (e.g. `["auto", "auto"]`).
3. Creates a new page via `POST /v1/pages` with `contentType: "richtext"` and the modified content, preserving the original `title`, `teamId`, and `folderId`.
4. Deletes the old page via `DELETE /v1/pages/<oldId>` (non-blocking on failure).
5. Returns a JSON result with the new page link and modification details.

### Why this approach

JoySpace does not expose a block-level PATCH or PUT endpoint for updating individual `width` fields. The only reliable way to change table widths is to recreate the page with modified richtext content. This script automates that process.

### Output fields

- `success`: boolean
- `oldPageId`: original page id
- `newPageId`: new page id
- `link`: new page URL
- `title`: page title
- `teamId`: team id
- `folderId`: folder id (empty string if none)
- `tableCount`: number of tables modified
- `details`: array of `{id, oldWidth, newWidth}` per table
- `recreated`: whether the page was recreated
- `oldDeleted`: whether the old page was deleted
- `authMode`: always `"browser"`
- `cookieSource`: e.g. `"chrome"`

When `oldDeleted` is `false`, the old page still exists and should be deleted manually.

### Delete a page

Request:

```http
DELETE https://apijoyspace.jd.com/v1/pages/<page_id>
x-team-id: <team_header_id>
Cookie: <jd.com browser cookies>
```

Expected result:

- `status: "success"`
