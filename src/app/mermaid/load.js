import {
  MERMAID_MIN_GANTT_HOST_WIDTH,
  MERMAID_MIN_HOST_WIDTH,
} from "../constants.js";
import { hooks } from "../hooks.js";
import { mermaidSources, state } from "../state.js";

/** Mermaid initialize() options; sent to the sandbox renderer per request. */
export function mermaidConfig() {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    // Mermaid 12 defaults to ELK; keep dagre so existing diagrams look the same.
    layout: "dagre",
    // Always classic — Excalidraw look is svg2roughjs with solid fills (native
    // Mermaid handDrawn hachure fails WCAG: pastel fills become dense ink strokes).
    look: "classic",
    // Stable sketch so re-renders / reuse do not reshuffle strokes every paint.
    handDrawnSeed: 1,
    theme: "base",
    themeVariables: hooks.mermaidThemeVariablesFromCss(),
    themeCSS: hooks.MERMAID_THEME_CSS,
  };
}

/** True when Excalidraw look is on — every diagram is sketched via svg2roughjs. */
export function mermaidNeedsSketch() {
  return state.mermaidLook === "handDrawn";
}

/**
 * Finish a RoughJS sketch from the sandbox once it sits in the preview.
 * @param {SVGElement} sketched
 * @param {{ cssWidth: number, cssHeight: number, viewBoxWidth: number, hostWidth: number }} sourceSize
 *   Classic SVG box measured in the sandbox before sketching.
 */
export function finishSketchedMermaidSvg(sketched, sourceSize) {
  sketched.dataset.mermaidSketched = "1";
  // Remap after insert — getComputedStyle on a detached sketch misses SVG
  // <style> strokes (Mermaid edges), so WCAG var(--mermaid-*) paints never land.
  hooks.normalizeMermaidHandDrawnColors(sketched);
  // tighten: drop asymmetric Mermaid/svg2roughjs gutters so drawings look centered.
  hooks.fitMermaidSvgViewBox(sketched, { tighten: true });
  hooks.sizeSketchedMermaidSvg(sketched, sourceSize);
}

export function mermaidNodeIsVisible(el) {
  return !el.closest("[hidden], .md-section-folded");
}

/**
 * True when source is a gantt diagram (optional YAML frontmatter stripped).
 * @param {string} src
 */
export function mermaidSourceIsGantt(src) {
  const body = String(src ?? "").replace(/^---[\s\S]*?\n---\s*/, "");
  return /^\s*gantt\b/im.test(body);
}

/**
 * Mermaid measures the host with offsetWidth/clientWidth. Skip run() while the
 * pane is too narrow so gantt (etc.) cannot emit negative SVG rect widths.
 * @param {HTMLElement} el
 */
export function mermaidHostWideEnough(el) {
  const w = el.clientWidth;
  if (!(w >= MERMAID_MIN_HOST_WIDTH)) return false;
  const src = mermaidSources.get(el) ?? el.textContent ?? "";
  if (mermaidSourceIsGantt(src) && w < MERMAID_MIN_GANTT_HOST_WIDTH)
    return false;
  return true;
}

hooks.mermaidConfig = mermaidConfig;
hooks.mermaidNeedsSketch = mermaidNeedsSketch;
hooks.finishSketchedMermaidSvg = finishSketchedMermaidSvg;
hooks.mermaidNodeIsVisible = mermaidNodeIsVisible;
hooks.mermaidSourceIsGantt = mermaidSourceIsGantt;
hooks.mermaidHostWideEnough = mermaidHostWideEnough;
