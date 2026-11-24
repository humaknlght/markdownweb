import { hooks } from "../hooks.js";
import {
  mermaidHeightCache,
  mermaidSources,
  preview,
  state,
} from "../state.js";

/**
 * Ensure the diagram SVG is a direct child of the Mermaid host.
 * Mermaid's iframe-hosted `run()` can leave an empty sibling SVG next to the
 * real diagram — keep the richest SVG, not the first match.
 * @param {HTMLElement} el
 * @returns {SVGElement | null}
 */
export function hoistMermaidDiagramSvg(el) {
  const svgs = [...el.querySelectorAll("svg")].filter(
    (node) => !node.closest(".mermaid-zoom-btn"),
  );
  if (!svgs.length) return null;
  const svg = svgs.reduce((best, cur) =>
    cur.querySelectorAll("*").length > best.querySelectorAll("*").length
      ? cur
      : best,
  );
  if (svg.parentElement !== el) {
    // Preserve zoom controls if they were already mounted.
    const zoomBtn = el.querySelector(":scope > .mermaid-zoom-btn");
    el.replaceChildren(svg);
    if (zoomBtn) el.appendChild(zoomBtn);
  }
  return /** @type {SVGElement} */ (svg);
}

export function syncMermaidSvgSizes() {
  let needsRelayout = false;
  let hasDeferredPending = false;
  for (const host of preview.querySelectorAll(".mermaid")) {
    // Do not hoist here — ResizeObserver can run mid-mermaid.run and would
    // discard Mermaid's in-progress wrapper + SVG. Hoist only after run().
    const svg =
      host.querySelector(":scope > svg") ||
      [...host.querySelectorAll("svg")].find(
        (node) => !node.closest(".mermaid-zoom-btn"),
      );
    if (!svg) {
      hooks.ensureMermaidZoomControls(host);
      if (
        host.hasAttribute("data-pending") &&
        hooks.mermaidNodeIsVisible(host) &&
        hooks.mermaidHostWideEnough(host)
      ) {
        hasDeferredPending = true;
      }
      continue;
    }
    hooks.ensureMermaidZoomControls(host);
    const hostW = host.clientWidth;
    if (hostW < 1) continue;

    let natural = Number(svg.dataset.mermaidNatural);
    if (!Number.isFinite(natural) || natural <= 0) {
      const rawMax = String(svg.style.maxWidth || "").trim();
      // parseFloat("100%") === 100 — never treat percentages as px naturals.
      const fromStyle = /%$/.test(rawMax) ? NaN : parseFloat(rawMax);
      natural =
        Number.isFinite(fromStyle) && fromStyle > 0
          ? fromStyle
          : svg.getBoundingClientRect().width;
      if (!(natural > 0)) continue;
      svg.dataset.mermaidNatural = String(natural);
      if (svg.dataset.mermaidFluid !== "1") {
        svg.dataset.mermaidFluid = Math.abs(natural - hostW) < 8 ? "1" : "0";
      }
    }

    if (svg.dataset.mermaidFluid === "1") {
      // Do not scale the SVG up — that zooms fonts/bars. Keep the natural
      // size until a debounced Mermaid re-run lays out at the new width.
      // Never tear down a good gantt SVG just to re-run into a too-narrow host.
      if (Math.abs(hostW - natural) >= 16) {
        svg.style.maxWidth = `${Math.min(natural, hostW)}px`;
        if (hooks.mermaidHostWideEnough(host)) needsRelayout = true;
      } else {
        svg.style.maxWidth = `${hostW}px`;
      }
    } else {
      svg.style.maxWidth = `${Math.min(natural, hostW)}px`;
    }
  }
  if (needsRelayout) scheduleMermaidRelayout();
  else if (hasDeferredPending) schedulePendingMermaidRender();
}

export function scheduleMermaidScale() {
  if (state.mermaidScaleRaf) return;
  state.mermaidScaleRaf = requestAnimationFrame(() => {
    state.mermaidScaleRaf = 0;
    syncMermaidSvgSizes();
  });
}

/**
 * Retry Mermaid hosts left pending because the preview was too narrow.
 * Debounced with the fluid relayout timer so splitter drags coalesce.
 */
export function schedulePendingMermaidRender() {
  window.clearTimeout(state.mermaidPendingTimer);
  state.mermaidPendingTimer = window.setTimeout(() => {
    state.mermaidPendingTimer = 0;
    void renderMermaidDiagrams().finally(() => {
      // Layout can settle a few frames after stylesheet / splitter changes.
      // Keep retrying while hosts remain pending and under the retry budget.
      if (!preview?.querySelector(".mermaid[data-pending]")) {
        state.mermaidPendingRetries = 0;
        return;
      }
      state.mermaidPendingRetries = (state.mermaidPendingRetries || 0) + 1;
      if (state.mermaidPendingRetries < 12) schedulePendingMermaidRender();
      else state.mermaidPendingRetries = 0;
    });
  }, 220);
}

/**
 * Re-run Mermaid for fluid diagrams whose host width drifted, so gantt (etc.)
 * get a real wider/narrower layout instead of a CSS zoom. Debounced so splitter
 * drags do not flash on every frame.
 */
export function scheduleMermaidRelayout() {
  window.clearTimeout(state.mermaidRelayoutTimer);
  // Hand-drawn sketching (svg2roughjs) often exceeds the classic 220ms debounce.
  // Bumping mermaidGen mid-sketch cancels the pass and leaves classic SVGs
  // without data-mermaid-sketched / var(--mermaid-*) paints (flaky e2e on CI).
  const delay = state.mermaidLook === "handDrawn" ? 900 : 220;
  state.mermaidRelayoutTimer = window.setTimeout(() => {
    state.mermaidRelayoutTimer = 0;
    relayoutFluidMermaidDiagrams();
  }, delay);
}

export function relayoutFluidMermaidDiagrams() {
  /** @type {HTMLElement[]} */
  const targets = [];
  for (const el of preview.querySelectorAll(".mermaid")) {
    const svg = el.querySelector(":scope > svg");
    if (svg?.dataset.mermaidFluid !== "1") continue;
    if (!mermaidSources.has(el)) continue;
    // Keep the last good SVG while the pane is too narrow for a safe re-run.
    if (!hooks.mermaidHostWideEnough(el)) continue;
    const natural = Number(svg.dataset.mermaidNatural);
    if (!Number.isFinite(natural)) continue;
    if (Math.abs(el.clientWidth - natural) < 16) continue;
    targets.push(el);
  }
  if (!targets.length) {
    // Width may have grown enough for first-time deferred hosts.
    void renderMermaidDiagrams();
    return;
  }

  state.mermaidGen += 1;
  for (const el of targets) {
    const prevH = el.clientHeight;
    if (prevH > 0) el.style.minHeight = `${prevH}px`;
    el.removeAttribute("data-processed");
    el.textContent = mermaidSources.get(el) ?? "";
    // Source was just written back; keep the WeakMap entry for the next pass.
    el.setAttribute("data-pending", "");
  }
  void renderMermaidDiagrams().finally(() => {
    for (const el of targets) {
      if (preview.contains(el)) el.style.minHeight = "";
    }
  });
}

/**
 * Render Mermaid diagrams that still need it. Skips nodes that are not laid out
 * (`[hidden]` / `.md-section-folded`) unless `force` is set — those get a wrong
 * viewBox if measured while display:none. Call again when a slide/section is shown.
 * @param {{ force?: boolean }} [opts]
 */
export async function renderMermaidDiagrams({ force = false } = {}) {
  const all = [...preview.querySelectorAll(".mermaid")];
  if (!all.length) return;

  const gen = state.mermaidGen;
  for (const el of all) {
    // Don't blank diagrams that already rendered (re-entry from slide change).
    const existing =
      el.querySelector(":scope > svg") ||
      [...el.querySelectorAll("svg")].find(
        (node) => !node.closest(".mermaid-zoom-btn"),
      );
    // Empty SVGs (cross-document Mermaid failures) must be retried.
    const hasDiagram =
      existing &&
      existing.querySelectorAll(
        "path, rect, polygon, circle, line, polyline, text, foreignObject",
      ).length > 0;
    if (!hasDiagram) {
      hooks.rememberMermaidSource(el);
      el.setAttribute("data-pending", "");
    }
  }

  /** @type {Array<() => void>} */
  const restore = [];
  if (force) {
    for (const el of preview.querySelectorAll("[hidden]")) {
      el.removeAttribute("hidden");
      restore.push(() => el.setAttribute("hidden", ""));
    }
    for (const el of preview.querySelectorAll(".md-section-folded")) {
      el.classList.remove("md-section-folded");
      restore.push(() => el.classList.add("md-section-folded"));
    }
    // Flush layout so Mermaid measures real boxes.
    void preview.offsetWidth;
  }

  const candidates = [
    ...preview.querySelectorAll(".mermaid[data-pending]"),
  ].filter((el) => force || hooks.mermaidNodeIsVisible(el));
  // Defer narrow hosts (esp. gantt) — leave data-pending for resize retry.
  const nodes = candidates.filter((el) => hooks.mermaidHostWideEnough(el));

  /** @type {Map<HTMLElement, { svg: string | null, scopeId: string, sourceSize: object | null }>} */
  const results = new Map();
  try {
    if (nodes.length) {
      if (state.mermaidLook === "handDrawn")
        await hooks.ensureExcalifontLoaded();
      if (gen !== state.mermaidGen) return;
      // Mermaid + svg2roughjs run in the opaque-origin sandbox frame; only
      // sanitized SVG markup comes back into the preview.
      const items = nodes.map((el) => {
        hooks.rememberMermaidSource(el);
        return {
          source: mermaidSources.get(el) ?? "",
          width: Math.max(el.clientWidth, 1),
        };
      });
      const rendered = await hooks.renderMermaidInSandbox(items, {
        sketch: hooks.mermaidNeedsSketch(),
      });
      if (gen !== state.mermaidGen) return;
      nodes.forEach((el, i) => {
        const result = rendered[i];
        const svg = hooks.adoptSandboxMermaidSvg(result, el.ownerDocument);
        if (!svg) return;
        el.replaceChildren(svg);
        results.set(el, result);
      });
    }
  } catch {
    /* renderer load / timeout failures leave the diagram source visible */
  } finally {
    for (const undo of restore.reverse()) undo();
  }

  if (gen !== state.mermaidGen) return;
  for (const el of nodes) {
    el.removeAttribute("data-pending");
    // Fresh SVG from this run — retag natural/fluid at the current host width.
    const svg = el.querySelector(":scope > svg");
    if (svg) {
      const sourceSize = results.get(el)?.sourceSize;
      if (sourceSize) hooks.finishSketchedMermaidSvg(svg, sourceSize);
      // Sketched SVGs already recorded natural size from the classic CSS box —
      // don't wipe it or syncMermaidSvgSizes will treat width=host as "fluid"
      // and stretch them again.
      if (svg.dataset.mermaidSketched !== "1") {
        delete svg.dataset.mermaidNatural;
        delete svg.dataset.mermaidFluid;
      }
      // Long gantt titles overflow the fluid viewBox; constrain after insert so
      // getBBox reflects the live SVG (must be connected).
      hooks.fitMermaidDiagramTitle?.(svg);
      // Re-apply constructable CSS if SVG <style> CSSOM is blocked (black gantt).
      hooks.adoptMermaidSvgStyles?.(svg);
      // Mermaid bindFunctions attach JS listeners that never cross the sandbox
      // boundary. Re-apply click hrefs as real SVG <a> links.
      const srcForLinks = mermaidSources.get(el) ?? "";
      if (srcForLinks) hooks.linkMermaidSvgClicks?.(svg, srcForLinks);
    }
    // Release the paint reservation now that the real SVG owns layout.
    el.style.minHeight = "";
    const src = mermaidSources.get(el);
    const h = el.offsetHeight;
    if (src && h > 0) mermaidHeightCache.set(hooks.mermaidReuseKey(src), h);
  }
  syncMermaidSvgSizes();
}

/**
 * Re-run every Mermaid host with the current look (classic / handDrawn).
 * Used when the Diagrams toolbar preference changes.
 */
export function rerenderAllMermaidDiagrams() {
  const hosts = [...preview.querySelectorAll(".mermaid")];
  if (!hosts.length) return Promise.resolve();

  state.mermaidGen += 1;
  for (const el of hosts) {
    hooks.rememberMermaidSource(el);
    const prevH = el.clientHeight;
    if (prevH > 0) el.style.minHeight = `${prevH}px`;
    el.removeAttribute("data-processed");
    el.textContent = mermaidSources.get(el) ?? "";
    el.setAttribute("data-pending", "");
  }
  return renderMermaidDiagrams().finally(() => {
    for (const el of hosts) {
      if (preview.contains(el)) el.style.minHeight = "";
    }
  });
}

hooks.hoistMermaidDiagramSvg = hoistMermaidDiagramSvg;
hooks.syncMermaidSvgSizes = syncMermaidSvgSizes;
hooks.scheduleMermaidScale = scheduleMermaidScale;
hooks.schedulePendingMermaidRender = schedulePendingMermaidRender;
hooks.scheduleMermaidRelayout = scheduleMermaidRelayout;
hooks.relayoutFluidMermaidDiagrams = relayoutFluidMermaidDiagrams;
hooks.renderMermaidDiagrams = renderMermaidDiagrams;
hooks.rerenderAllMermaidDiagrams = rerenderAllMermaidDiagrams;
