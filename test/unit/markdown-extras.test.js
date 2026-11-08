import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAbbrDef, applyAbbreviations } from "../../src/markdown/abbr.js";
import {
  findFootnoteDefStart,
  parseFootnoteDef,
} from "../../src/markdown/footnotes.js";
import { applyHeadingId } from "../../src/markdown/heading-ids.js";
import { parseMarkdown, renderMarkdownHtml } from "../helpers/render.js";

describe("task lists", () => {
  it("renders disabled checkbox spans instead of <input>", () => {
    const html = renderMarkdownHtml("- [x] Write the press release\n- [ ] Update the website\n");
    assert.match(html, /task-list-item-checkbox/);
    assert.match(html, /aria-checked="true"/);
    assert.match(html, /aria-checked="false"/);
    assert.match(html, /task-list-item/);
    assert.doesNotMatch(html, /<input\b/i);
    assert.match(html, /Write the press release/);
  });
});

describe("heading IDs", () => {
  it("strips {#id} and applies it via applyHeadingId", () => {
    const token = {
      type: "heading",
      text: "My Great Heading {#custom-id}",
      tokens: [{ type: "text", text: "My Great Heading {#custom-id}", raw: "My Great Heading {#custom-id}" }],
    };
    assert.equal(applyHeadingId(token), true);
    assert.equal(token.customId, "custom-id");
    assert.equal(token.text, "My Great Heading");
    assert.equal(token.tokens[0].text, "My Great Heading");
  });

  it("renders id on the heading element", () => {
    const html = renderMarkdownHtml("### My Great Heading {#custom-id}\n");
    assert.match(html, /<h3 id="custom-id">My Great Heading<\/h3>/);
    assert.doesNotMatch(html, /\{#custom-id\}/);
  });

  it("rejects unsafe id characters", () => {
    const html = renderMarkdownHtml("### Bad {#bad id}\n");
    assert.doesNotMatch(html, /id="/);
    assert.match(html, /\{#bad id\}/);
  });
});

describe("mark highlight", () => {
  it("renders ==text== and ::text:: as <mark>", () => {
    const html = renderMarkdownHtml("==twoequals==\n\n::twohypens::\n");
    assert.match(html, /<mark>twoequals<\/mark>/);
    assert.match(html, /<mark>twohypens<\/mark>/);
  });
});

describe("sub and sup", () => {
  it("renders H~2~O as subscript and X^2^ as superscript", () => {
    const html = renderMarkdownHtml("H~2~O and X^2^\n");
    assert.match(html, /H<sub>2<\/sub>O/);
    assert.match(html, /X<sup>2<\/sup>/);
  });

  it("keeps ~~strike~~ and spaced ~strike~ as <del>", () => {
    const html = renderMarkdownHtml("~~two tilde~~\n\n~one tilde~\n");
    assert.match(html, /<del>two tilde<\/del>/);
    assert.match(html, /<del>one tilde<\/del>/);
    assert.doesNotMatch(html, /<sub>one tilde<\/sub>/);
  });
});

describe("abbreviations", () => {
  it("parses *[ABBR]: title definitions", () => {
    const parsed = parseAbbrDef("*[HTML]: Hyper Text Markup Language\n");
    assert.ok(parsed);
    assert.equal(parsed.abbr, "HTML");
    assert.equal(parsed.title, "Hyper Text Markup Language");
  });

  it("wraps matching words in <abbr title>", () => {
    const html = renderMarkdownHtml(
      "*[HTML]: Hyper Text Markup Language\n\nThe HTML specification is maintained by the W3C.\n",
    );
    assert.match(
      html,
      /<abbr title="Hyper Text Markup Language">HTML<\/abbr>/,
    );
    assert.doesNotMatch(html, /\*\[HTML\]:/);
  });

  it("applyAbbreviations skips code spans", () => {
    const out = applyAbbreviations(
      "see <code>HTML</code> and HTML",
      new Map([["HTML", "Hyper Text Markup Language"]]),
    );
    assert.match(out, /<code>HTML<\/code>/);
    assert.match(out, /<abbr title="Hyper Text Markup Language">HTML<\/abbr>/);
  });
});

describe("footnotes", () => {
  it("finds and parses a simple definition", () => {
    const src = "Hello\n\n[^1]: This is the first footnote.\n";
    assert.equal(findFootnoteDefStart(src), "Hello\n\n".length);
    const parsed = parseFootnoteDef("[^1]: This is the first footnote.\n");
    assert.ok(parsed);
    assert.equal(parsed.label, "1");
    assert.equal(parsed.text, "This is the first footnote.");
  });

  it("parses multi-paragraph indented footnote bodies", () => {
    const src =
      "[^bignote]: Here's one with multiple paragraphs and code.\n" +
      "\n" +
      "    Indent paragraphs to include them in the footnote.\n" +
      "\n" +
      "    `{ my code }`\n" +
      "\n" +
      "    Add as many paragraphs as you like.\n";
    const parsed = parseFootnoteDef(src);
    assert.ok(parsed);
    assert.equal(parsed.label, "bignote");
    assert.match(parsed.text, /Indent paragraphs/);
    assert.match(parsed.text, /`\{ my code \}`/);
    assert.match(parsed.text, /Add as many paragraphs/);
  });

  it("renders refs and a footnotes section", () => {
    const html = renderMarkdownHtml(
      "Here's a simple footnote,[^1] and here's a longer one.[^bignote]\n\n" +
        "[^1]: This is the first footnote.\n\n" +
        "[^bignote]: Here's one with multiple paragraphs and code.\n\n" +
        "    Indent paragraphs to include them in the footnote.\n\n" +
        "    `{ my code }`\n\n" +
        "    Add as many paragraphs as you like.\n",
    );

    assert.match(html, /footnote-ref/);
    assert.match(html, /href="#fn-1"/);
    assert.match(html, /href="#fn-bignote"/);
    assert.match(html, /<section class="footnotes"/);
    assert.match(html, /id="fn-1"/);
    assert.match(html, /id="fn-bignote"/);
    assert.match(html, /This is the first footnote/);
    assert.match(html, /Indent paragraphs to include them/);
    assert.match(html, /footnote-backref/);
    assert.doesNotMatch(html, /\[\^1\]:/);
    // Hash links stay in-page (no target=_blank).
    assert.doesNotMatch(html, /href="#fn-1"[^>]*target="_blank"/);
  });

  it("keeps external links opening in a new tab", () => {
    const html = renderMarkdownHtml("[cnn](https://cnn.com)\n");
    assert.match(html, /href="https:\/\/cnn\.com\/?"[^>]*target="_blank"/);
  });
});

describe("extras compose with GFM", () => {
  it("still parses bold/italic around new inline forms", () => {
    const raw = parseMarkdown("**==marked==** and _H~2~O_\n");
    assert.match(raw, /<strong><mark>marked<\/mark><\/strong>/);
    assert.match(raw, /<em>H<sub>2<\/sub>O<\/em>/);
  });
});
