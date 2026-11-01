import { hooks } from "./hooks.js";
import {
  state
} from "./state.js";
import {
  STORAGE_KEYS,
  EMERGENCY_LS_MAX,
  STORAGE_CHANNEL
} from "./constants.js";
import {
  getDraft,
  requestPersistentStorage,
  setDraft,
  parseDraftMirror
} from "./vendor-deps.js";

export function currentDocKey() {
  if (state.currentGistFile?.gistId && state.currentGistFile?.filename) {
    return `gist:${state.currentGistFile.gistId}:${state.currentGistFile.filename}`;
  }
  if (state.currentDriveFile?.id) return `drive:${state.currentDriveFile.id}`;
  if (state.currentFilePath) return `path:${state.currentFilePath}`;
  if (state.currentFileName) return `name:${state.currentFileName}`;
  return "untitled";
}

/** @param {string} gistId @param {string} filename */
export function gistEntryId(gistId, filename) {
  return `${gistId}\0${filename}`;
}

export function readDraftMirror() {
  try {
    return parseDraftMirror(localStorage.getItem(STORAGE_KEYS.draft));
  } catch {
    return null;
  }
}

export function mirrorDraftToLocalStorage(content, docKey = currentDocKey()) {
  try {
    const text = String(content ?? "");
    if (text.length <= EMERGENCY_LS_MAX) {
      localStorage.setItem(
        STORAGE_KEYS.draft,
        JSON.stringify({ v: 1, docKey, content: text }),
      );
    } else {
      localStorage.removeItem(STORAGE_KEYS.draft);
    }
  } catch {
    /* quota */
  }
}

/** Persist draft to IndexedDB (primary) + small localStorage mirror, scoped by doc. */
export async function persistDraft(content) {
  if (state.contentIsExternal || state.guideSession) return;
  const text = String(content ?? hooks.getMarkdownSource());
  const docKey = currentDocKey();
  if (state.historyIdbReady) {
    await setDraft(text, docKey);
    void ensurePersistentStorage();
  }
  mirrorDraftToLocalStorage(text, docKey);
  broadcastStorage();
}

export function persistDraftFireAndForget(content) {
  void persistDraft(content);
}

export async function ensurePersistentStorage() {
  if (state.persistRequested || !state.historyIdbReady) return;
  state.persistRequested = true;
  await requestPersistentStorage();
}

export function broadcastStorage() {
  try {
    state.storageChannel?.postMessage({ type: "storage", t: Date.now() });
  } catch {
    /* ignore */
  }
}

export function setupStorageSync() {
  try {
    state.storageChannel = new BroadcastChannel(STORAGE_CHANNEL);
    state.storageChannel.onmessage = (event) => {
      if (event?.data?.type !== "storage") return;
      state.historyIndexCache = null;
      void hooks.hydrateHistoryIndexFromIdb().then(() => {
        void onRemoteStorageChange();
      });
    };
  } catch {
    state.storageChannel = null;
  }
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEYS.history) {
      state.historyIndexCache = null;
      void hooks.hydrateHistoryIndexFromIdb().then(() => {
        void onRemoteStorageChange();
      });
    } else if (event.key === STORAGE_KEYS.draft) {
      void onRemoteStorageChange(event.newValue ?? undefined);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushStorageBestEffort();
  });
  window.addEventListener("pagehide", flushStorageBestEffort);
}

export function flushStorageBestEffort() {
  if (state.contentIsExternal || state.applyingRemoteStorage || state.guideSession) return;
  const source = hooks.getMarkdownSource();
  const docKey = currentDocKey();
  mirrorDraftToLocalStorage(source, docKey);
  if (state.historyIdbReady) void setDraft(source, docKey);
}

export async function onRemoteStorageChange(mirrorRaw) {
  if (state.applyingRemoteStorage) return;
  state.applyingRemoteStorage = true;
  try {
    hooks.renderHistoryMenu();
    if (state.contentIsExternal || state.guideSession || hooks.isDirty()) return;
    const myKey = currentDocKey();
    let remote = null;
    let remoteKey = null;

    if (typeof mirrorRaw === "string") {
      const parsed = parseDraftMirror(mirrorRaw);
      if (parsed) {
        remote = parsed.content;
        remoteKey = parsed.docKey;
      }
    }

    if (remote == null && state.historyIdbReady) {
      const draft = await getDraft(myKey);
      if (draft) {
        remote = draft.content;
        remoteKey = draft.docKey;
      }
    }

    if (remote == null) {
      const mirrored = readDraftMirror();
      if (mirrored) {
        remote = mirrored.content;
        remoteKey = mirrored.docKey;
      }
    }

    if (remoteKey != null && remoteKey !== myKey) return;
    if (remote == null || remote === hooks.getMarkdownSource()) return;
    hooks.setEditorValue(remote);
    state.lastHistoryContent = remote;
    hooks.renderMarkdown(remote);
    hooks.updateSaveButton();
  } finally {
    state.applyingRemoteStorage = false;
  }
}

hooks.currentDocKey = currentDocKey;
hooks.gistEntryId = gistEntryId;
hooks.readDraftMirror = readDraftMirror;
hooks.mirrorDraftToLocalStorage = mirrorDraftToLocalStorage;
hooks.persistDraft = persistDraft;
hooks.persistDraftFireAndForget = persistDraftFireAndForget;
hooks.ensurePersistentStorage = ensurePersistentStorage;
hooks.broadcastStorage = broadcastStorage;
hooks.setupStorageSync = setupStorageSync;
hooks.flushStorageBestEffort = flushStorageBestEffort;
hooks.onRemoteStorageChange = onRemoteStorageChange;
