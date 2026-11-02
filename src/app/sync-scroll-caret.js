import { hooks } from "./hooks.js";
import {
  state,
  editor,
  preview,
  panes,
  previewPane
} from "./state.js";

/**
 * 1-based source line of the editor caret (or selection start).
 * Cached incrementally so holding ←/→ on a huge line (e.g. collapsed data URI
 * after expand, or a long wrap-off row) does not re-scan the whole prefix.
 */
/**
 * Shift a preview scroll target so the block matching a caret still visible in
 * the editor stays in the preview viewport. A raw top-of-viewport sync would
 * otherwise follow a tall image sitting at the editor top and scroll the caret
 * block off screen.
 *
 * @param {number} target
 */
export function adjustPreviewScrollForVisibleCaret(target) {
  const line = editorCaretLine();
  if (!isEditorLineVisible(line)) return target;
  const el = previewElementForLine(line);
  if (!el || !hooks.previewNodeIsLaidOut(el)) return target;
  const pad = 8;
  const top = hooks.offsetWithin(el, previewPane);
  const height = el.offsetHeight;
  const bottom = top + height;
  const viewH = previewPane.clientHeight;
  if (viewH <= 0) return target;
  if (height > viewH - pad * 2) {
    if (bottom <= target) return bottom - pad;
    if (top >= target + viewH) return top - viewH + pad;
    return target;
  }
  let next = target;
  if (bottom > next + viewH - pad) next = bottom - viewH + pad;
  if (top < next + pad) next = top - pad;
  return next;
}

export function editorCaretLine() {
  const value = editor.value;
  const pos = editor.selectionStart;
  const cachePos = state.caretLineCachePos;
  if (cachePos === pos && cachePos >= 0) return state.caretLineCacheLine;

  let line = state.caretLineCacheLine;
  if (cachePos >= 0 && cachePos <= value.length && pos <= value.length) {
    if (pos > cachePos) {
      for (let i = cachePos; i < pos; i++) {
        if (value.charCodeAt(i) === 10) line += 1;
      }
    } else if (pos < cachePos) {
      for (let i = pos; i < cachePos; i++) {
        if (value.charCodeAt(i) === 10) line -= 1;
      }
    }
  } else {
    line = 1;
    for (let i = 0; i < pos; i++) {
      if (value.charCodeAt(i) === 10) line += 1;
    }
  }
  state.caretLineCachePos = pos;
  state.caretLineCacheLine = line;
  return line;
}

/** Call when editor text changes so the caret-line cache cannot walk stale offsets. */
export function invalidateCaretLineCache() {
  state.caretLineCachePos = -1;
  state.caretLineCacheLine = 1;
  state.lastSelectPos = -1;
}

/** True when the text between two caret offsets contains a newline. */
export function selectionDeltaCrossesLine(from, to) {
  const value = editor.value;
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(value.length, Math.max(from, to));
  for (let i = start; i < end; i++) {
    if (value.charCodeAt(i) === 10) return true;
  }
  return false;
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
  // Use scroll-space (offsetWithin), not getBoundingClientRect: preview
  // nodes live in the sandboxed iframe while `#preview-pane` is the parent
  // scroll root — cross-document client rects are not comparable.
  const pad = 8;
  const top = hooks.offsetWithin(el, pane);
  const height = el.offsetHeight;
  const bottom = top + height;
  const viewTop = pane.scrollTop + pad;
  const viewBottom = pane.scrollTop + pane.clientHeight - pad;
  if (bottom <= viewTop || top >= viewBottom) return true;
  // Fully visible.
  if (top >= viewTop && bottom <= viewBottom) return false;
  // Oversized but intersecting — leave the current scroll alone.
  if (height > pane.clientHeight - pad * 2) return false;
  // Partially clipped smaller block — nudge into view.
  return true;
}

/**
 * Scroll `pane` so `el` is visible with nearest-edge alignment.
 * @param {HTMLElement} el
 * @param {HTMLElement} pane
 */
export function revealPreviewElement(el, pane) {
  const pad = 8;
  const top = hooks.offsetWithin(el, pane);
  const height = el.offsetHeight;
  const bottom = top + height;
  const viewBottom = pane.scrollTop + pane.clientHeight - pad;
  if (bottom > viewBottom) {
    hooks.clampScrollTop(pane, top + height - pane.clientHeight + pad);
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
  const lineTops = state.editorLineTops || (state.editorLineTops = hooks.measureEditorLineTops());
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
  const lineTops = state.editorLineTops || (state.editorLineTops = hooks.measureEditorLineTops());
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

/**
 * @param {{ force?: boolean }} [opts]
 *   `force` — re-reveal even if the caret line is unchanged (height settle).
 */
export function scheduleRevealPreviewForCaret({ force = false } = {}) {
  scheduleOutlineHighlight();
  if (!state.syncScrollEnabled) return;
  // Always take the latest request: a pending RAF may have been queued before
  // preview height settled (e.g. large image still decoding). Dropping the
  // newer call left the caret target scrolled out of view.
  if (state.caretRevealRaf) cancelAnimationFrame(state.caretRevealRaf);
  state.caretRevealRaf = requestAnimationFrame(() => {
    state.caretRevealRaf = 0;
    const line = editorCaretLine();
    // Holding ←/→ (or clicking within the same line) must not re-measure the
    // preview on every selectionchange — that stalls caret painting.
    if (!force && line === state.lastCaretRevealLine) return;
    state.lastCaretRevealLine = line;
    revealPreviewForEditorCaret();
  });
}

/** Which pane last drove outline position: "editor" | "preview". */

/** 1-based source line of the last heading at or above the preview viewport top. */
export function previewLineNearViewportTop() {
  if (!previewPane || previewPane.clientHeight <= 0) return 0;
  // Same scroll-space rule as caret reveal: headings live in the iframe.
  const marker = previewPane.scrollTop + Math.min(40, previewPane.clientHeight * 0.2);
  let line = 0;
  for (const h of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!hooks.previewNodeIsLaidOut(h)) continue;
    const src = Number(h.getAttribute("data-source-line"));
    if (!Number.isFinite(src) || src < 1) continue;
    if (hooks.offsetWithin(h, previewPane) <= marker) line = src;
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
hooks.invalidateCaretLineCache = invalidateCaretLineCache;
hooks.selectionDeltaCrossesLine = selectionDeltaCrossesLine;
hooks.previewElementForLine = previewElementForLine;
hooks.previewElementNeedsReveal = previewElementNeedsReveal;
hooks.revealPreviewElement = revealPreviewElement;
hooks.revealPreviewForEditorCaret = revealPreviewForEditorCaret;
hooks.adjustPreviewScrollForVisibleCaret = adjustPreviewScrollForVisibleCaret;
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
