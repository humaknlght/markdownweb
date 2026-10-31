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


export function setupFilesDrawer() {
  // Drawer + outline are available everywhere; folder browsing needs FS Access.
  if (filesDrawer) {
    filesDrawer.hidden = false;
    filesDrawer.classList.toggle("has-fs", fsAccessSupported);
    filesDrawer.classList.toggle("has-drive", state.driveConfigured);
    filesDrawer.classList.toggle("has-gist", state.gistConfigured);
    filesDrawer.setAttribute("aria-label", "Files");
  }
  if (filesBackdrop) filesBackdrop.hidden = false;
  if (filesToggleBtn) {
    filesToggleBtn.hidden = false;
    hooks.syncFilesToggleLabel();
  }

  filesToggleBtn?.addEventListener("click", () => hooks.toggleFilesDrawer());
  filesBackdrop?.addEventListener("click", () => hooks.setFilesDrawerOpen(false));
  // On narrow layouts, drag the panes left over the drawer to dismiss it.
  panes.addEventListener("pointerdown", hooks.onDrawerCloseDragPointerDown, { passive: true });
  // Non-passive so we can preventDefault once the dismiss gesture is claimed.
  panes.addEventListener("pointermove", hooks.onDrawerCloseDragPointerMove);
  panes.addEventListener("pointerup", hooks.onDrawerCloseDragPointerUp, { passive: true });
  panes.addEventListener("pointercancel", hooks.onDrawerCloseDragPointerCancel, { passive: true });

  if (state.driveConfigured || state.gistConfigured) {
    if (state.driveConfigured) {
      document.querySelectorAll(".drive-only").forEach((el) => {
        el.hidden = false;
      });
    }
    if (state.gistConfigured) {
      document.querySelectorAll(".gist-only").forEach((el) => {
        el.hidden = false;
      });
    }
    document.querySelectorAll(".cloud-only").forEach((el) => {
      el.hidden = false;
    });
    const savedSource = localStorage.getItem(STORAGE_KEYS.filesSource);
    if (savedSource === "drive" && state.driveConfigured) state.filesSource = "drive";
    else if (savedSource === "gist" && state.gistConfigured) state.filesSource = "gist";
    else if (savedSource === "local") state.filesSource = "local";
    // Clear legacy plaintext; boot restore is memory-only (PRF Unlock after refresh).
    if (state.driveConfigured) {
      purgeLegacyCleartextToken();
      state.driveConnected = false;
    }
    if (state.gistConfigured) {
      purgeLegacyGistCleartextToken();
      state.gistConnected = false;
    }
    filesSourceLocalBtn?.addEventListener("click", () => hooks.setFilesSource("local"));
    filesSourceDriveBtn?.addEventListener("click", () => hooks.setFilesSource("drive"));
    filesSourceGistBtn?.addEventListener("click", () => hooks.setFilesSource("gist"));
    filesConnectDriveBtn?.addEventListener("click", () => {
      if (state.driveConnected) void hooks.disconnectGoogleDrive();
      else void hooks.connectGoogleDrive();
    });
    filesConnectGistBtn?.addEventListener("click", () => {
      if (state.gistConnected) void hooks.disconnectGithubGist();
      else void hooks.connectGithubGist();
    });
    filesEmptyConnectBtn?.addEventListener("click", () => void hooks.connectGoogleDrive());
    filesEmptyConnectGistBtn?.addEventListener("click", () => void hooks.connectGithubGist());
    window.addEventListener("online", () => hooks.updateFilesChrome());
    window.addEventListener("offline", () => hooks.updateFilesChrome());
  }

  if (fsAccessSupported || state.driveConfigured || state.gistConfigured) {
    if (saveBtn) {
      saveBtn.hidden = false;
      saveBtn.addEventListener("click", () => void hooks.saveCurrentDocument());
    }
    filesNewFileBtn?.addEventListener("click", () => void hooks.createUntitledDocument());
    filesNewFolderBtn?.addEventListener("click", () => void hooks.promptCreateFolder());
    filesRefreshBtn?.addEventListener("click", () => void hooks.refreshActiveFilesTree());

    filesTree?.addEventListener("click", (e) => {
      const row = e.target.closest(".files-tree-row");
      if (!row) return;
      if (row.getAttribute("data-drive-action") === "up") {
        void hooks.leaveDriveFolder();
        return;
      }
      if (hooks.isGistFilesSource()) {
        if (!state.gistConnected) return;
      } else if (hooks.isDriveFilesSource()) {
        if (!state.driveConnected) return;
      } else if (!fsAccessSupported) {
        return;
      }
      const id = hooks.filesEntryIdFromRow(row);
      const kind = /** @type {"file"|"directory"} */ (row.getAttribute("data-kind") || "file");
      if (!id && kind !== "directory") return;
      if (!hooks.isCloudFilesSource() && kind === "directory") hooks.selectFsPath(id);
      void hooks.activateFilesTreeEntry(id, kind);
    });

    filesTree?.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".files-tree-row");
      if (!row || !filesTree.contains(row)) return;
      if (row.getAttribute("data-drive-action") === "up") return;
      if (hooks.isGistFilesSource()) {
        if (!state.gistConnected) return;
      } else if (hooks.isDriveFilesSource()) {
        if (!state.driveConnected) return;
      } else if (!fsAccessSupported) {
        return;
      }
      const id = hooks.filesEntryIdFromRow(row);
      if (hooks.isCloudFilesSource() && !id) return;
      e.preventDefault();
      const kind = /** @type {"file"|"directory"} */ (row.getAttribute("data-kind") || "file");
      if (!hooks.isCloudFilesSource()) hooks.selectFsPath(id);
      hooks.openFilesContextMenu(e.clientX, e.clientY, { id, kind });
    });

    filesDrawer?.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".files-tree-row")) return;
      // Empty-area "new file/folder" menu is only for the files panel, not the outline.
      if (!e.target.closest(".files-section")) return;
      if (hooks.isGistFilesSource()) {
        if (!state.gistConnected) return;
      } else if (hooks.isDriveFilesSource()) {
        if (!state.driveConnected) return;
      } else if (!fsAccessSupported || !state.rootDirHandle || state.awaitingFsPermission) {
        return;
      }
      e.preventDefault();
      if (!hooks.isCloudFilesSource()) hooks.selectFsPath("");
      hooks.openFilesContextMenu(e.clientX, e.clientY, { id: "", kind: "directory" });
    });

    filesContextMenu?.addEventListener("click", (e) => {
      const item = e.target.closest("[data-fs-action]");
      if (!item) return;
      const action = item.getAttribute("data-fs-action");
      const target = state.contextTarget;
      hooks.closeFilesContextMenu();
      if (!target) return;
      if (action === "new-file") void hooks.promptCreateFile(target);
      else if (action === "new-folder") void hooks.promptCreateFolder(target);
      else if (action === "rename" && target.id) void hooks.promptRenameEntry(target.id);
      else if (action === "delete" && target.id) void hooks.promptDeleteEntry(target.id);
    });
  }

  if (fsAccessSupported) {
    document.querySelectorAll(".fs-only").forEach((el) => {
      el.hidden = false;
    });
    filesOpenFolderBtn?.addEventListener("click", () => void hooks.pickOpenFolder());
    filesEmptyOpenBtn?.addEventListener("click", () => void hooks.pickOpenFolder());
    filesReopenBtn?.addEventListener("click", () => void hooks.pickOpenFolder());
    filesRegrantBtn?.addEventListener("click", () => void hooks.regrantFolderPermission());
  }

  // Start collapsed per plan; ignore stale open preference for first paint safety —
  // still restore if user previously left it open.
  const savedOpen = localStorage.getItem(STORAGE_KEYS.filesDrawer) === "1";
  hooks.setFilesDrawerOpen(savedOpen, { persist: false });
  hooks.updateFilesChrome();
  hooks.updateSaveButton();
}

export async function restoreFilesDirectoryOnLoad() {
  if (!fsAccessSupported) return;
  try {
    const { handle, permission } = await restoreDirectory();
    if (!handle) return;
    if (permission === "granted") {
      await hooks.setRootDirectory(handle, { permissionOk: true });
    } else {
      await hooks.setRootDirectory(handle, { permissionOk: false });
      hooks.setFilesDrawerOpen(true, { persist: false });
    }
  } catch (err) {
    console.error(err);
    await clearStoredDirectory();
  }
}

/**
 * Restore the previously open file name / handle after a reload.
 * Keeps the draft in the editor; only re-binds identity for title + Save.
 */
export async function restoreCurrentFileBindingOnLoad() {
  let savedName = "";
  let savedPath = "";
  try {
    savedName = localStorage.getItem(STORAGE_KEYS.currentFile) || "";
    savedPath = localStorage.getItem(STORAGE_KEYS.currentFilePath) || "";
  } catch {
    /* ignore */
  }

  if (
    !hooks.isDriveFilesSource() &&
    fsAccessSupported &&
    state.rootDirHandle &&
    !state.awaitingFsPermission &&
    savedPath
  ) {
    for (let p = parentPathOf(savedPath); p; p = parentPathOf(p)) {
      expandedPaths.add(p);
    }
    try {
      await hooks.refreshFilesTree();
      const resolved = await resolveFilePath(state.rootDirHandle, savedPath);
      if (resolved) {
        hooks.bindCurrentFile(resolved, resolved.name || savedName, savedPath);
        hooks.selectFsPath(savedPath);
        return;
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (fsAccessSupported) {
    try {
      const handle = await loadStoredCurrentFileHandle();
      if (handle) {
        hooks.bindCurrentFile(handle, handle.name || savedName, savedPath);
        return;
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (savedName) {
    hooks.bindCurrentFile(null, savedName, savedPath);
  }
}

/**
 * Load local file content into the editor as external (Accept/Reject) content.
 * When a FileSystemFileHandle is provided, bind it and mark clean so Save can write back.
 * @param {{ text: string, name: string, handle?: FileSystemFileHandle|null, lastModified?: number|null }} opts
 */

hooks.setupFilesDrawer = setupFilesDrawer;
hooks.restoreFilesDirectoryOnLoad = restoreFilesDirectoryOnLoad;
hooks.restoreCurrentFileBindingOnLoad = restoreCurrentFileBindingOnLoad;
