import { hooks } from "../hooks.js";
import {
  aiProofEditor,
  aiProofEditorWrap,
  aiProofHighlight,
  aiProofHighlightCode,
  aiProofreadDialog,
  aiRewriteDialog,
  aiWriteDialog,
  editor,
  previewFrame,
  previewPane,
  state,
  writingToolsMenu,
} from "../state.js";

/** Dialog open/close, selection hold, and proofread preview. */
export function installAiDialogs(s, api) {
  const { renderCorrectedDiffHtml, resolveInsertRange, resolveTargetRange } =
    api;

  function isAiDialogOpen() {
    return Boolean(
      aiWriteDialog?.open || aiRewriteDialog?.open || aiProofreadDialog?.open,
    );
  }

  function isHoldingEditorSelection() {
    return Boolean(
      s.heldEditorRange &&
        ((writingToolsMenu && !writingToolsMenu.hidden) ||
          aiProofreadDialog?.open),
    );
  }

  function holdEditorSelection(start, end) {
    s.heldEditorRange = {
      start: Math.max(0, Math.min(start, end)),
      end: Math.max(start, end),
    };
  }

  function rememberEditorSelection() {
    holdEditorSelection(editor.selectionStart, editor.selectionEnd);
  }

  function clearHeldEditorSelection() {
    s.heldEditorRange = null;
  }

  function captureTargetRange({ insertAtCaret = false } = {}) {
    const start = s.heldEditorRange?.start ?? editor.selectionStart;
    const end = s.heldEditorRange?.end ?? editor.selectionEnd;
    return insertAtCaret
      ? resolveInsertRange(editor.value, start, end)
      : resolveTargetRange(editor.value, start, end);
  }

  function restoreHeldEditorSelection() {
    const range = s.heldEditorRange || s.pendingRange;
    if (!range) return;
    if (document.activeElement === aiProofEditor) return;
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    const max = editor.value.length;
    const start = Math.max(0, Math.min(range.start, max));
    const end = Math.max(0, Math.min(range.end, max));
    editor.setSelectionRange(start, end);
  }

  function scheduleRestoreHeldEditorSelection() {
    requestAnimationFrame(() => {
      if (!isHoldingEditorSelection() && !aiProofreadDialog?.open) return;
      restoreHeldEditorSelection();
    });
  }

  function setStatus(el, message) {
    if (!el) return;
    const text = el.querySelector(".ai-status-text");
    if (text) text.textContent = message || "";
    else el.textContent = message || "";
  }

  function setAiWaiting(statusEl, dialog, busy) {
    if (statusEl) {
      statusEl.dataset.busy = busy ? "1" : "0";
      const spinner = statusEl.querySelector(".ai-spinner");
      if (spinner) spinner.hidden = !busy;
    }
    if (dialog) {
      dialog.setAttribute("aria-busy", busy ? "true" : "false");
    }
  }

  function setBusy(ui, busy) {
    const {
      runBtn,
      stopBtn,
      applyBtn,
      cancelBtn,
      status,
      dialog,
      hideRunWhenBusy,
    } = ui;
    if (runBtn) {
      runBtn.disabled = busy;
      // Hide while working; callers decide whether to show it again on idle/error.
      if (hideRunWhenBusy && busy) runBtn.hidden = true;
    }
    if (stopBtn) stopBtn.hidden = !busy;
    if (applyBtn && busy) applyBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = false;
    if (status || dialog) setAiWaiting(status, dialog, busy);
  }

  function showPreview(el, text, { html = false } = {}) {
    if (!el) return;
    el.hidden = false;
    if (html) el.innerHTML = text;
    else el.textContent = text;
  }

  function openWriteDialog() {
    // Write inserts at the caret (or replaces a real selection) — never the whole doc.
    const range = captureTargetRange({ insertAtCaret: true });
    hooks.closeWritingToolsMenu();
    hooks.closeOverflowMenu();
    s.pendingRange = { start: range.start, end: range.end };
    s.pendingResult = "";
    clearHeldEditorSelection();
    const promptEl = document.getElementById("ai-write-prompt");
    const contextEl = document.getElementById("ai-write-context");
    const preview = document.getElementById("ai-write-preview");
    const status = document.getElementById("ai-write-status");
    const generateBtn = document.getElementById("ai-write-generate");
    const insertBtn = document.getElementById("ai-write-insert");
    const stopBtn = document.getElementById("ai-write-stop");
    if (promptEl) promptEl.value = "";
    if (contextEl) contextEl.value = "";
    if (preview) {
      preview.hidden = true;
      preview.textContent = "";
    }
    setStatus(status, "");
    if (generateBtn) generateBtn.hidden = false;
    if (insertBtn) {
      insertBtn.hidden = true;
      insertBtn.disabled = true;
    }
    if (stopBtn) stopBtn.hidden = true;
    aiWriteDialog?.showModal();
    promptEl?.focus();
  }

  function openRewriteDialog() {
    const range = captureTargetRange();
    hooks.closeWritingToolsMenu();
    hooks.closeOverflowMenu();
    if (!range.slice.trim()) {
      hooks.showToast("Nothing to rewrite");
      clearHeldEditorSelection();
      return;
    }
    s.pendingRange = { start: range.start, end: range.end };
    s.pendingResult = "";
    clearHeldEditorSelection();
    const desc = document.getElementById("ai-rewrite-desc");
    const contextEl = document.getElementById("ai-rewrite-context");
    const preview = document.getElementById("ai-rewrite-preview");
    const status = document.getElementById("ai-rewrite-status");
    const runBtn = document.getElementById("ai-rewrite-run");
    const applyBtn = document.getElementById("ai-rewrite-apply");
    const stopBtn = document.getElementById("ai-rewrite-stop");
    if (desc) {
      desc.textContent = range.isSelection
        ? "Rewrites the current selection."
        : "No selection — will rewrite the whole document. Long docs may exceed the model limit; select a smaller section if needed.";
    }
    if (contextEl) contextEl.value = "";
    if (preview) {
      preview.hidden = true;
      preview.textContent = "";
    }
    setStatus(status, "");
    if (runBtn) runBtn.hidden = false;
    if (applyBtn) {
      applyBtn.hidden = true;
      applyBtn.disabled = true;
    }
    if (stopBtn) stopBtn.hidden = true;
    aiRewriteDialog?.showModal();
  }

  function openProofreadDialog() {
    const range = captureTargetRange();
    hooks.closeWritingToolsMenu();
    hooks.closeOverflowMenu();
    if (!range.slice.trim()) {
      hooks.showToast("Nothing to proofread");
      clearHeldEditorSelection();
      return;
    }
    s.pendingRange = { start: range.start, end: range.end };
    s.pendingResult = "";
    holdEditorSelection(range.start, range.end);
    clearProofreadPreview();
    const desc = document.getElementById("ai-proofread-desc");
    const status = document.getElementById("ai-proofread-status");
    const runBtn = document.getElementById("ai-proofread-run");
    const applyBtn = document.getElementById("ai-proofread-apply");
    const stopBtn = document.getElementById("ai-proofread-stop");
    if (desc) {
      desc.textContent = range.isSelection
        ? "Checks the selection. Code fences keep their structure; only Mermaid notes and line comments are proofread, plus surrounding Markdown."
        : "Whole document. Code fences keep their structure; only Mermaid notes and line comments are proofread, plus surrounding Markdown.";
    }
    setStatus(status, "");
    setAiWaiting(status, aiProofreadDialog, false);
    if (runBtn) {
      runBtn.hidden = false;
      runBtn.disabled = false;
    }
    if (applyBtn) {
      applyBtn.hidden = true;
      applyBtn.disabled = true;
    }
    if (stopBtn) stopBtn.hidden = true;
    // Modeless so the main preview stays readable behind the dock.
    aiProofreadDialog?.show();
    requestAnimationFrame(() => syncProofDockClearance());
    scheduleRestoreHeldEditorSelection();
  }

  function syncProofDockClearance() {
    const dialog = aiProofreadDialog;
    if (!dialog?.open) {
      document.documentElement.style.removeProperty(
        "--ai-proof-dock-clearance",
      );
      return;
    }
    const height = Math.ceil(dialog.getBoundingClientRect().height);
    // Match dock `bottom: 1rem` plus a small gap above the dialog.
    const clearance = height + 24;
    document.documentElement.style.setProperty(
      "--ai-proof-dock-clearance",
      `${Math.max(clearance, 96)}px`,
    );
  }

  function showProofreadPreview(originalSlice, correctedSlice) {
    if (!aiProofEditorWrap || !aiProofEditor || !aiProofHighlightCode) return;
    document.body.dataset.aiProofPreview = "1";
    if (previewFrame) previewFrame.hidden = true;
    aiProofEditorWrap.hidden = false;
    if (previewPane) {
      previewPane.setAttribute("aria-label", "Proofread result");
    }
    aiProofEditor.value = correctedSlice;
    aiProofHighlightCode.innerHTML = `${renderCorrectedDiffHtml(originalSlice, correctedSlice)}\n`;
    syncProofEditorHighlightMetrics();
    if (state.syncScrollEnabled) {
      hooks.syncPreviewFromEditor();
    } else {
      aiProofEditor.scrollTop = 0;
      hooks.syncProofEditorHighlightScroll();
    }
    scheduleRestoreHeldEditorSelection();
  }

  function clearProofreadPreview({ restoreMarkdown = true } = {}) {
    const active =
      document.body.dataset.aiProofPreview === "1" ||
      (aiProofEditorWrap && !aiProofEditorWrap.hidden);
    if (!active) {
      // Recover a blank right pane if Apply left the preview frame hidden.
      if (previewFrame?.hidden) previewFrame.hidden = false;
      return;
    }
    delete document.body.dataset.aiProofPreview;
    if (aiProofEditorWrap) aiProofEditorWrap.hidden = true;
    if (aiProofEditor) aiProofEditor.value = "";
    if (aiProofHighlightCode) aiProofHighlightCode.innerHTML = "";
    if (previewFrame) previewFrame.hidden = false;
    if (previewPane) {
      previewPane.setAttribute("aria-label", "Rendered preview");
    }
    if (restoreMarkdown) hooks.renderMarkdown(hooks.getMarkdownSource());
  }

  function syncProofEditorHighlightMetrics() {
    if (!aiProofEditor || !aiProofHighlight) return;
    const dx = aiProofEditor.offsetWidth - aiProofEditor.clientWidth;
    const dy = aiProofEditor.offsetHeight - aiProofEditor.clientHeight;
    aiProofHighlight.style.inset = `0 ${dx}px ${dy}px 0`;
    hooks.syncProofEditorHighlightScroll();
  }

  function onProofEditorScroll() {
    hooks.syncProofEditorHighlightScroll();
    // Right-pane scroll drives the left editor when Sync scroll is on.
    if (state.syncScrollDriver !== "editor")
      state.outlineScrollSource = "preview";
    hooks.syncEditorFromPreview();
  }

  function applyPendingResult(dialog) {
    if (!s.pendingRange || s.pendingResult == null) return;
    const isProof = dialog === aiProofreadDialog;
    hooks.replaceEditorRange(
      s.pendingRange.start,
      s.pendingRange.end,
      s.pendingResult,
    );
    s.pendingRange = null;
    s.pendingResult = "";
    clearHeldEditorSelection();
    if (isProof) {
      // Editor already re-rendered via replaceEditorRange; only restore the pane UI.
      clearProofreadPreview({ restoreMarkdown: false });
    }
    dialog?.close();
    hooks.showToast("Applied");
    editor.focus();
  }

  function closeAiDialog(dialog) {
    s.abortAi();
    if (dialog === aiProofreadDialog) clearProofreadPreview();
    clearHeldEditorSelection();
    dialog?.close();
    if (dialog === aiProofreadDialog) syncProofDockClearance();
  }

  s.isAiDialogOpen = isAiDialogOpen;
  s.isHoldingEditorSelection = isHoldingEditorSelection;
  s.holdEditorSelection = holdEditorSelection;
  s.rememberEditorSelection = rememberEditorSelection;
  s.clearHeldEditorSelection = clearHeldEditorSelection;
  s.captureTargetRange = captureTargetRange;
  s.restoreHeldEditorSelection = restoreHeldEditorSelection;
  s.scheduleRestoreHeldEditorSelection = scheduleRestoreHeldEditorSelection;
  s.setStatus = setStatus;
  s.setAiWaiting = setAiWaiting;
  s.setBusy = setBusy;
  s.showPreview = showPreview;
  s.openWriteDialog = openWriteDialog;
  s.openRewriteDialog = openRewriteDialog;
  s.openProofreadDialog = openProofreadDialog;
  s.syncProofDockClearance = syncProofDockClearance;
  s.showProofreadPreview = showProofreadPreview;
  s.clearProofreadPreview = clearProofreadPreview;
  s.syncProofEditorHighlightMetrics = syncProofEditorHighlightMetrics;
  s.onProofEditorScroll = onProofEditorScroll;
  s.applyPendingResult = applyPendingResult;
  s.closeAiDialog = closeAiDialog;
}
