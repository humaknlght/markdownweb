import { hooks } from "../hooks.js";
import {
  editor,
  writingToolsDropdown,
  writingToolsBtn,
  writingToolsMenu,
  aiWriteMenuBtn,
  aiRewriteMenuBtn,
  aiProofreadMenuBtn,
  aiWriteDialog,
  aiRewriteDialog,
  aiProofreadDialog,
  aiProofEditor,
  aiProofHighlight,
} from "../state.js";
import {
  loadChromeAiModule,
  anyWritingAiGlobalPresent,
} from "../lazy-modules.js";
import { installAiDialogs } from "./dialogs.js";
import { installAiActions } from "./actions.js";

export async function setupChromeAi() {
  if (!writingToolsDropdown || !writingToolsBtn || !writingToolsMenu) return;
  if (!anyWritingAiGlobalPresent()) return;

  const api = await loadChromeAiModule();
  const { isAiSupported, isPromptApiSupported } = api;

  writingToolsDropdown.hidden = false;

  const promptOk = isPromptApiSupported();
  if (aiWriteMenuBtn) {
    aiWriteMenuBtn.hidden = !(isAiSupported("Writer") || promptOk);
  }
  if (aiRewriteMenuBtn) {
    aiRewriteMenuBtn.hidden = !(isAiSupported("Rewriter") || promptOk);
  }
  if (aiProofreadMenuBtn) {
    aiProofreadMenuBtn.hidden = !(isAiSupported("Proofreader") || promptOk);
  }

  /** @type {AbortController|null} */
  const s = {
    aiAbort: null,
    /** @type {{ start: number, end: number }|null} */
    pendingRange: null,
    /** @type {{ start: number, end: number }|null} */
    heldEditorRange: null,
    /** @type {string} */
    pendingResult: "",
    /** @type {object|null} */
    activeSession: null,
  };
  installAiDialogs(s, api);
  installAiActions(s, api);

  writingToolsBtn.addEventListener("mousedown", (e) => {
    // Keep editor selection when opening the menu (mousedown would blur otherwise).
    e.preventDefault();
    s.rememberEditorSelection();
  });
  writingToolsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    s.rememberEditorSelection();
    hooks.toggleWritingToolsMenu();
    s.scheduleRestoreHeldEditorSelection();
  });

  writingToolsDropdown?.addEventListener("mousedown", (e) => {
    // Any click inside the Writing tools control should not clear the selection.
    e.preventDefault();
    if (editor.selectionStart !== editor.selectionEnd) {
      s.rememberEditorSelection();
    }
  });

  aiProofEditor?.addEventListener("scroll", s.onProofEditorScroll);
  aiProofHighlight?.addEventListener(
    "scroll",
    () => {
      if (aiProofHighlight.scrollTop) aiProofHighlight.scrollTop = 0;
      if (aiProofHighlight.scrollLeft) aiProofHighlight.scrollLeft = 0;
    },
    { passive: true },
  );

  aiWriteMenuBtn?.addEventListener("click", () => s.openWriteDialog());
  aiRewriteMenuBtn?.addEventListener("click", () => s.openRewriteDialog());
  aiProofreadMenuBtn?.addEventListener("click", () => s.openProofreadDialog());

  document.getElementById("ai-write-cancel")?.addEventListener("click", () => {
    s.closeAiDialog(aiWriteDialog);
  });
  document.getElementById("ai-write-stop")?.addEventListener("click", () => s.abortAi());
  document
    .getElementById("ai-write-generate")
    ?.addEventListener("click", () => void s.runWriteAction());
  document.getElementById("ai-write-insert")?.addEventListener("click", () => {
    if (!s.pendingRange) {
      s.pendingRange = {
        start: editor.selectionStart,
        end: editor.selectionEnd,
      };
    }
    s.applyPendingResult(aiWriteDialog);
  });

  document.getElementById("ai-rewrite-cancel")?.addEventListener("click", () => {
    s.closeAiDialog(aiRewriteDialog);
  });
  document.getElementById("ai-rewrite-stop")?.addEventListener("click", () => s.abortAi());
  document
    .getElementById("ai-rewrite-run")
    ?.addEventListener("click", () => void s.runRewriteAction());
  document.getElementById("ai-rewrite-apply")?.addEventListener("click", () => {
    s.applyPendingResult(aiRewriteDialog);
  });

  document.getElementById("ai-proofread-cancel")?.addEventListener("click", () => {
    s.closeAiDialog(aiProofreadDialog);
  });
  document
    .getElementById("ai-proofread-stop")
    ?.addEventListener("click", () => s.abortAi());
  document
    .getElementById("ai-proofread-run")
    ?.addEventListener("click", () => void s.runProofreadAction());
  document
    .getElementById("ai-proofread-apply")
    ?.addEventListener("click", () => {
      s.applyPendingResult(aiProofreadDialog);
    });

  for (const dialog of [aiWriteDialog, aiRewriteDialog, aiProofreadDialog]) {
    dialog?.addEventListener("cancel", () => {
      s.abortAi();
      if (dialog === aiProofreadDialog) s.clearProofreadPreview();
      s.clearHeldEditorSelection();
    });
    dialog?.addEventListener("close", () => {
      s.abortAi();
      if (dialog === aiProofreadDialog) {
        s.clearProofreadPreview();
        s.syncProofDockClearance();
      }
      s.clearHeldEditorSelection();
    });
  }

  // Keep editor selection while using the modeless proofread dock.
  aiProofreadDialog?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    s.scheduleRestoreHeldEditorSelection();
  });

  if (aiProofreadDialog && typeof ResizeObserver === "function") {
    const dockRo = new ResizeObserver(() => s.syncProofDockClearance());
    dockRo.observe(aiProofreadDialog);
  }
  window.addEventListener("resize", () => {
    if (aiProofreadDialog?.open) s.syncProofDockClearance();
  });

  // If anything steals focus, put the selection back while we are holding it.
  editor.addEventListener("blur", () => {
    if (!s.isHoldingEditorSelection() && !aiProofreadDialog?.open) return;
    s.scheduleRestoreHeldEditorSelection();
  });

  // Modeless proofread dock: Escape does not auto-dismiss like showModal().
  aiProofreadDialog?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    s.closeAiDialog(aiProofreadDialog);
  });

  setupChromeAi.isDialogOpen = s.isAiDialogOpen;
}

setupChromeAi.isDialogOpen = () => false;

hooks.setupChromeAi = setupChromeAi;
