import { hooks } from "../hooks.js";
import {
  state,
  fsAccessSupported,
  fsEntries,
  expandedPaths,
  driveCurrentFolderId
} from "../state.js";
import {
  STORAGE_KEYS
} from "../constants.js";
import {
  createFile,
  ensureEditableExtension,
  readTextFileMeta,
  saveWithPicker,
  suggestedUntitledName,
  writeTextFile,
  createDriveFileWithToken,
  ensureDriveAccessToken,
  ensureDriveAppFolder,
  getDriveFileMeta,
  saveExistingDriveFile,
  createPrivateGist,
  ensureGistAccessToken,
  readGistFileWithMeta,
  updateGistFile,
  moveDraft,
  joinFsPath
} from "../vendor-deps.js";

export async function saveCurrentDocumentToDrive() {
  if (!state.driveConfigured) return;
  const text = hooks.getMarkdownSource();
  try {
    if (state.currentDriveFile?.id) {
      const token = await ensureDriveAccessToken();
      const meta = await getDriveFileMeta(token, state.currentDriveFile.id);
      if (
        !hooks.confirmOverwriteIfRemoteChanged(
          state.currentDriveFile.name || state.currentFileName || "This Drive file",
          meta.modifiedTime,
        )
      ) {
        return;
      }
      const saved = await saveExistingDriveFile(state.currentDriveFile.id, {
        name: state.currentDriveFile.name || state.currentFileName || suggestedUntitledName(text),
        content: text,
      });
      if (saved.modifiedTime) hooks.setCurrentFileRevision("drive", saved.modifiedTime);
      hooks.markCleanFromEditor();
      hooks.showToast(`Saved ${state.currentDriveFile.name || state.currentFileName}`);
      void hooks.refreshDriveTree();
      return;
    }

    if (!state.driveConnected) {
      await hooks.connectGoogleDrive();
      if (!state.driveConnected) return;
    }

    const suggestedName = suggestedUntitledName(text);
    const raw = window.prompt("Save to Google Drive as", suggestedName);
    if (raw == null) return;
    const name = ensureEditableExtension(raw, text);
    const parentId =
      driveCurrentFolderId() || (await ensureDriveAppFolder(await ensureDriveAccessToken()));
    const file = await createDriveFileWithToken({ name, content: text, parentId });
    const fromKey = hooks.currentDocKey();
    hooks.bindCurrentDriveFile(file);
    const toKey = hooks.currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      hooks.moveSavedSnapshot(fromKey, toKey);
    }
    hooks.markCleanFromEditor();
    state.filesSource = "drive";
    try {
      localStorage.setItem(STORAGE_KEYS.filesSource, "drive");
    } catch {
      /* ignore */
    }
    await hooks.refreshDriveTree();
    hooks.updateFilesChrome();
    hooks.showToast(`Saved ${file.name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    hooks.showToast(err?.message || "Could not save to Google Drive");
  }
}

export async function saveCurrentDocumentToGist() {
  if (!state.gistConfigured) return;
  const text = hooks.getMarkdownSource();
  try {
    if (state.currentGistFile?.gistId && state.currentGistFile?.filename) {
      const token = await ensureGistAccessToken();
      const remote = await readGistFileWithMeta(
        token,
        state.currentGistFile.gistId,
        state.currentGistFile.filename,
      );
      if (
        !hooks.confirmOverwriteIfRemoteChanged(
          state.currentGistFile.filename || "This gist",
          remote.updatedAt,
        )
      ) {
        return;
      }
      const saved = await updateGistFile(
        token,
        state.currentGistFile.gistId,
        state.currentGistFile.filename,
        text,
      );
      if (saved.updatedAt) hooks.setCurrentFileRevision("gist", saved.updatedAt);
      hooks.markCleanFromEditor();
      hooks.showToast(`Saved ${state.currentGistFile.filename}`);
      void hooks.refreshGistTree();
      return;
    }

    if (!state.gistConnected) {
      await hooks.connectGithubGist();
      if (!state.gistConnected) return;
    }

    const suggestedName = suggestedUntitledName(text);
    const raw = window.prompt("Save as private gist filename", suggestedName);
    if (raw == null) return;
    const filename = ensureEditableExtension(raw, text);
    const token = await ensureGistAccessToken();
    const created = await createPrivateGist(token, { filename, content: text });
    const fromKey = hooks.currentDocKey();
    hooks.bindCurrentGistFile({
      gistId: created.id,
      filename: created.filename,
      updatedAt: created.updatedAt,
    });
    const toKey = hooks.currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      hooks.moveSavedSnapshot(fromKey, toKey);
    }
    hooks.markCleanFromEditor();
    state.filesSource = "gist";
    try {
      localStorage.setItem(STORAGE_KEYS.filesSource, "gist");
    } catch {
      /* ignore */
    }
    await hooks.refreshGistTree();
    hooks.updateFilesChrome();
    hooks.showToast(`Saved ${created.filename}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    hooks.showToast(err?.message || "Could not save to GitHub Gist");
  }
}

export async function saveCurrentDocument() {
  const text = hooks.getMarkdownSource();
  const suggestedName = suggestedUntitledName(text);
  try {
    if (state.currentGistFile?.gistId || hooks.isGistFilesSource()) {
      await saveCurrentDocumentToGist();
      return;
    }
    if (state.currentDriveFile?.id || hooks.isDriveFilesSource()) {
      await saveCurrentDocumentToDrive();
      return;
    }

    if (!fsAccessSupported) {
      if (state.gistConfigured) {
        await saveCurrentDocumentToGist();
      } else if (state.driveConfigured) {
        await saveCurrentDocumentToDrive();
      }
      return;
    }

    if (state.currentFileHandle) {
      const file = await state.currentFileHandle.getFile();
      if (
        !hooks.confirmOverwriteIfRemoteChanged(
          state.currentFileName || state.currentFileHandle.name || "This file",
          String(file.lastModified),
        )
      ) {
        return;
      }
      await writeTextFile(state.currentFileHandle, text);
      const after = await state.currentFileHandle.getFile();
      hooks.setCurrentFileRevision("fs", after.lastModified);
      hooks.markCleanFromEditor();
      hooks.showToast(`Saved ${state.currentFileName || state.currentFileHandle.name}`);
      return;
    }

    const dir = hooks.getTargetDirForCreate();
    if (dir) {
      const raw = window.prompt("Save as file name", suggestedName);
      if (raw == null) return;
      const name = ensureEditableExtension(raw, text);
      const handle = await createFile(dir, name, text);
      const basePath = dir === state.rootDirHandle ? "" : ([...fsEntries.entries()].find(([, e]) => e.handle === dir)?.[0] ?? "");
      if (basePath) expandedPaths.add(basePath);
      await hooks.refreshFilesTree();
      const createdPath = joinFsPath(basePath, name);
      const fromKey = hooks.currentDocKey();
      hooks.bindCurrentFile(handle, name, createdPath);
      const createdMeta = await readTextFileMeta(handle);
      hooks.setCurrentFileRevision("fs", createdMeta.lastModified);
      const toKey = hooks.currentDocKey();
      if (fromKey !== toKey) {
        void moveDraft(fromKey, toKey);
        hooks.moveSavedSnapshot(fromKey, toKey);
      }
      hooks.markCleanFromEditor();
      hooks.selectFsPath(createdPath);
      hooks.showToast(`Saved ${name}`);
      return;
    }

    const handle = await saveWithPicker(suggestedName, text);
    if (!handle) {
      hooks.showToast("Open a folder to save, or use a supported browser");
      return;
    }
    const fromKey = hooks.currentDocKey();
    hooks.bindCurrentFile(handle, handle.name, "");
    const savedMeta = await readTextFileMeta(handle);
    hooks.setCurrentFileRevision("fs", savedMeta.lastModified);
    const toKey = hooks.currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      hooks.moveSavedSnapshot(fromKey, toKey);
    }
    hooks.markCleanFromEditor();
    hooks.showToast(`Saved ${handle.name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    hooks.showToast("Could not save");
  }
}

hooks.saveCurrentDocumentToDrive = saveCurrentDocumentToDrive;
hooks.saveCurrentDocumentToGist = saveCurrentDocumentToGist;
hooks.saveCurrentDocument = saveCurrentDocument;
