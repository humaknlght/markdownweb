import { hooks } from "../hooks.js";

export function normalizeMermaidHandDrawnColors(svg) {
  const tokens = hooks.readMermaidThemeTokens();
  /** @type {Record<string, string>} */
  const varByRole = {
    bg: "--mermaid-bg",
    fg: "--mermaid-fg",
    nodeBg: "--mermaid-node-bg",
    nodeBorder: "--mermaid-node-border",
    clusterBg: "--mermaid-cluster-bg",
    clusterBorder: "--mermaid-cluster-border",
    line: "--mermaid-line",
    labelBg: "--mermaid-label-bg",
    noteBg: "--mermaid-note-bg",
    noteFg: "--mermaid-note-fg",
  };
  /** Surface fills sketched as strokes must become ink for ≥3:1 UI contrast. */
  const surfaceToInk = {
    bg: "line",
    nodeBg: "nodeBorder",
    clusterBg: "clusterBorder",
    labelBg: "line",
    noteBg: "noteFg",
  };

  /** @type {Map<string, string>} */
  const roleByColor = new Map();
  for (const [role, value] of Object.entries(tokens)) {
    const rgb = hooks.parseCssColorRgb(value);
    if (rgb) roleByColor.set(hooks.cssColorKey(rgb), role);
  }
  // Classic Mermaid "base" defaults that Rough often bakes before CSS overrides.
  // #333 is Mermaid's default edge stroke — treat as line ink, not text fill.
  for (const [hex, role] of [
    ["#ececff", "nodeBg"],
    ["#9370db", "nodeBorder"],
    ["#ffffde", "clusterBg"],
    ["#f4f4f4", "labelBg"],
    ["#e8e8e8", "labelBg"],
    ["#ffffff", "bg"],
    ["#333333", "line"],
    ["#333", "line"],
    ["#000000", "line"],
    ["#000", "line"],
    ["#fff5ad", "noteBg"],
    ["#6b6b22", "clusterBorder"],
  ]) {
    const rgb = hooks.parseCssColorRgb(hex);
    if (rgb) roleByColor.set(hooks.cssColorKey(rgb), role);
  }

  const bgRgb = hooks.parseCssColorRgb(tokens.bg);
  const nodeBgRgb = hooks.parseCssColorRgb(tokens.nodeBg);

  // Pass 1: remap shape paints (keep author classDef fills that are not theme tokens).
  for (const el of svg.querySelectorAll(
    "path, rect, line, circle, polygon, polyline",
  )) {
    const computed = getComputedStyle(el);

    for (const attr of /** @type {const} */ (["stroke", "fill"])) {
      let raw = el.getAttribute(attr);
      if (raw?.startsWith("url(") || raw?.startsWith("var(")) continue;

      // Mermaid edges often omit stroke attrs and paint via SVG CSS (#333).
      if (!raw || raw === "none") {
        const painted = computed[attr];
        if (!painted || painted === "none") continue;
        if (attr === "fill") {
          const hadAttr = el.hasAttribute("fill") && el.getAttribute("fill") !== "none";
          if (!hadAttr || raw === "none") continue;
          raw = painted;
        } else {
          raw = painted;
        }
      }

      const rgb = hooks.parseCssColorRgb(raw);
      if (!rgb) continue;

      let role = roleByColor.get(hooks.cssColorKey(rgb));
      // Unknown low-contrast strokes against the canvas → theme ink. Do NOT remap
      // unknown fills: classDef pastels (#9f6, #f96) are intentionally light and
      // would otherwise be replaced with node-bg (contrast vs canvas is often <3).
      if (!role && attr === "stroke" && bgRgb && hooks.contrastRatioRgb(rgb, bgRgb) < 3) {
        role = "line";
      }
      if (!role) continue;

      if (attr === "stroke" && surfaceToInk[role]) {
        // Stroke-only sketch of a filled surface: restore the fill so ink sits
        // on the intended background (e.g. note-fg on note-bg, not page bg).
        const curFill = el.getAttribute("fill");
        if (!curFill || curFill === "none") {
          hooks.setMermaidPaintVar(el, "fill", varByRole[role]);
        }
        role = surfaceToInk[role];
      }
      // Note borders are inked with note-fg; without a fill they sit on the page
      // canvas and fail contrast on dark themes (dark ink on dark bg).
      if (
        attr === "stroke" &&
        role === "noteFg" &&
        (!el.getAttribute("fill") || el.getAttribute("fill") === "none")
      ) {
        hooks.setMermaidPaintVar(el, "fill", varByRole.noteBg);
      }
      // Text-ish fills on shapes (arrowheads) that matched fg/line → line ink.
      if (attr === "fill" && (role === "fg" || role === "line")) {
        role = "line";
      }

      const cssVar = varByRole[role];
      if (cssVar) hooks.setMermaidPaintVar(el, attr, cssVar);
    }
  }

  // Pass 2: label ink against the (now final) shape fills — including classDef colors.
  for (const el of svg.querySelectorAll("text, tspan")) {
    const note =
      el.classList.contains("noteText") ||
      Boolean(el.closest?.(".noteText, .note"));
    if (note) {
      hooks.setMermaidPaintVar(el, "fill", varByRole.noteFg);
      continue;
    }
    const behind = hooks.mermaidLabelBackgroundRgb(el) || nodeBgRgb || bgRgb;
    const inkVar = behind
      ? hooks.mermaidTextInkVarForFill(behind, tokens, varByRole)
      : varByRole.fg;
    hooks.setMermaidPaintVar(el, "fill", inkVar);
  }

  for (const label of svg.querySelectorAll(
    ".nodeLabel, .edgeLabel, .label, .cluster-label, foreignObject div, foreignObject span, foreignObject p",
  )) {
    if (!(label instanceof HTMLElement) && !(label instanceof SVGElement)) continue;
    const note = Boolean(label.closest?.(".noteText, .note"));
    if (note) {
      label.style.setProperty("color", `var(${varByRole.noteFg})`, "important");
      continue;
    }
    const behind = hooks.mermaidLabelBackgroundRgb(label) || nodeBgRgb || bgRgb;
    const inkVar = behind
      ? hooks.mermaidTextInkVarForFill(behind, tokens, varByRole)
      : varByRole.fg;
    label.style.setProperty("color", `var(${inkVar})`, "important");
  }
}

/**
 * Fit viewBox around sketched content (RoughJS strokes bow outside Mermaid's
 * box). Uses the root SVG bbox — per-element boxes from svg2roughjs can report
 * huge empty extents (pie labels) that inflate the canvas and cause scrollbars.
 *
 * @param {SVGSVGElement | SVGElement} svg
 * @param {{ pad?: number, tighten?: boolean }} [opts]
 *   tighten: crop to content with uniform pad (hand-drawn). Mermaid/svg2roughjs
 *   often leave asymmetric empty viewBox gutters, so the SVG box is centered
 *   but the drawing looks shifted left/right in the preview.
 */
export function fitMermaidSvgViewBox(svg, { pad = 8, tighten = false } = {}) {
  if (!(svg instanceof SVGSVGElement)) return;
  const rawVb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const hasVb = rawVb.length === 4 && rawVb.every((n) => Number.isFinite(n));
  const vx = hasVb ? rawVb[0] : 0;
  const vy = hasVb ? rawVb[1] : 0;
  const vw = hasVb ? rawVb[2] : 0;
  const vh = hasVb ? rawVb[3] : 0;

  let bb;
  try {
    bb = svg.getBBox();
  } catch {
    bb = null;
  }

  // Absurd bbox (gantt "today" marker years off-canvas): only pad the original.
  const absurd =
    hasVb &&
    bb &&
    bb.width > 0 &&
    bb.height > 0 &&
    (bb.width > Math.max(vw * 2.5, 1) || bb.height > Math.max(vh * 2.5, 1));

  if (!bb || !(bb.width > 0 && bb.height > 0) || absurd) {
    if (!hasVb || !(vw > 0 && vh > 0)) return;
    svg.setAttribute(
      "viewBox",
      `${vx - pad} ${vy - pad} ${vw + pad * 2} ${vh + pad * 2}`,
    );
    return;
  }

  if (tighten) {
    // Crop to ink with equal pad so content sits in the middle of the SVG.
    const nextW = bb.width + pad * 2;
    const nextH = bb.height + pad * 2;
    if (!(nextW > 0 && nextH > 0)) return;
    svg.setAttribute(
      "viewBox",
      `${bb.x - pad} ${bb.y - pad} ${nextW} ${nextH}`,
    );
    return;
  }

  // Prefer content bbox, but never shrink below the original viewBox (avoids
  // clipping Mermaid chrome) and only expand modestly for rough overflow.
  let minX = bb.x - pad;
  let minY = bb.y - pad;
  let maxX = bb.x + bb.width + pad;
  let maxY = bb.y + bb.height + pad;
  if (hasVb && vw > 0 && vh > 0) {
    minX = Math.min(minX, vx - pad);
    minY = Math.min(minY, vy - pad);
    maxX = Math.max(maxX, vx + vw + pad);
    maxY = Math.max(maxY, vy + vh + pad);
    // Cap expansion so a few wild glyphs can't create empty scrollable gutters.
    const maxW = vw * 1.35;
    const maxH = vh * 1.35;
    if (maxX - minX > maxW) {
      const cx = (minX + maxX) / 2;
      minX = cx - maxW / 2;
      maxX = cx + maxW / 2;
    }
    if (maxY - minY > maxH) {
      const cy = (minY + maxY) / 2;
      minY = cy - maxH / 2;
      maxY = cy + maxH / 2;
    }
  }

  const nextW = maxX - minX;
  const nextH = maxY - minY;
  if (!(nextW > 0 && nextH > 0)) return;
  svg.setAttribute("viewBox", `${minX} ${minY} ${nextW} ${nextH}`);
}

/**
 * Match classic Mermaid content scale after sketching.
 * fitMermaidSvgViewBox pads the viewBox for RoughJS stroke overflow. Keeping the
 * classic CSS width with a wider viewBox shrinks nodes/text (gitGraph looked
 * smaller in hand-drawn). Scale CSS width by newVb/oldVb so content stays the
 * same size; syncMermaidSvgSizes still caps with max-width when the host is narrow.
 * @param {SVGElement} sketched
 * @param {{ cssWidth: number, cssHeight: number, viewBoxWidth: number, hostWidth: number }} sourceSize
 */
export function sizeSketchedMermaidSvg(sketched, sourceSize) {
  if (!(sketched instanceof SVGElement)) return;

  const vb = (sketched.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : NaN;
  const srcVbW = sourceSize?.viewBoxWidth;

  // Do not set style.maxWidth = "100%": syncMermaidSvgSizes parseFloat → 100px lock.
  sketched.style.removeProperty("max-width");
  sketched.style.height = "auto";
  delete sketched.dataset.mermaidNatural;
  delete sketched.dataset.mermaidFluid;

  let w = sourceSize?.cssWidth;
  // Preserve classic content scale when viewBox grows (rough pad) or shrinks
  // (tighten crops asymmetric gutters so drawings look centered).
  if (w > 0 && srcVbW > 0 && Number.isFinite(vbW) && vbW !== srcVbW) {
    w *= vbW / srcVbW;
  }
  if (!(w > 0) && Number.isFinite(vbW)) w = vbW;

  const hostW = sourceSize?.hostWidth ?? 0;
  // Use rendered size, not width="100%" — gitGraph sets 100% but stays content-sized
  // via max-width ≈ viewBox; treating % as fluid stretched it to the full panel.
  const filledHost =
    sourceSize?.cssWidth > 0 &&
    hostW > 0 &&
    Math.abs(sourceSize.cssWidth - hostW) < 8;

  if (filledHost) {
    // Fluid diagrams stay at 100% — slight shrink from viewBox pad is preferable
    // to overflowing the preview (the old width=100% vertical-scroll bug).
    sketched.setAttribute("width", "100%");
    sketched.dataset.mermaidFluid = "1";
  } else if (w > 0) {
    const pxW = Math.round(w);
    sketched.setAttribute("width", String(pxW));
    sketched.dataset.mermaidNatural = String(pxW);
    sketched.dataset.mermaidFluid = "0";
  } else {
    sketched.removeAttribute("width");
  }
  // height:auto + viewBox preserves aspect (needed for foreignObject label layout).
  sketched.removeAttribute("height");
}

hooks.normalizeMermaidHandDrawnColors = normalizeMermaidHandDrawnColors;
hooks.fitMermaidSvgViewBox = fitMermaidSvgViewBox;
hooks.sizeSketchedMermaidSvg = sizeSketchedMermaidSvg;
