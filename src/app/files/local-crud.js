import { hooks } from "../hooks.js";
import {
  state,
  gistEntries,
  fsEntries,
  expandedPaths
} from "../state.js";
import {
  ensureGistAccessToken,
  moveDraft,
  createFile,
  createFolder,
  readTextFileMeta,
  removeEntry,
  renameEntry,
  createDriveFileWithToken,
  createDriveFolderWithToken,
  renameDriveItemWithToken,
  trashDriveItemWithToken,
  createPrivateGist,
  deleteGist,
  joinFsPath,
  parentPathOf
} from "../vendor-deps.js";

export async function createUntitledDocument() {
  if (!hooks.confirmDiscardIfDirty()) return;
  await hooks.persistDraft(hooks.getMarkdownSource());
  hooks.setEditorValue("");
  hooks.clearCurrentFileBinding();
  await hooks.persistDraft("");
  hooks.renderMarkdown("");
  hooks.markDirtyBaseline();
  hooks.setContentExternal(false);
  hooks.showToast("New untitled document");
}

/**
 * @param {{ id?: string, kind?: string } | string | null} [target]
 * @returns {{ id: string, kind: "file"|"directory" } | null}
 */
export function normalizeFilesTarget(target = null) {
  if (target == null) {
    if (hooks.isCloudFilesSource()) return { id: "", kind: "directory" };
    return { id: state.selectedPath || "", kind: "directory" };
  }
  if (typeof target === "string") return { id: target, kind: "directory" };
  return {
    id: target.id || "",
    kind: target.kind === "file" ? "file" : "directory",
  };
}

/**
 * After creating an empty document, bind it and clear the editor.
 * @param {() => void} bind
 */
export async function openCreatedEmptyDocument(bind) {
  await hooks.persistDraft(hooks.getMarkdownSource());
  hooks.setEditorValue("");
  bind();
  await hooks.persistDraft("");
  hooks.renderMarkdown("");
  hooks.markCleanFromEditor();
  hooks.setContentExternal(false);
}

/**
 * @param {{ id?: string, kind?: string } | string | null} [target]
 */
export async function promptCreateFile(target = null) {
  const dest = normalizeFilesTarget(target);
  const raw = window.prompt("New file name", "untitled.md");
  if (raw == null) return;
  const name = hooks.normalizeEntryName(raw, "file");
  if (!name) {
    hooks.showToast("Use a .md, .txt, or .html name");
    return;
  }

  try {
    if (hooks.isGistFilesSource()) {
      if (!state.gistConnected) return;
      if (!hooks.confirmDiscardIfDirty()) return;
      const token = await ensureGistAccessToken();
      const created = await createPrivateGist(token, { filename: name, content: "" });
      await openCreatedEmptyDocument(() =>
        hooks.bindCurrentGistFile({
          gistId: created.id,
          filename: created.filename,
          updatedAt: created.updatedAt,
        }),
      );
      await hooks.refreshActiveFilesTree();
      hooks.showToast(`Created ${name}`);
      return;
    }
    if (hooks.isDriveFilesSource()) {
      if (!state.driveConnected) return;
      if (!hooks.confirmDiscardIfDirty()) return;
      const parentId = await hooks.resolveDriveCreateParentId(dest);
      const file = await createDriveFileWithToken({ name, content: "", parentId });
      await openCreatedEmptyDocument(() => hooks.bindCurrentDriveFile(file));
      await hooks.refreshActiveFilesTree();
      hooks.showToast(`Created ${name}`);
      return;
    }

    const dir = hooks.getTargetDirForCreate(dest?.id ?? state.selectedPath);
    if (!dir) {
      hooks.showToast("Open a folder first");
      return;
    }
    const handle = await createFile(dir, name, "");
    const createdMeta = await readTextFileMeta(handle);
    const basePath =
      dir === state.rootDirHandle ? "" : ([...fsEntries.entries()].find(([, e]) => e.handle === dir)?.[0] ?? "");
    if (basePath) expandedPaths.add(basePath);
    await hooks.refreshActiveFilesTree();
    const createdPath = joinFsPath(basePath, name);
    await openCreatedEmptyDocument(() => {
      hooks.bindCurrentFile(handle, name, createdPath);
      hooks.setCurrentFileRevision("fs", createdMeta.lastModified);
    });
    hooks.selectFsPath(createdPath);
    hooks.showToast(`Created ${name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    hooks.showToast(err?.message || "Could not create file");
  }
}

/**
 * @param {{ id?: string, kind?: string } | string | null} [target]
 */
export async function promptCreateFolder(target = null) {
  if (hooks.isGistFilesSource()) {
    hooks.showToast("Gists do not support folders");
    return;
  }
  const dest = normalizeFilesTarget(target);
  const raw = window.prompt("New folder name", hooks.isDriveFilesSource() ? "untitled" : "");
  if (raw == null) return;
  const name = hooks.normalizeEntryName(raw, "directory");
  if (!name) {
    hooks.showToast("Folder name required");
    return;
  }

  try {
    if (hooks.isDriveFilesSource()) {
      if (!state.driveConnected) return;
      const parentId = await hooks.resolveDriveCreateParentId(dest);
      await createDriveFolderWithToken(name, parentId);
      await hooks.refreshActiveFilesTree();
      hooks.showToast(`Created folder ${name}`);
      return;
    }

    const dir = hooks.getTargetDirForCreate(dest?.id ?? state.selectedPath);
    if (!dir) {
      hooks.showToast("Open a folder first");
      return;
    }
    await createFolder(dir, name);
    const basePath =
      dir === state.rootDirHandle ? "" : ([...fsEntries.entries()].find(([, e]) => e.handle === dir)?.[0] ?? "");
    if (basePath) expandedPaths.add(basePath);
    await hooks.refreshActiveFilesTree();
    hooks.showToast(`Created folder ${name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    hooks.showToast(err?.message || "Could not create folder");
  }
}

/** @param {string} id */
export async function promptRenameEntry(id) {
  const entry = hooks.getActiveTreeEntry(id);
  if (!entry) return;
  const next = window.prompt("Rename to", entry.name);
  if (next == null) return;
  const finalName = hooks.normalizeEntryName(next, entry.kind);
  if (!finalName) {
    if (entry.kind === "file") hooks.showToast("Use a .md, .txt, or .html name");
    return;
  }
  if (finalName === entry.name) return;

  try {
    if (hooks.isDriveFilesSource()) {
      const renamed = await renameDriveItemWithToken(id, finalName);
      if (state.currentDriveFile?.id === id) {
        const fromKey = hooks.currentDocKey();
        hooks.bindCurrentDriveFile({
          id: renamed.id,
          name: renamed.name || finalName,
          mimeType: renamed.mimeType,
        });
        const toKey = hooks.currentDocKey();
        if (fromKey !== toKey) {
          void moveDraft(fromKey, toKey);
          hooks.moveSavedSnapshot(fromKey, toKey);
        }
      }
      await hooks.refreshActiveFilesTree();
      hooks.showToast(`Renamed to ${finalName}`);
      return;
    }

    const fsEntry = fsEntries.get(id);
    if (!fsEntry || !fsEntry.parent) return;
    const wasCurrent = state.currentFileHandle === fsEntry.handle;
    const renamed = await renameEntry(fsEntry.parent, fsEntry.handle, finalName);
    if (id && expandedPaths.has(id)) {
      expandedPaths.delete(id);
      expandedPaths.add(joinFsPath(parentPathOf(id), finalName));
    }
    await hooks.refreshActiveFilesTree();
    if (wasCurrent) {
      const renamedPath = joinFsPath(parentPathOf(id), finalName);
      const fromKey = hooks.currentDocKey();
      hooks.bindCurrentFile(/** @type {FileSystemFileHandle} */ (renamed), finalName, renamedPath);
      try {
        const meta = await readTextFileMeta(/** @type {FileSystemFileHandle} */ (renamed));
        hooks.setCurrentFileRevision("fs", meta.lastModified);
      } catch {
        /* keep prior stamp if re-read fails */
      }
      const toKey = hooks.currentDocKey();
      if (fromKey !== toKey) {
        void moveDraft(fromKey, toKey);
        hooks.moveSavedSnapshot(fromKey, toKey);
      }
    }
    hooks.showToast(`Renamed to ${finalName}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    hooks.showToast(err?.message || "Could not rename");
  }
}

/** @param {string} id */
export async function promptDeleteEntry(id) {
  const entry = hooks.getActiveTreeEntry(id);
  if (!entry) return;
  const label = entry.kind === "directory" ? `folder "${entry.name}"` : `"${entry.name}"`;
  const detail = hooks.isGistFilesSource()
    ? "The entire gist will be deleted on GitHub."
    : hooks.isDriveFilesSource()
      ? "It will move to Google Drive trash."
      : "This cannot be undone.";
  if (!window.confirm(`Delete ${label}? ${detail}`)) return;

  try {
    if (hooks.isGistFilesSource()) {
      const entry = gistEntries.get(id);
      if (!entry) return;
      const token = await ensureGistAccessToken();
      await deleteGist(token, entry.gistId);
      if (state.currentGistFile?.gistId === entry.gistId) hooks.clearCurrentFileBinding();
      await hooks.refreshActiveFilesTree();
      hooks.showToast("Deleted");
      return;
    }
    if (hooks.isDriveFilesSource()) {
      await trashDriveItemWithToken(id);
      if (state.currentDriveFile?.id === id) hooks.clearCurrentFileBinding();
      await hooks.refreshActiveFilesTree();
      hooks.showToast("Deleted");
      return;
    }

    const fsEntry = fsEntries.get(id);
    if (!fsEntry || !fsEntry.parent) return;
    const currentPath =
      state.currentFilePath || [...fsEntries.entries()].find(([, e]) => e.handle === state.currentFileHandle)?.[0];
    const affectsCurrent =
      Boolean(currentPath) && (currentPath === id || currentPath.startsWith(`${id}/`));
    await removeEntry(fsEntry.parent, fsEntry.handle.name, true);
    expandedPaths.delete(id);
    for (const p of [...expandedPaths]) {
      if (p.startsWith(`${id}/`)) expandedPaths.delete(p);
    }
    await hooks.refreshActiveFilesTree();
    if (affectsCurrent) hooks.clearCurrentFileBinding();
    if (state.selectedPath === id || state.selectedPath.startsWith(`${id}/`)) hooks.selectFsPath("");
    hooks.showToast("Deleted");
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    hooks.showToast(err?.message || "Could not delete");
  }
}

hooks.createUntitledDocument = createUntitledDocument;
hooks.normalizeFilesTarget = normalizeFilesTarget;
hooks.openCreatedEmptyDocument = openCreatedEmptyDocument;
hooks.promptCreateFile = promptCreateFile;
hooks.promptCreateFolder = promptCreateFolder;
hooks.promptRenameEntry = promptRenameEntry;
hooks.promptDeleteEntry = promptDeleteEntry;
