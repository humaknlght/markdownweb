import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { MERMAID_ZOOM_MAX, MERMAID_ZOOM_MIN } from "../../src/app/constants.js";
import {
  adoptZoomStageCss,
  clampMermaidZoom,
  mermaidZoomViewBox,
  zoomStageCssText,
  zoomStageVariableDeclarations,
} from "../../src/app/mermaid/zoom-utils.js";

describe("mermaid zoom viewport helpers", () => {
  it("clamps zoom to configured bounds", () => {
    assert.equal(clampMermaidZoom(0), MERMAID_ZOOM_MIN);
    assert.equal(clampMermaidZoom(99), MERMAID_ZOOM_MAX);
    assert.equal(clampMermaidZoom(1.5), 1.5);
  });

  it("keeps an existing viewBox", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html>");
    const svg = win.document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    svg.setAttribute("viewBox", "10 20 300 150");
    assert.equal(mermaidZoomViewBox(svg, 400, 200), "10 20 300 150");
  });

  it("synthesizes a viewBox from fallback size when missing", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html>");
    const svg = win.document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    assert.equal(mermaidZoomViewBox(svg, 320, 180), "0 0 320 180");
  });
});

describe("zoom stage theme css", () => {
  /** @param {[string, string][]} entries */
  function fakeStyle(entries) {
    const map = new Map(entries);
    return {
      *[Symbol.iterator]() {
        yield* map.keys();
      },
      /** @param {string} name */
      getPropertyValue(name) {
        return map.get(name) || "";
      },
    };
  }

  it("copies theme tokens and drops values that would break the rule", () => {
    const css = zoomStageVariableDeclarations(
      fakeStyle([
        ["--mermaid-bg", "#062436"],
        ["--mermaid-gantt-0", "#1588a8"],
        ["--color-scheme", "dark"],
        ["--chrome-text", "#f4f8fb"],
        ["--preview-fg", "#f4f8fb"],
        ["color", "#111"],
        ["--mermaid-font", '";}body{background:red}'],
        ["--other", "#fff"],
        ["--mermaid-empty", "  "],
      ]),
    );
    assert.match(css, /--mermaid-bg:#062436/);
    assert.match(css, /--mermaid-gantt-0:#1588a8/);
    assert.match(css, /--color-scheme:dark/);
    assert.match(css, /--chrome-text:#f4f8fb/);
    assert.match(css, /--preview-fg:#f4f8fb/);
    assert.doesNotMatch(css, /--other|color:|#111|background:red/);
  });

  it("puts tokens on :root ahead of the stage layout", () => {
    const css = zoomStageCssText(
      "--mermaid-bg:#062436;--mermaid-gantt-0:#1588a8",
    );
    assert.match(
      css,
      /^:root\{--mermaid-bg:#062436;--mermaid-gantt-0:#1588a8\}/,
    );
    assert.match(css, /background:var\(--mermaid-bg,#fff\)/);
    assert.match(css, /color-scheme:var\(--color-scheme,light\)/);
    assert.match(
      css,
      /foreignObject p,.mermaid-zoom-scaler foreignObject div\{margin:0!important\}/,
    );
  });

  it("adopts a constructable sheet when inline styles would be blocked", () => {
    const { window: win, document: doc } = new JSDOM(
      "<!DOCTYPE html><html><head></head><body></body></html>",
    ).window;
    /** @type {string[]} */
    const synced = [];
    class FakeSheet {
      /** @param {string} css */
      replaceSync(css) {
        synced.push(css);
      }
    }
    win.CSSStyleSheet = FakeSheet;
    /** @type {FakeSheet[]} */
    const adopted = [];
    Object.defineProperty(doc, "adoptedStyleSheets", {
      configurable: true,
      get: () => adopted,
      set: (next) => {
        adopted.length = 0;
        adopted.push(...next);
      },
    });

    assert.equal(adoptZoomStageCss(doc, ":root{--mermaid-bg:#062436}"), true);
    assert.equal(adopted.length, 1);
    assert.match(synced[0], /--mermaid-bg:#062436/);
  });
});
