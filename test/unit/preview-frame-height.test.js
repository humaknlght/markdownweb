import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { measurePreviewFrameContentHeight } from "../../src/app/preview-frame-height.js";

describe("preview frame content height", () => {
  it("uses #preview scrollHeight and ignores taller html/body", () => {
    const { window: win } = new JSDOM(
      `<!DOCTYPE html><html><body><article id="preview"></article></body></html>`,
    );
    const doc = win.document;
    const root = doc.documentElement;
    const body = doc.body;
    const article = doc.getElementById("preview");

    Object.defineProperty(root, "scrollHeight", {
      value: 5000,
      configurable: true,
    });
    Object.defineProperty(body, "scrollHeight", {
      value: 4800,
      configurable: true,
    });
    Object.defineProperty(article, "scrollHeight", {
      value: 1200,
      configurable: true,
    });

    // Old Math.max(root, body, article) would latch at 5000 after a tall Mermaid
    // paint; content height must follow the article so the iframe can shrink.
    assert.equal(measurePreviewFrameContentHeight(doc), 1200);
    assert.equal(
      Math.max(root.scrollHeight, body.scrollHeight, article.scrollHeight),
      5000,
    );
  });

  it("falls back to 1px when #preview is missing", () => {
    const { window: win } = new JSDOM(
      `<!DOCTYPE html><html><body></body></html>`,
    );
    assert.equal(measurePreviewFrameContentHeight(win.document), 1);
  });
});
