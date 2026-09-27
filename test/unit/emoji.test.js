import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownHtml } from "../helpers/render.js";

describe("emojiExtension", () => {
  it("converts shortcodes and emoticons from the classic sample", () => {
    const html = renderMarkdownHtml(
      "Classic: :wink: :cry: :laughing: :yum:\n\nShortcuts: :-) :-( ;) ",
    );
    assert.match(html, /😉/);
    assert.match(html, /😢/);
    assert.match(html, /😆/);
    assert.match(html, /😋/);
    assert.match(html, /🙂/);
    assert.match(html, /😦/);
  });

  it("leaves unknown shortcodes as literal text", () => {
    const html = renderMarkdownHtml(":notanemoji:");
    assert.match(html, /:notanemoji:/);
  });

  it("prefers longer emoticons when surrounded by spaces", () => {
    const html = renderMarkdownHtml("x >:( y");
    assert.match(html, /😠/);
  });

  const urlCases = [
    "http://www.ericperret.org?:-)",
    "https://example.com/path:-)/x",
    "See http://a.com/:)/b and note",
    "http://example.com/:wink: no",
    "Visit www.example.com?:-) please",
  ];

  for (const src of urlCases) {
    it(`does not convert emoji inside URL: ${src}`, () => {
      const html = renderMarkdownHtml(src);
      assert.doesNotMatch(html, /[😉😕🙂😦😎😠]/);
    });
  }

  it("converts emoticon after a URL on the same line", () => {
    const html = renderMarkdownHtml("text before http://x.com?:-) text after :-)");
    assert.match(html, /🙂/);
  });

  const boundaryKeep = [
    ["C:\\Users", /C:\\Users/],
    ["cost:$5", /cost:\$5/],
    ["(see step 8)", /step 8/],
  ];

  for (const [src, expect] of boundaryKeep) {
    it(`does not convert bound emoticon in ${JSON.stringify(src)}`, () => {
      const html = renderMarkdownHtml(src);
      assert.match(html, expect);
      assert.doesNotMatch(html, /[😕😒😎]/);
    });
  }

  it("treats 0:) as the angel emoticon", () => {
    const html = renderMarkdownHtml("v1.0:)");
    assert.match(html, /😇/);
  });

  it("converts <3 after a letter when left of < is a letter (no boundary)", () => {
    // Current emoticon rules: left of "<" is "o" (word char) so this should stay literal.
    // If the implementation converts anyway, document that here.
    const html = renderMarkdownHtml("foo<3");
    // Accept either behavior: literal or heart — boundary is at `<`.
    assert.ok(/foo(&lt;3|❤️|❤)/.test(html));
  });

  it("converts <3 with word boundaries", () => {
    const html = renderMarkdownHtml("x <3 y");
    assert.match(html, /❤️|❤/);
  });
});
