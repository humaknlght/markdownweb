import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("styles.css cascade order", () => {
  it("keeps fancy .editor-wrap after .editor-pane > .editor-wrap", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const layout = css.indexOf(".editor-pane > .editor-wrap");
    const fancy = css.indexOf('html[data-theme="fancy"] .editor-wrap');
    assert.ok(layout >= 0, "layout selector missing");
    assert.ok(fancy >= 0, "fancy selector missing");
    assert.ok(
      fancy > layout,
      "fancy .editor-wrap must follow .editor-pane > .editor-wrap",
    );
    assert.match(
      css.slice(fancy),
      /^html\[data-theme="fancy"\] \.editor-wrap\s*\{[^}]*background:\s*transparent;/s,
    );
  });

  it("keeps is-resizing #editor/.preview after base #editor and .preview", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const editor = css.indexOf(
      ".editor-highlight,\n#editor,\n#ai-proof-editor {",
    );
    const preview = css.indexOf(
      ".preview {\n  padding: 1.25rem 1.5rem 2.5rem;",
    );
    const resizing = css.indexOf(
      "html .panes.is-resizing #editor,\nhtml .panes.is-resizing .preview {",
    );
    assert.ok(editor >= 0, "base #editor group missing");
    assert.ok(preview >= 0, "base .preview missing");
    assert.ok(resizing >= 0, "is-resizing #editor/.preview missing");
    assert.ok(
      resizing > editor && resizing > preview,
      "is-resizing rules must follow base #editor and .preview",
    );
  });

  it("keeps toolbar-actions stacked collapse after base stacked collapse", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(
      '.collapse-btn .stacked-collapse,\n  .collapse-btn[aria-pressed="true"] .stacked-expand',
    );
    const toolbar = css.indexOf(
      ".toolbar-actions .collapse-btn .stacked-collapse",
    );
    assert.ok(base >= 0, "base stacked collapse missing");
    assert.ok(toolbar >= 0, "toolbar-actions stacked collapse missing");
    assert.ok(
      toolbar > base,
      "toolbar-actions stacked collapse must follow base stacked collapse",
    );
  });

  it("keeps fancy .splitter after base .splitter", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(".splitter {\n  transition: visibility 0s;");
    const themed = css.indexOf(
      'html[data-theme="fancy"] .splitter {\n  background: rgba(255, 255, 255, 0.28);',
    );
    assert.ok(base >= 0, "base .splitter missing");
    assert.ok(themed >= 0, "fancy .splitter missing");
    assert.ok(themed > base, "fancy .splitter must follow base .splitter");
  });

  it("keeps salesforce .splitter after base .splitter", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(".splitter {\n  transition: visibility 0s;");
    const themed = css.indexOf('html[data-theme="salesforce"] .splitter {');
    assert.ok(base >= 0, "base .splitter missing");
    assert.ok(themed >= 0, "salesforce .splitter missing");
    assert.ok(themed > base, "salesforce .splitter must follow base .splitter");
    assert.match(
      css.slice(themed),
      /^html\[data-theme="salesforce"\] \.splitter\s*\{[^}]*background:\s*#90d0fe;/s,
    );
  });

  it("keeps base .splitter before collapsed .splitter rules", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(".splitter {\n  transition: visibility 0s;");
    const collapsed = css.indexOf("html .panes.editor-collapsed .splitter");
    assert.ok(base >= 0, "base .splitter missing");
    assert.ok(collapsed >= 0, "collapsed .splitter missing");
    assert.ok(
      base < collapsed,
      "base .splitter must precede collapsed .splitter rules",
    );
  });

  it("keeps salesforce splitter hover after base splitter hover", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(".splitter:hover,\n.splitter:focus-visible {");
    const themed = css.indexOf('html[data-theme="salesforce"] .splitter:hover');
    assert.ok(base >= 0, "base splitter hover missing");
    assert.ok(themed >= 0, "salesforce splitter hover missing");
    assert.ok(
      themed > base,
      "salesforce splitter hover must follow base splitter hover",
    );
    assert.match(
      css.slice(themed),
      /^html\[data-theme="salesforce"\] \.splitter:hover,\s*html\[data-theme="salesforce"\] \.splitter:focus-visible,\s*html\[data-theme="salesforce"\] \.panes\.is-resizing \.splitter\s*\{[^}]*background:\s*#0176d3;/s,
    );
  });

  it("keeps salesforce .preview pre code after .editor-highlight code", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(".editor-highlight code {");
    const themed = css.indexOf(
      'html[data-theme="salesforce"] .preview pre code',
    );
    assert.ok(base >= 0, "base .editor-highlight code missing");
    assert.ok(themed >= 0, "salesforce .preview pre code missing");
    assert.ok(
      themed > base,
      "salesforce .preview pre code must follow .editor-highlight code",
    );
    assert.match(
      css.slice(themed),
      /^html\[data-theme="salesforce"\] \.preview pre code\s*\{[^}]*color:\s*#eaf5fe;/s,
    );
  });

  it("keeps salesforce .editor-highlight tokens after base .editor-highlight", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(
      ".editor-highlight {\n  /* Not a scroll container:",
    );
    const themed = css.indexOf(
      'html[data-theme="salesforce"] .editor-highlight',
    );
    assert.ok(base >= 0, "base .editor-highlight missing");
    assert.ok(themed >= 0, "salesforce .editor-highlight missing");
    assert.ok(
      themed > base,
      "salesforce .editor-highlight must follow base .editor-highlight",
    );
    assert.match(
      css.slice(themed),
      /^html\[data-theme="salesforce"\] \.editor-highlight\s*\{[^}]*--syntax-comment:\s*#6a737d;/s,
    );
  });

  it("keeps base .editor-highlight before data-line-wrap=off rules", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(
      ".editor-highlight {\n  /* Not a scroll container:",
    );
    const wrapOff = css.indexOf('html[data-line-wrap="off"] .editor-highlight');
    assert.ok(base >= 0, "base .editor-highlight missing");
    assert.ok(wrapOff >= 0, "line-wrap-off .editor-highlight missing");
    assert.ok(
      base < wrapOff,
      "base .editor-highlight must precede data-line-wrap=off rules",
    );
  });

  it("keeps fancy #editor::placeholder after base placeholder", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(
      "#editor::placeholder {\n  color: var(--chrome-muted);",
    );
    const fancy = css.indexOf('html[data-theme="fancy"] #editor::placeholder');
    assert.ok(base >= 0, "base #editor::placeholder missing");
    assert.ok(fancy >= 0, "fancy #editor::placeholder missing");
    assert.ok(
      fancy > base,
      "fancy #editor::placeholder must follow base placeholder",
    );
  });

  it("keeps dedicated #editor before data-line-wrap=off rules", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const editor = css.indexOf("#editor {\n  z-index: 1;\n  resize: none;");
    const wrapOff = css.indexOf('html[data-line-wrap="off"] #editor');
    assert.ok(editor >= 0, "dedicated #editor missing");
    assert.ok(wrapOff >= 0, "line-wrap-off #editor missing");
    assert.ok(
      editor < wrapOff,
      "dedicated #editor must precede data-line-wrap=off rules",
    );
  });

  it("keeps fancy splitter hover after base splitter hover", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    const base = css.indexOf(".splitter:hover,\n.splitter:focus-visible {");
    const themed = css.indexOf('html[data-theme="fancy"] .splitter:hover');
    assert.ok(base >= 0, "base splitter hover missing");
    assert.ok(themed >= 0, "fancy splitter hover missing");
    assert.ok(
      themed > base,
      "fancy splitter hover must follow base splitter hover",
    );
    assert.match(
      css.slice(themed),
      /^html\[data-theme="fancy"\] \.splitter:hover,\s*html\[data-theme="fancy"\] \.splitter:focus-visible,\s*html\[data-theme="fancy"\] \.panes\.is-resizing \.splitter\s*\{[^}]*background:\s*var\(--chrome-focus\);/s,
    );
  });

  it("hides view chrome without !important (polyfill is the only styles.css !important)", async () => {
    const css = await fs.readFile(
      path.join(root, "src/styles/styles.css"),
      "utf8",
    );
    for (const re of [
      /html\[data-view="edit"\] \.reader-only,\s*html\[data-view="slides"\] \.reader-only\s*\{[^}]*display:\s*none;/s,
      /html\[data-view="reader"\] \.authoring-only,\s*html\[data-view="present"\] \.authoring-only\s*\{[^}]*display:\s*none;/s,
      /html\[data-view="present"\] \.preview > \[hidden\],\s*html\[data-view="slides"\] \.preview > \[hidden\]\s*\{[^}]*display:\s*none;/s,
      /\.present-chrome\[hidden\]\s*\{[^}]*display:\s*none;/s,
      /body\.files-drawer-dragging \.files-drawer\s*\{[^}]*transition:\s*none;/s,
    ]) {
      assert.match(css, re);
    }
    assert.doesNotMatch(
      css,
      /html\[data-view="edit"\] \.reader-only[\s\S]*?display:\s*none\s*!important/,
    );
    assert.doesNotMatch(
      css,
      /\.present-chrome\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s,
    );
    const propertyImportants = [
      ...css.matchAll(/^[ \t]*[a-z-]+\s*:[^;]*!important/gim),
    ];
    assert.equal(
      propertyImportants.length,
      1,
      "only [hidden] polyfill may use !important",
    );
    assert.match(propertyImportants[0][0], /display:\s*none\s*!important/);
  });
});
