import { hooks } from "../hooks.js";
import {
  editor,
  aiWriteDialog,
  aiRewriteDialog,
  aiProofreadDialog,
} from "../state.js";

/** Write, rewrite, and proofread runs against the lazy Chrome AI module. */
export function installAiActions(s, api) {
  const {
    assertInputFitsQuota,
    availabilityLabel,
    checkAvailability,
    checkPromptAvailability,
    createAiSession,
    createPromptSession,
    destroyAiSession,
    formatAiError,
    PROMPT_TEXT_OPTIONS,
    promptSystemFor,
    runProofreadDocument,
    runPromptRewrite,
    runPromptWrite,
    runRewrite,
    runWrite,
    wrapPromptSessionAsProofreader,
    writingBackendFor,
  } = api;

  function abortAi() {
    try {
      s.aiAbort?.abort();
    } catch {
      /* ignore */
    }
    s.aiAbort = null;
    destroyAiSession(s.activeSession);
    s.activeSession = null;
  }

  async function ensureSession(kind, options, onProgress) {
    destroyAiSession(s.activeSession);
    s.activeSession = null;
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
        signal: s.aiAbort?.signal,
        onProgress,
      });
      s.activeSession =
        kind === "Proofreader" ? wrapPromptSessionAsProofreader(lm) : lm;
      return s.activeSession;
    }

    const status = await checkAvailability(kind, options);
    if (status === "unavailable") {
      throw new Error(availabilityLabel(status));
    }
    s.activeSession = await createAiSession(kind, options, {
      signal: s.aiAbort?.signal,
      onProgress,
    });
    return s.activeSession;
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
      s.setStatus(status, "Enter a prompt.");
      promptEl?.focus();
      return;
    }

    abortAi();
    s.aiAbort = new AbortController();
    s.pendingResult = "";
    s.setBusy(
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
    s.showPreview(preview, "");
    s.setStatus(status, "Starting…");

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
        s.setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      s.setStatus(status, "Writing…");
      const context = contextEl?.value?.trim() || undefined;
      const writeOpts = {
        context,
        signal: s.aiAbort.signal,
        onChunk: (text) => {
          s.pendingResult = text;
          s.showPreview(preview, text);
        },
      };
      const result =
        backend === "prompt"
          ? await runPromptWrite(session, prompt, { ...writeOpts, tone, length })
          : await runWrite(session, prompt, writeOpts);
      s.pendingResult = result;
      s.showPreview(preview, result);
      s.setStatus(status, result.trim() ? "Ready to insert." : "No output.");
      if (generateBtn) generateBtn.hidden = true;
      if (insertBtn) {
        insertBtn.hidden = false;
        insertBtn.disabled = !result.trim();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        s.setStatus(status, "Stopped.");
      } else {
        s.setStatus(status, formatAiError(err, "Write failed."));
        hooks.showToast("Write failed");
      }
      if (generateBtn) generateBtn.hidden = false;
    } finally {
      s.setBusy(
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
      destroyAiSession(s.activeSession);
      s.activeSession = null;
      s.aiAbort = null;
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
    if (!s.pendingRange) return;

    // Keep collapsed embeds — expanding data URIs inflates size past model quotas.
    const source = editor.value.slice(s.pendingRange.start, s.pendingRange.end);
    if (!source.trim()) {
      s.setStatus(status, "Nothing to rewrite.");
      return;
    }

    abortAi();
    s.aiAbort = new AbortController();
    s.pendingResult = "";
    s.setBusy(
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
    s.showPreview(preview, "");
    s.setStatus(status, "Starting…");

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
        s.setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      await assertInputFitsQuota(session, source);
      s.setStatus(status, "Rewriting…");
      const context = contextEl?.value?.trim() || undefined;
      const rewriteOpts = {
        context,
        signal: s.aiAbort.signal,
        onChunk: (text) => {
          s.pendingResult = text;
          s.showPreview(preview, text);
        },
      };
      const result =
        backend === "prompt"
          ? await runPromptRewrite(session, source, { ...rewriteOpts, tone, length })
          : await runRewrite(session, source, rewriteOpts);
      s.pendingResult = result;
      s.showPreview(preview, result);
      s.setStatus(status, result.trim() ? "Ready to apply." : "No output.");
      if (runBtn) runBtn.hidden = true;
      if (applyBtn) {
        applyBtn.hidden = false;
        applyBtn.disabled = !result.trim();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        s.setStatus(status, "Stopped.");
      } else {
        s.setStatus(status, formatAiError(err, "Rewrite failed."));
        hooks.showToast("Rewrite failed");
      }
      if (runBtn) runBtn.hidden = false;
    } finally {
      s.setBusy(
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
      destroyAiSession(s.activeSession);
      s.activeSession = null;
      s.aiAbort = null;
    }
  }

  async function runProofreadAction() {
    const status = document.getElementById("ai-proofread-status");
    const runBtn = document.getElementById("ai-proofread-run");
    const applyBtn = document.getElementById("ai-proofread-apply");
    const stopBtn = document.getElementById("ai-proofread-stop");
    const cancelBtn = document.getElementById("ai-proofread-cancel");
    if (!s.pendingRange) return;
    if (runBtn?.disabled || aiProofreadDialog?.getAttribute("aria-busy") === "true") {
      return;
    }

    // Keep collapsed embeds — expanding data URIs inflates size past model quotas.
    const source = editor.value.slice(s.pendingRange.start, s.pendingRange.end);
    if (!source.trim()) {
      s.setStatus(status, "Nothing to proofread.");
      return;
    }

    abortAi();
    s.aiAbort = new AbortController();
    s.pendingResult = "";
    s.clearProofreadPreview();
    s.setBusy(
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
    s.setStatus(status, "Starting…");
    s.syncProofDockClearance();

    try {
      const options = { expectedInputLanguages: ["en"] };
      const session = await ensureSession("Proofreader", options, (loaded) => {
        s.setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      s.setStatus(status, "Proofreading…");
      const result = await runProofreadDocument(session, source, {
        signal: s.aiAbort.signal,
        onProgress: ({ index, total, label }) => {
          const kind =
            label === "mermaid-notes"
              ? "diagram notes"
              : label === "comments"
                ? "code comments"
                : "text";
          s.setStatus(
            status,
            total > 1
              ? `Proofreading ${kind}: ${index + 1} of ${total}…`
              : `Proofreading ${kind}…`,
          );
        },
      });
      s.pendingResult = result.correctedInput;
      const n = result.correctionCount;
      const changed = result.correctedInput !== source;
      if (changed) {
        s.showProofreadPreview(source, result.correctedInput);
      }
      const sectionNote =
        result.chunkCount > 1 ? ` (${result.chunkCount} sections)` : "";
      s.setStatus(
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
        s.setStatus(status, "Stopped.");
      } else {
        s.setStatus(status, formatAiError(err, "Proofread failed."));
        hooks.showToast("Proofread failed");
      }
      if (runBtn) runBtn.hidden = false;
    } finally {
      s.setBusy(
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
      destroyAiSession(s.activeSession);
      s.activeSession = null;
      s.aiAbort = null;
      s.syncProofDockClearance();
      s.scheduleRestoreHeldEditorSelection();
    }
  }

  s.abortAi = abortAi;
  s.ensureSession = ensureSession;
  s.runWriteAction = runWriteAction;
  s.runRewriteAction = runRewriteAction;
  s.runProofreadAction = runProofreadAction;
}
