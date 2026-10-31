import { hooks } from "../hooks.js";
import {
  state,
  preview,
  mermaidSources,
  mermaidHeightCache
} from "../state.js";

export function syncMermaidSvgSizes() {
  let needsRelayout = false;
  let hasDeferredPending = false;
  for (const host of preview.querySelectorAll(".mermaid")) {
    const svg = host.querySelector(":scope > svg");
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
    void renderMermaidDiagrams();
  }, 220);
}

/**
 * Re-run Mermaid for fluid diagrams whose host width drifted, so gantt (etc.)
 * get a real wider/narrower layout instead of a CSS zoom. Debounced so splitter
 * drags do not flash on every frame.
 */
export function scheduleMermaidRelayout() {
  window.clearTimeout(state.mermaidRelayoutTimer);
  state.mermaidRelayoutTimer = window.setTimeout(() => {
    state.mermaidRelayoutTimer = 0;
    relayoutFluidMermaidDiagrams();
  }, 220);
}

export function relayoutFluidMermaidDiagrams() {
  /** @type {HTMLElement[]} */
  const targets = [];
  for (const el of preview.querySelectorAll(".mermaid")) {
    const svg = el.querySelector(":scope > svg");
    if (!svg || svg.dataset.mermaidFluid !== "1") continue;
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
 * Mermaid sometimes keeps `taskText` + middle anchoring when the label is wider
 * than the bar, but still parks `x` at the bar's right edge. That reads as a
 * large left gap inside the bar (common in readable width). Promote those
 * labels to outside-right placement.
 * @param {SVGElement} svg
 */
export function fixMermaidGanttLabels(svg) {
  if (svg.getAttribute("aria-roledescription") !== "gantt") return;
  const bars = [...svg.querySelectorAll("rect")]
    .map((r) => ({
      className: r.getAttribute("class") || "",
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
      h: Number(r.getAttribute("height")),
    }))
    .filter(
      (b) =>
        /\b(task|active|done|crit)\b/i.test(b.className) &&
        Number.isFinite(b.x) &&
        Number.isFinite(b.w) &&
        b.h >= 12 &&
        b.h <= 28 &&
        b.w > 0,
    );

  for (const text of svg.querySelectorAll("text")) {
    const cls = text.getAttribute("class") || "";
    if (!/\btaskText\b|\b(?:active|done|crit)Text\d/.test(cls)) continue;
    if (/\btaskTextOutside(?:Left|Right)\b/.test(cls)) continue;

    const widthMatch = cls.match(/\bwidth-([\d.]+)\b/);
    const textW = widthMatch ? Number(widthMatch[1]) : 0;
    const x = Number(text.getAttribute("x"));
    const y = Number(text.getAttribute("y"));
    if (!(textW > 0) || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    const bar = bars
      .map((b) => ({ ...b, yDist: Math.abs(b.y + b.h / 2 - y) }))
      .sort((a, b) => a.yDist - b.yDist)[0];
    if (!bar || bar.yDist > bar.h || textW <= bar.w + 1) continue;

    const barEnd = bar.x + bar.w;
    const sec = cls.match(/\btaskText(\d)\b/)?.[1];
    text.classList.add("taskTextOutsideRight");
    if (sec != null) text.classList.add(`taskTextOutside${sec}`);
    text.setAttribute("text-anchor", "start");
    // Mermaid's outside-right offset is ~5px past the bar end.
    text.setAttribute("x", String(barEnd + 5));
  }
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
    if (!el.querySelector(":scope > svg")) {
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

  const candidates = [...preview.querySelectorAll(".mermaid[data-pending]")].filter(
    (el) => force || hooks.mermaidNodeIsVisible(el),
  );
  // Defer narrow hosts (esp. gantt) — leave data-pending for resize retry.
  const nodes = candidates.filter((el) => hooks.mermaidHostWideEnough(el));

  try {
    if (nodes.length) {
      if (state.mermaidLook === "handDrawn") await hooks.ensureExcalifontLoaded();
      if (gen !== state.mermaidGen) return;
      const mermaid = await hooks.loadMermaid();
      if (gen !== state.mermaidGen) return;
      mermaid.initialize(hooks.mermaidConfig());
      await mermaid.run({ nodes, suppressErrors: true });
    }
  } catch {
    /* invalid diagrams render into their nodes; import failures are ignored */
  } finally {
    for (const undo of restore.reverse()) undo();
  }

  if (gen !== state.mermaidGen) return;
  for (const el of nodes) {
    el.removeAttribute("data-pending");
    // Fresh SVG from this run — retag natural/fluid at the current host width.
    let svg = el.querySelector(":scope > svg");
    if (svg) {
      fixMermaidGanttLabels(svg);
      if (hooks.mermaidNeedsSketch()) {
        try {
          const sketched = await hooks.sketchMermaidSvg(svg);
          if (gen !== state.mermaidGen) return;
          if (sketched) svg = sketched;
        } catch {
          /* keep the classic Mermaid SVG if the sketcher fails to load */
        }
      }
      // Sketched SVGs already recorded natural size from the classic CSS box —
      // don't wipe it or syncMermaidSvgSizes will treat width=host as "fluid"
      // and stretch them again.
      if (svg.dataset.mermaidSketched !== "1") {
        delete svg.dataset.mermaidNatural;
        delete svg.dataset.mermaidFluid;
      }
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

hooks.syncMermaidSvgSizes = syncMermaidSvgSizes;
hooks.scheduleMermaidScale = scheduleMermaidScale;
hooks.schedulePendingMermaidRender = schedulePendingMermaidRender;
hooks.scheduleMermaidRelayout = scheduleMermaidRelayout;
hooks.relayoutFluidMermaidDiagrams = relayoutFluidMermaidDiagrams;
hooks.fixMermaidGanttLabels = fixMermaidGanttLabels;
hooks.renderMermaidDiagrams = renderMermaidDiagrams;
hooks.rerenderAllMermaidDiagrams = rerenderAllMermaidDiagrams;
