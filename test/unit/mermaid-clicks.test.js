import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  parseMermaidClickHrefs,
  applyMermaidHrefLinks,
} from "../../src/app/mermaid/clicks.js";

describe("mermaid click hrefs", () => {
  it("parses click href lines and ignores call / non-http URLs", () => {
    const src = `
gantt
  Task :a1, 2026-01-01, 1d
  click a1 href "https://example.com/a"
  click a2 href https://example.com/b
  click a3 href 'https://example.com/c'
  click a4 call doEvil()
  click a5 href "javascript:alert(1)"
  click a6 href "data:text/html,hi"
`;
    const map = parseMermaidClickHrefs(src);
    assert.equal(map.size, 3);
    assert.equal(map.get("a1"), "https://example.com/a");
    assert.equal(map.get("a2"), "https://example.com/b");
    assert.equal(map.get("a3"), "https://example.com/c");
    assert.equal(map.has("a4"), false);
    assert.equal(map.has("a5"), false);
    assert.equal(map.has("a6"), false);
  });

  it("wraps matching svg nodes in <a target=_blank>", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html><div id='root'></div>");
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = win.document.createElementNS(svgNS, "svg");
    const rect = win.document.createElementNS(svgNS, "rect");
    rect.setAttribute("id", "mermaid-123-a1");
    rect.setAttribute("class", "task clickable");
    const text = win.document.createElementNS(svgNS, "text");
    text.setAttribute("id", "mermaid-123-a1-text");
    text.setAttribute("class", "taskText clickable");
    const other = win.document.createElementNS(svgNS, "rect");
    other.setAttribute("id", "mermaid-123-other");
    svg.append(rect, text, other);
    win.document.getElementById("root").append(svg);

    applyMermaidHrefLinks(
      svg,
      new Map([["a1", "https://example.com/task"]]),
    );

    assert.equal(rect.parentElement?.tagName, "a");
    assert.equal(text.parentElement?.tagName, "a");
    assert.equal(other.parentElement?.tagName, "svg");
    assert.equal(rect.parentElement?.getAttribute("href"), "https://example.com/task");
    assert.equal(rect.parentElement?.getAttribute("target"), "_blank");
    assert.equal(rect.parentElement?.getAttribute("rel"), "noopener noreferrer");
    // Idempotent — already wrapped nodes are left alone.
    applyMermaidHrefLinks(
      svg,
      new Map([["a1", "https://example.com/task"]]),
    );
    assert.equal(rect.parentElement?.parentElement?.tagName, "svg");
  });
});
