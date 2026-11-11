import { MERMAID_ZOOM_BTN_SVG, MERMAID_ZOOM_STEP } from "../constants.js";
import { hooks } from "../hooks.js";
import {
  mermaidZoomCloseBtn,
  mermaidZoomDialog,
  mermaidZoomInBtn,
  mermaidZoomLevel,
  mermaidZoomOutBtn,
  mermaidZoomResetBtn,
  mermaidZoomStage,
  preview,
  state,
} from "../state.js";
import { clampMermaidZoom, mermaidZoomViewBox } from "./zoom-utils.js";

export { clampMermaidZoom, mermaidZoomViewBox };

export function ensureMermaidZoomControls(host) {
  if (!host.querySelector(":scope > svg")) {
    host.querySelector(".mermaid-zoom-btn")?.remove();
    return;
  }
  if (host.querySelector(":scope > .mermaid-zoom-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mermaid-zoom-btn";
  btn.title = "Zoom diagram";
  btn.setAttribute("aria-label", "Zoom diagram");
  btn.innerHTML = MERMAID_ZOOM_BTN_SVG;
  host.appendChild(btn);
}

/**
 * Scale by SVG viewport width (keep viewBox; height:auto). Avoid CSS
 * transform: scale — browsers often rasterize that layer and the diagram
 * looks blurry when zoomed.
 */
export function applyMermaidZoom() {
  const svg = mermaidZoomStage?.querySelector(".mermaid-zoom-scaler > svg");
  // Don't use instanceof — the node may have been imported from the preview iframe.
  if (svg?.namespaceURI !== "http://www.w3.org/2000/svg") return;
  if (!(state.mermaidZoomBaseW > 0)) return;
  state.mermaidZoomFactor = clampMermaidZoom(state.mermaidZoomFactor);
  const w = state.mermaidZoomBaseW * state.mermaidZoomFactor;
  svg.style.maxWidth = "none";
  svg.style.width = `${w}px`;
  svg.style.height = "auto";
  svg.setAttribute("width", String(Math.round(w)));
  svg.removeAttribute("height");
  if (mermaidZoomLevel) {
    mermaidZoomLevel.textContent = `${Math.round(state.mermaidZoomFactor * 100)}%`;
  }
}

/** Fit the zoomed SVG to the dialog stage width. */
export function fitMermaidZoom() {
  if (!(state.mermaidZoomBaseW > 0) || !mermaidZoomStage) return;
  const stageW = mermaidZoomStage.clientWidth;
  if (!(stageW > 0)) {
    state.mermaidZoomFactor = 1;
  } else {
    state.mermaidZoomFactor = clampMermaidZoom(
      (stageW * 0.92) / state.mermaidZoomBaseW,
    );
  }
  applyMermaidZoom();
}

/**
 * Open the zoom dialog for a Mermaid host. Scales only that diagram so text
 * stays readable without changing the rest of the preview.
 * @param {HTMLElement} host
 */
export function openMermaidZoom(host) {
  if (!mermaidZoomDialog || !mermaidZoomStage) return;
  const srcSvg = host.querySelector(":scope > svg");
  if (!srcSvg) return;

  const pre = srcSvg.getBoundingClientRect();
  state.mermaidZoomBaseW = pre.width > 0 ? pre.width : 400;
  state.mermaidZoomBaseH = Math.max(pre.height, 0);
  state.mermaidZoomFactor = 1;

  // Preview lives in a sandboxed iframe — import into the parent document so
  // the dialog owns the node (cloneNode alone keeps the iframe realm).
  const clone = /** @type {SVGElement} */ (
    srcSvg.ownerDocument === document
      ? srcSvg.cloneNode(true)
      : document.importNode(srcSvg, true)
  );
  // Keep (or synthesize) viewBox; zoom changes display width/height so the
  // browser re-rasters vectors + foreignObject labels crisply together.
  clone.setAttribute(
    "viewBox",
    mermaidZoomViewBox(srcSvg, state.mermaidZoomBaseW, state.mermaidZoomBaseH),
  );
  clone.style.maxWidth = "none";
  clone.style.width = `${state.mermaidZoomBaseW}px`;
  clone.style.height = "auto";
  clone.setAttribute("width", String(Math.round(state.mermaidZoomBaseW)));
  clone.removeAttribute("height");

  const scaler = document.createElement("div");
  scaler.className = "mermaid-zoom-scaler";
  scaler.appendChild(clone);

  mermaidZoomStage.replaceChildren(scaler);
  applyMermaidZoom();
  mermaidZoomDialog.showModal();

  // After layout, fit to stage width (viewBox keeps aspect via height:auto).
  requestAnimationFrame(() => {
    if (!mermaidZoomDialog?.open) return;
    const laidOut = scaler.querySelector("svg")?.getBoundingClientRect().height;
    if (laidOut > 0) state.mermaidZoomBaseH = laidOut;
    fitMermaidZoom();
    mermaidZoomStage.focus({ preventScroll: true });
  });
}

export function closeMermaidZoom() {
  if (!mermaidZoomDialog?.open) return;
  mermaidZoomDialog.close();
}

export function onMermaidZoomDialogClose() {
  mermaidZoomStage?.replaceChildren();
  state.mermaidZoomBaseW = 0;
  state.mermaidZoomBaseH = 0;
  state.mermaidZoomFactor = 1;
}

export function stepMermaidZoom(delta) {
  state.mermaidZoomFactor = clampMermaidZoom(state.mermaidZoomFactor + delta);
  applyMermaidZoom();
}

export function setupMermaidZoom() {
  preview?.addEventListener("click", (e) => {
    const btn = e.target.closest(".mermaid-zoom-btn");
    if (!btn || !preview.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const host = btn.closest(".mermaid");
    if (host) openMermaidZoom(host);
  });

  mermaidZoomInBtn?.addEventListener("click", () =>
    stepMermaidZoom(MERMAID_ZOOM_STEP),
  );
  mermaidZoomOutBtn?.addEventListener("click", () =>
    stepMermaidZoom(-MERMAID_ZOOM_STEP),
  );
  mermaidZoomResetBtn?.addEventListener("click", () => fitMermaidZoom());
  mermaidZoomCloseBtn?.addEventListener("click", () => closeMermaidZoom());
  mermaidZoomDialog?.addEventListener("close", onMermaidZoomDialogClose);
  mermaidZoomDialog?.addEventListener("click", (e) => {
    // Click on the dialog frame (not toolbar/stage) closes — same as backdrop intent
    // when the dialog is sized under the viewport.
    if (e.target === mermaidZoomDialog) closeMermaidZoom();
  });
  mermaidZoomStage?.addEventListener(
    "wheel",
    (e) => {
      if (!mermaidZoomDialog?.open) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      stepMermaidZoom(e.deltaY < 0 ? MERMAID_ZOOM_STEP : -MERMAID_ZOOM_STEP);
    },
    { passive: false },
  );
  mermaidZoomDialog?.addEventListener("keydown", (e) => {
    if (!mermaidZoomDialog.open) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      stepMermaidZoom(MERMAID_ZOOM_STEP);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      stepMermaidZoom(-MERMAID_ZOOM_STEP);
    } else if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      fitMermaidZoom();
    }
  });
}

hooks.ensureMermaidZoomControls = ensureMermaidZoomControls;
hooks.clampMermaidZoom = clampMermaidZoom;
hooks.mermaidZoomViewBox = mermaidZoomViewBox;
hooks.applyMermaidZoom = applyMermaidZoom;
hooks.fitMermaidZoom = fitMermaidZoom;
hooks.openMermaidZoom = openMermaidZoom;
hooks.closeMermaidZoom = closeMermaidZoom;
hooks.onMermaidZoomDialogClose = onMermaidZoomDialogClose;
hooks.stepMermaidZoom = stepMermaidZoom;
hooks.setupMermaidZoom = setupMermaidZoom;
