import { SAVED_SNAPSHOT_MAX_KEYS, STORAGE_KEYS } from "./constants.js";
import { hooks } from "./hooks.js";
import {
  currentFileEl,
  currentFileNameEl,
  fsAccessSupported,
  fsEntries,
  state,
} from "./state.js";
import { revisionStampChanged, storeCurrentFileHandle } from "./vendor-deps.js";

/** @type {Record<"fs"|"drive"|"gist"|"url", string>} */
const CONTENT_SOURCE_LABELS = {
  fs: "Local file",
  drive: "Google Drive",
  gist: "GitHub Gist",
  url: "Shared link",
};

export function isDirty() {
  // Clean only after a disk save/load or Accept of URL md/mdz content.
  // IDB auto-save does not clear dirty.
  return hooks.getMarkdownSource() !== state.savedSnapshot;
}

export function confirmDiscardIfDirty() {
  if (!isDirty()) return true;
  return window.confirm("You have unsaved changes. Discard them?");
}

/** @returns {"fs"|"drive"|"gist"|"url"|null} */
export function resolveContentSource() {
  if (
    state.contentSource === "fs" ||
    state.contentSource === "drive" ||
    state.contentSource === "gist" ||
    state.contentSource === "url"
  ) {
    return state.contentSource;
  }
  if (state.currentDriveFile) return "drive";
  if (state.currentGistFile) return "gist";
  if (state.currentFileHandle || state.currentFilePath) return "fs";
  return null;
}

export function updateDocumentTitle() {
  const base = "Markdown Editor";
  document.title = state.currentFileName
    ? `${state.currentFileName} · ${base}`
    : base;
  const source = resolveContentSource();
  const fileEl = currentFileEl || document.getElementById("current-file");
  const nameEl =
    currentFileNameEl || document.getElementById("current-file-name");
  if (nameEl) {
    nameEl.textContent = state.currentFileName || "";
  }
  if (fileEl) {
    const show = Boolean(state.currentFileName);
    fileEl.hidden = !show;
    // CSS shows the matching [data-source-icon] from this attribute.
    fileEl.dataset.source = show && source ? source : "";
    fileEl.title = show && source ? CONTENT_SOURCE_LABELS[source] : "";
  } else if (nameEl) {
    // Older cached markup only had #current-file-name.
    nameEl.hidden = !state.currentFileName;
  }
  if (state.speechActive) hooks.updateSpeechMediaSession();
}

/**
 * @returns {Record<string, string>}
 */
export function loadSavedSnapshotMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.savedSnapshot);
    if (raw == null) return {};
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.v === 1 &&
        parsed.byKey &&
        typeof parsed.byKey === "object"
      ) {
        /** @type {Record<string, string>} */
        const out = {};
        for (const [key, value] of Object.entries(parsed.byKey)) {
          if (typeof value === "string") out[key] = value;
        }
        return out;
      }
    } catch {
      /* legacy plain markdown snapshot */
    }
    return { untitled: raw };
  } catch {
    return {};
  }
}

/**
 * @param {string} [docKey]
 * @returns {string | null}
 */
export function readSavedSnapshot(docKey = hooks.currentDocKey()) {
  const map = loadSavedSnapshotMap();
  return Object.hasOwn(map, docKey) ? map[docKey] : null;
}

/**
 * @param {string} docKey
 * @param {string} content
 */
export function writeSavedSnapshot(docKey, content) {
  try {
    const map = loadSavedSnapshotMap();
    map[docKey] = content;
    const keys = Object.keys(map);
    if (keys.length > SAVED_SNAPSHOT_MAX_KEYS) {
      const drop = keys.filter((k) => k !== docKey && k !== "untitled");
      while (Object.keys(map).length > SAVED_SNAPSHOT_MAX_KEYS && drop.length) {
        delete map[drop.shift()];
      }
    }
    localStorage.setItem(
      STORAGE_KEYS.savedSnapshot,
      JSON.stringify({ v: 1, byKey: map }),
    );
  } catch {
    /* ignore quota */
  }
}

/**
 * @param {string} fromKey
 * @param {string} toKey
 */
export function moveSavedSnapshot(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  try {
    const map = loadSavedSnapshotMap();
    if (Object.hasOwn(map, fromKey)) {
      map[toKey] = map[fromKey];
      delete map[fromKey];
      localStorage.setItem(
        STORAGE_KEYS.savedSnapshot,
        JSON.stringify({ v: 1, byKey: map }),
      );
    }
  } catch {
    /* ignore */
  }
}

export function markCleanFromEditor() {
  // Call only after persisting to disk or accepting URL share / external content.
  state.savedSnapshot = hooks.getMarkdownSource();
  writeSavedSnapshot(hooks.currentDocKey(), state.savedSnapshot);
  hooks.updateSaveButton();
}

/** Untitled / draft baseline: any non-matching content counts as dirty. */
export function markDirtyBaseline() {
  state.savedSnapshot = "";
  hooks.updateSaveButton();
}

/**
 * @param {"fs"|"drive"|"gist"} source
 * @param {string | number | null | undefined} value
 */
export function setCurrentFileRevision(source, value) {
  const v = value == null ? "" : String(value);
  state.currentFileRevision = v ? { source, value: v } : null;
}

export function clearCurrentFileRevision() {
  state.currentFileRevision = null;
}

/**
 * Prompt when the remote copy changed since open / last save.
 * @param {string} label
 * @param {string | null | undefined} remoteValue
 * @returns {boolean} true when Save may proceed
 */
export function confirmOverwriteIfRemoteChanged(label, remoteValue) {
  if (!state.currentFileRevision) return true;
  if (!revisionStampChanged(state.currentFileRevision.value, remoteValue))
    return true;
  return window.confirm(
    `${label} changed since it was opened. Overwrite with your version?`,
  );
}

export function pathForHandle(fileHandle) {
  if (!fileHandle) return "";
  for (const [path, entry] of fsEntries) {
    if (entry.kind === "file" && entry.handle === fileHandle) return path;
  }
  return "";
}

export function persistCurrentFileBinding() {
  // Shared-link labels are session UI only — don't revive as a local file name.
  if (state.contentSource === "url") {
    try {
      localStorage.removeItem(STORAGE_KEYS.currentFile);
      localStorage.removeItem(STORAGE_KEYS.currentFilePath);
    } catch {
      /* ignore */
    }
    if (fsAccessSupported) void storeCurrentFileHandle(null);
    return;
  }
  try {
    if (state.currentFileName)
      localStorage.setItem(STORAGE_KEYS.currentFile, state.currentFileName);
    else localStorage.removeItem(STORAGE_KEYS.currentFile);
    if (state.currentFilePath)
      localStorage.setItem(STORAGE_KEYS.currentFilePath, state.currentFilePath);
    else localStorage.removeItem(STORAGE_KEYS.currentFilePath);
  } catch {
    /* ignore */
  }
  if (fsAccessSupported) {
    void storeCurrentFileHandle(state.currentFileHandle);
  }
}

export function clearCurrentFileBinding() {
  state.currentFileHandle = null;
  state.currentDriveFile = null;
  state.currentGistFile = null;
  state.currentFileName = "";
  state.currentFilePath = "";
  state.contentSource = null;
  clearCurrentFileRevision();
  updateDocumentTitle();
  hooks.updateSaveButton();
  hooks.highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/**
 * @param {FileSystemFileHandle|null} fileHandle
 * @param {string} [name]
 * @param {string} [path]
 */
export function bindCurrentFile(fileHandle, name, path = "") {
  state.currentDriveFile = null;
  state.currentGistFile = null;
  state.currentFileHandle = fileHandle;
  state.currentFileName = name || fileHandle?.name || "";
  state.currentFilePath = path || pathForHandle(fileHandle) || "";
  state.contentSource = "fs";
  // Revision stamp is set by the open/save caller (needs lastModified from getFile).
  if (!fileHandle) clearCurrentFileRevision();
  else if (state.currentFileRevision?.source !== "fs")
    clearCurrentFileRevision();
  // Do not reload savedSnapshot here — open/create paths set the editor first and
  // markClean afterward. Restoring a stale snap made rapid switches (and disconnect)
  // look dirty via the same confirmDiscardIfDirty() check.
  updateDocumentTitle();
  hooks.updateSaveButton();
  hooks.highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/**
 * @param {{ id: string, name: string, mimeType?: string, modifiedTime?: string }} file
 */
export function bindCurrentDriveFile(file) {
  state.currentFileHandle = null;
  state.currentFilePath = "";
  state.currentGistFile = null;
  state.currentDriveFile = {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
  };
  state.currentFileName = file.name || "";
  state.contentSource = "drive";
  if (file.modifiedTime) setCurrentFileRevision("drive", file.modifiedTime);
  else if (state.currentFileRevision?.source !== "drive")
    clearCurrentFileRevision();
  updateDocumentTitle();
  hooks.updateSaveButton();
  hooks.highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/**
 * @param {{ gistId: string, filename: string, updatedAt?: string }} file
 */
export function bindCurrentGistFile(file) {
  state.currentFileHandle = null;
  state.currentFilePath = "";
  state.currentDriveFile = null;
  state.currentGistFile = { gistId: file.gistId, filename: file.filename };
  state.currentFileName = file.filename || "";
  state.contentSource = "gist";
  if (file.updatedAt) setCurrentFileRevision("gist", file.updatedAt);
  else if (state.currentFileRevision?.source !== "gist")
    clearCurrentFileRevision();
  updateDocumentTitle();
  hooks.updateSaveButton();
  hooks.highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/**
 * Label for Markdown loaded from a share URL (`#md` / `#mdz`).
 * @param {string} [name]
 */
export function bindCurrentUrlDocument(name = "Shared document") {
  state.currentFileHandle = null;
  state.currentDriveFile = null;
  state.currentGistFile = null;
  state.currentFilePath = "";
  state.currentFileName = name;
  state.contentSource = "url";
  clearCurrentFileRevision();
  updateDocumentTitle();
  hooks.updateSaveButton();
  hooks.highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/** True after we have prompted for notification permission for Dock badging. */

/** Apple platforms tie installed-app icon badges to notification permission. */

hooks.isDirty = isDirty;
hooks.confirmDiscardIfDirty = confirmDiscardIfDirty;
hooks.updateDocumentTitle = updateDocumentTitle;
hooks.loadSavedSnapshotMap = loadSavedSnapshotMap;
hooks.readSavedSnapshot = readSavedSnapshot;
hooks.writeSavedSnapshot = writeSavedSnapshot;
hooks.moveSavedSnapshot = moveSavedSnapshot;
hooks.markCleanFromEditor = markCleanFromEditor;
hooks.markDirtyBaseline = markDirtyBaseline;
hooks.setCurrentFileRevision = setCurrentFileRevision;
hooks.clearCurrentFileRevision = clearCurrentFileRevision;
hooks.confirmOverwriteIfRemoteChanged = confirmOverwriteIfRemoteChanged;
hooks.pathForHandle = pathForHandle;
hooks.persistCurrentFileBinding = persistCurrentFileBinding;
hooks.clearCurrentFileBinding = clearCurrentFileBinding;
hooks.resolveContentSource = resolveContentSource;
hooks.bindCurrentFile = bindCurrentFile;
hooks.bindCurrentDriveFile = bindCurrentDriveFile;
hooks.bindCurrentGistFile = bindCurrentGistFile;
hooks.bindCurrentUrlDocument = bindCurrentUrlDocument;
