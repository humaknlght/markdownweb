import { hooks } from "./hooks.js";
import {
  state,
  editor,
  editorHighlight,
  panes,
  themeSelect,
  widthSelect,
  mermaidLookSelect,
  fileInput,
  filesOpenFileBtn,
  shareDropdown,
  shareBtn,
  exportDropdown,
  exportBtn,
  exportMenu,
  writingToolsDropdown,
  aiProofEditor,
  speakDropdown,
  collapseEditorBtn,
  collapsePreviewBtn,
  syncScrollBtn,
  lineWrapBtn,
  formatBar,
  headingDropdown,
  imageDropdown,
  formatImageInput,
  formatMoreDropdown,
  previewPane,
  historyBtn,
  historyDropdown,
  toolbarMenu,
  toolbarActions,
  overflowBtn,
  editViewBtn,
  viewModeDropdown,
  viewModeMainBtn,
  viewModeMenuBtn,
  viewModeMenu,
  presentViewBtn,
  printBtn,
  helpBtn,
  presentPrevBtn,
  presentNextBtn,
  presentExitBtn,
  externalModal,
  mermaidZoomDialog,
  filesContextMenu
} from "./state.js";
import {
  STORAGE_KEYS,
  NARROW_MQ,
  THEMES,
  WIDTHS,
  MERMAID_LOOKS
} from "./constants.js";
import {
  loadGoogleDriveConfig,
  googleDriveEnabled,
  tryRestoreDriveAccessToken,
  loadGithubGistConfig,
  githubGistEnabled,
  tryRestoreGistAccessToken,
  getTip,
  probeHistoryIdb,
  setDraft
} from "./vendor-deps.js";

export function setupBootCoreListeners() {

  // Non-critical UI — after first paint (next frame), so speak/history work ASAP.
  requestAnimationFrame(() => {
    hooks.setupSpeech();
    void hooks.setupChromeAi();
    hooks.renderHistoryMenu();
  });
  editor.addEventListener("input", hooks.onEditorInput);
  editor.addEventListener("beforeinput", hooks.onEditorBeforeInput);
  editor.addEventListener("paste", hooks.onEditorPaste);
  editor.addEventListener("copy", hooks.onEditorCopyOrCut);
  editor.addEventListener("cut", hooks.onEditorCopyOrCut);

  themeSelect.addEventListener("change", () => {
    hooks.setTheme(themeSelect.value, { persist: hooks.isAuthoringView() });
    // Mermaid colors follow --mermaid-* CSS variables, so no re-render is needed.
    if (!hooks.isAuthoringView()) {
      hooks.syncHashForView(state.currentView);
    }
  });

  hooks.setupZenBrandUnlock();

  widthSelect.addEventListener("change", () => {
    hooks.setPreviewWidth(widthSelect.value, { persist: true });
    // Narrow: dismiss after pick so the preview is visible. Desktop: keep open for multi-tweaks.
    if (window.matchMedia(NARROW_MQ).matches && toolbarMenu.classList.contains("is-open")) {
      hooks.closeOverflowMenu();
    }
  });

  mermaidLookSelect?.addEventListener("change", () => {
    hooks.setMermaidLook(mermaidLookSelect.value, { persist: true });
    if (window.matchMedia(NARROW_MQ).matches && toolbarMenu.classList.contains("is-open")) {
      hooks.closeOverflowMenu();
    }
  });

  filesOpenFileBtn?.addEventListener("click", () => {
    void hooks.openLocalFileChooser();
  });
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    hooks.handleFile(file);
    fileInput.value = "";
  });

  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void hooks.copyShareUrl();
  });

  exportBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    hooks.toggleExportMenu();
  });
  exportMenu?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-export]");
    if (!item) return;
    void hooks.exportDocument(item.getAttribute("data-export"));
  });

  editViewBtn?.addEventListener("click", () => hooks.setView("edit"));
  viewModeMainBtn?.addEventListener("click", hooks.onViewModeMainClick);
  viewModeMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    hooks.closeHistory();
    hooks.closeVoiceMenu();
    hooks.closeShareMenu();
    hooks.closeExportMenu();
    hooks.closeWritingToolsMenu();
    hooks.closeHeadingMenu();
    hooks.closeImageMenu();
    hooks.closeFormatMoreMenu();
    hooks.toggleViewModeMenu();
  });
  viewModeMenu?.addEventListener("click", hooks.onViewModeMenuClick);
  presentViewBtn?.addEventListener("click", hooks.enterPresentMode);
  printBtn?.addEventListener("click", () => window.print());
  helpBtn?.addEventListener("click", (e) => {
    // Keep modified / middle clicks as real navigation (new tab).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    hooks.closeOverflowMenu();
    void hooks.loadHelpGuide();
  });
  window.addEventListener("beforeprint", hooks.syncPrintPageOrientation);
  window.addEventListener("afterprint", hooks.clearPrintPageOrientation);
  presentPrevBtn?.addEventListener("click", hooks.presentPrev);
  presentNextBtn?.addEventListener("click", hooks.presentNext);
  presentExitBtn?.addEventListener("click", hooks.exitPresentMode);
  document.addEventListener("pointermove", hooks.onPresentChromePointerActivity, { passive: true });
  previewPane.addEventListener("pointerdown", hooks.onPresentSwipePointerDown, { passive: true });
  previewPane.addEventListener("pointerup", hooks.onPresentSwipePointerUp, { passive: true });
  previewPane.addEventListener("pointercancel", hooks.onPresentSwipePointerCancel, { passive: true });
  document.addEventListener("fullscreenchange", hooks.onPresentFullscreenChange);
  document.addEventListener("webkitfullscreenchange", hooks.onPresentFullscreenChange);
  // Escape must not dismiss — only Accept / Reject (method=dialog) close the modal.
  externalModal?.addEventListener("cancel", (e) => e.preventDefault());
  externalModal?.addEventListener("close", () => {
    if (externalModal.returnValue === "accept") hooks.acceptExternalContent();
    else if (externalModal.returnValue === "reject") hooks.rejectExternalContent();
  });

  collapseEditorBtn.addEventListener("click", hooks.toggleEditorCollapse);
  collapsePreviewBtn.addEventListener("click", hooks.togglePreviewCollapse);
  syncScrollBtn.addEventListener("click", hooks.toggleSyncScroll);
  lineWrapBtn?.addEventListener("click", hooks.toggleLineWrap);
  editor.addEventListener(
    "scroll",
    () => {
      // Ignore echo scrolls from preview-driven sync so outline stays on the preview section.
      if (state.syncScrollDriver !== "preview") state.outlineScrollSource = "editor";
      hooks.syncEditorHighlightScroll();
      hooks.syncPreviewFromEditor();
      hooks.scheduleOutlineHighlight();
    },
    { passive: true },
  );
  // overflow:hidden still lets scrollIntoView move scrollTop; pin it so Find cannot
  // desync the highlight layer from the textarea (which owns scrolling).
  editorHighlight.addEventListener(
    "scroll",
    () => {
      if (editorHighlight.scrollTop) editorHighlight.scrollTop = 0;
      if (editorHighlight.scrollLeft) editorHighlight.scrollLeft = 0;
    },
    { passive: true },
  );
  previewPane.addEventListener(
    "scroll",
    () => {
      // Ignore echo scrolls from editor-driven sync (e.g. click-to-reveal) so the
      // outline keeps following the editor caret/section the user just entered.
      if (state.syncScrollDriver !== "editor") state.outlineScrollSource = "preview";
      hooks.syncEditorFromPreview();
      hooks.scheduleOutlineHighlight();
    },
    { passive: true },
  );
  editor.addEventListener("click", () => {
    state.outlineScrollSource = "editor";
    hooks.scheduleRevealPreviewForCaret();
  });
  editor.addEventListener("keyup", (e) => {
    if (
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "Home" ||
      e.key === "End" ||
      e.key === "PageUp" ||
      e.key === "PageDown" ||
      e.key === "Enter"
    ) {
      state.outlineScrollSource = "editor";
      hooks.scheduleRevealPreviewForCaret();
    }
  });
  editor.addEventListener("select", () => {
    state.outlineScrollSource = "editor";
    // Browser Find scrolls the textarea to the match; that scroll is not always
    // accompanied by a "scroll" event, so re-align the highlight layer here.
    hooks.syncEditorHighlightScroll();
    hooks.scheduleRevealPreviewForCaret();
  });
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      hooks.syncEditorHighlightScroll();
      hooks.invalidateScrollAnchors();
      hooks.scheduleMermaidScale();
      if (state.syncScrollEnabled) {
        hooks.syncPreviewFromEditor();
        hooks.scheduleRevealPreviewForCaret();
      }
    });
    ro.observe(editor);
    ro.observe(previewPane);
    if (aiProofEditor) ro.observe(aiProofEditor);
  }
}

hooks.setupBootCoreListeners = setupBootCoreListeners;
