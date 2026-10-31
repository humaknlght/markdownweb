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


export function scrollRatio(el) {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return 0;
  return el.scrollTop / max;
}

export function applyScrollRatio(el, ratio) {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) {
    el.scrollTop = 0;
    return;
  }
  el.scrollTop = ratio * max;
}

export function invalidateScrollAnchors() {
  state.scrollAnchors = null;
}

/** True when `el` participates in preview layout (not slide-hidden or section-folded). */
export function previewNodeIsLaidOut(el) {
  return Boolean(el) && !el.hidden && !el.closest("[hidden], .md-section-folded");
}

export function offsetWithin(el, container) {
  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return elRect.top - containerRect.top + container.scrollTop;
}

export function ensureLineMirror() {
  if (state.lineMirror) return state.lineMirror;
  state.lineMirror = document.createElement("div");
  state.lineMirror.setAttribute("aria-hidden", "true");
  state.lineMirror.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;height:auto;" +
    "overflow:hidden;white-space:pre-wrap;overflow-wrap:break-word;word-wrap:break-word;" +
    "top:0;left:-99999px;z-index:-1;";
  document.body.appendChild(state.lineMirror);
  return state.lineMirror;
}

/** Pixel offset of each source line start inside the editor (handles wrapping). */
export function measureEditorLineTops() {
  const mirror = ensureLineMirror();
  const cs = getComputedStyle(editor);
  const copyProps = [
    "boxSizing",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontVariant",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "textIndent",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "tabSize",
  ];
  for (const prop of copyProps) {
    mirror.style[prop] = cs[prop];
  }
  // Match editor wrap so sync-scroll anchors stay aligned when wrapping is off.
  mirror.style.whiteSpace = cs.whiteSpace;
  mirror.style.overflowWrap = cs.overflowWrap;
  mirror.style.wordWrap = cs.wordWrap;
  mirror.style.width = `${editor.clientWidth}px`;

  const lines = editor.value.split("\n");
  mirror.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line || " ";
    frag.appendChild(row);
  }
  mirror.appendChild(frag);
  return Array.from(mirror.children, (row) => row.offsetTop);
}

export function buildScrollAnchors() {
  const lineTops = measureEditorLineTops();
  const anchors = [{ editor: 0, preview: 0 }];

  for (const el of preview.querySelectorAll("[data-source-line]")) {
    if (!previewNodeIsLaidOut(el)) continue;
    const line = Number(el.getAttribute("data-source-line"));
    if (!Number.isFinite(line) || line < 1 || line > lineTops.length) continue;
    const previewTop = offsetWithin(el, previewPane);
    anchors.push({
      editor: lineTops[line - 1],
      preview: previewTop,
    });

    const endLine = Number(el.getAttribute("data-source-line-end"));
    if (Number.isFinite(endLine) && endLine > line && endLine <= lineTops.length) {
      anchors.push({
        editor: lineTops[endLine - 1],
        preview: previewTop + el.offsetHeight,
      });
    }
  }

  // Use max scrollTop (not scrollHeight) so both panes reach their bottoms
  // together — client heights differ, so scrollHeight end-points desync.
  anchors.push({
    editor: Math.max(0, editor.scrollHeight - editor.clientHeight),
    preview: Math.max(0, previewPane.scrollHeight - previewPane.clientHeight),
  });

  anchors.sort((a, b) => a.editor - b.editor || a.preview - b.preview);

  const deduped = [];
  for (const anchor of anchors) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.editor - anchor.editor) < 0.5) continue;
    if (prev && anchor.preview < prev.preview) {
      deduped.push({ editor: anchor.editor, preview: prev.preview });
    } else {
      deduped.push(anchor);
    }
  }
  return deduped;
}

export function getScrollAnchors() {
  if (!state.scrollAnchors) state.scrollAnchors = buildScrollAnchors();
  return state.scrollAnchors;
}

export function interpolateAnchor(position, anchors, fromKey, toKey) {
  if (!anchors.length) return 0;
  if (position <= anchors[0][fromKey]) return anchors[0][toKey];
  const last = anchors[anchors.length - 1];
  if (position >= last[fromKey]) return last[toKey];

  let lo = 0;
  let hi = anchors.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid][fromKey] <= position) lo = mid;
    else hi = mid;
  }

  const a = anchors[lo];
  const b = anchors[hi];
  const span = b[fromKey] - a[fromKey];
  if (span <= 0) return a[toKey];
  return a[toKey] + ((position - a[fromKey]) / span) * (b[toKey] - a[toKey]);
}

export function clampScrollTop(el, top) {
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  el.scrollTop = Math.min(Math.max(0, top), max);
}

export function beginSyncDriver(driver) {
  state.syncScrollDriver = driver;
  window.clearTimeout(state.syncScrollUnlockTimer);
  state.syncScrollUnlockTimer = window.setTimeout(() => {
    state.syncScrollDriver = null;
  }, 80);
}

export function setSyncScroll(enabled, { persist = true } = {}) {
  state.syncScrollEnabled = Boolean(enabled);
  syncScrollBtn.setAttribute("aria-pressed", String(state.syncScrollEnabled));
  const syncLabel = state.syncScrollEnabled ? "Unsync scroll" : "Sync scroll";
  syncScrollBtn.title = syncLabel;
  syncScrollBtn.setAttribute("aria-label", syncLabel);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.syncScroll, state.syncScrollEnabled ? "1" : "0");
    } catch {
      /* storage may be unavailable */
    }
  }
  if (state.syncScrollEnabled) {
    invalidateScrollAnchors();
    syncPreviewFromEditor();
    hooks.revealPreviewForEditorCaret();
  }
}

export function setLineWrap(enabled, { persist = true } = {}) {
  state.lineWrapEnabled = Boolean(enabled);
  document.documentElement.dataset.lineWrap = state.lineWrapEnabled ? "on" : "off";
  if (lineWrapBtn) {
    lineWrapBtn.setAttribute("aria-pressed", String(state.lineWrapEnabled));
    const wrapLabel = state.lineWrapEnabled ? "Unwrap lines" : "Wrap lines";
    lineWrapBtn.title = wrapLabel;
    lineWrapBtn.setAttribute("aria-label", wrapLabel);
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.lineWrap, state.lineWrapEnabled ? "1" : "0");
    } catch {
      /* storage may be unavailable */
    }
  }
  invalidateScrollAnchors();
  if (state.syncScrollEnabled) {
    syncPreviewFromEditor();
    hooks.revealPreviewForEditorCaret();
  }
}

export function isProofreadPreviewActive() {
  return (
    document.body.dataset.aiProofPreview === "1" &&
    Boolean(aiProofEditor) &&
    Boolean(aiProofEditorWrap) &&
    !aiProofEditorWrap.hidden
  );
}

export function syncProofEditorHighlightScroll() {
  if (!aiProofEditor || !aiProofHighlight || !aiProofHighlightCode) return;
  aiProofHighlightCode.style.transform = `translate(${-aiProofEditor.scrollLeft}px, ${-aiProofEditor.scrollTop}px)`;
}

export function syncPreviewFromEditor() {
  if (!state.syncScrollEnabled || state.syncScrollDriver === "preview") return;
  if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
    return;
  }
  // Proofread replaces the rendered preview with a second editor — ratio-sync
  // that pane so Sync scroll still couples left and right.
  if (isProofreadPreviewActive()) {
    beginSyncDriver("editor");
    applyScrollRatio(aiProofEditor, scrollRatio(editor));
    syncProofEditorHighlightScroll();
    return;
  }
  if (state.currentView === "slides") {
    beginSyncDriver("editor");
    hooks.syncSlidesFromEditor({ preferCaret: false });
    return;
  }
  beginSyncDriver("editor");
  const anchors = getScrollAnchors();
  if (anchors.length >= 2) {
    clampScrollTop(
      previewPane,
      interpolateAnchor(editor.scrollTop, anchors, "editor", "preview"),
    );
  } else {
    applyScrollRatio(previewPane, scrollRatio(editor));
  }
}

export function syncEditorFromPreview() {
  if (!state.syncScrollEnabled || state.syncScrollDriver === "editor") return;
  if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
    return;
  }
  // Preview height is mid-flight while Mermaid paints; mapping back into the
  // editor causes the up/down jitter seen when typing at the end of diagram-heavy docs.
  if (hooks.mermaidPreviewUnsettled()) return;
  if (isProofreadPreviewActive()) {
    beginSyncDriver("preview");
    applyScrollRatio(editor, scrollRatio(aiProofEditor));
    hooks.syncEditorHighlightScroll();
    return;
  }
  // In slides mode the active slide follows the editor caret/viewport. Reverse
  // sync would scroll the editor and then re-resolve the slide from the
  // viewport top — often jumping back to an earlier slide still on screen.
  if (state.currentView === "slides") return;
  beginSyncDriver("preview");
  const anchors = getScrollAnchors();
  if (anchors.length >= 2) {
    clampScrollTop(
      editor,
      interpolateAnchor(previewPane.scrollTop, anchors, "preview", "editor"),
    );
  } else {
    applyScrollRatio(editor, scrollRatio(previewPane));
  }
}

/** 1-based source line of the editor caret (or selection start). */

hooks.scrollRatio = scrollRatio;
hooks.applyScrollRatio = applyScrollRatio;
hooks.invalidateScrollAnchors = invalidateScrollAnchors;
hooks.previewNodeIsLaidOut = previewNodeIsLaidOut;
hooks.offsetWithin = offsetWithin;
hooks.ensureLineMirror = ensureLineMirror;
hooks.measureEditorLineTops = measureEditorLineTops;
hooks.buildScrollAnchors = buildScrollAnchors;
hooks.getScrollAnchors = getScrollAnchors;
hooks.interpolateAnchor = interpolateAnchor;
hooks.clampScrollTop = clampScrollTop;
hooks.beginSyncDriver = beginSyncDriver;
hooks.setSyncScroll = setSyncScroll;
hooks.setLineWrap = setLineWrap;
hooks.isProofreadPreviewActive = isProofreadPreviewActive;
hooks.syncProofEditorHighlightScroll = syncProofEditorHighlightScroll;
hooks.syncPreviewFromEditor = syncPreviewFromEditor;
hooks.syncEditorFromPreview = syncEditorFromPreview;
