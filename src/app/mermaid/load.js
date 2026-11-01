import { hooks } from "../hooks.js";
import {
  state,
  mermaidSources
} from "../state.js";
import {
  MERMAID_HAND_FONT,
  MERMAID_CDN,
  SVG2ROUGH_CDN,
  MERMAID_MIN_HOST_WIDTH,
  MERMAID_MIN_GANTT_HOST_WIDTH
} from "../constants.js";
import {
  CDN_INTEGRITY_URLS
} from "../lazy-modules.js";

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

export function initMermaid(mermaid) {
  mermaid.startOnLoad = false;
  mermaid.initialize(mermaidConfig());
  return mermaid;
}

export function loadMermaid() {
  // ESM entry + lazy chunks from jsDelivr (relative imports under dist/chunks/).
  // Import-map integrity covers the entry and every nested chunk URL.
  if (!CDN_INTEGRITY_URLS.has(MERMAID_CDN)) {
    return Promise.reject(new Error("Mermaid CDN URL missing SRI allowlist entry"));
  }
  state.mermaidModule ??= import(MERMAID_CDN).then((mod) => {
    const mermaid = mod.default;
    if (!mermaid?.initialize || !mermaid?.run) {
      throw new Error("Mermaid failed to load");
    }
    return initMermaid(mermaid);
  });
  return state.mermaidModule;
}

export function loadSvg2Rough() {
  if (!CDN_INTEGRITY_URLS.has(SVG2ROUGH_CDN)) {
    return Promise.reject(new Error("svg2roughjs CDN URL missing SRI allowlist entry"));
  }
  state.svg2roughModule ??= import(SVG2ROUGH_CDN).then((mod) => {
    const Svg2Roughjs = mod.Svg2Roughjs;
    if (typeof Svg2Roughjs !== "function") {
      throw new Error("svg2roughjs failed to load");
    }
    return Svg2Roughjs;
  });
  return state.svg2roughModule;
}

/** True when Excalidraw look is on — every diagram is sketched via svg2roughjs. */
export function mermaidNeedsSketch() {
  return state.mermaidLook === "handDrawn";
}

/**
 * Convert a rendered Mermaid SVG into a RoughJS sketch (Excalidraw-like).
 * SVG must stay in the document so computed theme styles resolve.
 * @param {SVGElement} svg
 * @returns {Promise<SVGElement | null>}
 */
export async function sketchMermaidSvg(svg) {
  const Svg2Roughjs = await loadSvg2Rough();
  const scratch = document.createElement("div");
  scratch.hidden = true;
  scratch.setAttribute("aria-hidden", "true");
  // Keep in-DOM for layout/style resolution of the source SVG next to it.
  svg.parentElement?.appendChild(scratch);
  try {
    const converter = new Svg2Roughjs(scratch);
    // Match Mermaid hand-drawn labels (Excalifont). Default Comic Sans is a joke.
    converter.fontFamily = MERMAID_HAND_FONT;
    converter.randomize = false;
    converter.seed = 1;
    converter.roughConfig = {
      roughness: 1.2,
      bowing: 1,
      seed: 1,
      // Solid fills keep node/note backgrounds — hachure reuses fill pastels as
      // strokes, which fail WCAG against the diagram canvas on many themes.
      fillStyle: "solid",
    };
    converter.svg = /** @type {SVGSVGElement} */ (svg);
    await converter.sketch();
    const sketched = scratch.querySelector(":scope > svg");
    if (!(sketched instanceof SVGElement)) return null;
    sketched.dataset.mermaidSketched = "1";
    // Keep class for theming. Size from the classic SVG's rendered CSS box —
    // copying width="100%" would upscale tall viewBoxes and cause vertical scroll.
    const srcClass = svg.getAttribute("class");
    const preBox = svg.getBoundingClientRect();
    const srcVb = (svg.getAttribute("viewBox") || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const sourceSize = {
      cssWidth: preBox.width,
      cssHeight: preBox.height,
      viewBoxWidth: srcVb.length === 4 && srcVb[2] > 0 ? srcVb[2] : 0,
      hostWidth: svg.parentElement?.clientWidth ?? 0,
    };
    if (srcClass && !sketched.getAttribute("class")) {
      sketched.setAttribute("class", srcClass);
    }
    if (!sketched.getAttribute("viewBox") && svg.getAttribute("viewBox")) {
      sketched.setAttribute("viewBox", svg.getAttribute("viewBox"));
    }
    // svg2roughjs drops Mermaid's <style> (themeCSS, p{margin:0}) — copy it back
    // so labels/theme rules still apply after sketch (and in the zoom dialog).
    const srcStyle = svg.querySelector("style");
    if (srcStyle && !sketched.querySelector("style")) {
      sketched.insertBefore(srcStyle.cloneNode(true), sketched.firstChild);
    }
    // Hachure strokes often reuse fill pastels — remap to WCAG theme ink.
    hooks.normalizeMermaidHandDrawnColors(sketched);
    svg.replaceWith(sketched);
    // Fit after insert — getBBox() is wrong while the sketch sits in [hidden].
    // tighten: drop asymmetric Mermaid/svg2roughjs gutters so drawings look centered.
    hooks.fitMermaidSvgViewBox(sketched, { tighten: true });
    hooks.sizeSketchedMermaidSvg(sketched, sourceSize);
    return sketched;
  } finally {
    scratch.remove();
  }
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
  if (mermaidSourceIsGantt(src) && w < MERMAID_MIN_GANTT_HOST_WIDTH) return false;
  return true;
}

hooks.mermaidConfig = mermaidConfig;
hooks.initMermaid = initMermaid;
hooks.loadMermaid = loadMermaid;
hooks.loadSvg2Rough = loadSvg2Rough;
hooks.mermaidNeedsSketch = mermaidNeedsSketch;
hooks.sketchMermaidSvg = sketchMermaidSvg;
hooks.mermaidNodeIsVisible = mermaidNodeIsVisible;
hooks.mermaidSourceIsGantt = mermaidSourceIsGantt;
hooks.mermaidHostWideEnough = mermaidHostWideEnough;
