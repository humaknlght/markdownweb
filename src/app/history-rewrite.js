import { hooks } from "./hooks.js";
import {
  state
} from "./state.js";
import {
  HISTORY_LIMIT,
  HISTORY_INDEX_VERSION,
  PATCH_MAX_CHARS
} from "./constants.js";
import {
  contentHash,
  makeRevisionBody,
  clearHistoryBodies,
  commitHistoryBodies,
  setHistoryIndex,
  titleFromMarkdown
} from "./vendor-deps.js";

export async function removeHistoryMatching(content) {
  if (!content?.trim()) return;
  const hash = contentHash(content);

  if (!state.historyIdbReady) {
    const entries = hooks.loadHistoryIndexEntries().filter(
      (e) => e.content !== content && e.hash !== hash,
    );
    hooks.saveLegacyHistory(entries);
    if (state.lastHistoryContent === content) state.lastHistoryContent = "";
    hooks.renderHistoryMenu();
    hooks.broadcastStorage();
    return;
  }

  const index = hooks.loadHistoryIndex();
  // Fast path: nothing with this hash → no rewrite (avoids rematerializing the chain).
  if (!index.entries.some((e) => e.hash === hash)) {
    if (state.lastHistoryContent === content) state.lastHistoryContent = "";
    return;
  }

  /** @type {{ meta: object, content: string }[]} */
  const kept = [];
  let removed = false;
  for (let i = 0; i < index.entries.length; i++) {
    const entry = index.entries[i];
    if (entry.hash === hash) {
      removed = true;
      continue;
    }
    const text = await hooks.materializeHistoryEntry(i);
    // Abort rather than silently dropping unrebuildable revisions.
    if (text == null) return;
    if (contentHash(text) === hash || text === content) {
      removed = true;
      continue;
    }
    kept.push({ meta: entry, content: text });
  }

  if (state.lastHistoryContent === content) state.lastHistoryContent = "";
  if (!removed) return;

  const oldIds = index.entries.map((e) => e.id);
  if (!kept.length) {
    await clearHistoryBodies(oldIds);
    hooks.saveHistoryIndex({ generation: index.generation + 1, entries: [] });
    void setHistoryIndex({
      v: HISTORY_INDEX_VERSION,
      generation: index.generation + 1,
      entries: [],
    });
    hooks.renderHistoryMenu();
    hooks.broadcastStorage();
    return;
  }

  await rewriteHistoryChain(kept, index.generation + 1, oldIds);
  hooks.renderHistoryMenu();
  hooks.broadcastStorage();
}

/**
 * @param {{ meta: { id?: string, title?: string, savedAt?: number }, content: string }[]} kept
 * @param {number} generation
 * @param {string[]} pruneCandidateIds
 */
export async function rewriteHistoryChain(kept, generation, pruneCandidateIds) {
  const tipContent = kept[0].content;
  /** @type {Array<{ id: string, body: { patch?: string, content?: string } }>} */
  const revWrites = [];
  const entries = [
    {
      id: kept[0].meta.id || hooks.newHistoryId(),
      title: kept[0].meta.title || titleFromMarkdown(tipContent),
      savedAt: kept[0].meta.savedAt || Date.now(),
      hash: contentHash(tipContent),
      body: "tip",
    },
  ];
  let prev = tipContent;
  for (let i = 1; i < kept.length && entries.length < HISTORY_LIMIT; i++) {
    const c = kept[i].content;
    const id = kept[i].meta.id || hooks.newHistoryId();
    const made = makeRevisionBody(prev, c, PATCH_MAX_CHARS);
    revWrites.push({
      id,
      body: made.kind === "patch" ? { patch: made.patch } : { content: made.content },
    });
    entries.push({
      id,
      title: kept[i].meta.title || titleFromMarkdown(c),
      savedAt: kept[i].meta.savedAt || Date.now(),
      hash: contentHash(c),
      body: made.kind === "patch" ? "patch" : "full",
    });
    prev = c;
  }
  const keepRev = new Set(entries.slice(1).map((e) => e.id));
  const pruneIds = pruneCandidateIds.filter((id) => !keepRev.has(id));
  const ok = await commitHistoryBodies({
    generation,
    tipContent,
    revWrites,
    pruneIds,
    indexEntries: entries,
    indexVersion: HISTORY_INDEX_VERSION,
  });
  if (!ok) {
    hooks.saveLegacyHistory(
      kept.slice(0, HISTORY_LIMIT).map((k) => ({
        id: k.meta.id || hooks.newHistoryId(),
        title: k.meta.title || titleFromMarkdown(k.content),
        content: k.content,
        savedAt: k.meta.savedAt || Date.now(),
        hash: contentHash(k.content),
      })),
    );
    return;
  }
  hooks.saveHistoryIndex({ generation, entries });
}

export function acceptExternalContent() {
  const content = hooks.getMarkdownSource();
  state.preExternalSnapshot = null;
  hooks.setContentExternal(false);
  void hooks.persistDraft(content);
  void hooks.pushHistory(content);
  hooks.clearShareMarkdownFromUrl();
  // Accept establishes a clean baseline (share URL, upload, or OS / picker open).
  hooks.markCleanFromEditor();
  state.pendingExternalFromUrl = false;
  hooks.renderMarkdown(content);
  hooks.scheduleEditorHighlight();
}

export function rejectExternalContent() {
  const rejected = state.pendingExternalContent || hooks.getMarkdownSource();
  const snapshot = state.preExternalSnapshot;
  state.preExternalSnapshot = null;
  state.pendingExternalFromUrl = false;
  window.clearTimeout(state.historyTimer);
  void removeHistoryMatching(rejected);

  const restored = snapshot?.content ?? "";
  hooks.setContentExternal(false);
  hooks.setEditorValue(restored);
  state.lastHistoryContent = restored;

  if (snapshot) {
    state.currentFileHandle = snapshot.fileHandle;
    state.currentDriveFile = snapshot.driveFile ?? null;
    state.currentGistFile = snapshot.gistFile ?? null;
    state.currentFileName = snapshot.fileName;
    state.currentFilePath = snapshot.filePath;
    state.savedSnapshot = snapshot.savedSnapshot;
    state.currentFileRevision = snapshot.fileRevision ?? null;
    hooks.updateDocumentTitle();
    hooks.updateSaveButton();
    hooks.highlightActiveFileInTree();
    hooks.persistCurrentFileBinding();
  } else {
    hooks.clearCurrentFileBinding();
    hooks.markDirtyBaseline();
  }

  void hooks.persistDraft(restored);
  hooks.clearShareMarkdownFromUrl();
  hooks.renderMarkdown(restored);
  hooks.setView("edit", { syncUrl: false });
  hooks.showToast("External content rejected");
}

hooks.removeHistoryMatching = removeHistoryMatching;
hooks.rewriteHistoryChain = rewriteHistoryChain;
hooks.acceptExternalContent = acceptExternalContent;
hooks.rejectExternalContent = rejectExternalContent;
