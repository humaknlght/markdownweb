import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findDefListStart, parseDefList } from "../../src/deflist.js";
import { renderMarkdownHtml } from "../helpers/render.js";

describe("parseDefList", () => {
  it("parses the classic term / : definition example", () => {
    const src =
      "First Term\n" +
      ": This is the definition of the first term.\n" +
      "\n" +
      "Second Term\n" +
      ": This is one definition of the second term.\n" +
      ": This is another definition of the second term.\n";

    const parsed = parseDefList(src);
    assert.ok(parsed);
    assert.equal(parsed.items.length, 2);
    assert.deepEqual(parsed.items[0].terms, ["First Term"]);
    assert.deepEqual(parsed.items[0].definitions, [
      "This is the definition of the first term.",
    ]);
    assert.deepEqual(parsed.items[1].terms, ["Second Term"]);
    assert.deepEqual(parsed.items[1].definitions, [
      "This is one definition of the second term.",
      "This is another definition of the second term.",
    ]);
  });

  it("allows multiple terms for one definition", () => {
    const parsed = parseDefList("Term A\nTerm B\n: Shared definition\n");
    assert.ok(parsed);
    assert.deepEqual(parsed.items[0].terms, ["Term A", "Term B"]);
    assert.deepEqual(parsed.items[0].definitions, ["Shared definition"]);
  });

  it("allows a blank line between term and definition", () => {
    const parsed = parseDefList("Term\n\n: Definition\n");
    assert.ok(parsed);
    assert.deepEqual(parsed.items[0].terms, ["Term"]);
    assert.deepEqual(parsed.items[0].definitions, ["Definition"]);
  });

  it("rejects ordinary paragraphs", () => {
    assert.equal(parseDefList("Just a paragraph.\n"), null);
    assert.equal(parseDefList("Not a list:\nstill a paragraph\n"), null);
  });
});

describe("findDefListStart", () => {
  it("finds a list after preceding text", () => {
    const src = "ello\n\nTerm\n: Def";
    const index = findDefListStart(src);
    assert.equal(index, "ello\n\n".length);
  });
});

describe("defListExtension", () => {
  it("renders dt/dd structure", () => {
    const html = renderMarkdownHtml(
      "First Term\n" +
        ": This is the definition of the first term.\n" +
        "\n" +
        "Second Term\n" +
        ": This is one definition of the second term.\n" +
        ": This is another definition of the second term.\n",
    );

    assert.match(html, /<dl\b/);
    assert.match(html, /<dt>First Term<\/dt>/);
    assert.match(html, /<dd>This is the definition of the first term\.<\/dd>/);
    assert.match(html, /<dt>Second Term<\/dt>/);
    assert.match(html, /<dd>This is one definition of the second term\.<\/dd>/);
    assert.match(
      html,
      /<dd>This is another definition of the second term\.<\/dd>/,
    );
    assert.doesNotMatch(html, /<p>First Term/);
  });

  it("renders inline markdown inside terms and definitions", () => {
    const html = renderMarkdownHtml("**Bold term**\n: A `code` and *em* value\n");
    assert.match(html, /<dt><strong>Bold term<\/strong><\/dt>/);
    assert.match(html, /<dd>A <code>code<\/code> and <em>em<\/em> value<\/dd>/);
  });

  it("does not steal normal paragraphs or lists", () => {
    assert.doesNotMatch(renderMarkdownHtml("Hello world\n"), /<dl\b/);
    assert.doesNotMatch(renderMarkdownHtml("- item\n- item\n"), /<dl\b/);
    assert.match(renderMarkdownHtml("> quote\n"), /<blockquote/);
  });

  it("leaves a following paragraph outside the list", () => {
    const html = renderMarkdownHtml("Term\n: Def\n\nAfterward.\n");
    assert.match(html, /<dl\b[\s\S]*<\/dl>/);
    assert.match(html, /<p>Afterward\.<\/p>/);
  });
});
