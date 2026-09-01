import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCookieHeader,
  buildCreatePagePayload,
  extractTitleFromMarkdown,
  normalizeBrowserCookiePayload,
  normalizeCookieMap,
  normalizeLocationFromBasicInfo,
  promoteSectionHeadingsForJoySpace,
} from "./import_markdown_doc.js";

test("extractTitleFromMarkdown prefers first markdown h1", () => {
  const markdown = "# Main Title\n\n## Section\n";
  const title = extractTitleFromMarkdown(markdown, "/tmp/fallback-name.md");
  assert.equal(title, "Main Title");
});

test("extractTitleFromMarkdown falls back to file stem", () => {
  const markdown = "No heading here";
  const title = extractTitleFromMarkdown(markdown, "/tmp/fallback-name.md");
  assert.equal(title, "fallback-name");
});

test("normalizeLocationFromBasicInfo maps private-space team ids to root", () => {
  const location = normalizeLocationFromBasicInfo({
    team_id: "$f38OgOIWJu5tLu1UD0wI",
    folder_id: "",
  });
  assert.deepEqual(location, {
    teamId: "root",
    folderId: undefined,
  });
});

test("buildCreatePagePayload omits folderId when absent", () => {
  const payload = buildCreatePagePayload({
    title: "Doc",
    markdown: "# Doc",
    teamId: "root",
    folderId: undefined,
  });

  assert.deepEqual(payload, {
    title: "Doc",
    page_type: 13,
    teamId: "root",
    content: [{ value: "# Doc" }],
    contentType: "markdown",
  });
});

test("promoteSectionHeadingsForJoySpace promotes sections but preserves title and fenced code", () => {
  const markdown = [
    "# TRD Title",
    "",
    "## 需求物料",
    "",
    "### 接口文档",
    "",
    "```mermaid",
    "flowchart TD",
    "A[## Keep Code Heading]",
    "```",
    "",
    "#### 深层章节",
    "",
  ].join("\n");

  assert.equal(
    promoteSectionHeadingsForJoySpace(markdown),
    [
      "# TRD Title",
      "",
      "# 需求物料",
      "",
      "## 接口文档",
      "",
      "```mermaid",
      "flowchart TD",
      "A[## Keep Code Heading]",
      "```",
      "",
      "### 深层章节",
      "",
    ].join("\n"),
  );
});

test("buildCookieHeader supports relay-style browser cookie jar", () => {
  const cookie = buildCookieHeader({
    cookies: {
      "sso.jd.com": "sso-123",
      me_token: "me-456",
      thor: "thor-789",
      empty: "",
    },
  });
  assert.equal(cookie, "sso.jd.com=sso-123; me_token=me-456; thor=thor-789");
});

test("buildCookieHeader ignores removed token-style auth inputs", () => {
  assert.equal(buildCookieHeader({ meToken: "me-456", ssoToken: "sso-123" }), "");
});

test("normalizeBrowserCookiePayload validates browser_cookie3 output", () => {
  assert.deepEqual(
    normalizeBrowserCookiePayload({
      ok: true,
      source: "chrome",
      cookies: {
        "sso.jd.com": " sso-123 ",
        "": "ignored",
        blank: "",
      },
    }),
    {
      cookies: {
        "sso.jd.com": "sso-123",
      },
      source: "chrome",
      error: "",
    },
  );

  assert.deepEqual(normalizeCookieMap(null), {});
  assert.match(
    normalizeBrowserCookiePayload({ ok: false, error: "not installed" }).error,
    /not installed/,
  );
});
