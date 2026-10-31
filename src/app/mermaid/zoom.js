import { hooks } from "../hooks.js";
import {
  state,
  preview,
  mermaidZoomDialog,
  mermaidZoomStage,
  mermaidZoomLevel,
  mermaidZoomInBtn,
  mermaidZoomOutBtn,
  mermaidZoomResetBtn,
  mermaidZoomCloseBtn
} from "../state.js";
import {
  MERMAID_ZOOM_MIN,
  MERMAID_ZOOM_MAX,
  MERMAID_ZOOM_STEP,
  MERMAID_ZOOM_BTN_SVG
} from "../constants.js";

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

export function clampMermaidZoom(factor) {
  return Math.min(MERMAID_ZOOM_MAX, Math.max(MERMAID_ZOOM_MIN, factor));
}

/**
 * Scale via CSS transform (not SVG width). Mermaid labels live in foreignObject
 * HTML — resizing the SVG with style.width leaves font-size at 16px so text
 * looks like dots inside huge shapes (especially Excalidraw sketches).
 */
export function applyMermaidZoom() {
  const scaler = mermaidZoomStage?.querySelector(".mermaid-zoom-scaler");
  const inner = scaler?.querySelector(".mermaid-zoom-scaler-inner");
  if (!(scaler instanceof HTMLElement) || !(inner instanceof HTMLElement)) return;
  if (!(state.mermaidZoomBaseW > 0)) return;
  state.mermaidZoomFactor = clampMermaidZoom(state.mermaidZoomFactor);
  const w = state.mermaidZoomBaseW * state.mermaidZoomFactor;
  const h =
    state.mermaidZoomBaseH > 0
      ? state.mermaidZoomBaseH * state.mermaidZoomFactor
      : state.mermaidZoomBaseW * state.mermaidZoomFactor;
  scaler.style.width = `${w}px`;
  scaler.style.height = `${h}px`;
  inner.style.width = `${state.mermaidZoomBaseW}px`;
  inner.style.height = state.mermaidZoomBaseH > 0 ? `${state.mermaidZoomBaseH}px` : "auto";
  inner.style.transform = `scale(${state.mermaidZoomFactor})`;
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
    state.mermaidZoomFactor = clampMermaidZoom((stageW * 0.92) / state.mermaidZoomBaseW);
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
  state.mermaidZoomBaseH = pre.height > 0 ? pre.height : 0;
  state.mermaidZoomFactor = 1;

  const clone = /** @type {SVGElement} */ (srcSvg.cloneNode(true));
  // Keep viewBox + width; height:auto preserves aspect for foreignObject labels.
  // Scaling is done on a wrapper via transform (CSS width alone leaves HTML
  // labels at 16px — tiny "dots" inside enlarged shapes).
  clone.style.maxWidth = "none";
  clone.style.width = `${state.mermaidZoomBaseW}px`;
  clone.style.height = "auto";
  clone.setAttribute("width", String(Math.round(state.mermaidZoomBaseW)));
  clone.removeAttribute("height");

  const inner = document.createElement("div");
  inner.className = "mermaid-zoom-scaler-inner";
  inner.appendChild(clone);

  const scaler = document.createElement("div");
  scaler.className = "mermaid-zoom-scaler";
  scaler.appendChild(inner);

  mermaidZoomStage.replaceChildren(scaler);
  applyMermaidZoom();
  mermaidZoomDialog.showModal();

  // After layout, remeasure height (height:auto + viewBox) then fit to stage.
  requestAnimationFrame(() => {
    if (!mermaidZoomDialog?.open) return;
    const laidOut = inner.querySelector("svg")?.getBoundingClientRect().height;
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

  mermaidZoomInBtn?.addEventListener("click", () => stepMermaidZoom(MERMAID_ZOOM_STEP));
  mermaidZoomOutBtn?.addEventListener("click", () => stepMermaidZoom(-MERMAID_ZOOM_STEP));
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
hooks.applyMermaidZoom = applyMermaidZoom;
hooks.fitMermaidZoom = fitMermaidZoom;
hooks.openMermaidZoom = openMermaidZoom;
hooks.closeMermaidZoom = closeMermaidZoom;
hooks.onMermaidZoomDialogClose = onMermaidZoomDialogClose;
hooks.stepMermaidZoom = stepMermaidZoom;
hooks.setupMermaidZoom = setupMermaidZoom;
