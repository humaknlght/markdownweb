import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { morphPreviewHtml } from "../../src/app/preview-morph.js";

describe("morphPreviewHtml", () => {
  /** @type {Document} */
  let document;
  /** @type {HTMLElement} */
  let preview;

  beforeEach(() => {
    const dom = new JSDOM("<!DOCTYPE html><article id='preview'></article>");
    document = dom.window.document;
    preview = /** @type {HTMLElement} */ (document.getElementById("preview"));
  });

  it("keeps an image element when a neighboring paragraph changes", () => {
    preview.innerHTML =
      '<p data-source-line="1">Hello</p><p data-source-line="2"><img alt="pic" src="data:image/png;base64,aaa"></p>';
    const img = preview.querySelector("img");
    const hello = preview.querySelector("p");

    morphPreviewHtml(
      preview,
      '<p data-source-line="1">Hello!</p><p data-source-line="2"><img alt="pic" src="data:image/png;base64,aaa"></p>',
    );

    assert.equal(preview.querySelector("img"), img);
    assert.equal(preview.querySelector("p"), hello);
    assert.equal(hello.textContent, "Hello!");
  });

  it("keeps an image when a block is inserted above it", () => {
    preview.innerHTML =
      '<p data-source-line="1"><img alt="pic" src="pixel.png"></p>';
    const img = preview.querySelector("img");

    morphPreviewHtml(
      preview,
      '<p data-source-line="1">Intro</p><p data-source-line="2"><img alt="pic" src="pixel.png"></p>',
    );

    assert.equal(preview.querySelector("img"), img);
    assert.equal(preview.querySelectorAll("p").length, 2);
  });

  it("updates source-line markers on an unchanged block", () => {
    preview.innerHTML = '<p data-source-line="4">Stay</p>';
    const p = preview.querySelector("p");

    morphPreviewHtml(
      preview,
      '<p data-source-line="9" data-source-line-end="10">Stay</p>',
    );

    assert.equal(preview.querySelector("p"), p);
    assert.equal(p.getAttribute("data-source-line"), "9");
    assert.equal(p.getAttribute("data-source-line-end"), "10");
  });

  it("keeps a heading toggle when the title is unchanged", () => {
    preview.innerHTML =
      '<h2 data-source-line="1"><button class="md-section-toggle" type="button">Collapse section</button><span class="md-section-label">Title</span></h2>';
    const button = preview.querySelector("button");

    morphPreviewHtml(preview, '<h2 data-source-line="3">Title</h2>');

    assert.equal(preview.querySelector("button"), button);
    assert.equal(
      preview.querySelector("h2").getAttribute("data-source-line"),
      "3",
    );
  });

  it("keeps code line numbers when the code text is unchanged", () => {
    preview.innerHTML =
      '<pre data-source-line="1"><code><span class="code-line"><span class="line-num">1</span><span class="line-src">const a = 1</span></span></code></pre>';
    const pre = preview.querySelector("pre");

    morphPreviewHtml(
      preview,
      '<pre data-source-line="2"><code><span class="code-line"><span class="line-src">const a = 1</span></span></code></pre>',
    );

    assert.equal(preview.querySelector("pre"), pre);
    assert.equal(preview.querySelector(".line-num").textContent, "1");
    assert.equal(pre.getAttribute("data-source-line"), "2");
  });

  it("upgrades plain fenced code when HLJS token spans arrive", () => {
    // First paint often runs before a lazy grammar loads, so the preview has
    // escaped text only. The quiet re-paint after load must replace that DOM
    // even though the visible text is unchanged.
    preview.innerHTML = [
      '<pre data-source-line="1"><code class="hljs language-json">',
      '<span class="code-line"><span class="line-num">1</span>',
      '<span class="line-src">{"a":1}</span></span>',
      "</code></pre>",
    ].join("");
    const pre = preview.querySelector("pre");

    morphPreviewHtml(
      preview,
      [
        '<pre data-source-line="1"><code class="hljs language-json">',
        '<span class="code-line"><span class="line-src">',
        '<span class="hljs-punctuation">{</span>',
        '<span class="hljs-attr">"a"</span>',
        '<span class="hljs-punctuation">:</span>',
        '<span class="hljs-number">1</span>',
        '<span class="hljs-punctuation">}</span>',
        "</span></span>",
        "</code></pre>",
      ].join(""),
    );

    assert.equal(preview.querySelector("pre"), pre);
    assert.ok(preview.querySelector(".hljs-attr"));
    assert.ok(preview.querySelector(".hljs-number"));
    assert.equal(preview.querySelector(".hljs-attr").textContent, '"a"');
  });

  it("updates code language class when a fence tag is added", () => {
    preview.innerHTML =
      '<pre data-source-line="1"><code class="hljs"><span class="code-line"><span class="line-num">1</span><span class="line-src">x = 1</span></span></code></pre>';

    morphPreviewHtml(
      preview,
      '<pre data-source-line="1"><code class="hljs language-python"><span class="code-line"><span class="line-src"><span class="hljs-title">x</span> = <span class="hljs-number">1</span></span></span></code></pre>',
    );

    const code = preview.querySelector("code");
    assert.equal(code.className, "hljs language-python");
    assert.ok(preview.querySelector(".hljs-number"));
  });

  it("reuses a decoded image inside a paragraph whose text changed", () => {
    preview.innerHTML =
      '<p data-source-line="1">before <img alt="pic" src="pixel.png"> after</p>';
    const img = preview.querySelector("img");
    const p = preview.querySelector("p");

    morphPreviewHtml(
      preview,
      '<p data-source-line="1">before! <img alt="pic" src="pixel.png"> after</p>',
    );

    assert.equal(preview.querySelector("img"), img);
    assert.equal(preview.querySelector("p"), p);
    assert.match(p.textContent, /before!/);
  });

  it("patches a list in place when content is pasted into an earlier item", () => {
    preview.innerHTML = [
      "<ul>",
      '<li data-source-line="1">one</li>',
      '<li data-source-line="2">two</li>',
      '<li data-source-line="3">three <img alt="pic" src="pixel.png"></li>',
      "</ul>",
    ].join("");
    const ul = preview.querySelector("ul");
    const items = [...preview.querySelectorAll("li")];
    const img = preview.querySelector("img");

    morphPreviewHtml(
      preview,
      [
        "<ul>",
        '<li data-source-line="1">one</li>',
        '<li data-source-line="2">pasted block</li>',
        '<li data-source-line="3">two</li>',
        '<li data-source-line="4">three <img alt="pic" src="pixel.png"></li>',
        "</ul>",
      ].join(""),
    );

    const next = [...preview.querySelectorAll("li")];
    assert.equal(preview.querySelector("ul"), ul);
    assert.equal(next[0], items[0]);
    assert.equal(next[2], items[1]);
    assert.equal(next[3], items[2]);
    assert.equal(next[3].querySelector("img"), img);
    assert.equal(next[1].textContent, "pasted block");
    assert.equal(next[2].getAttribute("data-source-line"), "3");
    assert.equal(next[3].getAttribute("data-source-line"), "4");
  });

  it("drops an image that the new markup no longer has", () => {
    preview.innerHTML = '<p><img alt="pic" src="pixel.png"></p><p>Tail</p>';

    morphPreviewHtml(preview, "<p>Tail</p>");

    assert.equal(preview.querySelector("img"), null);
    assert.equal(preview.textContent, "Tail");
  });

  it("keeps a rendered mermaid host when the fence text is unchanged", () => {
    preview.innerHTML =
      '<div class="mermaid" data-source-line="1"><svg></svg></div>';
    const host = preview.querySelector(".mermaid");
    const svg = preview.querySelector("svg");
    const sources = new WeakMap([[host, "graph TD; A-->B"]]);

    morphPreviewHtml(
      preview,
      '<div class="mermaid" data-source-line="4">graph TD; A-->B</div>',
      (el) => sources.get(el),
    );

    assert.equal(preview.querySelector(".mermaid"), host);
    assert.equal(preview.querySelector("svg"), svg);
    assert.equal(host.getAttribute("data-source-line"), "4");
  });

  it("drops a stale mermaid SVG when the fence text changes", () => {
    preview.innerHTML =
      '<div class="mermaid" data-source-line="1"><svg></svg></div>';
    const host = preview.querySelector(".mermaid");
    const sources = new WeakMap([[host, "graph TD; A-->B"]]);

    morphPreviewHtml(
      preview,
      '<div class="mermaid" data-source-line="1">graph TD; A-->C</div>',
      (el) => sources.get(el),
    );

    assert.equal(preview.querySelector(".mermaid"), host);
    assert.equal(preview.querySelector("svg"), null);
    assert.equal(host.textContent, "graph TD; A-->C");
  });
});
