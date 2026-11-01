import { hooks } from "./hooks.js";
import {
  state,
  preview,
  previewPane,
  renderLoading,
  toastEl
} from "./state.js";
import {
  RENDER_LOADING_DELAY_MS
} from "./constants.js";

export function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 1800);
}

/** Mark content as external (share/upload/OS launch) so reader/present show a trust modal. */
export function setContentExternal(external) {
  state.contentIsExternal = Boolean(external);
  document.body.dataset.external = state.contentIsExternal ? "1" : "0";
  if (state.contentIsExternal) {
    state.pendingExternalContent = hooks.getMarkdownSource();
    // Do not parse or syntax-highlight untrusted Markdown until Accept.
    clearUntrustedPreview();
    hooks.scheduleEditorHighlight();
  } else {
    state.pendingExternalContent = null;
  }
  hooks.syncExternalModal();
}

/**
 * Stash draft + file binding before overwriting with untrusted content.
 * @param {string} [contentOverride] Prefer stored draft at hooks.init(editor may still be empty).
 */
export function stashPreExternalState(contentOverride) {
  if (state.preExternalSnapshot) return;
  state.preExternalSnapshot = {
    content: contentOverride != null ? String(contentOverride) : hooks.getMarkdownSource(),
    fileHandle: state.currentFileHandle,
    driveFile: state.currentDriveFile,
    gistFile: state.currentGistFile,
    fileName: state.currentFileName,
    filePath: state.currentFilePath,
    savedSnapshot: state.savedSnapshot,
    fileRevision: state.currentFileRevision,
  };
}

/** Clear preview without running marked / DOMPurify / Mermaid on untrusted source. */
export function clearUntrustedPreview() {
  if (state.speechActive) hooks.stopSpeaking();
  window.clearTimeout(state.renderTimer);
  state.paintGen += 1;
  endRenderLoading();
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.mermaidGen += 1;
  preview.innerHTML =
    '<p class="external-preview-placeholder">Preview is paused until you accept this content.</p>';
  hooks.invalidateScrollAnchors();
  hooks.updateDocOutline();
}

/** Yield until after the next paint so a loading spinner can appear on screen. */
export function yieldToPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Macrotask after the frame so the browser can commit the paint.
        setTimeout(resolve, 0);
      });
    });
  });
}

/** Drop the current preview DOM so a prior document is not shown under the spinner. */
export function clearPreviewContent() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.mermaidGen += 1;
  preview.innerHTML = "";
  if (previewPane) previewPane.scrollTop = 0;
  hooks.invalidateScrollAnchors();
  hooks.updateDocOutline();
}

/**
 * Mount the loading overlay and arm the 700ms reveal timer.
 * @param {{ eager?: boolean }} [opts] eager: show immediately (large docs)
 */
export function beginRenderLoading(opts = {}) {
  if (!(renderLoading instanceof HTMLElement)) return;
  window.clearTimeout(state.renderLoadingTimer);
  const alreadyVisible = renderLoading.classList.contains("is-visible") && !renderLoading.hidden;
  renderLoading.hidden = false;
  previewPane?.setAttribute("aria-busy", "true");
  if (opts.eager || alreadyVisible) {
    revealRenderLoading();
    return;
  }
  renderLoading.classList.remove("is-visible");
  renderLoading.setAttribute("aria-hidden", "true");
  state.renderLoadingTimer = window.setTimeout(() => {
    state.renderLoadingTimer = 0;
    revealRenderLoading();
  }, RENDER_LOADING_DELAY_MS);
}

/** Make the armed loading overlay visible (idempotent). */
export function revealRenderLoading() {
  if (!(renderLoading instanceof HTMLElement) || renderLoading.hidden) return;
  renderLoading.classList.add("is-visible");
  renderLoading.setAttribute("aria-hidden", "false");
}

export function endRenderLoading() {
  window.clearTimeout(state.renderLoadingTimer);
  state.renderLoadingTimer = 0;
  if (!(renderLoading instanceof HTMLElement)) return;
  renderLoading.classList.remove("is-visible");
  renderLoading.hidden = true;
  renderLoading.setAttribute("aria-hidden", "true");
  previewPane?.removeAttribute("aria-busy");
}

hooks.showToast = showToast;
hooks.setContentExternal = setContentExternal;
hooks.stashPreExternalState = stashPreExternalState;
hooks.clearUntrustedPreview = clearUntrustedPreview;
hooks.yieldToPaint = yieldToPaint;
hooks.clearPreviewContent = clearPreviewContent;
hooks.beginRenderLoading = beginRenderLoading;
hooks.revealRenderLoading = revealRenderLoading;
hooks.endRenderLoading = endRenderLoading;
