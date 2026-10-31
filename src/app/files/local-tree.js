import { hooks } from "../hooks.js";
import {
  state,
  driveEntries,
  gistEntries,
  filesTree,
  fsEntries,
  expandedPaths,
  fsAccessSupported,
} from "../state.js";
import {
  ensureDriveAccessToken,
  readDriveFileWithMeta,
  ensureGistAccessToken,
  readGistFileWithMeta,
  moveDraft,
  ensureHandlePermission,
  listDirectory,
  openDirectory,
  readTextFileMeta,
  resolveFilePath,
  joinFsPath,
  parentPathOf,
} from "../vendor-deps.js";


export async function finishOpenDocument(name, seq = state.openDocumentSeq) {
  if (seq !== state.openDocumentSeq) return;
  await hooks.persistDraft(hooks.getMarkdownSource());
  if (seq !== state.openDocumentSeq) return;
  hooks.renderMarkdown(hooks.getMarkdownSource());
  await hooks.pushHistory(hooks.getMarkdownSource());
  if (seq !== state.openDocumentSeq) return;
  hooks.markCleanFromEditor();
  hooks.setContentExternal(false);
  hooks.highlightActiveFileInTree();
  hooks.showToast(`Loaded ${name}`);
}

export async function openDriveTreeFile(fileId) {
  const entry = driveEntries.get(fileId);
  if (!entry || entry.kind !== "file") return;
  if (state.currentDriveFile?.id === fileId && !hooks.isDirty()) {
    hooks.highlightActiveFileInTree();
    return;
  }
  if (!hooks.confirmDiscardIfDirty()) return;
  const seq = ++state.openDocumentSeq;
  try {
    await hooks.persistDraft(hooks.getMarkdownSource());
    if (seq !== state.openDocumentSeq) return;
    const token = await ensureDriveAccessToken();
    if (seq !== state.openDocumentSeq) return;
    const { text: content, meta } = await readDriveFileWithMeta(token, fileId);
    if (seq !== state.openDocumentSeq) return;
    hooks.setEditorValue(content);
    const fromKey = hooks.currentDocKey();
    hooks.bindCurrentDriveFile({
      id: entry.id,
      name: entry.name,
      mimeType: entry.mimeType,
      modifiedTime: meta.modifiedTime,
    });
    const toKey = hooks.currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      hooks.moveSavedSnapshot(fromKey, toKey);
    }
    // Mark clean under the new doc key before any further awaits so the same
    // hooks.confirmDiscardIfDirty() used by switch/disconnect is not a false positive.
    hooks.markCleanFromEditor();
    await finishOpenDocument(entry.name, seq);
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (seq !== state.openDocumentSeq) return;
    console.error(err);
    hooks.showToast(err?.message || "Could not open Drive file");
  }
}

export async function openGistTreeFile(entryId) {
  const entry = gistEntries.get(entryId);
  if (!entry || entry.kind !== "file") return;
  if (
    state.currentGistFile?.gistId === entry.gistId &&
    state.currentGistFile?.filename === entry.filename &&
    !hooks.isDirty()
  ) {
    hooks.highlightActiveFileInTree();
    return;
  }
  if (!hooks.confirmDiscardIfDirty()) return;
  const seq = ++state.openDocumentSeq;
  try {
    await hooks.persistDraft(hooks.getMarkdownSource());
    if (seq !== state.openDocumentSeq) return;
    const token = await ensureGistAccessToken();
    if (seq !== state.openDocumentSeq) return;
    const { content, updatedAt } = await readGistFileWithMeta(
      token,
      entry.gistId,
      entry.filename,
    );
    if (seq !== state.openDocumentSeq) return;
    hooks.setEditorValue(content);
    const fromKey = hooks.currentDocKey();
    hooks.bindCurrentGistFile({ gistId: entry.gistId, filename: entry.filename, updatedAt });
    const toKey = hooks.currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      hooks.moveSavedSnapshot(fromKey, toKey);
    }
    hooks.markCleanFromEditor();
    await finishOpenDocument(entry.filename, seq);
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (seq !== state.openDocumentSeq) return;
    console.error(err);
    hooks.showToast(err?.message || "Could not open Gist file");
  }
}

/** Activate a tree row (open file or enter/toggle directory). */
export async function activateFilesTreeEntry(id, kind) {
  if (hooks.isGistFilesSource()) {
    if (kind === "file") await openGistTreeFile(id);
    return;
  }
  if (hooks.isDriveFilesSource()) {
    if (kind === "directory") await hooks.enterDriveFolder(id);
    else await openDriveTreeFile(id);
    return;
  }
  if (kind === "directory") await toggleFsDirectory(id);
  else await openFsFile(id);
}

export function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} path
 * @param {HTMLUListElement} listEl
 */
export async function renderDirectoryChildren(dirHandle, path, listEl) {
  listEl.replaceChildren();
  const entries = await listDirectory(dirHandle);
  for (const entry of entries) {
    const childPath = joinFsPath(path, entry.name);
    fsEntries.set(childPath, {
      kind: entry.kind,
      handle: entry.handle,
      parent: dirHandle,
      path: childPath,
    });

    const isDir = entry.kind === "directory";
    const { li } = hooks.createFilesTreeItem({
      id: childPath,
      kind: entry.kind,
      name: entry.name,
      idAttr: "path",
      twistieText: isDir ? (expandedPaths.has(childPath) ? "▼" : "▶") : "•",
      twistieSpacer: !isDir,
    });
    if (isDir) li.setAttribute("aria-expanded", "false");

    if (isDir) {
      const childList = document.createElement("ul");
      childList.setAttribute("role", "group");
      childList.hidden = !expandedPaths.has(childPath);
      li.append(childList);
      if (expandedPaths.has(childPath)) {
        li.setAttribute("aria-expanded", "true");
        await renderDirectoryChildren(
          /** @type {FileSystemDirectoryHandle} */ (entry.handle),
          childPath,
          childList,
        );
      }
    }

    listEl.append(li);
  }
}

export async function renderFilesTree() {
  if (!filesTree || !state.rootDirHandle) return;
  fsEntries.clear();
  fsEntries.set("", {
    kind: "directory",
    handle: state.rootDirHandle,
    parent: null,
    path: "",
  });
  await renderDirectoryChildren(state.rootDirHandle, "", filesTree);
  hooks.highlightSelectedInTree();
  hooks.highlightActiveFileInTree();
}

export async function refreshFilesTree() {
  if (!state.rootDirHandle) return;
  // Cloud modes own the same #files-tree; do not paint local entries into it.
  if (hooks.isCloudFilesSource()) return;
  try {
    await renderFilesTree();
  } catch (err) {
    console.error(err);
    hooks.showToast("Could not refresh folder");
  }
}

export async function setRootDirectory(handle, { permissionOk = true } = {}) {
  state.rootDirHandle = handle;
  state.selectedDirHandle = handle;
  state.selectedPath = "";
  state.awaitingFsPermission = Boolean(handle) && !permissionOk;
  hooks.updateFilesChrome();
  if (permissionOk && handle) {
    await refreshFilesTree();
  } else if (filesTree && !hooks.isCloudFilesSource()) {
    filesTree.replaceChildren();
    fsEntries.clear();
  }
}

export async function pickOpenFolder() {
  if (!fsAccessSupported) return;
  try {
    const handle = await openDirectory();
    await setRootDirectory(handle, { permissionOk: true });
    hooks.showToast(`Opened ${handle.name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    hooks.showToast("Could not open folder");
  }
}

export async function regrantFolderPermission() {
  if (!state.rootDirHandle) return;
  try {
    const permission = await ensureHandlePermission(state.rootDirHandle, "readwrite");
    if (permission !== "granted") {
      hooks.showToast("Permission denied");
      return;
    }
    state.awaitingFsPermission = false;
    hooks.updateFilesChrome();
    await refreshFilesTree();
    if (state.currentFilePath) {
      for (let p = parentPathOf(state.currentFilePath); p; p = parentPathOf(p)) {
        expandedPaths.add(p);
      }
      await refreshFilesTree();
      const resolved = await resolveFilePath(state.rootDirHandle, state.currentFilePath);
      if (resolved) {
        hooks.bindCurrentFile(resolved, resolved.name || state.currentFileName, state.currentFilePath);
        hooks.selectFsPath(state.currentFilePath);
      }
    }
    hooks.showToast(`Opened ${state.rootDirHandle.name}`);
  } catch (err) {
    console.error(err);
    hooks.showToast("Could not access folder");
  }
}

export async function openFsFile(path) {
  const entry = fsEntries.get(path);
  if (!entry || entry.kind !== "file") return;
  if (state.currentFileHandle === entry.handle && !hooks.isDirty()) {
    hooks.selectFsPath(path);
    return;
  }
  if (!hooks.confirmDiscardIfDirty()) return;
  const seq = ++state.openDocumentSeq;
  try {
    // Persist the outgoing document under its own key before switching.
    await hooks.persistDraft(hooks.getMarkdownSource());
    if (seq !== state.openDocumentSeq) return;
    const { text, lastModified } = await readTextFileMeta(
      /** @type {FileSystemFileHandle} */ (entry.handle),
    );
    if (seq !== state.openDocumentSeq) return;
    hooks.setEditorValue(text);
    hooks.bindCurrentFile(/** @type {FileSystemFileHandle} */ (entry.handle), entry.handle.name, path);
    hooks.setCurrentFileRevision("fs", lastModified);
    hooks.selectFsPath(path);
    hooks.markCleanFromEditor();
    await finishOpenDocument(entry.handle.name, seq);
  } catch (err) {
    if (seq !== state.openDocumentSeq) return;
    console.error(err);
    hooks.showToast("Could not open file");
  }
}

export async function toggleFsDirectory(path) {
  const entry = fsEntries.get(path);
  if (!entry || entry.kind !== "directory") return;
  hooks.selectFsPath(path);
  const li = filesTree?.querySelector(`.files-tree-item[data-path="${cssEscape(path)}"]`);
  const childList = li?.querySelector(":scope > ul");
  if (!li || !childList) return;

  if (expandedPaths.has(path)) {
    expandedPaths.delete(path);
    childList.hidden = true;
    childList.replaceChildren();
    li.setAttribute("aria-expanded", "false");
    const twistie = li.querySelector(".files-tree-twistie");
    if (twistie) twistie.textContent = "▶";
    return;
  }

  expandedPaths.add(path);
  li.setAttribute("aria-expanded", "true");
  const twistie = li.querySelector(".files-tree-twistie");
  if (twistie) twistie.textContent = "▼";
  childList.hidden = false;
  try {
    await renderDirectoryChildren(
      /** @type {FileSystemDirectoryHandle} */ (entry.handle),
      path,
      childList,
    );
    hooks.highlightSelectedInTree();
    hooks.highlightActiveFileInTree();
  } catch (err) {
    expandedPaths.delete(path);
    console.error(err);
    hooks.showToast("Could not open folder");
  }
}

hooks.finishOpenDocument = finishOpenDocument;
hooks.openDriveTreeFile = openDriveTreeFile;
hooks.openGistTreeFile = openGistTreeFile;
hooks.activateFilesTreeEntry = activateFilesTreeEntry;
hooks.cssEscape = cssEscape;
hooks.renderDirectoryChildren = renderDirectoryChildren;
hooks.renderFilesTree = renderFilesTree;
hooks.refreshFilesTree = refreshFilesTree;
hooks.setRootDirectory = setRootDirectory;
hooks.pickOpenFolder = pickOpenFolder;
hooks.regrantFolderPermission = regrantFolderPermission;
hooks.openFsFile = openFsFile;
hooks.toggleFsDirectory = toggleFsDirectory;
