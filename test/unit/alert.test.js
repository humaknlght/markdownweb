import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownHtml } from "../helpers/render.js";

describe("alertExtension", () => {
  for (const type of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
    it(`renders [!${type}] as markdown-alert-${type.toLowerCase()}`, () => {
      const html = renderMarkdownHtml(`> [!${type}]\n> Body`);
      assert.match(html, new RegExp(`markdown-alert-${type.toLowerCase()}`));
      assert.match(html, /markdown-alert-title/);
      assert.match(html, /<svg/);
      assert.doesNotMatch(html, /<blockquote/);
    });
  }

  it("matches alert types case-insensitively", () => {
    const html = renderMarkdownHtml("> [!note]\n> Hi");
    assert.match(html, /markdown-alert-note/);
  });

  it("trims same-line body after the marker", () => {
    const html = renderMarkdownHtml("> [!WARNING] Same-line body");
    assert.match(html, /Same-line body/);
    assert.doesNotMatch(html, />\s+Same-line/);
  });

  it("keeps a normal blockquote as blockquote", () => {
    const html = renderMarkdownHtml("> just a quote");
    assert.match(html, /<blockquote/);
    assert.doesNotMatch(html, /markdown-alert/);
  });

  it("leaves unknown [!FOO] as a blockquote", () => {
    const html = renderMarkdownHtml("> [!FOO]\n> nope");
    assert.match(html, /<blockquote/);
    assert.doesNotMatch(html, /markdown-alert/);
  });

  it("renders inline markdown inside the alert body", () => {
    const html = renderMarkdownHtml("> [!TIP]\n> **bold** and `code`");
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
  });
});
