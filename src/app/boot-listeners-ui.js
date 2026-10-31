import { hooks } from "./hooks.js";
import {
  state,
  editor,
  shareDropdown,
  exportDropdown,
  writingToolsDropdown,
  speakDropdown,
  formatBar,
  headingDropdown,
  imageDropdown,
  formatImageInput,
  formatMoreDropdown,
  historyBtn,
  historyDropdown,
  toolbarMenu,
  toolbarActions,
  overflowBtn,
  viewModeDropdown,
  mermaidZoomDialog,
  filesContextMenu
} from "./state.js";
import { NARROW_MQ } from "./constants.js";

export function setupBootUiListeners() {
  historyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hooks.closeVoiceMenu();
    hooks.closeShareMenu();
    hooks.closeExportMenu();
    hooks.closeWritingToolsMenu();
    hooks.closeViewModeMenu();
    hooks.closeHeadingMenu();
    hooks.closeImageMenu();
    hooks.closeFormatMoreMenu();
    hooks.toggleHistory();
  });

  overflowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hooks.toggleOverflowMenu();
  });

  // Keep textarea selection when clicking format controls (avoid focus steal).
  formatBar?.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });

  if (formatBar && typeof ResizeObserver === "function") {
    const formatBarRo = new ResizeObserver(() => hooks.syncFormatBarCompact());
    formatBarRo.observe(formatBar);
  }
  hooks.syncFormatBarCompact();

  formatBar?.addEventListener("click", (e) => {
    const headingToggle = e.target.closest("#heading-menu-btn");
    if (headingToggle) {
      e.stopPropagation();
      hooks.toggleHeadingMenu();
      return;
    }
    const imageToggle = e.target.closest("#image-menu-btn");
    if (imageToggle) {
      e.stopPropagation();
      hooks.toggleImageMenu();
      return;
    }
    const moreToggle = e.target.closest("#format-more-btn");
    if (moreToggle) {
      e.stopPropagation();
      hooks.toggleFormatMoreMenu();
      return;
    }
    const item = e.target.closest("[data-format]");
    if (!item || !formatBar.contains(item)) return;
    e.stopPropagation();
    const action = item.getAttribute("data-format");
    const levelAttr = item.getAttribute("data-heading-level");
    const level = levelAttr ? Number(levelAttr) : undefined;
    hooks.closeHeadingMenu();
    hooks.closeImageMenu();
    hooks.closeFormatMoreMenu();
    hooks.runFormatAction(action, { level });
  });

  formatImageInput?.addEventListener("change", () => {
    const file = formatImageInput.files?.[0];
    formatImageInput.value = "";
    const range = state.pendingFormatImageRange;
    state.pendingFormatImageRange = null;
    if (!file) return;
    const start = range?.start ?? editor.selectionStart;
    const end = range?.end ?? editor.selectionEnd;
    void hooks.insertImageFromFile(file, { start, end, toast: "Image inserted" });
  });

  // Dismiss the overflow panel after choosing an action. Nested dropdown
  // toggles (share/export/history/voice) call stopPropagation so they stay open.
  toolbarActions?.addEventListener("click", (e) => {
    if (!toolbarMenu.classList.contains("is-open")) return;
    if (e.target.closest("select, .select-label")) return;
    hooks.closeOverflowMenu();
  });

  document.addEventListener("click", (e) => {
    if (!historyDropdown.contains(e.target)) hooks.closeHistory();
    if (speakDropdown && !speakDropdown.contains(e.target)) hooks.closeVoiceMenu();
    if (shareDropdown && !shareDropdown.contains(e.target)) hooks.closeShareMenu();
    if (exportDropdown && !exportDropdown.contains(e.target)) hooks.closeExportMenu();
    if (writingToolsDropdown && !writingToolsDropdown.contains(e.target)) {
      hooks.closeWritingToolsMenu();
    }
    if (viewModeDropdown && !viewModeDropdown.contains(e.target)) hooks.closeViewModeMenu();
    if (headingDropdown && !headingDropdown.contains(e.target)) hooks.closeHeadingMenu();
    if (imageDropdown && !imageDropdown.contains(e.target)) hooks.closeImageMenu();
    if (formatMoreDropdown && !formatMoreDropdown.contains(e.target)) hooks.closeFormatMoreMenu();
    // Native <select> option picks can click body after the OS menu closes; keep
    // the kebab open while focus remains on a control inside it.
    if (!toolbarMenu.contains(e.target) && !toolbarMenu.contains(document.activeElement)) {
      hooks.closeOverflowMenu();
    }
    if (filesContextMenu && !filesContextMenu.contains(e.target)) hooks.closeFilesContextMenu();
  });

  document.addEventListener("keydown", (e) => {
    // Native <dialog showModal()> traps focus; still block app shortcuts while open.
    if (hooks.isExternalModalOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (mermaidZoomDialog?.open) {
      // Zoom dialog owns Escape / +/- ; skip app shortcuts (incl. present nav).
      return;
    }
    if (hooks.setupChromeAi.isDialogOpen?.()) {
      // Let the dialog handle Escape; skip app-level shortcuts.
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      if (hooks.canSaveDocument() && hooks.isAuthoringView()) {
        e.preventDefault();
        void hooks.saveCurrentDocument();
      }
      return;
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "o" &&
      !hooks.isDriveFilesSource() &&
      !hooks.isGistFilesSource()
    ) {
      e.preventDefault();
      void hooks.openLocalFileChooser();
      return;
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      document.activeElement === editor &&
      hooks.isAuthoringView()
    ) {
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        hooks.runFormatAction("bold");
        return;
      }
      if (key === "i") {
        e.preventDefault();
        hooks.runFormatAction("italic");
        return;
      }
      if (key === "k") {
        e.preventDefault();
        hooks.runFormatAction("link");
        return;
      }
    }

    if (hooks.isSlideNavView()) {
      if (e.key === "Escape") {
        // Menus first — don't exit slides/present while an overlay is open.
        if (hooks.dismissOpenOverlay()) {
          e.preventDefault();
          return;
        }
        hooks.exitPresentMode();
        e.preventDefault();
        return;
      }
      // Don't steal Space/arrows from buttons, menus, selects, tree, splitter, etc.
      if (hooks.isSlideNavTypingOrControl(document.activeElement)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") {
        hooks.presentNext();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        hooks.presentPrev();
        e.preventDefault();
        return;
      }
      if (e.key === "Home") {
        hooks.showPresentSection(0);
        hooks.syncEditorToPresentSection();
        e.preventDefault();
        return;
      }
      if (e.key === "End") {
        hooks.showPresentSection(state.presentSections.length - 1);
        hooks.syncEditorToPresentSection();
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Escape") {
      if (hooks.dismissOpenOverlay()) {
        e.preventDefault();
        return;
      }
      if (state.speechActive) hooks.stopSpeaking();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (!hooks.isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  hooks.syncToolbarBarPlacement();
  window.matchMedia(NARROW_MQ).addEventListener("change", (e) => {
    hooks.syncToolbarBarPlacement();
    if (!e.matches) hooks.closeOverflowMenu();
    hooks.syncFormatBarCompact();
  });
}

hooks.setupBootUiListeners = setupBootUiListeners;
