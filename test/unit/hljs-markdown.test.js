import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { withMarkdownEscapes } from "../../src/markdown/hljs-markdown.js";

/** @type {import("highlight.js").HLJSApi} */
let hljs;
/** @type {(text: string) => string} */
let highlight;
/** Unpatched markdown highlight for contrast. */
let highlightStock;

before(async () => {
  ({ default: hljs } = await import("highlight.js"));
  const markdown = (await import("highlight.js/lib/languages/markdown")).default;

  const stock = hljs.newInstance();
  stock.registerLanguage("markdown", markdown);
  highlightStock = (text) =>
    stock.highlight(text, { language: "markdown", ignoreIllegals: true }).value;

  hljs.registerLanguage("markdown", withMarkdownEscapes(markdown));
  highlight = (text) =>
    hljs.highlight(text, { language: "markdown", ignoreIllegals: true }).value;
});

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("withMarkdownEscapes", () => {
  it("does not treat \\* and \\_ as emphasis openers", () => {
    const src =
      "escaping characters like asterisks (\\*) and backticks (\\`) and underscores (\\_) when they appear";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.doesNotMatch(html, /hljs-emphasis/);
    // Stock grammar falsely wraps from the first escaped * through a later _.
    assert.match(highlightStock(src), /hljs-emphasis/);
  });

  it("keeps real *italic* and **bold** highlighting", () => {
    const src = "**bold** and *italic* and \\*not italic\\* and \\_not em\\_";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.match(html, /hljs-strong/);
    assert.match(html, /hljs-emphasis/);
    // Escaped pairs must not open additional emphasis after the real italic closes.
    assert.equal((html.match(/hljs-emphasis/g) || []).length, 1);
  });

  it("handles escaped markers inside blockquotes with strong text", () => {
    const src =
      "> **Note:** Parsers must correctly handle escaping characters like asterisks (\\*) and backticks (\\`) and underscores (\\_) when they appear within prose rather than formatting tags.";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.match(html, /hljs-quote/);
    assert.match(html, /hljs-strong/);
    assert.doesNotMatch(html, /hljs-emphasis/);
  });

  it("still highlights nested bold-italic combinations", () => {
    const src = "**_bold-italic combination_**";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.match(html, /hljs-strong/);
    assert.match(html, /hljs-emphasis/);
  });

  it("does not treat mid-word underscores as emphasis (filenames / snake_case)", () => {
    const src = "I have a file name eric_perret*.zip";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.doesNotMatch(html, /hljs-emphasis/);
    // Stock grammar opens italic at `_` (then `*`) and paints through EOF.
    assert.match(highlightStock(src), /hljs-emphasis/);
  });

  it("does not emphasize snake_case or ALL_CAPS identifiers", () => {
    for (const src of ["foo_bar_baz", "SOME_CONSTANT", "snake_case_var"]) {
      const html = highlight(src);
      assert.equal(stripTags(html), src);
      assert.doesNotMatch(html, /hljs-emphasis|hljs-strong/);
    }
  });

  it("does not emphasize bare *.ext or unmatched * (no runaway italic)", () => {
    for (const src of ["*.zip", "x*y", "**/*.go"]) {
      const html = highlight(src);
      assert.equal(stripTags(html), src);
      assert.doesNotMatch(html, /hljs-emphasis|hljs-strong/);
    }
  });

  it("still highlights word-boundary _italic_ and __bold__", () => {
    const src = "_italic_ and __bold__ at edges";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.match(html, /hljs-emphasis/);
    assert.match(html, /hljs-strong/);
  });

  it("keeps intraword *asterisk* emphasis (CommonMark allows it)", () => {
    const src = "a*b*c";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.match(html, /hljs-emphasis/);
  });

  it("still highlights ***bold-italic*** delimiter runs", () => {
    const src = "***bold-italic***";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.match(html, /hljs-strong/);
    assert.match(html, /hljs-emphasis/);
  });

  it("highlights nested list after an empty item (no indent swallow)", () => {
    const src = "-\n  - ninja";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.equal((html.match(/hljs-bullet/g) || []).length, 2);
    // Stock grammar's end:\\s+ eats the next line's indent after an empty item.
    assert.equal((highlightStock(src).match(/hljs-bullet/g) || []).length, 1);
  });

  it("highlights indented and spaceless blockquotes like marked", () => {
    for (const src of ["  > eric", ">eric5", "   > three"]) {
      const html = highlight(src);
      assert.equal(stripTags(html), src);
      assert.match(html, /hljs-quote/);
      assert.doesNotMatch(highlightStock(src), /hljs-quote/);
    }
  });

  it("keeps 4-space indented > as code, not a blockquote", () => {
    const src = "    > four";
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.match(html, /hljs-code/);
    assert.doesNotMatch(html, /hljs-quote/);
  });

  it("highlights the user list/blockquote sample consistently", () => {
    const src = [
      "- eric",
      "  - item 1",
      "  > eric",
      "",
      "  - eric 2",
      "",
      "  > eric 3",
      "",
      "-",
      "  - ninja",
      "",
      "> eric 4",
      "",
      ">eric5",
    ].join("\n");
    const html = highlight(src);
    assert.equal(stripTags(html), src);
    assert.equal((html.match(/hljs-bullet/g) || []).length, 5);
    assert.equal((html.match(/hljs-quote/g) || []).length, 4);
  });
});
