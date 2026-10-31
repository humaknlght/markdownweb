import { hooks } from "./hooks.js";
import {
  state,
  editor,
  preview,
  panes,
  aiProofEditorWrap,
  aiProofEditor,
  aiProofHighlight,
  aiProofHighlightCode,
  syncScrollBtn,
  lineWrapBtn,
  previewPane
} from "./state.js";
import {
  STORAGE_KEYS
} from "./constants.js";

export function editorCaretLine() {
  const text = editor.value.slice(0, editor.selectionStart);
  return (text.match(/\n/g) || []).length + 1;
}

/** Preview block that covers the given 1-based source line. */
export function previewElementForLine(line) {
  let match = null;
  let previous = null;
  for (const el of preview.querySelectorAll("[data-source-line]")) {
    const start = Number(el.getAttribute("data-source-line"));
    if (!Number.isFinite(start) || start < 1) continue;
    const endRaw = Number(el.getAttribute("data-source-line-end"));
    const end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : start;
    if (line < start) return match || previous || el;
    previous = el;
    if (line <= end) match = el;
  }
  return match || previous;
}

/**
 * Whether `el` needs scrolling into `pane` (nearest semantics). Tall Mermaid
 * blocks taller than the pane are treated as in-view when they intersect it —
 * requiring the whole block to fit caused endless top/bottom thrash.
 * @param {Element} el
 * @param {HTMLElement} pane
 */
export function previewElementNeedsReveal(el, pane) {
  const paneRect = pane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const pad = 8;
  const viewTop = paneRect.top + pad;
  const viewBottom = paneRect.bottom - pad;
  if (elRect.bottom <= viewTop || elRect.top >= viewBottom) return true;
  // Fully visible.
  if (elRect.top >= viewTop && elRect.bottom <= viewBottom) return false;
  // Oversized but intersecting — leave the current scroll alone.
  if (elRect.height > pane.clientHeight - pad * 2) return false;
  // Partially clipped smaller block — nudge into view.
  return true;
}

/**
 * Scroll `pane` so `el` is visible with nearest-edge alignment.
 * @param {HTMLElement} el
 * @param {HTMLElement} pane
 */
export function revealPreviewElement(el, pane) {
  const paneRect = pane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const pad = 8;
  const top = hooks.offsetWithin(el, pane);
  if (elRect.bottom > paneRect.bottom - pad) {
    hooks.clampScrollTop(pane, top + el.offsetHeight - pane.clientHeight + pad);
  } else {
    hooks.clampScrollTop(pane, top - pad);
  }
}

/**
 * Keep the rendered block for the editor caret in view. Uses nearest so we
 * only scroll when the matching preview content is actually off-screen.
 * In slides mode, also switches to the slide that contains the caret line.
 */
export function revealPreviewForEditorCaret() {
  if (!state.syncScrollEnabled) return;
  if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
    return;
  }
  // Proofread right pane is plain text — caret reveal uses rendered blocks.
  if (hooks.isProofreadPreviewActive()) {
    hooks.syncPreviewFromEditor();
    return;
  }
  if (state.currentView === "slides") {
    hooks.beginSyncDriver("editor");
    syncSlidesFromEditor({ preferCaret: true });
    return;
  }
  const el = previewElementForLine(editorCaretLine());
  if (!el) return;
  // Expand collapsed ancestors so caret sync measures real geometry.
  hooks.ensurePreviewElementExpanded(el);
  if (!hooks.previewNodeIsLaidOut(el)) return;
  if (!previewElementNeedsReveal(el, previewPane)) return;

  hooks.beginSyncDriver("editor");
  revealPreviewElement(el, previewPane);
}

/** 1-based source line nearest the top of the editor viewport. */
export function editorLineNearViewportTop() {
  const lineTops = hooks.measureEditorLineTops();
  if (!lineTops.length) return 1;
  const y = editor.scrollTop + 4;
  let lo = 0;
  let hi = lineTops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineTops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Whether a 1-based editor line intersects the visible editor viewport. */
export function isEditorLineVisible(line) {
  const lineTops = hooks.measureEditorLineTops();
  if (!lineTops.length || line < 1 || line > lineTops.length) return false;
  const top = lineTops[line - 1];
  const bottom = line < lineTops.length ? lineTops[line] : top + 20;
  const viewTop = editor.scrollTop;
  const viewBottom = viewTop + editor.clientHeight;
  return bottom > viewTop && top < viewBottom;
}

/** Index of the present/slides section that best covers a 1-based source line. */
export function presentSectionIndexForLine(line) {
  if (!state.presentSections.length) hooks.buildPresentSections();
  if (!state.presentSections.length) return 0;

  let best = 0;
  let bestStart = -Infinity;
  for (let i = 0; i < state.presentSections.length; i++) {
    for (const child of state.presentSections[i]) {
      const start = Number(child.getAttribute("data-source-line"));
      if (!Number.isFinite(start) || start < 1) continue;
      const endRaw = Number(child.getAttribute("data-source-line-end"));
      const end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : start;
      if (line >= start && line <= end) return i;
      if (start <= line && start >= bestStart) {
        best = i;
        bestStart = start;
      }
    }
  }
  return best;
}

/**
 * Switch to the slide for the editor caret (or viewport top) and scroll the
 * matching preview block into view.
 * @param {{ preferCaret?: boolean }} [opts]
 */
export function syncSlidesFromEditor({ preferCaret = true } = {}) {
  if (state.currentView !== "slides") return;
  if (!state.presentSections.length) hooks.buildPresentSections();
  if (!state.presentSections.length) return;

  const caretLine = editorCaretLine();
  // While the caret remains on screen, keep its slide even if an earlier
  // slide's heading is still at the top of the editor viewport.
  const line =
    preferCaret || isEditorLineVisible(caretLine)
      ? caretLine
      : editorLineNearViewportTop();
  const idx = presentSectionIndexForLine(line);
  if (idx !== state.presentIndex) {
    hooks.showPresentSection(idx);
    hooks.invalidateScrollAnchors();
  }

  const el = previewElementForLine(line);
  if (!hooks.previewNodeIsLaidOut(el)) return;
  if (!previewElementNeedsReveal(el, previewPane)) return;

  revealPreviewElement(el, previewPane);
}

export function scheduleRevealPreviewForCaret() {
  scheduleOutlineHighlight();
  if (!state.syncScrollEnabled || state.caretRevealRaf) return;
  state.caretRevealRaf = requestAnimationFrame(() => {
    state.caretRevealRaf = 0;
    revealPreviewForEditorCaret();
  });
}

/** Which pane last drove outline position: "editor" | "preview". */

/** 1-based source line of the last heading at or above the preview viewport top. */
export function previewLineNearViewportTop() {
  const paneRect = previewPane.getBoundingClientRect();
  if (paneRect.height <= 0) return 0;
  const marker = paneRect.top + Math.min(40, paneRect.height * 0.2);
  let line = 0;
  for (const h of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!hooks.previewNodeIsLaidOut(h)) continue;
    const src = Number(h.getAttribute("data-source-line"));
    if (!Number.isFinite(src) || src < 1) continue;
    if (h.getBoundingClientRect().top <= marker) line = src;
    else break;
  }
  return line;
}

/** Source line used to pick the active outline row from scroll/caret position. */
export function outlineSourceLine() {
  const previewVisible = !panes.classList.contains("preview-collapsed");
  const editorVisible = !panes.classList.contains("editor-collapsed");

  // Editor caret/click wins while the editor is driving outline position.
  if (editorVisible && state.outlineScrollSource === "editor") {
    const caret = editorCaretLine();
    if (document.activeElement === editor || isEditorLineVisible(caret)) return caret;
    return editorLineNearViewportTop();
  }

  if (previewVisible) {
    const line = previewLineNearViewportTop();
    if (line > 0) return line;
  }

  if (editorVisible) return editorLineNearViewportTop();
  return editorCaretLine();
}

export function scheduleOutlineHighlight() {
  if (state.outlineHighlightRaf) return;
  state.outlineHighlightRaf = requestAnimationFrame(() => {
    state.outlineHighlightRaf = 0;
    hooks.highlightActiveOutlineItem();
  });
}

export function toggleSyncScroll() {
  hooks.setSyncScroll(!state.syncScrollEnabled);
}

export function toggleLineWrap() {
  hooks.setLineWrap(!state.lineWrapEnabled);
}

hooks.editorCaretLine = editorCaretLine;
hooks.previewElementForLine = previewElementForLine;
hooks.previewElementNeedsReveal = previewElementNeedsReveal;
hooks.revealPreviewElement = revealPreviewElement;
hooks.revealPreviewForEditorCaret = revealPreviewForEditorCaret;
hooks.editorLineNearViewportTop = editorLineNearViewportTop;
hooks.isEditorLineVisible = isEditorLineVisible;
hooks.presentSectionIndexForLine = presentSectionIndexForLine;
hooks.syncSlidesFromEditor = syncSlidesFromEditor;
hooks.scheduleRevealPreviewForCaret = scheduleRevealPreviewForCaret;
hooks.previewLineNearViewportTop = previewLineNearViewportTop;
hooks.outlineSourceLine = outlineSourceLine;
hooks.scheduleOutlineHighlight = scheduleOutlineHighlight;
hooks.toggleSyncScroll = toggleSyncScroll;
hooks.toggleLineWrap = toggleLineWrap;
