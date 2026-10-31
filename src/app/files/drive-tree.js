import { hooks } from "../hooks.js";
import {
  state,
  filesDrawerTitle,
  filesTree,
  DRIVE_ROOT_UI_NAME,
  driveEntries,
  driveCurrentFolderId,
  drivePathLabel
} from "../state.js";
import {
  STORAGE_KEYS
} from "../constants.js";
import {
  clearDriveAccessToken,
  ensureDriveAccessToken,
  ensureDriveAppFolder,
  getDriveAccessToken,
  isDriveSessionMemoryOnly,
  listDriveFolderChildren
} from "../vendor-deps.js";

export async function ensureDriveNavRoot(token) {
  const rootId = await ensureDriveAppFolder(token);
  if (!state.driveNavStack.length || state.driveNavStack[0].id !== rootId) {
    state.driveNavStack = [{ id: rootId, name: DRIVE_ROOT_UI_NAME }];
  } else {
    state.driveNavStack[0] = { id: rootId, name: DRIVE_ROOT_UI_NAME };
  }
  return rootId;
}

export async function renderDriveTree() {
  if (!filesTree) return;
  driveEntries.clear();

  const token = getDriveAccessToken();
  if (!token) return;

  await ensureDriveNavRoot(token);
  const folderId = driveCurrentFolderId();
  const { entries } = await listDriveFolderChildren(token, folderId);

  // Re-check after awaits: local restore must not leave a half-painted shared tree.
  if (!hooks.isDriveFilesSource() || !state.driveConnected) return;
  filesTree.replaceChildren();

  if (state.driveNavStack.length > 1) {
    const { li } = hooks.createFilesTreeItem({
      id: "",
      kind: "directory",
      name: `.. (${state.driveNavStack[state.driveNavStack.length - 2].name})`,
      idAttr: "driveId",
      twistieText: "◀",
      rowClass: "files-tree-up",
      action: "up",
    });
    filesTree.append(li);
  }

  for (const entry of entries) {
    driveEntries.set(entry.id, entry);
    const { li } = hooks.createFilesTreeItem({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      idAttr: "driveId",
      twistieText: entry.kind === "directory" ? "▶" : "",
    });
    filesTree.append(li);
  }

  if (filesDrawerTitle && hooks.isDriveFilesSource() && state.driveConnected) {
    filesDrawerTitle.textContent = drivePathLabel();
    filesDrawerTitle.title = drivePathLabel();
  }
  hooks.highlightActiveFileInTree();
}

export async function enterDriveFolder(folderId) {
  const entry = driveEntries.get(folderId);
  if (!entry || entry.kind !== "directory") return;
  state.driveNavStack.push({ id: entry.id, name: entry.name });
  await refreshDriveTree();
}

export async function leaveDriveFolder() {
  if (state.driveNavStack.length <= 1) return;
  state.driveNavStack.pop();
  await refreshDriveTree();
}

/**
 * @param {{ id?: string, kind?: string } | null} [target]
 * @returns {Promise<string>}
 */
export async function resolveDriveCreateParentId(target = null) {
  if (target?.kind === "directory" && target.id) {
    if (target.id !== driveCurrentFolderId()) {
      const entry = driveEntries.get(target.id);
      if (entry?.kind === "directory") {
        state.driveNavStack.push({ id: entry.id, name: entry.name });
      }
    }
    return target.id;
  }
  return driveCurrentFolderId() || (await ensureDriveAppFolder(await ensureDriveAccessToken()));
}

export function beginDriveFilesLoading() {
  state.driveFilesLoading = true;
  if (filesTree) {
    filesTree.replaceChildren();
    filesTree.hidden = true;
  }
  hooks.updateFilesChrome();
}

export function endDriveFilesLoading() {
  state.driveFilesLoading = false;
  hooks.updateFilesChrome();
}

export async function refreshDriveTree() {
  if (!hooks.isDriveFilesSource() || !state.driveConnected) return;
  beginDriveFilesLoading();
  try {
    await renderDriveTree();
  } catch (err) {
    console.error(err);
    if (err?.status === 401 || /401|auth|token/i.test(String(err?.message || ""))) {
      clearDriveAccessToken();
      state.driveConnected = false;
      state.driveNavStack = [];
      driveEntries.clear();
      hooks.showToast("Google Drive session expired — connect again");
      return;
    }
    hooks.showToast(err?.message || "Could not refresh Drive");
  } finally {
    endDriveFilesLoading();
  }
}

export async function connectGoogleDrive() {
  if (!state.driveConfigured) return;
  if (!hooks.isBrowserOnline()) {
    hooks.updateFilesChrome();
    hooks.showToast("You need to be online to connect Google Drive");
    return;
  }
  try {
    await ensureDriveAccessToken();
    state.driveConnected = true;
    state.filesSource = "drive";
    try {
      localStorage.setItem(STORAGE_KEYS.filesSource, "drive");
    } catch {
      /* ignore */
    }
    beginDriveFilesLoading();
    try {
      await renderDriveTree();
    } finally {
      endDriveFilesLoading();
    }
    if (isDriveSessionMemoryOnly()) {
      hooks.showToast(
        `Connected — ${DRIVE_ROOT_UI_NAME} (session won’t survive refresh or closing this tab)`,
      );
    } else {
      hooks.showToast(`Connected — ${DRIVE_ROOT_UI_NAME}`);
    }
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") return;
    console.error(err);
    state.driveConnected = false;
    endDriveFilesLoading();
    const offlineish =
      !hooks.isBrowserOnline() ||
      err?.name === "TypeError" ||
      /Failed to fetch|NetworkError|ERR_INTERNET/i.test(String(err?.message || ""));
    hooks.showToast(
      offlineish
        ? "You need to be online to connect Google Drive"
        : err?.message || "Could not connect Google Drive",
    );
    hooks.updateFilesChrome();
  }
}

export async function disconnectGoogleDrive() {
  if (!state.driveConfigured) return;
  // Closing a Drive-backed doc must happen before the token is cleared so Cancel
  // leaves the session intact, and so Save cannot reconnect to an orphaned binding.
  if (state.currentDriveFile) {
    if (!hooks.confirmDiscardIfDirty()) return;
    state.openDocumentSeq += 1;
    await hooks.persistDraft(hooks.getMarkdownSource());
    hooks.setEditorValue("");
    hooks.clearCurrentFileBinding();
    await hooks.persistDraft("");
    hooks.renderMarkdown("");
    hooks.markDirtyBaseline();
    hooks.setContentExternal(false);
  }
  clearDriveAccessToken();
  state.driveConnected = false;
  state.driveFilesLoading = false;
  state.driveNavStack = [];
  driveEntries.clear();
  if (filesTree) {
    filesTree.replaceChildren();
    filesTree.hidden = true;
  }
  hooks.updateFilesChrome();
  hooks.showToast("Disconnected from Google Drive");
}

hooks.ensureDriveNavRoot = ensureDriveNavRoot;
hooks.renderDriveTree = renderDriveTree;
hooks.enterDriveFolder = enterDriveFolder;
hooks.leaveDriveFolder = leaveDriveFolder;
hooks.resolveDriveCreateParentId = resolveDriveCreateParentId;
hooks.beginDriveFilesLoading = beginDriveFilesLoading;
hooks.endDriveFilesLoading = endDriveFilesLoading;
hooks.refreshDriveTree = refreshDriveTree;
hooks.connectGoogleDrive = connectGoogleDrive;
hooks.disconnectGoogleDrive = disconnectGoogleDrive;
