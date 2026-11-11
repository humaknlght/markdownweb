import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("print.css theme cascade", () => {
  it("uses higher-specificity line-num color without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html\.md-preview-frame\[data-theme\]\s+\.preview\s+\.line-num\s*\{[^}]*color:\s*var\(--syntax-comment\);/s,
    );
    assert.doesNotMatch(
      print,
      /html\.md-preview-frame\[data-theme\]\s+\.preview\s+\.line-num\s*\{[^}]*color:\s*var\(--syntax-comment\)\s*!important/s,
    );
  });

  it("clears page background-image in print without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*background-image:\s*none;/s,
    );
    assert.doesNotMatch(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*background-image:\s*none\s*!important/s,
    );
  });

  it("sets print body color without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*color:\s*#1f2328;/s,
    );
    assert.doesNotMatch(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*color:\s*#1f2328\s*!important/s,
    );
  });

  it("sets print page height without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(print, /html\[data-theme\]\s+body\s*\{[^}]*height:\s*auto;/s);
    assert.doesNotMatch(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*height:\s*auto\s*!important/s,
    );
  });

  it("sets print inline code color without !important via raised specificity", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /\.preview code:not\(pre code\),\s*html\[data-theme\] \.preview code:not\(pre code\)\s*\{([^}]+)\}/s,
    );
    assert.ok(block, "expected raised-specificity inline code rule");
    assert.match(block[1], /color:\s*inherit;/);
    assert.doesNotMatch(block[1], /color:\s*inherit\s*!important/);
  });

  it("sets print inline code background without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /\.preview code:not\(pre code\),\s*html\[data-theme\] \.preview code:not\(pre code\)\s*\{([^}]+)\}/s,
    );
    assert.ok(block);
    assert.match(block[1], /background:\s*var\(--preview-code-bg\);/);
    assert.doesNotMatch(
      block[1],
      /background:\s*var\(--preview-code-bg\)\s*!important/,
    );
  });

  it("sets print inline code border-radius without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /\.preview code:not\(pre code\),\s*html\[data-theme\] \.preview code:not\(pre code\)\s*\{([^}]+)\}/s,
    );
    assert.ok(block);
    assert.match(block[1], /border-radius:\s*3px;/);
    assert.doesNotMatch(block[1], /border-radius:\s*3px\s*!important/);
  });

  it("sets print pre background without !important via raised specificity", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /html\[data-theme\] \.preview pre\s*\{([^}]+)\}/s,
    );
    assert.ok(block, "expected themed pre chrome rule");
    assert.match(block[1], /background:\s*var\(--preview-pre-bg\);/);
    assert.doesNotMatch(
      block[1],
      /background:\s*var\(--preview-pre-bg\)\s*!important/,
    );
  });

  it("sets print pre border without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /html\[data-theme\] \.preview pre\s*\{([^}]+)\}/s,
    );
    assert.ok(block);
    assert.match(block[1], /border:\s*1px solid var\(--preview-pre-border\);/);
    assert.doesNotMatch(
      block[1],
      /border:\s*1px solid var\(--preview-pre-border\)\s*!important/,
    );
  });

  it("sets print pre border-radius without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /html\[data-theme\] \.preview pre\s*\{([^}]+)\}/s,
    );
    assert.ok(block);
    assert.match(block[1], /border-radius:\s*6px;/);
    assert.doesNotMatch(block[1], /border-radius:\s*6px\s*!important/);
  });

  it("sets print pre color without !important via raised specificity", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /\.preview pre,\s*\.preview pre code,\s*html\[data-theme\] \.preview pre,\s*html\[data-theme\] \.preview pre code\s*\{([^}]+)\}/s,
    );
    assert.ok(block, "expected raised-specificity pre color rule");
    assert.match(block[1], /color:\s*inherit;/);
    assert.doesNotMatch(block[1], /!important/);
  });

  it("sets print page display without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*display:\s*block;/s,
    );
    assert.doesNotMatch(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*display:\s*block\s*!important/s,
    );
  });

  it("sets print mermaid background without !important via raised specificity", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /\.preview \.mermaid,\s*\.preview \.mermaid svg,\s*html\[data-theme\] \.preview \.mermaid,\s*html\[data-theme\] \.preview \.mermaid svg\s*\{([^}]+)\}/s,
    );
    assert.ok(block, "expected raised-specificity mermaid rule");
    assert.match(block[1], /background:\s*var\(--mermaid-bg\);/);
    assert.doesNotMatch(
      block[1],
      /background:\s*var\(--mermaid-bg\)\s*!important/,
    );
  });

  it("sets print mermaid filter without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /\.preview \.mermaid,\s*\.preview \.mermaid svg,\s*html\[data-theme\] \.preview \.mermaid,\s*html\[data-theme\] \.preview \.mermaid svg\s*\{([^}]+)\}/s,
    );
    assert.ok(block);
    assert.match(block[1], /filter:\s*none;/);
    assert.doesNotMatch(block[1], /filter:\s*none\s*!important/);
  });

  it("sets print mermaid background-color without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(
      /\.preview \.mermaid,\s*\.preview \.mermaid svg,\s*html\[data-theme\] \.preview \.mermaid,\s*html\[data-theme\] \.preview \.mermaid svg\s*\{([^}]+)\}/s,
    );
    assert.ok(block);
    assert.match(block[1], /background-color:\s*var\(--mermaid-bg\);/);
    assert.doesNotMatch(
      block[1],
      /background-color:\s*var\(--mermaid-bg\)\s*!important/,
    );
  });

  it("keeps collapsed preview-pane print rule above descending specificity", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html \.panes\.preview-collapsed \.preview-pane,\s*html\[data-theme\] \.panes\.preview-collapsed \.preview-pane\s*\{/s,
    );
  });

  it("resets alert tokens to github-light values for print", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    const block = print.match(/html\[data-theme\]\s*\{([^}]+)\}/s);
    assert.ok(block, "expected print token reset block");
    assert.match(block[1], /--alert-note:\s*#0969da;/);
    assert.match(block[1], /--alert-tip:\s*#1a7f37;/);
    assert.match(block[1], /--alert-important:\s*#8250df;/);
    assert.match(block[1], /--alert-warning:\s*#9a6700;/);
    assert.match(block[1], /--alert-caution:\s*#cf222e;/);
  });

  it("keeps print page background !important (beats fancy/zen equal-specificity color)", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*background:\s*#fff\s*!important;/s,
    );
  });

  it("neutralizes themed preview chrome without !important (group A)", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );

    const blockquote = print.match(
      /\.preview blockquote,\s*html\[data-theme\] \.preview blockquote\s*\{([^}]+)\}/s,
    );
    assert.ok(blockquote, "expected raised-specificity blockquote rule");
    assert.match(blockquote[1], /background:\s*transparent;/);
    assert.match(
      blockquote[1],
      /border-left:\s*3px solid var\(--preview-quote\);/,
    );
    assert.match(blockquote[1], /border-radius:\s*0;/);
    assert.match(blockquote[1], /padding:\s*0\.15em 0 0\.15em 1em;/);
    assert.match(blockquote[1], /color:\s*var\(--preview-muted\);/);
    assert.doesNotMatch(blockquote[1], /!important/);

    const alert = print.match(/\.preview \.markdown-alert\s*\{([^}]+)\}/s);
    assert.ok(alert, "expected markdown-alert rule");
    assert.doesNotMatch(alert[1], /!important/);

    assert.match(
      print,
      /\.preview \.markdown-alert-note\s*\{\s*border-left-color:\s*var\(--alert-note\);\s*\}/s,
    );
    assert.match(
      print,
      /\.preview \.markdown-alert-note \.markdown-alert-title\s*\{\s*color:\s*var\(--alert-note\);\s*\}/s,
    );

    const frontmatter = print.match(
      /\.preview table\.markdown-frontmatter\s*\{([^}]+)\}/s,
    );
    assert.ok(frontmatter);
    assert.match(frontmatter[1], /display:\s*table;/);
    assert.match(frontmatter[1], /overflow:\s*visible;/);
    assert.doesNotMatch(frontmatter[1], /!important/);

    const table = print.match(
      /\.preview table\s*\{\s*display:\s*table;\s*overflow:\s*visible;\s*width:\s*100%;\s*\}/s,
    );
    assert.ok(table, "expected plain table print rule without !important");

    const preWrap = print.match(
      /html\[data-theme\] \.preview pre,\s*html\[data-theme\] \.preview pre code\s*\{([^}]*overflow:\s*visible;[^}]*)\}/s,
    );
    assert.ok(preWrap);
    assert.match(preWrap[1], /white-space:\s*pre-wrap;/);
    assert.doesNotMatch(preWrap[1], /!important/);

    assert.match(
      print,
      /html\[data-theme\] \.preview \.line-num,\s*html\.md-preview-frame\[data-theme\] \.preview \.line-num\s*\{[^}]*border-right-color:\s*var\(--preview-pre-border\);/s,
    );
    assert.doesNotMatch(
      print,
      /border-right-color:\s*var\(--preview-pre-border\)\s*!important/,
    );

    assert.match(
      print,
      /\.preview a,\s*html\[data-theme\] \.preview a\s*\{[^}]*font-weight:\s*inherit;/s,
    );
  });
});
