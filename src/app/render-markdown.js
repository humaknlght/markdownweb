import { hooks } from "./hooks.js";
import {
  state,
  preview
} from "./state.js";
import {
  RENDER_DEBOUNCE_MS,
  RENDER_LOADING_EAGER_CHARS
} from "./constants.js";
import {
  marked,
  DOMPurify
} from "./vendor-deps.js";
import {
  ensureHljsLanguagesForSource
} from "./hljs-setup.js";

export async function renderMarkdown(source) {
  if (state.contentIsExternal) {
    hooks.clearUntrustedPreview();
    return;
  }
  if (state.speechActive) hooks.stopSpeaking();

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
  if (large) {
    // Clear the previous document so it is not visible under the spinner.
    hooks.clearPreviewContent();
    hooks.beginRenderLoading({ eager: true });
    await hooks.yieldToPaint();
    if (gen !== state.paintGen) return;
  } else {
    hooks.beginRenderLoading();
  }

  // Load missing fence grammars in the background; re-render once they arrive.
  void ensureHljsLanguagesForSource(source).then((loadedAny) => {
    if (!loadedAny || state.contentIsExternal) return;
    if (hooks.getMarkdownSource() !== source) return;
    void renderMarkdown(source).then(() => hooks.scheduleEditorHighlight());
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
    preview.innerHTML = clean;
    hooks.restoreMermaidRenders(mermaidReuse);
    hooks.addCodeLineNumbers(preview);
    hooks.enhanceSectionToggles();
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
