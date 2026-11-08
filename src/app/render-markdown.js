import { RENDER_DEBOUNCE_MS, RENDER_LOADING_EAGER_CHARS } from "./constants.js";
import { ensureHljsLanguagesForSource } from "./hljs-setup.js";
import { hooks } from "./hooks.js";
import { morphPreviewHtml } from "./preview-morph.js";
import { mermaidSources, preview, state } from "./state.js";
import { DOMPurify, marked } from "./vendor-deps.js";

/**
 * @param {string} source
 * @param {{ skipLoadingUi?: boolean }} [options]
 *   Quiet re-paint after a background HLJS grammar load: keep the existing
 *   preview visible (no clear / spinner flash). Mermaid fence grammars are
 *   editor-only, so those loads refresh the editor highlight without a
 *   second preview paint.
 */
export async function renderMarkdown(source, options = {}) {
  if (state.contentIsExternal) {
    hooks.clearUntrustedPreview();
    return;
  }
  if (state.speechActive) hooks.stopSpeaking();

  const skipLoadingUi = options.skipLoadingUi === true;
  const gen = ++state.paintGen;
  const large = (source || "").length >= RENDER_LOADING_EAGER_CHARS;

  // Editor first: finish highlight and let it paint before any preview spinner.
  if (state.editorHighlightRaf) {
    cancelAnimationFrame(state.editorHighlightRaf);
    state.editorHighlightRaf = 0;
  }
  hooks.updateEditorHighlight();
  await hooks.yieldToPaint();
  if (gen !== state.paintGen) return;

  // Large sync preview work blocks timers, so reveal the spinner before parse
  // (after the editor is already on screen). Smaller docs keep the 700ms delay.
  // Skip both on quiet language-load re-paints so a finished preview is not
  // cleared / covered again when a fence grammar arrives.
  if (!skipLoadingUi) {
    // First paint of a large doc has nothing to keep on screen. Later keystrokes
    // morph the existing DOM, so blanking it here would flash the preview.
    if (large && preview.childNodes.length === 0) {
      hooks.beginRenderLoading({ eager: true });
      await hooks.yieldToPaint();
      if (gen !== state.paintGen) return;
    } else {
      hooks.beginRenderLoading();
    }
  }

  // Load missing fence grammars in the background. Mermaid preview uses its
  // own renderer, so a mermaid-only HLJS load only refreshes the editor
  // overlay. Other newly loaded grammars re-paint the preview quietly.
  void ensureHljsLanguagesForSource(source).then((loadedLangs) => {
    if (!loadedLangs.length || state.contentIsExternal) return;
    if (hooks.getMarkdownSource() !== source) return;
    hooks.updateEditorHighlight();
    hooks.scheduleEditorHighlight();
    if (loadedLangs.every((lang) => lang === "mermaid")) return;
    void renderMarkdown(source, { skipLoadingUi: true });
  });

  try {
    paintMarkdown(source, gen);
  } catch (err) {
    if (gen === state.paintGen) hooks.endRenderLoading();
    throw err;
  }
}

/**
 * @param {string} source
 * @param {number} [gen]
 */
export function paintMarkdown(source, gen = state.paintGen) {
  const raw = marked.parse(source || "", { async: false });
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ["data-source-line", "data-source-line-end"],
    // Block phishing chrome (fake login forms) in the preview.
    FORBID_TAGS: [
      "form",
      "input",
      "button",
      "select",
      "textarea",
      "option",
      "optgroup",
      "fieldset",
      "legend",
    ],
  });

  if (gen !== state.paintGen) return;

  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(() => {
    state.rafId = 0;
    if (gen !== state.paintGen) return;
    // Reuse unchanged Mermaid SVGs so typing below diagrams does not wipe and
    // re-paint them (that collapse was hiding newly added preview text).
    const mermaidReuse = hooks.takeMermaidRenderReuse();
    state.mermaidGen += 1;
    morphPreviewHtml(preview, clean, (el) => mermaidSources.get(el));
    hooks.restoreMermaidRenders(mermaidReuse);
    hooks.addCodeLineNumbers(preview);
    hooks.enhanceSectionToggles();
    hooks.bindPreviewMediaHeightSettle?.(preview);
    hooks.schedulePreviewFrameHeight?.();
    if (hooks.isSlideNavView()) {
      hooks.buildPresentSections();
      hooks.showPresentSection(state.presentIndex);
    }
    hooks.invalidateScrollAnchors();
    hooks.updateDocOutline();
    // Hold the editor as sync driver through any async Mermaid pass so reverse
    // sync cannot yank the textarea while preview height is still settling.
    hooks.beginSyncDriver("editor");
    hooks.syncPreviewFromEditor();
    hooks.revealPreviewForEditorCaret();
    if (gen === state.paintGen) hooks.endRenderLoading();
    hooks.renderMermaidDiagrams().finally(() => {
      if (gen !== state.paintGen) return;
      hooks.enhanceSectionToggles();
      if (hooks.isSlideNavView()) {
        hooks.buildPresentSections();
        hooks.showPresentSection(state.presentIndex);
      }
      hooks.bindPreviewMediaHeightSettle?.(preview);
      hooks.schedulePreviewFrameHeight?.();
      hooks.invalidateScrollAnchors();
      hooks.beginSyncDriver("editor");
      hooks.syncPreviewFromEditor();
      hooks.revealPreviewForEditorCaret();
    });
  });
}

export function scheduleRender() {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(() => {
    renderMarkdown(hooks.getMarkdownSource());
  }, RENDER_DEBOUNCE_MS);
}

hooks.renderMarkdown = renderMarkdown;
hooks.paintMarkdown = paintMarkdown;
hooks.scheduleRender = scheduleRender;
