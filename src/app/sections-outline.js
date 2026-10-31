import { hooks } from "./hooks.js";
import {
  state,
  editor,
  preview,
  panes,
  previewPane,
  outlineEmpty,
  outlineList
} from "./state.js";

export function updateDocOutline() {
  if (!outlineList || !outlineEmpty) return;

  const headings = [...preview.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  outlineList.replaceChildren();

  if (!headings.length) {
    outlineEmpty.hidden = false;
    outlineList.hidden = true;
    return;
  }

  outlineEmpty.hidden = true;
  outlineList.hidden = false;

  const frag = document.createDocumentFragment();
  headings.forEach((heading, index) => {
    const level = Number(heading.tagName.slice(1));
    const line = Number(heading.getAttribute("data-source-line")) || 0;
    const li = document.createElement("li");
    li.className = "outline-item";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "outline-row";
    btn.dataset.level = String(level);
    btn.dataset.index = String(index);
    if (line > 0) btn.dataset.sourceLine = String(line);
    btn.textContent = hooks.headingTitleText(heading) || `Heading ${level}`;
    btn.title = btn.textContent;
    li.appendChild(btn);
    frag.appendChild(li);
  });
  outlineList.appendChild(frag);
  highlightActiveOutlineItem();
}

export function offsetOfSourceLine(line) {
  if (line < 1) return 0;
  const text = editor.value;
  let pos = 0;
  let current = 1;
  while (current < line && pos < text.length) {
    const next = text.indexOf("\n", pos);
    if (next === -1) return text.length;
    pos = next + 1;
    current += 1;
  }
  return pos;
}

/** Scroll the preview pane to the heading/block for a 1-based source line. */
export function scrollPreviewToSourceLine(line) {
  if (!Number.isFinite(line) || line < 1) return;

  if (hooks.isSlideNavView()) {
    if (!state.presentSections.length) hooks.buildPresentSections();
    if (state.presentSections.length) {
      const idx = hooks.presentSectionIndexForLine(line);
      if (idx !== state.presentIndex) {
        hooks.showPresentSection(idx);
        hooks.invalidateScrollAnchors();
      }
    }
  }

  const headings = [...preview.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const target =
    headings.find((h) => Number(h.getAttribute("data-source-line")) === line) ||
    hooks.previewElementForLine(line);
  if (!target || target.hidden || target.closest("[hidden]")) return;
  hooks.ensurePreviewElementExpanded(target);
  if (!hooks.previewNodeIsLaidOut(target)) return;

  // Prefer "editor" as driver when the editor is open so preview scroll does not
  // reverse-sync the caret away from the outline target.
  hooks.beginSyncDriver(panes.classList.contains("editor-collapsed") ? "preview" : "editor");
  hooks.clampScrollTop(previewPane, hooks.offsetWithin(target, previewPane) - 8);
}

/**
 * Jump to a source line from the outline. Scrolls the editor when it is open,
 * and the preview (including the matching slide) when the preview is open.
 */
export function goToSourceLine(line) {
  if (!Number.isFinite(line) || line < 1) return;

  const editorVisible = !panes.classList.contains("editor-collapsed");
  const previewVisible = !panes.classList.contains("preview-collapsed");
  const pos = offsetOfSourceLine(line);
  editor.setSelectionRange(pos, pos);

  if (editorVisible) {
    editor.focus();
    state.outlineScrollSource = "editor";
    const lineTops = hooks.measureEditorLineTops();
    const top = lineTops[line - 1] ?? 0;
    hooks.beginSyncDriver("editor");
    hooks.clampScrollTop(editor, top - Math.min(48, editor.clientHeight * 0.2));
    hooks.syncEditorHighlightScroll();
  }

  if (previewVisible) {
    state.outlineScrollSource = "preview";
    scrollPreviewToSourceLine(line);
  }

  highlightActiveOutlineItem();
}

export function highlightActiveOutlineItem() {
  if (!outlineList) return;
  const line = hooks.outlineSourceLine();
  const rows = [...outlineList.querySelectorAll(".outline-row")];
  let active = null;
  for (const row of rows) {
    const rowLine = Number(row.dataset.sourceLine);
    if (!Number.isFinite(rowLine) || rowLine < 1) continue;
    if (rowLine <= line) active = row;
    else break;
  }
  rows.forEach((row) => row.classList.toggle("is-active", row === active));
}

export function setupDocOutline() {
  preview?.addEventListener("click", (e) => {
    const toggle = e.target.closest(".md-section-toggle");
    if (!toggle || !preview.contains(toggle)) return;
    e.preventDefault();
    e.stopPropagation();
    const heading = toggle.closest("h1, h2, h3, h4, h5, h6");
    if (heading) hooks.toggleSectionCollapse(heading);
  });

  outlineList?.addEventListener("click", (e) => {
    const row = e.target.closest(".outline-row");
    if (!row || !outlineList.contains(row)) return;
    const line = Number(row.dataset.sourceLine);
    if (Number.isFinite(line) && line > 0) {
      goToSourceLine(line);
      return;
    }
    const index = Number(row.dataset.index);
    const heading = preview.querySelectorAll("h1, h2, h3, h4, h5, h6")[index];
    if (!heading) return;
    const headingLine = Number(heading.getAttribute("data-source-line"));
    if (Number.isFinite(headingLine) && headingLine > 0) {
      goToSourceLine(headingLine);
      return;
    }
    const editorVisible = !panes.classList.contains("editor-collapsed");
    const previewVisible = !panes.classList.contains("preview-collapsed");
    if (previewVisible) {
      if (hooks.isSlideNavView()) {
        if (!state.presentSections.length) hooks.buildPresentSections();
        for (let i = 0; i < state.presentSections.length; i++) {
          if (state.presentSections[i].some((n) => n === heading || n.contains(heading))) {
            if (i !== state.presentIndex) {
              hooks.showPresentSection(i);
              hooks.invalidateScrollAnchors();
            }
            break;
          }
        }
      }
      hooks.beginSyncDriver(panes.classList.contains("editor-collapsed") ? "preview" : "editor");
      hooks.clampScrollTop(previewPane, hooks.offsetWithin(heading, previewPane) - 8);
    }
    if (editorVisible) editor.focus();
  });
}

hooks.updateDocOutline = updateDocOutline;
hooks.offsetOfSourceLine = offsetOfSourceLine;
hooks.scrollPreviewToSourceLine = scrollPreviewToSourceLine;
hooks.goToSourceLine = goToSourceLine;
hooks.highlightActiveOutlineItem = highlightActiveOutlineItem;
hooks.setupDocOutline = setupDocOutline;
