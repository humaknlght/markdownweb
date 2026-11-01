import { hooks } from "./hooks.js";
import {
  state,
  editor,
  preview,
  viewModeMainBtn,
  viewModeMenuBtn,
  viewModeMenu,
  presentChrome,
  presentExitBtn,
  presentProgress
} from "./state.js";
import {
  THEMES,
  VIEWS
} from "./constants.js";

export function syncHashForView(view) {
  const url = new URL(window.location.href);
  const hashParams =
    url.hash.length > 1 ? new URLSearchParams(url.hash.slice(1)) : new URLSearchParams();
  const searchParams = new URLSearchParams(url.search);
  const existing =
    hashParams.has("mdz") ||
    hashParams.has("md") ||
    hashParams.has("view") ||
    hashParams.has("theme")
      ? hashParams
      : searchParams;

  const params = new URLSearchParams();
  const mdz = existing.get("mdz");
  const md = existing.get("md");
  if (mdz) params.set("mdz", mdz);
  else if (md) params.set("md", md);
  if (state.guideSession || existing.get("guide") === "1") params.set("guide", "1");

  const theme = document.documentElement.dataset.theme;
  if (THEMES.includes(theme)) params.set("theme", theme);
  else {
    const prevTheme = existing.get("theme");
    if (THEMES.includes(prevTheme)) params.set("theme", prevTheme);
  }

  const nextView = VIEWS.includes(view) ? view : "edit";
  params.set("view", nextView);

  url.search = "";
  url.hash = params.toString();
  history.replaceState(null, "", url);
}

export function buildPresentSections() {
  const children = [...preview.children];
  if (!children.length) {
    state.presentSections = [];
    return;
  }

  const sections = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    sections.push(current);
    current = [];
  };

  for (const child of children) {
    const tag = child.tagName;
    if ((tag === "H1" || tag === "H2") && current.length) flush();
    current.push(child);
  }
  flush();
  state.presentSections = sections;
}

export function updatePresentProgress() {
  if (!presentProgress) return;
  if (!state.presentSections.length) {
    presentProgress.textContent = "0 / 0";
    return;
  }
  presentProgress.textContent = `${state.presentIndex + 1} / ${state.presentSections.length}`;
}

export function showPresentSection(index) {
  if (!state.presentSections.length) {
    buildPresentSections();
  }
  if (!state.presentSections.length) {
    state.presentIndex = 0;
    updatePresentProgress();
    return;
  }

  state.presentIndex = Math.max(0, Math.min(index, state.presentSections.length - 1));
  const active = state.presentSections[state.presentIndex];
  for (const child of preview.children) {
    child.hidden = !active.includes(child);
  }
  updatePresentProgress();
  preview.scrollTop = 0;
  const pane = document.getElementById("preview-pane");
  if (pane) pane.scrollTop = 0;
  state.outlineScrollSource = "preview";
  hooks.scheduleOutlineHighlight();
  void hooks.renderMermaidDiagrams();
}

/** First 1-based source line covered by a present/slides section. */
export function sourceLineForPresentSection(index) {
  const section = state.presentSections[index];
  if (!section?.length) return null;
  let best = Infinity;
  for (const child of section) {
    const start = Number(child.getAttribute("data-source-line"));
    if (Number.isFinite(start) && start >= 1 && start < best) best = start;
  }
  return Number.isFinite(best) && best !== Infinity ? best : null;
}

/**
 * When sync-scroll is on in slides mode, move the editor caret/scroll to the
 * active slide after an explicit prev/next (or Home/End) navigation.
 */
export function syncEditorToPresentSection() {
  if (state.currentView !== "slides" || !state.syncScrollEnabled) return;
  const line = sourceLineForPresentSection(state.presentIndex);
  if (line == null) return;

  const pos = hooks.offsetOfSourceLine(line);
  hooks.beginSyncDriver("preview");
  editor.setSelectionRange(pos, pos);

  const lineTops = hooks.measureEditorLineTops();
  const top = lineTops[line - 1] ?? 0;
  hooks.clampScrollTop(editor, top - Math.min(48, editor.clientHeight * 0.2));
  hooks.syncEditorHighlightScroll();
  hooks.scheduleOutlineHighlight();
}

export function clearPresentSectionFilter() {
  for (const child of preview.children) {
    child.hidden = false;
  }
}

export function isSlideNavView() {
  return state.currentView === "present" || state.currentView === "slides";
}

/**
 * True when slide nav keys (Space/arrows/etc.) should leave the focused control alone.
 * Escape still exits present/slides regardless.
 */
export function isSlideNavTypingOrControl(el) {
  if (!el || el === document.body) return false;
  if (el === editor) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(
    el.closest(
      "button, a[href], select, input, textarea, summary, " +
        "[role='button'], [role='menuitem'], [role='option'], " +
        "[role='treeitem'], [role='slider'], [role='combobox'], " +
        "[role='listbox'], [role='textbox'], .splitter",
    ),
  );
}

export function isAuthoringView() {
  return state.currentView === "edit" || state.currentView === "slides";
}

export function updateViewModeMainBtn() {
  if (!viewModeMainBtn) return;
  const viewModeLabel = viewModeMainBtn.querySelector(".btn-text");
  if (state.currentView === "slides") {
    if (viewModeLabel) viewModeLabel.textContent = "Edit";
    else viewModeMainBtn.textContent = "Edit";
    viewModeMainBtn.title = "Back to full preview";
  } else {
    if (viewModeLabel) viewModeLabel.textContent = "Slides";
    else viewModeMainBtn.textContent = "Slides";
    viewModeMainBtn.title = "Slides preview";
  }
  updateViewModeMenuSelection();
}

export function updateViewModeMenuSelection() {
  if (!viewModeMenu) return;
  for (const btn of viewModeMenu.querySelectorAll("[data-view]")) {
    btn.classList.toggle(
      "is-selected",
      btn.getAttribute("data-view") === state.currentView,
    );
  }
}

export function onViewModeMenuClick(e) {
  // Scope to menuitems only — body also has [data-view], which closest() would hit.
  const item = e.target.closest("#view-mode-menu [role='menuitem']");
  if (!item) return;
  const view =
    item.getAttribute("data-view") ||
    (item.id === "present-menu-btn" ? "present" : null);
  if (!view) return;
  closeViewModeMenu();
  if (view === "present") hooks.enterPresentMode();
  else if (view === "slides") hooks.enterSlidesMode();
  else if (view === "edit") setView("edit");
}

export function openViewModeMenu() {
  if (!viewModeMenu || !viewModeMenuBtn) return;
  viewModeMenu.hidden = false;
  viewModeMenuBtn.setAttribute("aria-expanded", "true");
}

export function closeViewModeMenu() {
  if (!viewModeMenu || !viewModeMenuBtn) return;
  viewModeMenu.hidden = true;
  viewModeMenuBtn.setAttribute("aria-expanded", "false");
}

export function toggleViewModeMenu() {
  if (!viewModeMenu) return;
  if (viewModeMenu.hidden) {
    hooks.closeHistory();
    hooks.closeVoiceMenu();
    hooks.closeShareMenu();
    hooks.closeExportMenu();
    hooks.closeWritingToolsMenu();
    hooks.closeHeadingMenu();
    hooks.closeImageMenu();
    hooks.closeFormatMoreMenu();
    openViewModeMenu();
  } else {
    closeViewModeMenu();
  }
}

export function onViewModeMainClick() {
  if (state.currentView === "slides") setView("edit");
  else hooks.enterSlidesMode();
}

export function setView(view, { syncUrl = true } = {}) {
  const next = VIEWS.includes(view) ? view : "edit";
  const wasSlideNav = state.currentView === "present" || state.currentView === "slides";
  const nextIsSlideNav = next === "present" || next === "slides";
  const leavingPresent = state.currentView === "present" && next !== "present";
  if (wasSlideNav && !nextIsSlideNav) {
    clearPresentSectionFilter();
    hooks.applySectionCollapse();
  }

  state.currentView = next;
  if (leavingPresent) {
    void hooks.leavePresentFullscreen();
  }
  document.body.dataset.view = next;
  hooks.syncExternalModal();
  updateViewModeMainBtn();

  if (presentChrome) {
    presentChrome.hidden = !nextIsSlideNav;
  }
  if (presentExitBtn) {
    presentExitBtn.title = next === "slides" ? "Exit slides mode" : "Exit present mode";
  }
  hooks.syncPresentChromeAutohide();

  if (nextIsSlideNav) {
    hooks.clearSectionFolds();
    buildPresentSections();
    // Keep the current slide when switching slides ↔ present; reset only when
    // entering slide-nav from edit/reader.
    showPresentSection(wasSlideNav ? state.presentIndex : 0);
    if (next === "slides" && state.syncScrollEnabled) {
      hooks.revealPreviewForEditorCaret();
    }
  }

  if (syncUrl) {
    syncHashForView(next);
  }

  hooks.applyCollapseState();

  hooks.closeShareMenu();
  hooks.closeExportMenu();
  hooks.closeWritingToolsMenu();
  hooks.closeHistory();
  hooks.closeVoiceMenu();
  closeViewModeMenu();
  hooks.closeOverflowMenu();
}

hooks.syncHashForView = syncHashForView;
hooks.buildPresentSections = buildPresentSections;
hooks.updatePresentProgress = updatePresentProgress;
hooks.showPresentSection = showPresentSection;
hooks.sourceLineForPresentSection = sourceLineForPresentSection;
hooks.syncEditorToPresentSection = syncEditorToPresentSection;
hooks.clearPresentSectionFilter = clearPresentSectionFilter;
hooks.isSlideNavView = isSlideNavView;
hooks.isSlideNavTypingOrControl = isSlideNavTypingOrControl;
hooks.isAuthoringView = isAuthoringView;
hooks.updateViewModeMainBtn = updateViewModeMainBtn;
hooks.updateViewModeMenuSelection = updateViewModeMenuSelection;
hooks.onViewModeMenuClick = onViewModeMenuClick;
hooks.openViewModeMenu = openViewModeMenu;
hooks.closeViewModeMenu = closeViewModeMenu;
hooks.toggleViewModeMenu = toggleViewModeMenu;
hooks.onViewModeMainClick = onViewModeMainClick;
hooks.setView = setView;
