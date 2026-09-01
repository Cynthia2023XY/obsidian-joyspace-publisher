import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMarkdownServer } from "./serve_markdown.js";

test("createMarkdownServer serves markdown content with JoySpace CORS headers", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "joyspace-md-skill-"));
  const markdownPath = path.join(tempDir, "sample.md");
  const markdown = "# Title\n\nHello JoySpace\n";
  await fs.writeFile(markdownPath, markdown, "utf8");

  const server = await createMarkdownServer({
    filePath: markdownPath,
    host: "127.0.0.1",
    port: 0,
    allowedOrigin: "https://joyspace.jd.com",
  });

  try {
    const response = await fetch(`${server.url}/md`);
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.equal(text, markdown);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://joyspace.jd.com",
    );
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  } finally {
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
