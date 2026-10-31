import { hooks } from "../hooks.js";
import {
  state,
  filesOpenFileBtn,
  filesDrawerTitle,
  filesOpenFolderBtn,
  filesSourceLocalBtn,
  filesSourceDriveBtn,
  filesSourceGistBtn,
  filesConnectDriveBtn,
  filesConnectGistBtn,
  filesDriveOfflineHint,
  filesEmptyConnectBtn,
  filesEmptyConnectGistBtn,
  filesEmptyCopy,
  filesNewFileBtn,
  filesNewFolderBtn,
  filesRefreshBtn,
  filesEmpty,
  filesEmptyOpenBtn,
  filesLoading,
  filesLoadingCopy,
  filesPermission,
  filesTree,
  fsAccessSupported,
  driveEntries,
  gistEntries,
  fsEntries,
  drivePathLabel,
  DRIVE_ROOT_UI_NAME,
} from "../state.js";
import {
  ensureEditableExtension,
  isEditableFileName,
  hasSealedDriveSession,
  hasSealedGistSession
} from "../vendor-deps.js";

export function createFilesTreeItem(opts) {
  const idAttr =
    opts.idAttr ||
    (hooks.isGistFilesSource() ? "gistId" : hooks.isDriveFilesSource() ? "driveId" : "path");

  const li = document.createElement("li");
  li.className = "files-tree-item";
  li.setAttribute("role", "treeitem");
  li.dataset.kind = opts.kind;
  if (idAttr === "driveId") li.dataset.driveId = opts.id;
  else if (idAttr === "gistId") li.dataset.gistId = opts.id;
  else li.dataset.path = opts.id;

  const row = document.createElement("button");
  row.type = "button";
  row.className = `files-tree-row${opts.rowClass ? ` ${opts.rowClass}` : ""}`;
  row.dataset.kind = opts.kind;
  if (idAttr === "driveId") row.dataset.driveId = opts.id;
  else if (idAttr === "gistId") row.dataset.gistId = opts.id;
  else row.dataset.path = opts.id;
  if (opts.action) row.dataset.driveAction = opts.action;

  const twistie = document.createElement("span");
  twistie.className = "files-tree-twistie";
  if (opts.twistieSpacer) {
    twistie.classList.add("is-spacer");
    twistie.textContent = opts.twistieText || "•";
  } else {
    twistie.textContent = opts.twistieText || (opts.kind === "directory" ? "▶" : "");
  }

  const label = document.createElement("span");
  label.className = "files-tree-label";
  label.textContent = opts.name;

  row.append(twistie, label);
  li.append(row);
  return { li, row, twistie };
}

/**
 * @param {string} rawName
 * @param {"file"|"directory"} kind
 * @returns {string | null} final name, or null if invalid/cancelled upstream
 */
export function normalizeEntryName(rawName, kind) {
  const newName = String(rawName).trim();
  if (!newName) return null;
  if (kind === "file") {
    if (!isEditableFileName(ensureEditableExtension(newName))) return null;
    return ensureEditableExtension(newName);
  }
  return newName;
}

export function isBrowserOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Log-out (door + arrow) icon for the Drive disconnect control. */
const DRIVE_DISCONNECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></svg>`;

/** Cloud + inbound arrow icon for the Drive connect control. */
const DRIVE_CONNECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5.609 8A6.65 8.05 0 0 1 17.025 10.95h1.7a4.275 5.175 0 1 1 0 10.35H10.65A6.65 8.05 0 0 1 7.759 20.5" /><path d="M2 15h10" /><path d="m9 18 3-3-3-3" /></svg>`;

export function updateFilesChrome() {
  const driveMode = hooks.isDriveFilesSource();
  const gistMode = hooks.isGistFilesSource();
  const cloudMode = driveMode || gistMode;
  const hasLocalRoot = Boolean(state.rootDirHandle) && !state.awaitingFsPermission;
  const hasDriveRoot = state.driveConnected;
  const hasGistRoot = state.gistConnected;
  const hasRoot = driveMode ? hasDriveRoot : gistMode ? hasGistRoot : hasLocalRoot;
  const online = isBrowserOnline();
  const needsOnlineToConnect =
    (state.driveConfigured && driveMode && !hasDriveRoot && !online) ||
    (state.gistConfigured && gistMode && !hasGistRoot && !online);
  const cloudLoading = (driveMode && state.driveFilesLoading) || (gistMode && state.gistFilesLoading);

  document.body.classList.toggle("files-source-drive", driveMode);
  document.body.classList.toggle("files-source-gist", gistMode);
  document.body.classList.toggle("files-source-local", !cloudMode);

  if (filesSourceLocalBtn) {
    filesSourceLocalBtn.classList.toggle("is-active", !cloudMode);
    filesSourceLocalBtn.setAttribute("aria-pressed", !cloudMode ? "true" : "false");
  }
  if (filesSourceDriveBtn) {
    filesSourceDriveBtn.classList.toggle("is-active", driveMode);
    filesSourceDriveBtn.setAttribute("aria-pressed", driveMode ? "true" : "false");
  }
  if (filesSourceGistBtn) {
    filesSourceGistBtn.classList.toggle("is-active", gistMode);
    filesSourceGistBtn.setAttribute("aria-pressed", gistMode ? "true" : "false");
  }

  if (filesDrawerTitle) {
    if (gistMode) {
      filesDrawerTitle.textContent = state.gistConnected ? "Gists" : "GitHub Gist";
      filesDrawerTitle.title = filesDrawerTitle.textContent;
    } else if (driveMode) {
      filesDrawerTitle.textContent = state.driveConnected ? drivePathLabel() : "Google Drive";
      filesDrawerTitle.title = state.driveConnected ? drivePathLabel() : "Google Drive";
    } else {
      filesDrawerTitle.textContent = state.rootDirHandle ? `/${state.rootDirHandle.name}` : "Files";
      if (state.rootDirHandle) filesDrawerTitle.title = `/${state.rootDirHandle.name}`;
      else filesDrawerTitle.removeAttribute("title");
    }
  }

  if (filesEmptyCopy) {
    if (!cloudMode) {
      filesEmptyCopy.textContent = state.gistConfigured
        ? "Open a folder, or switch to Gist above to connect GitHub."
        : "Open a folder to browse Markdown, text, and HTML files.";
    } else if (gistMode) {
      filesEmptyCopy.textContent = needsOnlineToConnect
        ? "You need to be online to connect GitHub Gist."
        : "Connect with a GitHub personal access token to browse your gists.";
    } else if (needsOnlineToConnect) {
      filesEmptyCopy.textContent = "You need to be online to connect Google Drive.";
    } else {
      filesEmptyCopy.textContent = `Connect Google Drive to browse the ${DRIVE_ROOT_UI_NAME} folder.`;
    }
  }

  if (filesLoadingCopy) {
    filesLoadingCopy.textContent = gistMode ? "Loading Gists…" : "Loading Google Drive…";
  }
  if (filesLoading) {
    filesLoading.hidden = !cloudLoading;
  }
  if (filesEmpty) {
    filesEmpty.hidden =
      cloudLoading ||
      (driveMode
        ? hasDriveRoot
        : gistMode
          ? hasGistRoot
          : hasLocalRoot || state.awaitingFsPermission);
  }
  if (filesPermission) {
    filesPermission.hidden = cloudMode || !state.awaitingFsPermission;
  }
  if (filesTree) filesTree.hidden = cloudLoading || !hasRoot;
  if (filesNewFileBtn) filesNewFileBtn.disabled = false;
  if (filesNewFolderBtn) {
    filesNewFolderBtn.disabled = gistMode
      ? true
      : driveMode
        ? !hasDriveRoot
        : !hasLocalRoot;
  }
  if (filesRefreshBtn) {
    filesRefreshBtn.disabled = driveMode
      ? !hasDriveRoot
      : gistMode
        ? !hasGistRoot
        : !hasLocalRoot;
  }
  if (filesConnectDriveBtn) {
    filesConnectDriveBtn.hidden =
      !state.driveConfigured || !driveMode || (needsOnlineToConnect && driveMode && !hasDriveRoot);
    if (hasDriveRoot) {
      filesConnectDriveBtn.classList.add("svg-btn");
      filesConnectDriveBtn.innerHTML = DRIVE_DISCONNECT_ICON;
      filesConnectDriveBtn.title = "Disconnect Google Drive and\nclear your saved sign-in";
      filesConnectDriveBtn.setAttribute("aria-label", "Disconnect");
    } else if (hasSealedDriveSession()) {
      filesConnectDriveBtn.classList.remove("svg-btn");
      filesConnectDriveBtn.textContent = "Unlock Drive";
      filesConnectDriveBtn.title =
        "Use your passkey to restore\nyour saved Google Drive sign-in";
      filesConnectDriveBtn.setAttribute("aria-label", "Unlock Drive");
    } else {
      filesConnectDriveBtn.classList.add("svg-btn");
      filesConnectDriveBtn.innerHTML = DRIVE_CONNECT_ICON;
      filesConnectDriveBtn.title = "Connect Google Drive";
      filesConnectDriveBtn.setAttribute("aria-label", "Connect Drive");
    }
  }
  if (filesConnectGistBtn) {
    const gistOfflineBlock = gistMode && !hasGistRoot && !online;
    filesConnectGistBtn.hidden = !state.gistConfigured || !gistMode || gistOfflineBlock;
    if (hasGistRoot) {
      filesConnectGistBtn.classList.add("svg-btn");
      filesConnectGistBtn.innerHTML = DRIVE_DISCONNECT_ICON;
      filesConnectGistBtn.title = "Disconnect GitHub Gist and\nclear your saved token";
      filesConnectGistBtn.setAttribute("aria-label", "Disconnect Gist");
    } else if (hasSealedGistSession()) {
      filesConnectGistBtn.classList.remove("svg-btn");
      filesConnectGistBtn.textContent = "Unlock Gist";
      filesConnectGistBtn.title = "Use your passkey to restore\nyour saved GitHub Gist token";
      filesConnectGistBtn.setAttribute("aria-label", "Unlock Gist");
    } else {
      filesConnectGistBtn.classList.add("svg-btn");
      filesConnectGistBtn.innerHTML = DRIVE_CONNECT_ICON;
      filesConnectGistBtn.title = "Connect GitHub Gist";
      filesConnectGistBtn.setAttribute("aria-label", "Connect Gist");
    }
  }
  if (filesDriveOfflineHint) {
    filesDriveOfflineHint.hidden = !needsOnlineToConnect;
  }
  if (filesEmptyConnectBtn) {
    filesEmptyConnectBtn.hidden =
      !state.driveConfigured || !driveMode || hasDriveRoot || needsOnlineToConnect;
  }
  if (filesEmptyConnectGistBtn) {
    filesEmptyConnectGistBtn.hidden =
      !state.gistConfigured || !gistMode || hasGistRoot || needsOnlineToConnect;
  }
  if (filesEmptyOpenBtn) {
    filesEmptyOpenBtn.hidden = cloudMode;
  }
  if (filesOpenFileBtn) {
    filesOpenFileBtn.hidden = cloudMode;
  }
  if (filesOpenFolderBtn) {
    filesOpenFolderBtn.hidden = cloudMode || !fsAccessSupported;
  }
}

export function getTargetDirForCreate(preferredPath = state.selectedPath) {
  if (!state.rootDirHandle) return null;
  const entry = preferredPath ? fsEntries.get(preferredPath) : null;
  if (entry?.kind === "directory") return /** @type {FileSystemDirectoryHandle} */ (entry.handle);
  if (entry?.kind === "file" && entry.parent) return entry.parent;
  if (state.selectedDirHandle) return state.selectedDirHandle;
  return state.rootDirHandle;
}

export function selectFsPath(path) {
  state.selectedPath = path || "";
  const entry = state.selectedPath ? fsEntries.get(state.selectedPath) : null;
  if (entry?.kind === "directory") {
    state.selectedDirHandle = /** @type {FileSystemDirectoryHandle} */ (entry.handle);
  } else if (entry?.kind === "file" && entry.parent) {
    state.selectedDirHandle = entry.parent;
  } else {
    state.selectedDirHandle = state.rootDirHandle;
  }
  highlightSelectedInTree();
}

export function highlightSelectedInTree() {
  filesTree?.querySelectorAll(".files-tree-row.is-selected").forEach((el) => {
    el.classList.remove("is-selected");
  });
  if (!state.selectedPath) return;
  const row = filesTree?.querySelector(`.files-tree-row[data-path="${hooks.cssEscape(state.selectedPath)}"]`);
  row?.classList.add("is-selected");
}

export function highlightActiveFileInTree() {
  filesTree?.querySelectorAll(".files-tree-row.is-active-file").forEach((el) => {
    el.classList.remove("is-active-file");
  });
  if (hooks.isGistFilesSource() && state.currentGistFile?.gistId) {
    const id = hooks.gistEntryId(state.currentGistFile.gistId, state.currentGistFile.filename);
    const row = filesTree?.querySelector(
      `.files-tree-row[data-gist-id="${hooks.cssEscape(id)}"]`,
    );
    row?.classList.add("is-active-file");
    return;
  }
  if (hooks.isDriveFilesSource() && state.currentDriveFile?.id) {
    const row = filesTree?.querySelector(
      `.files-tree-row[data-drive-id="${hooks.cssEscape(state.currentDriveFile.id)}"]`,
    );
    row?.classList.add("is-active-file");
    return;
  }
  if (!state.currentFileName) return;
  if (state.currentFilePath) {
    const row = filesTree?.querySelector(`.files-tree-row[data-path="${hooks.cssEscape(state.currentFilePath)}"]`);
    row?.classList.add("is-active-file");
    return;
  }
  if (!state.currentFileHandle) return;
  for (const [path, entry] of fsEntries) {
    if (entry.kind === "file" && entry.handle === state.currentFileHandle) {
      const row = filesTree?.querySelector(`.files-tree-row[data-path="${hooks.cssEscape(path)}"]`);
      row?.classList.add("is-active-file");
      return;
    }
  }
}

hooks.createFilesTreeItem = createFilesTreeItem;
hooks.normalizeEntryName = normalizeEntryName;
hooks.isBrowserOnline = isBrowserOnline;
hooks.updateFilesChrome = updateFilesChrome;
hooks.getTargetDirForCreate = getTargetDirForCreate;
hooks.selectFsPath = selectFsPath;
hooks.highlightSelectedInTree = highlightSelectedInTree;
hooks.highlightActiveFileInTree = highlightActiveFileInTree;
