import { hooks } from "../hooks.js";
import {
  state
} from "../state.js";
import {
  MERMAID_HAND_FONT
} from "../constants.js";

export function parseCssColorRgb(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "none" || s === "transparent") return null;
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  const hsl = s.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (hsl) {
    // Rough/Mermaid sometimes emit hsl(); convert for matching.
    const h = ((+hsl[1] % 360) + 360) % 360;
    const sat = +hsl[2] / 100;
    const lit = +hsl[3] / 100;
    const a = sat * Math.min(lit, 1 - lit);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return lit - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return {
      r: Math.round(f(0) * 255),
      g: Math.round(f(8) * 255),
      b: Math.round(f(4) * 255),
    };
  }
  if (!s.startsWith("#")) return null;
  let h = s.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** @param {{ r: number, g: number, b: number }} c */
export function cssColorKey(c) {
  return `${c.r | 0},${c.g | 0},${c.b | 0}`;
}

/** @param {{ r: number, g: number, b: number }} c */
export function relativeLuminanceRgb(c) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/**
 * WCAG 2 contrast ratio between two sRGB colors.
 * @param {{ r: number, g: number, b: number }} a
 * @param {{ r: number, g: number, b: number }} b
 */
export function contrastRatioRgb(a, b) {
  const L1 = relativeLuminanceRgb(a);
  const L2 = relativeLuminanceRgb(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read live `--mermaid-*` tokens (theme-aware). */
export function readMermaidThemeTokens() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: get("--mermaid-bg", "#ffffff"),
    fg: get("--mermaid-fg", "#333333"),
    nodeBg: get("--mermaid-node-bg", "#ececff"),
    nodeBorder: get("--mermaid-node-border", "#9370db"),
    clusterBg: get("--mermaid-cluster-bg", "#ffffde"),
    clusterBorder: get("--mermaid-cluster-border", "#6b6b22"),
    line: get("--mermaid-line", "#333333"),
    labelBg: get("--mermaid-label-bg", "#e8e8e8"),
    noteBg: get("--mermaid-note-bg", "#fff5ad"),
    noteFg: get("--mermaid-note-fg", "#333333"),
  };
}

/**
 * Mermaid RoughJS paints from themeVariables at render time. Keep them in sync
 * with the page theme so handDrawn output starts from WCAG-safe tokens.
 */
export function mermaidThemeVariablesFromCss() {
  const t = readMermaidThemeTokens();
  const bg = parseCssColorRgb(t.bg);
  const darkMode = bg ? relativeLuminanceRgb(bg) < 0.4 : false;
  /** @type {Record<string, string | boolean>} */
  const vars = {
    darkMode,
    background: t.bg,
    primaryColor: t.nodeBg,
    primaryTextColor: t.fg,
    primaryBorderColor: t.nodeBorder,
    lineColor: t.line,
    secondaryColor: t.clusterBg,
    tertiaryColor: t.labelBg,
    noteBkgColor: t.noteBg,
    noteTextColor: t.noteFg,
  };
  if (state.mermaidLook === "handDrawn") {
    vars.fontFamily = MERMAID_HAND_FONT;
  }
  return vars;
}

/** Load Excalifont before measuring/sketching hand-drawn diagrams. */
export function ensureExcalifontLoaded() {
  if (typeof document === "undefined" || !document.fonts?.load) {
    return Promise.resolve();
  }
  // Warm the face; failures (offline) fall back to the sans stack in MERMAID_HAND_FONT.
  return document.fonts.load(`16px ${MERMAID_HAND_FONT}`).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Apply a theme paint, beating Mermaid's baked stylesheet rules when needed.
 * @param {Element} el
 * @param {"stroke" | "fill"} attr
 * @param {string} cssVarName
 */
export function setMermaidPaintVar(el, attr, cssVarName) {
  const value = `var(${cssVarName})`;
  el.setAttribute(attr, value);
  // Requirement / edge paths often get stroke from SVG <style>, which wins over
  // presentation attributes — force the theme token.
  if (el instanceof SVGElement) {
    el.style.setProperty(attr, value, "important");
  }
}

/**
 * Pick a WCAG AA text ink CSS variable for a given background fill.
 * Prefers theme fg/bg (works across light and dark); falls back by luminance.
 * @param {{ r: number, g: number, b: number }} fillRgb
 * @param {ReturnType<typeof readMermaidThemeTokens>} tokens
 * @param {Record<string, string>} varByRole
 */
export function mermaidTextInkVarForFill(fillRgb, tokens, varByRole) {
  const candidates = [
    ["fg", parseCssColorRgb(tokens.fg)],
    ["bg", parseCssColorRgb(tokens.bg)],
  ];
  let bestRole = "fg";
  let bestRatio = 0;
  for (const [role, rgb] of candidates) {
    if (!rgb) continue;
    const ratio = contrastRatioRgb(rgb, fillRgb);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestRole = role;
    }
  }
  if (bestRatio >= 4.5) return varByRole[bestRole];
  // Mid-tone custom fills (classDef) may beat neither token at 4.5 — use ink by luminance.
  return relativeLuminanceRgb(fillRgb) > 0.179 ? varByRole.fg : varByRole.bg;
}

/**
 * Resolve the painted fill behind a label (node / cluster / note / label chip).
 * @param {Element} el
 * @returns {{ r: number, g: number, b: number } | null}
 */
export function mermaidLabelBackgroundRgb(el) {
  const host =
    el.closest?.(
      "g.node, g.cluster, g.note, .edgeLabel, .label, foreignObject",
    ) || el.parentElement;
  if (!host) return null;
  for (const shape of host.querySelectorAll(
    ":scope > path, :scope > rect, :scope > circle, :scope > polygon, :scope > ellipse, path, rect, circle, polygon, ellipse",
  )) {
    if (shape === el || shape.contains?.(el)) continue;
    const tag = shape.tagName.toLowerCase();
    if (tag === "text" || tag === "tspan") continue;
    // Computed fill resolves var(--mermaid-*) after theme remaps.
    const raw = getComputedStyle(shape).fill;
    if (!raw || raw === "none" || raw.startsWith("url(")) continue;
    const rgb = parseCssColorRgb(raw);
    if (rgb) return rgb;
  }
  return null;
}

hooks.parseCssColorRgb = parseCssColorRgb;
hooks.cssColorKey = cssColorKey;
hooks.relativeLuminanceRgb = relativeLuminanceRgb;
hooks.contrastRatioRgb = contrastRatioRgb;
hooks.readMermaidThemeTokens = readMermaidThemeTokens;
hooks.mermaidThemeVariablesFromCss = mermaidThemeVariablesFromCss;
hooks.ensureExcalifontLoaded = ensureExcalifontLoaded;
hooks.setMermaidPaintVar = setMermaidPaintVar;
hooks.mermaidTextInkVarForFill = mermaidTextInkVarForFill;
hooks.mermaidLabelBackgroundRgb = mermaidLabelBackgroundRgb;
