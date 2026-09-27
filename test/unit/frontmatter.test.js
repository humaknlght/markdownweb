import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractFrontmatter,
  formatFrontmatterValue,
  renderFrontmatterHtml,
} from "../../src/frontmatter.js";
import { renderMarkdownHtml } from "../helpers/render.js";

describe("extractFrontmatter", () => {
  it("returns null when there is no front matter", () => {
    assert.equal(extractFrontmatter("# Hi"), null);
  });

  it("parses a leading YAML block", () => {
    const result = extractFrontmatter("---\ntitle: foo\n---\n\n# Body");
    assert.equal(result.parseError, false);
    assert.deepEqual(result.data, { title: "foo" });
    assert.match(result.body, /# Body/);
  });

  it("accepts empty front matter", () => {
    const result = extractFrontmatter("---\n---\n\n# Hi");
    assert.equal(result.parseError, false);
    assert.deepEqual(result.data, {});
  });

  it("strips a BOM", () => {
    const result = extractFrontmatter("\uFEFF---\ntitle: x\n---\n");
    assert.equal(result.data.title, "x");
    assert.equal(result.raw.startsWith("\uFEFF"), false);
  });

  it("marks invalid YAML and non-object roots as parse errors", () => {
    assert.equal(extractFrontmatter("---\n[unterminated\n---\n").parseError, true);
    assert.equal(extractFrontmatter("---\n- list\n---\n").parseError, true);
  });
});

describe("formatFrontmatterValue / renderFrontmatterHtml", () => {
  it("escapes HTML in scalars", () => {
    assert.equal(formatFrontmatterValue("Hello <b>"), "Hello &lt;b&gt;");
  });

  it("renders nested values as YAML in a pre", () => {
    const html = formatFrontmatterValue({ a: 1 });
    assert.match(html, /markdown-frontmatter-nested/);
  });

  it("renders an error panel for parse errors", () => {
    const html = renderFrontmatterHtml({ data: null, parseError: true, rawYaml: "bad" });
    assert.match(html, /markdown-frontmatter-error/);
    assert.match(html, /Invalid YAML/);
  });

  it("returns empty string for empty data", () => {
    assert.equal(renderFrontmatterHtml({ data: {}, parseError: false, rawYaml: "" }), "");
  });
});

describe("frontmatter in render pipeline", () => {
  it("shows a metadata table and no hr for a valid block", () => {
    const html = renderMarkdownHtml("---\ntitle: Docs\n---\n\n# Hi");
    assert.match(html, /markdown-frontmatter/);
    assert.match(html, /<th>title<\/th>/);
    assert.match(html, /<h1[^>]*>Hi<\/h1>/);
    assert.doesNotMatch(html, /<hr/);
  });

  it("consumes empty front matter without leaving hrs", () => {
    const html = renderMarkdownHtml("---\n---\n\n# Hi");
    assert.doesNotMatch(html, /<hr/);
    assert.match(html, /<h1[^>]*>Hi<\/h1>/);
  });

  it("keeps a mid-document --- as a thematic break", () => {
    const html = renderMarkdownHtml("# A\n\n---\n\n# B");
    assert.match(html, /<hr/);
  });
});
