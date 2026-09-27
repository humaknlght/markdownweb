import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapePipesInTableCodeSpans } from "../../src/tablePipes.js";
import { renderMarkdownHtml } from "../helpers/render.js";

describe("escapePipesInTableCodeSpans", () => {
  it("escapes pipes inside table code spans", () => {
    const src = "| Header | `a|b` |\n| --- | --- |\n| cell | `c|d` |";
    const result = escapePipesInTableCodeSpans(src);
    assert.match(result.split("\n")[0], /`a\\\|b`/);
    assert.match(result.split("\n")[2], /`c\\\|d`/);
    assert.equal(result.split("\n")[1], "| --- | --- |");
  });

  it("leaves fenced code blocks alone", () => {
    const fenced = "```\n| `a|b` |\n| --- |\n```\n| real | `x|y` |\n| --- | --- |";
    const result = escapePipesInTableCodeSpans(fenced);
    assert.equal(result.split("\n")[1], "| `a|b` |");
    assert.match(result, /`x\\\|y`/);
  });

  it("does not double-escape already-escaped pipes", () => {
    const line = escapePipesInTableCodeSpans("| `a\\|b` |\n| --- |");
    assert.match(line, /`a\\\|b`/);
    assert.doesNotMatch(line, /`a\\\\\|b`/);
  });
});

describe("table pipes + emoji pipeline", () => {
  it("keeps the 😐 table cells intact", () => {
    const md = "| Code | Face |\n| --- | --- |\n| `:|` `:-|` | 😐 |";
    const html = renderMarkdownHtml(md);
    assert.match(html, /😐/);
    assert.match(html, /<code>:\\|<\/code>/);
    assert.match(html, /<td/);
  });
});
