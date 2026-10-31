import { hooks } from "../hooks.js";
import {
  state,
  panes,
  fileInput,
  dropOverlay,
  filesToggleBtn,
  saveBtn,
  filesDrawer,
  filesBackdrop,
  filesOpenFolderBtn,
  filesSourceLocalBtn,
  filesSourceDriveBtn,
  filesSourceGistBtn,
  filesConnectDriveBtn,
  filesConnectGistBtn,
  filesEmptyConnectBtn,
  filesEmptyConnectGistBtn,
  filesNewFileBtn,
  filesNewFolderBtn,
  filesRefreshBtn,
  filesEmptyOpenBtn,
  filesRegrantBtn,
  filesReopenBtn,
  filesTree,
  filesContextMenu,
  fsAccessSupported,
  expandedPaths
} from "../state.js";
import {
  STORAGE_KEYS,
  TEXT_FILE_RE
} from "../constants.js";
import {
  clearStoredDirectory,
  openWithPicker,
  readTextFileMeta,
  restoreDirectory,
  loadStoredCurrentFileHandle,
  resolveFilePath,
  purgeLegacyCleartextToken,
  purgeLegacyGistCleartextToken,
  parentPathOf
} from "../vendor-deps.js";

export function loadExternalLocalFile({ text, name, handle = null, lastModified = null }) {
  hooks.stashPreExternalState();
  state.pendingExternalFromUrl = false;
  hooks.setEditorValue(text);
  hooks.bindCurrentFile(handle || null, name || "", "");
  if (handle && lastModified != null) hooks.setCurrentFileRevision("fs", lastModified);
  else if (!handle) hooks.clearCurrentFileRevision();
  hooks.selectFsPath("");
  // Real on-disk handle: opened content is the clean baseline (stays clean after Accept).
  if (handle) hooks.markCleanFromEditor();
  else hooks.updateSaveButton();
  hooks.setContentExternal(true);
  if (state.currentView !== "edit") hooks.setView("edit", { syncUrl: false });
  hooks.showToast(`Loaded ${name}`);
}

/**
 * Fallback open via `<input type="file">` (no writable handle).
 * @param {File} file
 */
export function handleFile(file) {
  if (!file) return;
  if (!TEXT_FILE_RE.test(file.name) && !file.type.startsWith("text/") && file.type !== "text/html") {
    hooks.showToast("Only Markdown, text, or HTML files are supported");
    return;
  }
  if (!hooks.confirmDiscardIfDirty()) return;
  const reader = new FileReader();
  reader.onload = () => {
    loadExternalLocalFile({
      text: String(reader.result ?? ""),
      name: file.name || "",
      handle: null,
    });
  };
  reader.onerror = () => hooks.showToast("Could not read file");
  reader.readAsText(file);
}

/**
 * Open via showOpenFilePicker when available; otherwise fall back to the file input.
 */
export async function openLocalFileChooser() {
  if (typeof window.showOpenFilePicker === "function") {
    try {
      if (!hooks.confirmDiscardIfDirty()) return;
      const picked = await openWithPicker();
      if (!picked) return;
      const name = picked.handle.name || "";
      if (!TEXT_FILE_RE.test(name)) {
        hooks.showToast("Only Markdown, text, or HTML files are supported");
        return;
      }
      loadExternalLocalFile({
        text: picked.text,
        name,
        handle: picked.handle,
        lastModified: picked.lastModified,
      });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error(err);
      hooks.showToast("Could not open file");
      return;
    }
  }
  fileInput?.click();
}

/**
 * Open a file launched via the OS / PWA File Handling API (FileSystemFileHandle).
 * @param {FileSystemFileHandle} fileHandle
 */
export async function openLaunchedFile(fileHandle) {
  if (!fileHandle || fileHandle.kind !== "file") return;
  const name = fileHandle.name || "";
  if (!TEXT_FILE_RE.test(name)) {
    hooks.showToast("Only Markdown, text, or HTML files are supported");
    return;
  }
  if (!hooks.confirmDiscardIfDirty()) return;
  try {
    const { text, lastModified } = await readTextFileMeta(fileHandle);
    loadExternalLocalFile({ text, name, handle: fileHandle, lastModified });
  } catch (err) {
    console.error(err);
    hooks.showToast("Could not open file");
  }
}

/** Register as consumer for OS “Open with” / default-app launches (installed PWA). */
export function setupFileHandling() {
  if (!("launchQueue" in window)) return;
  window.launchQueue.setConsumer((launchParams) => {
    const files = launchParams?.files;
    if (!files?.length) return;
    void openLaunchedFile(/** @type {FileSystemFileHandle} */ (files[0]));
  });
}

export function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

export function setupDragAndDrop() {
  // dragenter/dragleave also fire when crossing child elements, so count depth
  // instead of hiding the overlay on the first dragleave.
  let depth = 0;

  const reset = () => {
    depth = 0;
    dropOverlay.hidden = true;
  };

  window.addEventListener("dragenter", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth += 1;
    dropOverlay.hidden = false;
  });

  window.addEventListener("dragover", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (e) => {
    if (!isFileDrag(e)) return;
    depth -= 1;
    if (depth <= 0) reset();
  });

  window.addEventListener("drop", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    reset();
    void handleDrop(e.dataTransfer);
  });
}

/**
 * Prefer a FileSystemFileHandle from the drop (write-back capable); else FileReader.
 * @param {DataTransfer | null | undefined} dataTransfer
 */
export async function handleDrop(dataTransfer) {
  if (!dataTransfer) return;
  const items = dataTransfer.items;
  if (items?.length) {
    for (const item of items) {
      if (item.kind !== "file") continue;
      if (typeof item.getAsFileSystemHandle === "function") {
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle?.kind === "file") {
            await openLaunchedFile(/** @type {FileSystemFileHandle} */ (handle));
            return;
          }
        } catch (err) {
          console.error(err);
        }
      }
      break;
    }
  }
  handleFile(dataTransfer.files?.[0]);
}

hooks.loadExternalLocalFile = loadExternalLocalFile;
hooks.handleFile = handleFile;
hooks.openLocalFileChooser = openLocalFileChooser;
hooks.openLaunchedFile = openLaunchedFile;
hooks.setupFileHandling = setupFileHandling;
hooks.isFileDrag = isFileDrag;
hooks.setupDragAndDrop = setupDragAndDrop;
hooks.handleDrop = handleDrop;
