import { hooks } from "../hooks.js";
import {
  state,
  editor,
  preview,
  writingToolsDropdown,
  writingToolsBtn,
  writingToolsMenu,
  aiWriteMenuBtn,
  aiRewriteMenuBtn,
  aiProofreadMenuBtn,
  aiWriteDialog,
  aiRewriteDialog,
  aiProofreadDialog,
  aiProofEditorWrap,
  aiProofEditor,
  aiProofHighlight,
  aiProofHighlightCode,
  previewPane
} from "../state.js";
import {
  loadChromeAiModule,
  anyWritingAiGlobalPresent
} from "../lazy-modules.js";

export async function setupChromeAi() {
  if (!writingToolsDropdown || !writingToolsBtn || !writingToolsMenu) return;
  if (!anyWritingAiGlobalPresent()) return;

  const {
    assertInputFitsQuota,
    availabilityLabel,
    checkAvailability,
    checkPromptAvailability,
    createAiSession,
    createPromptSession,
    destroyAiSession,
    formatAiError,
    isAiSupported,
    isPromptApiSupported,
    PROMPT_TEXT_OPTIONS,
    promptSystemFor,
    renderCorrectedDiffHtml,
    resolveInsertRange,
    resolveTargetRange,
    runProofreadDocument,
    runPromptRewrite,
    runPromptWrite,
    runRewrite,
    runWrite,
    wrapPromptSessionAsProofreader,
    writingBackendFor,
  } = await loadChromeAiModule();

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
  let aiAbort = null;
  /** @type {{ start: number, end: number }|null} */
  let pendingRange = null;
  /** Editor selection to keep visible across toolbar / proofread focus changes. */
  /** @type {{ start: number, end: number }|null} */
  let heldEditorRange = null;
  /** @type {string} */
  let pendingResult = "";
  /** @type {object|null} */
  let activeSession = null;

  function abortAi() {
    try {
      aiAbort?.abort();
    } catch {
      /* ignore */
    }
    aiAbort = null;
    destroyAiSession(activeSession);
    activeSession = null;
  }

  function isAiDialogOpen() {
    return Boolean(
      aiWriteDialog?.open || aiRewriteDialog?.open || aiProofreadDialog?.open,
    );
  }

  function isHoldingEditorSelection() {
    return Boolean(
      heldEditorRange &&
        ((writingToolsMenu && !writingToolsMenu.hidden) || aiProofreadDialog?.open),
    );
  }

  function holdEditorSelection(start, end) {
    heldEditorRange = {
      start: Math.max(0, Math.min(start, end)),
      end: Math.max(start, end),
    };
  }

  function rememberEditorSelection() {
    holdEditorSelection(editor.selectionStart, editor.selectionEnd);
  }

  function clearHeldEditorSelection() {
    heldEditorRange = null;
  }

  function captureTargetRange({ insertAtCaret = false } = {}) {
    const start = heldEditorRange?.start ?? editor.selectionStart;
    const end = heldEditorRange?.end ?? editor.selectionEnd;
    return insertAtCaret
      ? resolveInsertRange(editor.value, start, end)
      : resolveTargetRange(editor.value, start, end);
  }

  /** Re-apply the held range so the editor keeps showing the selection. */
  function restoreHeldEditorSelection() {
    const range = heldEditorRange || pendingRange;
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

  /** Toggle waiting spinner + aria-busy on an AI status line / dialog. */
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
    const { runBtn, stopBtn, applyBtn, cancelBtn, status, dialog, hideRunWhenBusy } = ui;
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

  async function ensureSession(kind, options, onProgress) {
    destroyAiSession(activeSession);
    activeSession = null;
    const backend = writingBackendFor(kind);
    if (!backend) {
      throw new Error(availabilityLabel("unavailable"));
    }

    if (backend === "prompt") {
      const promptOptions = {
        ...PROMPT_TEXT_OPTIONS,
        initialPrompts: [{ role: "system", content: promptSystemFor(kind) }],
      };
      const status = await checkPromptAvailability(PROMPT_TEXT_OPTIONS);
      if (status === "unavailable") {
        throw new Error(availabilityLabel(status));
      }
      const lm = await createPromptSession(promptOptions, {
        signal: aiAbort?.signal,
        onProgress,
      });
      activeSession =
        kind === "Proofreader" ? wrapPromptSessionAsProofreader(lm) : lm;
      return activeSession;
    }

    const status = await checkAvailability(kind, options);
    if (status === "unavailable") {
      throw new Error(availabilityLabel(status));
    }
    activeSession = await createAiSession(kind, options, {
      signal: aiAbort?.signal,
      onProgress,
    });
    return activeSession;
  }

  function openWriteDialog() {
    // Write inserts at the caret (or replaces a real selection) — never the whole doc.
    const range = captureTargetRange({ insertAtCaret: true });
    hooks.closeWritingToolsMenu();
    hooks.closeOverflowMenu();
    pendingRange = { start: range.start, end: range.end };
    pendingResult = "";
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
    pendingRange = { start: range.start, end: range.end };
    pendingResult = "";
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
    pendingRange = { start: range.start, end: range.end };
    pendingResult = "";
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

  /** Reserve workspace space so the fixed dock does not cover scrolled text. */
  function syncProofDockClearance() {
    const dialog = aiProofreadDialog;
    if (!dialog?.open) {
      document.documentElement.style.removeProperty("--ai-proof-dock-clearance");
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

  /** Replace the preview with a second editor showing corrected text + diff marks. */
  function showProofreadPreview(originalSlice, correctedSlice) {
    if (!aiProofEditorWrap || !aiProofEditor || !aiProofHighlightCode) return;
    document.body.dataset.aiProofPreview = "1";
    if (preview) preview.hidden = true;
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
      // Recover a blank right pane if Apply left #preview hidden.
      if (preview?.hidden) preview.hidden = false;
      return;
    }
    delete document.body.dataset.aiProofPreview;
    if (aiProofEditorWrap) aiProofEditorWrap.hidden = true;
    if (aiProofEditor) aiProofEditor.value = "";
    if (aiProofHighlightCode) aiProofHighlightCode.innerHTML = "";
    if (preview) preview.hidden = false;
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
    if (state.syncScrollDriver !== "editor") state.outlineScrollSource = "preview";
    hooks.syncEditorFromPreview();
  }

  async function runWriteAction() {
    const promptEl = document.getElementById("ai-write-prompt");
    const contextEl = document.getElementById("ai-write-context");
    const toneEl = document.getElementById("ai-write-tone");
    const lengthEl = document.getElementById("ai-write-length");
    const preview = document.getElementById("ai-write-preview");
    const status = document.getElementById("ai-write-status");
    const generateBtn = document.getElementById("ai-write-generate");
    const insertBtn = document.getElementById("ai-write-insert");
    const stopBtn = document.getElementById("ai-write-stop");
    const cancelBtn = document.getElementById("ai-write-cancel");
    const prompt = promptEl?.value?.trim() || "";
    if (!prompt) {
      setStatus(status, "Enter a prompt.");
      promptEl?.focus();
      return;
    }

    abortAi();
    aiAbort = new AbortController();
    pendingResult = "";
    setBusy(
      {
        runBtn: generateBtn,
        stopBtn,
        applyBtn: insertBtn,
        cancelBtn,
        status,
        dialog: aiWriteDialog,
        hideRunWhenBusy: true,
      },
      true,
    );
    if (insertBtn) insertBtn.hidden = true;
    showPreview(preview, "");
    setStatus(status, "Starting…");

    try {
      const tone = toneEl?.value || "neutral";
      const length = lengthEl?.value || "short";
      const backend = writingBackendFor("Writer");
      const options = {
        tone,
        length,
        format: "markdown",
        expectedInputLanguages: ["en"],
        expectedContextLanguages: ["en"],
        outputLanguage: "en",
      };
      const session = await ensureSession("Writer", options, (loaded) => {
        setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      setStatus(status, "Writing…");
      const context = contextEl?.value?.trim() || undefined;
      const writeOpts = {
        context,
        signal: aiAbort.signal,
        onChunk: (text) => {
          pendingResult = text;
          showPreview(preview, text);
        },
      };
      const result =
        backend === "prompt"
          ? await runPromptWrite(session, prompt, { ...writeOpts, tone, length })
          : await runWrite(session, prompt, writeOpts);
      pendingResult = result;
      showPreview(preview, result);
      setStatus(status, result.trim() ? "Ready to insert." : "No output.");
      if (generateBtn) generateBtn.hidden = true;
      if (insertBtn) {
        insertBtn.hidden = false;
        insertBtn.disabled = !result.trim();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus(status, "Stopped.");
      } else {
        setStatus(status, formatAiError(err, "Write failed."));
        hooks.showToast("Write failed");
      }
      if (generateBtn) generateBtn.hidden = false;
    } finally {
      setBusy(
        {
          runBtn: generateBtn,
          stopBtn,
          applyBtn: insertBtn,
          cancelBtn,
          status,
          dialog: aiWriteDialog,
          hideRunWhenBusy: true,
        },
        false,
      );
      destroyAiSession(activeSession);
      activeSession = null;
      aiAbort = null;
    }
  }

  async function runRewriteAction() {
    const contextEl = document.getElementById("ai-rewrite-context");
    const toneEl = document.getElementById("ai-rewrite-tone");
    const lengthEl = document.getElementById("ai-rewrite-length");
    const preview = document.getElementById("ai-rewrite-preview");
    const status = document.getElementById("ai-rewrite-status");
    const runBtn = document.getElementById("ai-rewrite-run");
    const applyBtn = document.getElementById("ai-rewrite-apply");
    const stopBtn = document.getElementById("ai-rewrite-stop");
    const cancelBtn = document.getElementById("ai-rewrite-cancel");
    if (!pendingRange) return;

    // Keep collapsed embeds — expanding data URIs inflates size past model quotas.
    const source = editor.value.slice(pendingRange.start, pendingRange.end);
    if (!source.trim()) {
      setStatus(status, "Nothing to rewrite.");
      return;
    }

    abortAi();
    aiAbort = new AbortController();
    pendingResult = "";
    setBusy(
      {
        runBtn,
        stopBtn,
        applyBtn,
        cancelBtn,
        status,
        dialog: aiRewriteDialog,
        hideRunWhenBusy: true,
      },
      true,
    );
    if (applyBtn) applyBtn.hidden = true;
    showPreview(preview, "");
    setStatus(status, "Starting…");

    try {
      const tone = toneEl?.value || "as-is";
      const length = lengthEl?.value || "as-is";
      const backend = writingBackendFor("Rewriter");
      const options = {
        tone,
        length,
        format: "markdown",
        expectedInputLanguages: ["en"],
        expectedContextLanguages: ["en"],
        outputLanguage: "en",
      };
      const session = await ensureSession("Rewriter", options, (loaded) => {
        setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      await assertInputFitsQuota(session, source);
      setStatus(status, "Rewriting…");
      const context = contextEl?.value?.trim() || undefined;
      const rewriteOpts = {
        context,
        signal: aiAbort.signal,
        onChunk: (text) => {
          pendingResult = text;
          showPreview(preview, text);
        },
      };
      const result =
        backend === "prompt"
          ? await runPromptRewrite(session, source, { ...rewriteOpts, tone, length })
          : await runRewrite(session, source, rewriteOpts);
      pendingResult = result;
      showPreview(preview, result);
      setStatus(status, result.trim() ? "Ready to apply." : "No output.");
      if (runBtn) runBtn.hidden = true;
      if (applyBtn) {
        applyBtn.hidden = false;
        applyBtn.disabled = !result.trim();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus(status, "Stopped.");
      } else {
        setStatus(status, formatAiError(err, "Rewrite failed."));
        hooks.showToast("Rewrite failed");
      }
      if (runBtn) runBtn.hidden = false;
    } finally {
      setBusy(
        {
          runBtn,
          stopBtn,
          applyBtn,
          cancelBtn,
          status,
          dialog: aiRewriteDialog,
          hideRunWhenBusy: true,
        },
        false,
      );
      destroyAiSession(activeSession);
      activeSession = null;
      aiAbort = null;
    }
  }

  async function runProofreadAction() {
    const status = document.getElementById("ai-proofread-status");
    const runBtn = document.getElementById("ai-proofread-run");
    const applyBtn = document.getElementById("ai-proofread-apply");
    const stopBtn = document.getElementById("ai-proofread-stop");
    const cancelBtn = document.getElementById("ai-proofread-cancel");
    if (!pendingRange) return;
    if (runBtn?.disabled || aiProofreadDialog?.getAttribute("aria-busy") === "true") {
      return;
    }

    // Keep collapsed embeds — expanding data URIs inflates size past model quotas.
    const source = editor.value.slice(pendingRange.start, pendingRange.end);
    if (!source.trim()) {
      setStatus(status, "Nothing to proofread.");
      return;
    }

    abortAi();
    aiAbort = new AbortController();
    pendingResult = "";
    clearProofreadPreview();
    setBusy(
      {
        runBtn,
        stopBtn,
        applyBtn,
        cancelBtn,
        status,
        dialog: aiProofreadDialog,
        hideRunWhenBusy: true,
      },
      true,
    );
    if (applyBtn) applyBtn.hidden = true;
    setStatus(status, "Starting…");
    syncProofDockClearance();

    try {
      const options = { expectedInputLanguages: ["en"] };
      const session = await ensureSession("Proofreader", options, (loaded) => {
        setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      setStatus(status, "Proofreading…");
      const result = await runProofreadDocument(session, source, {
        signal: aiAbort.signal,
        onProgress: ({ index, total, label }) => {
          const kind =
            label === "mermaid-notes"
              ? "diagram notes"
              : label === "comments"
                ? "code comments"
                : "text";
          setStatus(
            status,
            total > 1
              ? `Proofreading ${kind}: ${index + 1} of ${total}…`
              : `Proofreading ${kind}…`,
          );
        },
      });
      pendingResult = result.correctedInput;
      const n = result.correctionCount;
      const changed = result.correctedInput !== source;
      if (changed) {
        showProofreadPreview(source, result.correctedInput);
      }
      const sectionNote =
        result.chunkCount > 1 ? ` (${result.chunkCount} sections)` : "";
      setStatus(
        status,
        !changed && !n
          ? `No issues found${sectionNote}.`
          : `${n} correction${n === 1 ? "" : "s"} suggested${sectionNote} — review the highlighted editor, then Apply.`,
      );
      if (runBtn) runBtn.hidden = true;
      if (applyBtn) {
        applyBtn.hidden = false;
        applyBtn.disabled = !changed;
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus(status, "Stopped.");
      } else {
        setStatus(status, formatAiError(err, "Proofread failed."));
        hooks.showToast("Proofread failed");
      }
      if (runBtn) runBtn.hidden = false;
    } finally {
      setBusy(
        {
          runBtn,
          stopBtn,
          applyBtn,
          cancelBtn,
          status,
          dialog: aiProofreadDialog,
          hideRunWhenBusy: true,
        },
        false,
      );
      destroyAiSession(activeSession);
      activeSession = null;
      aiAbort = null;
      syncProofDockClearance();
      scheduleRestoreHeldEditorSelection();
    }
  }

  function applyPendingResult(dialog) {
    if (!pendingRange || pendingResult == null) return;
    const isProof = dialog === aiProofreadDialog;
    hooks.replaceEditorRange(pendingRange.start, pendingRange.end, pendingResult);
    pendingRange = null;
    pendingResult = "";
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
    abortAi();
    if (dialog === aiProofreadDialog) clearProofreadPreview();
    clearHeldEditorSelection();
    dialog?.close();
    if (dialog === aiProofreadDialog) syncProofDockClearance();
  }

  writingToolsBtn.addEventListener("mousedown", (e) => {
    // Keep editor selection when opening the menu (mousedown would blur otherwise).
    e.preventDefault();
    rememberEditorSelection();
  });
  writingToolsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    rememberEditorSelection();
    hooks.toggleWritingToolsMenu();
    scheduleRestoreHeldEditorSelection();
  });

  writingToolsDropdown?.addEventListener("mousedown", (e) => {
    // Any click inside the Writing tools control should not clear the selection.
    e.preventDefault();
    if (editor.selectionStart !== editor.selectionEnd) {
      rememberEditorSelection();
    }
  });

  aiProofEditor?.addEventListener("scroll", onProofEditorScroll);
  aiProofHighlight?.addEventListener(
    "scroll",
    () => {
      if (aiProofHighlight.scrollTop) aiProofHighlight.scrollTop = 0;
      if (aiProofHighlight.scrollLeft) aiProofHighlight.scrollLeft = 0;
    },
    { passive: true },
  );

  aiWriteMenuBtn?.addEventListener("click", () => openWriteDialog());
  aiRewriteMenuBtn?.addEventListener("click", () => openRewriteDialog());
  aiProofreadMenuBtn?.addEventListener("click", () => openProofreadDialog());

  document.getElementById("ai-write-cancel")?.addEventListener("click", () => {
    closeAiDialog(aiWriteDialog);
  });
  document.getElementById("ai-write-stop")?.addEventListener("click", () => abortAi());
  document
    .getElementById("ai-write-generate")
    ?.addEventListener("click", () => void runWriteAction());
  document.getElementById("ai-write-insert")?.addEventListener("click", () => {
    if (!pendingRange) {
      pendingRange = {
        start: editor.selectionStart,
        end: editor.selectionEnd,
      };
    }
    applyPendingResult(aiWriteDialog);
  });

  document.getElementById("ai-rewrite-cancel")?.addEventListener("click", () => {
    closeAiDialog(aiRewriteDialog);
  });
  document.getElementById("ai-rewrite-stop")?.addEventListener("click", () => abortAi());
  document
    .getElementById("ai-rewrite-run")
    ?.addEventListener("click", () => void runRewriteAction());
  document.getElementById("ai-rewrite-apply")?.addEventListener("click", () => {
    applyPendingResult(aiRewriteDialog);
  });

  document.getElementById("ai-proofread-cancel")?.addEventListener("click", () => {
    closeAiDialog(aiProofreadDialog);
  });
  document
    .getElementById("ai-proofread-stop")
    ?.addEventListener("click", () => abortAi());
  document
    .getElementById("ai-proofread-run")
    ?.addEventListener("click", () => void runProofreadAction());
  document
    .getElementById("ai-proofread-apply")
    ?.addEventListener("click", () => {
      applyPendingResult(aiProofreadDialog);
    });

  for (const dialog of [aiWriteDialog, aiRewriteDialog, aiProofreadDialog]) {
    dialog?.addEventListener("cancel", () => {
      abortAi();
      if (dialog === aiProofreadDialog) clearProofreadPreview();
      clearHeldEditorSelection();
    });
    dialog?.addEventListener("close", () => {
      abortAi();
      if (dialog === aiProofreadDialog) {
        clearProofreadPreview();
        syncProofDockClearance();
      }
      clearHeldEditorSelection();
    });
  }

  // Keep editor selection while using the modeless proofread dock.
  aiProofreadDialog?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    scheduleRestoreHeldEditorSelection();
  });

  if (aiProofreadDialog && typeof ResizeObserver === "function") {
    const dockRo = new ResizeObserver(() => syncProofDockClearance());
    dockRo.observe(aiProofreadDialog);
  }
  window.addEventListener("resize", () => {
    if (aiProofreadDialog?.open) syncProofDockClearance();
  });

  // If anything steals focus, put the selection back while we are holding it.
  editor.addEventListener("blur", () => {
    if (!isHoldingEditorSelection() && !aiProofreadDialog?.open) return;
    scheduleRestoreHeldEditorSelection();
  });

  // Modeless proofread dock: Escape does not auto-dismiss like showModal().
  aiProofreadDialog?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    closeAiDialog(aiProofreadDialog);
  });

  setupChromeAi.isDialogOpen = isAiDialogOpen;
}

setupChromeAi.isDialogOpen = () => false;

hooks.setupChromeAi = setupChromeAi;
