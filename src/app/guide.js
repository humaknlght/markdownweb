import { hooks } from "./hooks.js";
import {
  state,
  editor,
  preview,
  previewPane,
  helpBtn
} from "./state.js";
import {
  getDraft
} from "./vendor-deps.js";

export function buildHelpGuideUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  const params = new URLSearchParams();
  params.set("guide", "1");
  params.set("view", "reader");
  url.hash = params.toString();
  return url.toString();
}

export function hasGuideUrlFlag() {
  try {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      if (hashParams.get("guide") === "1") return true;
    }
    return new URLSearchParams(window.location.search).get("guide") === "1";
  } catch {
    return false;
  }
}

if (helpBtn instanceof HTMLAnchorElement) {
  helpBtn.href = buildHelpGuideUrl();
}

/** Build injects __GUIDE_URL__ (content-hashed). Dev falls back to ./GUIDE.md. */
const GUIDE_URL =
  typeof __GUIDE_URL__ !== "undefined" && typeof __GUIDE_URL__ === "string"
    ? __GUIDE_URL__
    : "./GUIDE.md";

/** First-visit starter content from GUIDE.md (copied into dist at build time). */
export function getDefaultGuide() {
  if (!state.guidePromise) {
    state.guidePromise = (async () => {
      try {
        const response = await fetch(GUIDE_URL);
        if (!response.ok) return "";
        return await response.text();
      } catch {
        return "";
      }
    })();
  }
  return state.guidePromise;
}

/** Load GUIDE.md into the editor as help documentation. */
export async function loadHelpGuide() {
  if (!hooks.confirmDiscardIfDirty()) return;
  const guide = await getDefaultGuide();
  if (!guide) {
    hooks.showToast("Could not load help guide");
    return;
  }
  // Persist the outgoing document under its own key before switching to untitled.
  await hooks.persistDraft(hooks.getMarkdownSource());
  hooks.setEditorValue(guide);
  hooks.clearCurrentFileBinding();
  await hooks.persistDraft(guide);
  hooks.renderMarkdown(guide);
  // Same as first-visit GUIDE seed: reading material, not an unsaved user doc.
  state.savedSnapshot = guide;
  hooks.writeSavedSnapshot(hooks.currentDocKey(), guide);
  hooks.updateSaveButton();
  hooks.setContentExternal(false);
  if (state.currentView !== "edit") hooks.setView("edit", { syncUrl: false });
  editor.scrollTop = 0;
  preview.scrollTop = 0;
  if (previewPane) previewPane.scrollTop = 0;
  hooks.closeOverflowMenu();
  hooks.showToast("Loaded help guide");
}

/** Read the persisted draft for a document key (IndexedDB, then localStorage). No GUIDE seed. */
export async function loadStoredDraftContent(docKey = hooks.currentDocKey()) {
  if (state.historyIdbReady) {
    const idbDraft = await getDraft(docKey);
    if (idbDraft) return idbDraft.content;
  }
  const mirrored = hooks.readDraftMirror();
  if (mirrored && mirrored.docKey === docKey) return mirrored.content;
  return null;
}

hooks.buildHelpGuideUrl = buildHelpGuideUrl;
hooks.hasGuideUrlFlag = hasGuideUrlFlag;
hooks.getDefaultGuide = getDefaultGuide;
hooks.loadHelpGuide = loadHelpGuide;
hooks.loadStoredDraftContent = loadStoredDraftContent;
