import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { MERMAID_ZOOM_MAX, MERMAID_ZOOM_MIN } from "../../src/app/constants.js";
import {
  clampMermaidZoom,
  mermaidZoomViewBox,
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
