import { hooks } from "./hooks.js";
import {
  state,
  panes,
  splitter,
  collapseEditorBtn,
  collapsePreviewBtn
} from "./state.js";
import {
  STORAGE_KEYS,
  NARROW_MQ
} from "./constants.js";
import {
  SPLIT_MAX,
  SPLIT_MIN,
  clampSplit
} from "./vendor-deps.js";

export function applyCollapseState() {
  const editorCollapsed = localStorage.getItem(STORAGE_KEYS.editorCollapsed) === "1";
  // Collapse is an authoring-layout preference. Reader / present hide the expand
  // control and must always show the preview.
  const previewCollapsedPref = localStorage.getItem(STORAGE_KEYS.previewCollapsed) === "1";
  const previewCollapsed = previewCollapsedPref && hooks.isAuthoringView();

  panes.classList.toggle("editor-collapsed", editorCollapsed);
  panes.classList.toggle("preview-collapsed", previewCollapsed);

  collapseEditorBtn.setAttribute("aria-pressed", String(editorCollapsed));
  collapsePreviewBtn.setAttribute("aria-pressed", String(previewCollapsed));
  collapseEditorBtn.title = editorCollapsed ? "Expand editor" : "Collapse editor";
  collapsePreviewBtn.title = previewCollapsed ? "Expand preview" : "Collapse preview";
  collapseEditorBtn.setAttribute("aria-label", collapseEditorBtn.title);
  collapsePreviewBtn.setAttribute("aria-label", collapsePreviewBtn.title);
  splitter.setAttribute("aria-hidden", String(editorCollapsed || previewCollapsed));
  splitter.tabIndex = editorCollapsed || previewCollapsed ? -1 : 0;
  hooks.invalidateScrollAnchors();
}

export function isStackedLayout() {
  return window.matchMedia(NARROW_MQ).matches;
}

export function applySplit(percent, { persist = true } = {}) {
  state.splitPercent = clampSplit(Number(percent) || 50);
  panes.style.setProperty("--split", `${state.splitPercent}%`);
  splitter.setAttribute("aria-valuenow", String(Math.round(state.splitPercent)));
  hooks.invalidateScrollAnchors();
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.split, String(state.splitPercent));
    } catch {
      /* storage may be unavailable */
    }
  }
}

export function loadSplit() {
  const raw = localStorage.getItem(STORAGE_KEYS.split);
  const value = raw == null ? 50 : Number(raw);
  applySplit(Number.isFinite(value) ? value : 50, { persist: false });
}

export function setupSplitter() {
  splitter.setAttribute("aria-valuemin", String(SPLIT_MIN));
  splitter.setAttribute("aria-valuemax", String(SPLIT_MAX));
  loadSplit();

  let dragging = false;
  let activePointerId = null;

  const updateFromPointer = (clientX, clientY) => {
    const rect = panes.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ratio = isStackedLayout()
      ? ((clientY - rect.top) / rect.height) * 100
      : ((clientX - rect.left) / rect.width) * 100;
    applySplit(ratio);
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    activePointerId = null;
    panes.classList.remove("is-resizing");
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
  };

  const onWindowPointerMove = (e) => {
    if (!dragging || e.pointerId !== activePointerId) return;
    updateFromPointer(e.clientX, e.clientY);
  };

  const onWindowPointerUp = (e) => {
    if (e.pointerId !== activePointerId) return;
    stopDragging();
  };

  splitter.addEventListener("pointerdown", (e) => {
    if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
      return;
    }
    dragging = true;
    activePointerId = e.pointerId;
    panes.classList.add("is-resizing");
    try {
      splitter.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    updateFromPointer(e.clientX, e.clientY);
    e.preventDefault();
  });

  splitter.addEventListener("keydown", (e) => {
    if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
      return;
    }
    const step = e.shiftKey ? 5 : 2;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      applySplit(state.splitPercent - step);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      applySplit(state.splitPercent + step);
      e.preventDefault();
    } else if (e.key === "Home") {
      applySplit(SPLIT_MIN);
      e.preventDefault();
    } else if (e.key === "End") {
      applySplit(SPLIT_MAX);
      e.preventDefault();
    }
  });

  const syncOrientation = () => {
    splitter.setAttribute(
      "aria-orientation",
      isStackedLayout() ? "horizontal" : "vertical"
    );
  };
  syncOrientation();
  window.matchMedia(NARROW_MQ).addEventListener("change", syncOrientation);
}

export function toggleEditorCollapse() {
  const next = !panes.classList.contains("editor-collapsed");
  localStorage.setItem(STORAGE_KEYS.editorCollapsed, next ? "1" : "0");
  applyCollapseState();
}

export function togglePreviewCollapse() {
  // Reader / present always show the preview; edit and slides can collapse it.
  if (!hooks.isAuthoringView()) return;
  const next = localStorage.getItem(STORAGE_KEYS.previewCollapsed) !== "1";
  localStorage.setItem(STORAGE_KEYS.previewCollapsed, next ? "1" : "0");
  applyCollapseState();
}

hooks.applyCollapseState = applyCollapseState;
hooks.isStackedLayout = isStackedLayout;
hooks.applySplit = applySplit;
hooks.loadSplit = loadSplit;
hooks.setupSplitter = setupSplitter;
hooks.toggleEditorCollapse = toggleEditorCollapse;
hooks.togglePreviewCollapse = togglePreviewCollapse;
