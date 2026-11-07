import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildManifest } from "../../scripts/pwa.mjs";
import { THEMES, THEME_COLORS } from "../../src/app/constants.js";
import { applyPwaDisplayAttrs } from "../../src/app/pwa-display-attrs.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("applyPwaDisplayAttrs", () => {
  it("sets data-pwa for an installed window and clears data-wco when the overlay is off", () => {
    const { document } = new JSDOM("<!DOCTYPE html><html></html>").window;
    applyPwaDisplayAttrs(document.documentElement, {
      standalone: true,
      wcoVisible: false,
    });
    assert.equal(document.documentElement.hasAttribute("data-pwa"), true);
    assert.equal(document.documentElement.hasAttribute("data-wco"), false);
  });

  it("sets both data-pwa and data-wco when the overlay is visible", () => {
    const { document } = new JSDOM("<!DOCTYPE html><html></html>").window;
    applyPwaDisplayAttrs(document.documentElement, {
      standalone: true,
      wcoVisible: true,
    });
    assert.equal(document.documentElement.hasAttribute("data-pwa"), true);
    assert.equal(document.documentElement.hasAttribute("data-wco"), true);
  });

  it("clears both attributes in a normal browser tab", () => {
    const { document } = new JSDOM("<!DOCTYPE html><html data-pwa data-wco></html>").window;
    applyPwaDisplayAttrs(document.documentElement, {
      standalone: false,
      wcoVisible: false,
    });
    assert.equal(document.documentElement.hasAttribute("data-pwa"), false);
    assert.equal(document.documentElement.hasAttribute("data-wco"), false);
  });
});

describe("PWA toolbar border CSS", () => {
  it("adds top+bottom borders for installed PWA with the system title bar", async () => {
    const css = await fs.readFile(path.join(root, "src/styles/styles.css"), "utf8");
    assert.match(
      css,
      /html\[data-pwa\]:not\(\[data-wco\]\)\s*\.toolbar\s*\{[^}]*border-top:\s*1px solid var\(--chrome-border\)/s,
    );
    assert.match(
      css,
      /html\[data-pwa\]:not\(\[data-wco\]\)\s*\.toolbar\s*\{[^}]*border-bottom:\s*1px solid var\(--chrome-border\)/s,
    );
  });

  it("removes top+bottom borders when the button bar is in the title bar (WCO)", async () => {
    const css = await fs.readFile(path.join(root, "src/styles/styles.css"), "utf8");
    assert.match(
      css,
      /html\[data-wco\]\s*\.toolbar\s*\{[^}]*border-top:\s*0/s,
    );
    assert.match(
      css,
      /html\[data-wco\]\s*\.toolbar\s*\{[^}]*border-bottom:\s*0/s,
    );
  });

  it("keeps the default browser toolbar border-bottom outside PWA selectors", async () => {
    const css = await fs.readFile(path.join(root, "src/styles/styles.css"), "utf8");
    const toolbarBlock = css.match(/(?:^|\n)\.toolbar\s*\{[^}]+\}/);
    assert.ok(toolbarBlock, "expected a base .toolbar rule");
    assert.match(toolbarBlock[0], /border-bottom:\s*1px solid var\(--chrome-border\)/);
    assert.doesNotMatch(toolbarBlock[0], /border-top:/);
  });
});

describe("PWA manifest + theme-color", () => {
  it("opts into window-controls-overlay with a standalone fallback", () => {
    const m = JSON.parse(buildManifest());
    assert.deepEqual(m.display_override, ["window-controls-overlay"]);
    assert.equal(m.display, "standalone");
  });

  it("defines a theme-color for every theme (WCO chrome blend)", () => {
    for (const theme of THEMES) {
      assert.equal(typeof THEME_COLORS[theme], "string");
      assert.match(THEME_COLORS[theme], /^#[0-9a-fA-F]{6}$/);
    }
  });
});
