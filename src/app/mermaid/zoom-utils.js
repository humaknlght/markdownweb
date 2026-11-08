import {
  MERMAID_ZOOM_MIN,
  MERMAID_ZOOM_MAX,
} from "../constants.js";

export function clampMermaidZoom(factor) {
  return Math.min(MERMAID_ZOOM_MAX, Math.max(MERMAID_ZOOM_MIN, factor));
}

/**
 * Resolve a viewBox so display width/height changes scale vectors and
 * foreignObject HTML together (1:1 width≈viewBox leaves labels at 16px).
 * @param {SVGElement} svg
 * @param {number} fallbackW
 * @param {number} fallbackH
 * @returns {string}
 */
export function mermaidZoomViewBox(svg, fallbackW, fallbackH) {
  const raw = String(svg.getAttribute("viewBox") || "").trim();
  if (raw) return raw;
  try {
    const b = svg.getBBox();
    if (b.width > 0 && b.height > 0) {
      return `${b.x} ${b.y} ${b.width} ${b.height}`;
    }
  } catch {
    /* not in DOM / empty */
  }
  const w = fallbackW > 0 ? fallbackW : 400;
  const h = fallbackH > 0 ? fallbackH : w;
  return `0 0 ${w} ${h}`;
}
