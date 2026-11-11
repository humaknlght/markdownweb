import { hooks } from "../hooks.js";
import {
  mermaidHeightCache,
  mermaidSources,
  preview,
  state,
} from "../state.js";

/**
 * Mermaid replaces diagram text with SVG. Keep the source so fluid diagrams
 * (gantt, etc.) can re-run at a new width without CSS-zooming text/bars.
 * @param {HTMLElement} el
 */
export function rememberMermaidSource(el) {
  // No diagram SVG means the host is showing fence text. A morph reuses the
  // element across edits, so the map may still hold the previous fence.
  // Leaving it stale made restore put the old SVG back and the preview never
  // updated.
  if (!el.querySelector(":scope > svg")) {
    mermaidSources.set(el, el.textContent ?? "");
    return;
  }
  if (!mermaidSources.has(el)) {
    mermaidSources.set(el, el.textContent ?? "");
  }
}

/**
 * Collect rendered Mermaid SVGs before the preview DOM is replaced so unchanged
 * diagrams can be restored without a Mermaid re-run (avoids height/scroll thrash
 * when typing below diagrams).
 * @returns {Map<string, { svg: SVGElement, height: number }[]>}
 */
export function mermaidReuseKey(src) {
  return `${state.mermaidLook}\0${src}`;
}

export function takeMermaidRenderReuse() {
  /** @type {Map<string, { svg: SVGElement, height: number }[]>} */
  const bySource = new Map();
  for (const el of preview.querySelectorAll(".mermaid")) {
    // Direct child only — zoom-button icons are nested SVGs.
    const svg = el.querySelector(":scope > svg");
    const src = mermaidSources.get(el);
    if (!svg || !src) continue;
    const height = el.offsetHeight;
    if (height > 0) mermaidHeightCache.set(mermaidReuseKey(src), height);
    const key = mermaidReuseKey(src);
    const list = bySource.get(key) || [];
    list.push({ svg: /** @type {SVGElement} */ (svg.cloneNode(true)), height });
    bySource.set(key, list);
  }
  return bySource;
}

/**
 * Restore unchanged Mermaid SVGs after a preview repaint; reserve height and mark
 * pending only for diagrams whose source is new or changed.
 * @param {Map<string, { svg: SVGElement, height: number }[]>} bySource
 */
export function restoreMermaidRenders(bySource) {
  for (const el of preview.querySelectorAll(".mermaid")) {
    // Capture source from the fresh fence text before we swap in an SVG.
    rememberMermaidSource(el);
    const src = mermaidSources.get(el) ?? "";
    const key = mermaidReuseKey(src);
    const list = bySource.get(key);
    const reuse = list?.shift();
    if (reuse) {
      // A morph may have kept this host and its SVG. Replacing it with a clone
      // would drop the zoom control and repaint the diagram on every keystroke.
      if (!el.querySelector(":scope > svg")) el.replaceChildren(reuse.svg);
      el.style.minHeight = "";
      el.removeAttribute("data-pending");
      continue;
    }
    el.setAttribute("data-pending", "");
    const h = mermaidHeightCache.get(key);
    if (h > 0) el.style.minHeight = `${h}px`;
  }
}

/** True while any Mermaid host is still waiting for (or mid) SVG paint. */
export function mermaidPreviewUnsettled() {
  return Boolean(preview.querySelector(".mermaid[data-pending]"));
}

hooks.rememberMermaidSource = rememberMermaidSource;
hooks.mermaidReuseKey = mermaidReuseKey;
hooks.takeMermaidRenderReuse = takeMermaidRenderReuse;
hooks.restoreMermaidRenders = restoreMermaidRenders;
hooks.mermaidPreviewUnsettled = mermaidPreviewUnsettled;
