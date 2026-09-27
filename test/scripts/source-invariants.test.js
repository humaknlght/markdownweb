import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDN_PRECACHE } from "../../scripts/pwa.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("static source invariants", () => {
  it("keeps import map, CDN_PRECACHE, and THEMES in sync", async () => {
    const html = await fs.readFile(path.join(root, "src/index.html"), "utf8");
    assert.match(html, /type="importmap"/);
    assert.match(html, /window\.__MD_SW__="__SW_URL__"/);
    assert.match(html, /marked@18\.0\.13/);
    assert.match(html, /dompurify@3\.4\.15/);
    assert.match(html, /gemoji@8\.1\.0/);
    assert.match(html, /yaml@2\.9\.1/);

    for (const url of CDN_PRECACHE) {
      if (url.includes("mermaid")) continue; // dynamically imported, not in import map
      if (url.includes("languages/")) continue;
      const bare = url.includes("marked")
        ? "marked"
        : url.includes("dompurify")
          ? "dompurify"
          : url.includes("highlight")
            ? "highlight.js"
            : url.includes("gemoji")
              ? "gemoji"
              : url.includes("yaml")
                ? "yaml"
                : null;
      if (bare) assert.match(html, new RegExp(bare));
    }

    const app = await fs.readFile(path.join(root, "src/app.js"), "utf8");
    assert.match(
      app,
      /THEMES = \["github-light", "github-dark", "sepia", "terminal", "salesforce", "fancy"\]/,
    );
    // Theme boot script list in HTML must mention the same themes
    for (const theme of [
      "github-light",
      "github-dark",
      "sepia",
      "terminal",
      "salesforce",
      "fancy",
    ]) {
      assert.match(html, new RegExp(theme));
    }
  });

  it("htaccess has security and cache rules", async () => {
    const ht = await fs.readFile(path.join(root, "public/.htaccess"), "utf8");
    assert.match(ht, /DirectorySlash On/);
    assert.match(ht, /__SCRIPT_SRC__/);
    assert.match(ht, /__GUIDE_URL__/);
    assert.match(ht, /rel=prefetch/);
    assert.match(ht, /web-share=\(\)/);
    assert.match(ht, /fullscreen=\(self\)/);
    assert.match(ht, /og-image/);
    assert.match(ht, /Cross-Origin-Resource-Policy/);
  });
});
