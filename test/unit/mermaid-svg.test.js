import assert from "node:assert/strict";
import { describe, it } from "node:test";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import {
  normalizeSandboxResults,
  parseSandboxMermaidSvg,
  resanitizeMermaidSvgElement,
  sanitizeKeepingForeignObjects,
  scopeMermaidSvgStyles,
  splitScopedSelectorList,
} from "../../src/lib/mermaid-svg.js";

function setup() {
  const { window } = new JSDOM("<!DOCTYPE html><body></body>");
  // jsdom only builds `style.sheet` for documents with a window; browsers also
  // do for `createHTMLDocument` documents.
  window.document.implementation.createHTMLDocument = () =>
    new JSDOM("<!DOCTYPE html>").window.document;
  return {
    window,
    doc: window.document,
    purify: createDOMPurify(window),
  };
}

/** @param {Document} doc @param {string} css */
function svgWithStyle(doc, css) {
  const host = doc.createElement("div");
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" id="mermaid-3"><style>${css}</style><g></g></svg>`;
  return /** @type {SVGSVGElement} */ (host.firstElementChild);
}

describe("normalizeSandboxResults", () => {
  it("returns one entry per request and drops malformed or oversized SVG", () => {
    const out = normalizeSandboxResults(
      [
        { svg: "<svg></svg>", scopeId: "mermaid-1" },
        { svg: 42, scopeId: {} },
        { svg: "x".repeat(12), scopeId: "mermaid-2" },
        {
          svg: "<svg/>",
          scopeId: "mermaid-4",
          sourceSize: { cssWidth: 120, cssHeight: "9", hostWidth: Infinity },
        },
      ],
      5,
      11,
    );
    assert.equal(out.length, 5);
    assert.deepEqual(out[0], {
      svg: "<svg></svg>",
      scopeId: "mermaid-1",
      sourceSize: null,
    });
    assert.deepEqual(out[1], { svg: null, scopeId: "", sourceSize: null });
    assert.equal(out[2].svg, null);
    assert.deepEqual(out[3].sourceSize, {
      cssWidth: 120,
      cssHeight: 0,
      viewBoxWidth: 0,
      hostWidth: 0,
    });
    assert.deepEqual(out[4], { svg: null, scopeId: "", sourceSize: null });
    assert.equal(normalizeSandboxResults("nope", 1)[0].svg, null);
  });
});

describe("splitScopedSelectorList", () => {
  it("splits top-level commas and allows + inside functions", () => {
    assert.deepEqual(
      splitScopedSelectorList(
        "#mermaid-1 .a, #mermaid-1 path:nth-of-type(3n+1)",
      ),
      ["#mermaid-1 .a", "#mermaid-1 path:nth-of-type(3n+1)"],
    );
    assert.deepEqual(splitScopedSelectorList('#m [title="a,b"]'), [
      '#m [title="a,b"]',
    ]);
  });

  it("rejects sibling combinators that could reach outside the SVG", () => {
    assert.equal(splitScopedSelectorList("#mermaid-1 ~ .toolbar"), null);
    assert.equal(splitScopedSelectorList("#mermaid-1+button"), null);
  });
});

describe("scopeMermaidSvgStyles", () => {
  it("keeps only rules under the diagram id plus keyframes", () => {
    const { doc } = setup();
    const svg = svgWithStyle(
      doc,
      [
        "#mermaid-3 .node rect{fill:red}",
        "#mermaid-3{font-size:16px}",
        "body{display:none}",
        "#mermaid-30 .x{color:red}",
        "#mermaid-3 .a, .toolbar{color:red}",
        "#mermaid-3 ~ .app{color:red}",
        "@keyframes dash{to{stroke-dashoffset:0}}",
      ].join("\n"),
    );
    scopeMermaidSvgStyles(svg, "mermaid-3");
    const css = svg.querySelector("style").textContent;
    assert.match(css, /#mermaid-3 \.node rect/);
    assert.match(css, /#mermaid-3\s*\{/);
    assert.match(css, /@keyframes dash/);
    assert.doesNotMatch(css, /body/);
    assert.doesNotMatch(css, /mermaid-30/);
    assert.doesNotMatch(css, /toolbar/);
    assert.doesNotMatch(css, /\.app/);
  });

  it("drops all styles when the scope id is not a Mermaid diagram id", () => {
    const { doc } = setup();
    for (const scopeId of ["editor", "mermaid-zoom-stage", "", "mermaid-1 x"]) {
      const svg = svgWithStyle(doc, "#editor{display:none}");
      scopeMermaidSvgStyles(svg, scopeId);
      assert.equal(svg.querySelector("style"), null, scopeId);
    }
  });
});

describe("sanitizeKeepingForeignObjects", () => {
  it("drops event handlers and unsafe attrs on foreignObject shells", () => {
    const { doc, purify } = setup();
    const out = sanitizeKeepingForeignObjects(
      '<svg xmlns="http://www.w3.org/2000/svg" id="mermaid-1">' +
        '<foreignObject width="80" height="24" onload="alert(1)" href="javascript:alert(2)" style="background:url(https://evil.test/x)">' +
        '<div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">Ok</span></div>' +
        "</foreignObject></svg>",
      purify,
      undefined,
      doc,
    );
    assert.match(out, /nodeLabel/);
    assert.match(out, /width="80"/);
    assert.doesNotMatch(out, /onload|javascript:|evil\.test/i);
  });
});

describe("parseSandboxMermaidSvg", () => {
  it("sanitizes markup but keeps foreignObject labels", () => {
    const { doc, purify } = setup();
    const svg = parseSandboxMermaidSvg(
      {
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg" id="mermaid-1" onload="alert(1)">' +
          "<script>alert(2)</script>" +
          '<foreignObject width="80" height="24"><div xmlns="http://www.w3.org/1999/xhtml">' +
          '<span class="nodeLabel" onclick="alert(3)">Start</span><img src="x" onerror="alert(4)"></div></foreignObject>' +
          '<a href="javascript:alert(5)"><text>t</text></a></svg>',
        scopeId: "mermaid-1",
      },
      doc,
      purify,
    );
    assert.ok(svg);
    assert.equal(svg.localName, "svg");
    const html = svg.outerHTML;
    assert.match(html, /nodeLabel/);
    assert.match(html, />Start</);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /onload|onclick|onerror/i);
    assert.doesNotMatch(html, /javascript:/i);
  });

  it("returns null for missing or non-SVG markup", () => {
    const { doc, purify } = setup();
    assert.equal(
      parseSandboxMermaidSvg({ svg: null, scopeId: "" }, doc, purify),
      null,
    );
    assert.equal(
      parseSandboxMermaidSvg(
        { svg: '<img src="x" onerror="alert(1)">', scopeId: "" },
        doc,
        purify,
      ),
      null,
    );
  });

  it("resanitizeMermaidSvgElement re-runs the pipeline for zoom", () => {
    const { doc, purify } = setup();
    const once = parseSandboxMermaidSvg(
      {
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg" id="mermaid-2">' +
          '<foreignObject width="40" height="20"><div xmlns="http://www.w3.org/1999/xhtml">' +
          '<span class="nodeLabel">Zoom</span></div></foreignObject></svg>',
        scopeId: "mermaid-2",
      },
      doc,
      purify,
    );
    assert.ok(once);
    once.setAttribute("onload", "alert(9)");
    const again = resanitizeMermaidSvgElement(once, doc, purify);
    assert.ok(again);
    assert.match(again.outerHTML, /Zoom/);
    assert.doesNotMatch(again.outerHTML, /onload/i);
  });
});
