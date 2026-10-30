import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TABLE_STUB,
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertSnippet,
  insertTable,
  lineRange,
  prefixLines,
  wrapInline,
} from "../../src/markdown/format-markdown.js";

describe("format-markdown wrapInline", () => {
  it("wraps a selection in bold markers", () => {
    const edit = wrapInline("say hi there", 4, 6, "**");
    assert.equal(edit.text, "**hi**");
    assert.equal(edit.from, 4);
    assert.equal(edit.to, 6);
    assert.equal(edit.selectionStart, 6);
    assert.equal(edit.selectionEnd, 8);
  });

  it("unwraps when the selection already includes markers", () => {
    const edit = wrapInline("**hi**", 0, 6, "**");
    assert.equal(edit.text, "hi");
    assert.equal(edit.selectionStart, 0);
    assert.equal(edit.selectionEnd, 2);
  });

  it("unwraps when markers sit outside the selection", () => {
    const edit = wrapInline("**hi**", 2, 4, "**");
    assert.equal(edit.from, 0);
    assert.equal(edit.to, 6);
    assert.equal(edit.text, "hi");
  });

  it("inserts empty bold pair with caret between", () => {
    const edit = wrapInline("ab", 1, 1, "**");
    assert.equal(edit.text, "****");
    assert.equal(edit.selectionStart, 3);
    assert.equal(edit.selectionEnd, 3);
  });

  it("wraps italic with underscore markers", () => {
    const edit = wrapInline("hi", 0, 2, "_");
    assert.equal(edit.text, "_hi_");
  });
});

describe("format-markdown prefixLines", () => {
  it("expands to the current line bounds", () => {
    assert.deepEqual(lineRange("a\nbb\nc", 3, 3), { from: 2, to: 4 });
  });

  it("prefixes quote and toggles off", () => {
    const on = prefixLines("hello", 0, 5, "quote");
    assert.equal(on.text, "> hello");
    const off = prefixLines("> hello", 0, 7, "quote");
    assert.equal(off.text, "hello");
  });

  it("prefixes bullet list lines", () => {
    const edit = prefixLines("a\nb", 0, 3, "bullet");
    assert.equal(edit.text, "- a\n- b");
  });

  it("renumbers ordered lists and toggles off", () => {
    const on = prefixLines("a\nb\nc", 0, 5, "ordered");
    assert.equal(on.text, "1. a\n2. b\n3. c");
    const off = prefixLines(on.text, 0, on.text.length, "ordered");
    assert.equal(off.text, "a\nb\nc");
  });

  it("sets and toggles heading level", () => {
    const h2 = prefixLines("Title", 0, 5, "heading", { level: 2 });
    assert.equal(h2.text, "## Title");
    const again = prefixLines(h2.text, 0, h2.text.length, "heading", { level: 2 });
    assert.equal(again.text, "Title");
    const h1 = prefixLines("Title", 0, 5, "heading", { level: 1 });
    assert.equal(h1.text, "# Title");
  });

  it("replaces a bullet with a heading", () => {
    const edit = prefixLines("- Title", 0, 7, "heading", { level: 3 });
    assert.equal(edit.text, "### Title");
  });
});

describe("format-markdown inserts", () => {
  it("inserts a link selecting the url placeholder", () => {
    const edit = insertLink("see docs", 4, 8);
    assert.equal(edit.text, "[docs](url)");
    const built = "see ".slice(0, edit.from) + edit.text;
    assert.equal(built.slice(edit.selectionStart, edit.selectionEnd), "url");
  });

  it("inserts an image with selection as alt", () => {
    const edit = insertImage("logo", 0, 4);
    assert.equal(edit.text, "![logo](url)");
    assert.equal(edit.selectionStart, 8);
    assert.equal(edit.selectionEnd, 11);
  });

  it("wraps a selection in a code fence", () => {
    const edit = insertCodeBlock("x = 1", 0, 5);
    assert.equal(edit.text, "```\nx = 1\n```");
  });

  it("inserts an empty code fence with caret inside", () => {
    const edit = insertCodeBlock("", 0, 0);
    assert.equal(edit.text, "```\n\n```");
    assert.equal(edit.selectionStart, 4);
  });

  it("inserts the table stub", () => {
    const edit = insertTable("x", 0, 1);
    assert.equal(edit.text, TABLE_STUB);
    assert.ok(edit.text.includes("| Column 1 |"));
  });

  it("inserts a horizontal rule with spacing", () => {
    const edit = insertHorizontalRule("above", 5, 5);
    assert.equal(edit.text, "\n\n---\n");
  });

  it("honors insertSnippet selection offsets", () => {
    const edit = insertSnippet("hi", 2, 2, "ABC", 1, 1);
    assert.equal(edit.text, "ABC");
    assert.equal(edit.selectionStart, 3);
    assert.equal(edit.selectionEnd, 4);
  });
});
