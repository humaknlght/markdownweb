import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  applyLinkTargetAttributes,
  isSameDocumentHref,
  shouldOpenLinkInNewTab,
} from "../../src/lib/link-targets.js";
import { renderMarkdownHtml } from "../helpers/render.js";

describe("isSameDocumentHref / shouldOpenLinkInNewTab", () => {
  it("treats hash-only hrefs as same-document", () => {
    for (const href of ["#", "#fn-1", "#custom-id", " #fnref-1 "]) {
      assert.equal(isSameDocumentHref(href), true, href);
      assert.equal(shouldOpenLinkInNewTab(href), false, href);
    }
  });

  it("opens external sites and other pages in a new tab", () => {
    for (const href of [
      "https://cnn.com",
      "http://example.com/path",
      "mailto:me@somewhere.com",
      "tel:+15551212",
      "/privacy.html",
      "./other.md",
      "../up.md",
      "docs/guide.html",
      "page.html#section",
      "//cdn.example.com/x",
    ]) {
      assert.equal(isSameDocumentHref(href), false, href);
      assert.equal(shouldOpenLinkInNewTab(href), true, href);
    }
  });

  it("does not force a new tab for empty / missing href", () => {
    assert.equal(shouldOpenLinkInNewTab(""), false);
    assert.equal(shouldOpenLinkInNewTab(null), false);
    assert.equal(shouldOpenLinkInNewTab(undefined), false);
  });
});

describe("applyLinkTargetAttributes", () => {
  it("sets target=_blank on leaving links and clears it on hash links", () => {
    const { document } = new JSDOM("<!DOCTYPE html><a></a><a></a>").window;
    const [ext, hash] = document.querySelectorAll("a");

    ext.setAttribute("href", "https://example.com");
    applyLinkTargetAttributes(ext);
    assert.equal(ext.getAttribute("target"), "_blank");
    assert.equal(ext.getAttribute("rel"), "noopener noreferrer");

    hash.setAttribute("href", "#fn-1");
    hash.setAttribute("target", "_blank");
    hash.setAttribute("rel", "noopener noreferrer");
    applyLinkTargetAttributes(hash);
    assert.equal(hash.hasAttribute("target"), false);
    assert.equal(hash.hasAttribute("rel"), false);
  });
});

describe("render pipeline link targets", () => {
  it("adds target=_blank to markdown links that leave the document", () => {
    const html = renderMarkdownHtml(
      [
        "[cnn](https://cnn.com)",
        "<https://cnn.com>",
        "<me@somewhere.com>",
        "https://cnn.com",
        "[privacy](/privacy.html)",
        "[section on other page](guide.html#intro)",
      ].join("\n\n"),
    );

    for (const href of [
      "https://cnn.com",
      "mailto:me@somewhere.com",
      "/privacy.html",
      "guide.html#intro",
    ]) {
      assert.match(
        html,
        new RegExp(
          `href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*target="_blank"`,
        ),
        href,
      );
      assert.match(
        html,
        new RegExp(
          `href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*rel="noopener noreferrer"`,
        ),
        href,
      );
    }
  });

  it("keeps footnote / heading fragment links in-page", () => {
    const html = renderMarkdownHtml(
      "See note.[^1]\n\n[^1]: Footnote body.\n\n### Title {#custom-id}\n",
    );
    assert.match(html, /href="#fn-1"/);
    assert.doesNotMatch(html, /href="#fn-\w+"[^>]*target="_blank"/);
    assert.doesNotMatch(html, /href="#fnref-\w+"[^>]*target="_blank"/);
  });
});
