import { MERMAID_ZOOM_MAX, MERMAID_ZOOM_MIN } from "../constants.js";

/**
 * Stage layout for the zoom iframe. Theme colors come from copied custom
 * properties (`zoomStageVariableDeclarations`), not from styles.css — the
 * iframe must not inherit app chrome.
 */
export const ZOOM_STAGE_LAYOUT_CSS =
  "html,body{margin:0;min-height:100%;background:var(--mermaid-bg,#fff);color:var(--mermaid-fg,#333);color-scheme:var(--color-scheme,light);font-family:var(--mermaid-font,system-ui,sans-serif)}" +
  "body{padding:1rem;box-sizing:border-box}" +
  ".mermaid-zoom-scaler{margin:0 auto;width:max-content;max-width:none}" +
  ".mermaid-zoom-scaler > svg{display:block;max-width:none;height:auto;background:var(--mermaid-bg,#fff);font-family:var(--mermaid-font,system-ui,sans-serif)}" +
  "foreignObject,foreignObject div,foreignObject span,foreignObject p{font-family:var(--mermaid-font,system-ui,sans-serif)}" +
  ".mermaid-zoom-scaler foreignObject p,.mermaid-zoom-scaler foreignObject div{margin:0!important}" +
  ".mermaid-zoom-scaler .labelBkg,.mermaid-zoom-scaler span.edgeLabel,.mermaid-zoom-scaler .edgeLabel .labelBkg,.mermaid-zoom-scaler .edgeLabel p,.mermaid-zoom-scaler .edgeLabel span{background-color:var(--mermaid-label-bg)}" +
  ".mermaid-zoom-scaler .edgeLabel foreignObject p,.mermaid-zoom-scaler .edgeLabel foreignObject span{color:var(--mermaid-fg)}";

/** `;{}` or comments would break the single `:root` rule or close it early. */
const UNSAFE_CSS_VALUE = /[;{}]|\/\*|\*\//;

/**
 * Serialize theme tokens the zoom iframe cannot inherit. `--mermaid`,
 * `--chrome`, `--preview`, and `--color-scheme` are copied. `--color-scheme`
 * drives the native scrollbar. Values that cannot sit in one declaration are
 * dropped so one bad token cannot discard the rest.
 * @param {{ [Symbol.iterator](): IterableIterator<string>, getPropertyValue(name: string): string }} style
 * @returns {string}
 */
export function zoomStageVariableDeclarations(style) {
  /** @type {string[]} */
  const parts = [];
  for (const name of style) {
    if (
      name !== "--color-scheme" &&
      !name.startsWith("--mermaid") &&
      !name.startsWith("--chrome") &&
      !name.startsWith("--preview")
    ) {
      continue;
    }
    const value = style.getPropertyValue(name).trim();
    if (!value || UNSAFE_CSS_VALUE.test(value)) continue;
    parts.push(`${name}:${value}`);
  }
  return parts.join(";");
}

/**
 * @param {string} variableDeclarations
 * @returns {string}
 */
export function zoomStageCssText(variableDeclarations) {
  const vars = String(variableDeclarations || "").trim();
  const root = vars ? `:root{${vars}}` : "";
  return root + ZOOM_STAGE_LAYOUT_CSS;
}

/**
 * Apply zoom-stage CSS on `doc`. The stage is an about:blank iframe, so it
 * inherits the parent `style-src 'self'` policy and a written `<style>` does
 * not apply (`style.sheet` stays null). A constructable sheet does.
 * @param {Document} doc
 * @param {string} cssText
 * @returns {boolean}
 */
export function adoptZoomStageCss(doc, cssText) {
  const view = doc?.defaultView;
  if (!view || typeof view.CSSStyleSheet !== "function") return false;
  const css = String(cssText || "");
  if (!css) return false;
  try {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(css);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    return true;
  } catch {
    return false;
  }
}

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
