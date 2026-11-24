import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { fitMermaidDiagramTitle } from "../../src/app/mermaid/sketch.js";

describe("fitMermaidDiagramTitle", () => {
  it("sets textLength when the title bbox is wider than the viewBox", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html><div id='root'></div>");
    const root = win.document.getElementById("root");
    root.innerHTML = `<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg">
        <text class="titleText" x="200" y="20">A very long diagram title that overflows</text>
      </svg>`;
    const svg = root.querySelector("svg");
    const title = svg.querySelector(".titleText");
    title.getBBox = () => ({ x: -200, y: 0, width: 800, height: 20 });

    fitMermaidDiagramTitle(svg);

    assert.equal(title.getAttribute("textLength"), "368");
    assert.equal(title.getAttribute("lengthAdjust"), "spacingAndGlyphs");
  });

  it("clears textLength when the title already fits", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html><div id='root'></div>");
    const root = win.document.getElementById("root");
    root.innerHTML = `<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg">
        <text class="titleText" textLength="999" lengthAdjust="spacingAndGlyphs">Short</text>
      </svg>`;
    const svg = root.querySelector("svg");
    const title = svg.querySelector(".titleText");
    title.getBBox = () => ({ x: 150, y: 0, width: 100, height: 20 });

    fitMermaidDiagramTitle(svg);

    assert.equal(title.hasAttribute("textLength"), false);
    assert.equal(title.hasAttribute("lengthAdjust"), false);
  });

  it("no-ops without a title or viewBox", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html><div id='root'></div>");
    const root = win.document.getElementById("root");
    root.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>`;
    const svg = root.querySelector("svg");
    assert.doesNotThrow(() => fitMermaidDiagramTitle(svg));
    assert.doesNotThrow(() => fitMermaidDiagramTitle(null));
  });
});
