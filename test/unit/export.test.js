import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  GENERATOR_URL,
  buildHtmlDocument,
  buildMarkdownFile,
  buildRtfDocument,
  buildDocxBlob,
  cleanPreviewHtml,
  exportBasename,
} from "../../src/export.js";

describe("exportBasename", () => {
  it("slugifies titles and falls back to markdown", () => {
    assert.equal(exportBasename("Hello World!"), "Hello-World");
    assert.equal(exportBasename(" "), "markdown");
    assert.equal(exportBasename(""), "Untitled");
    assert.equal(exportBasename("a".repeat(70)).length, 60);
  });
});

describe("buildMarkdownFile", () => {
  it("prepends title and generator front matter", () => {
    const out = buildMarkdownFile("# Hello", "My Doc");
    assert.match(out, /^---\n/);
    assert.match(out, /title: My Doc/);
    assert.match(out, new RegExp(`generator: ${GENERATOR_URL}`));
    assert.match(out, /# Hello/);
  });

  it("leaves existing front matter unchanged", () => {
    const src = "---\ntitle: x\n---\nBody";
    assert.equal(buildMarkdownFile(src, "Irrelevant"), src);
  });
});

describe("buildHtmlDocument", () => {
  it("embeds the body, escaped title, and generator meta", () => {
    const doc = buildHtmlDocument("<p>Hi</p>", "Test");
    assert.match(doc, /<!DOCTYPE html>/);
    assert.match(doc, /<title>Test<\/title>/);
    assert.match(doc, /<p>Hi<\/p>/);
    assert.match(doc, new RegExp(GENERATOR_URL));
    assert.match(buildHtmlDocument("", "<script>"), /&lt;script&gt;/);
  });
});

describe("DOM exporters", () => {
  function previewWith(html) {
    const win = new Window({ url: "https://example.test/" });
    // export.js walks Node constants via numeric nodeType on the element tree.
    const el = win.document.createElement("article");
    el.innerHTML = html;
    return el;
  }

  it("cleans preview chrome from HTML exports", () => {
    const el = previewWith(
      `<h1 data-source-line="1">Hi</h1><mark class="speech-word">x</mark>` +
        `<button class="md-section-toggle">▼</button><p hidden>slide2</p>`,
    );
    const html = cleanPreviewHtml(el);
    assert.doesNotMatch(html, /data-source-line/);
    assert.doesNotMatch(html, /speech-word/);
    assert.doesNotMatch(html, /md-section-toggle/);
    assert.doesNotMatch(html, /hidden/);
    assert.match(html, /slide2/);
  });

  it("builds RTF with info block and generator", () => {
    const el = previewWith("<p>Hello</p>");
    const rtf = buildRtfDocument(el, "Doc");
    assert.match(rtf, /\{\\info/);
    assert.match(rtf, /Hello/);
  });

  it("builds a DOCX zip starting with PK", async () => {
    const el = previewWith("<p>Hello</p>");
    const blob = buildDocxBlob(el, "Doc");
    const buf = new Uint8Array(await blob.arrayBuffer());
    assert.equal(String.fromCharCode(buf[0], buf[1]), "PK");
  });
});
