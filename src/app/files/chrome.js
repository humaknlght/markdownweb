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
  drivePathLabel
} from "../state.js";
import {
  ensureEditableExtension,
  isEditableFileName,
  hasSealedDriveSession,
  hasSealedGistSession
} from "../vendor-deps.js";


export function isDriveFilesSource() {
  return state.driveConfigured && state.filesSource === "drive";
}

export function isGistFilesSource() {
  return state.gistConfigured && state.filesSource === "gist";
}

export function isCloudFilesSource() {
  return isDriveFilesSource() || isGistFilesSource();
}

/** @returns {Promise<void>} */
export async function refreshActiveFilesTree() {
  if (isDriveFilesSource()) await hooks.refreshDriveTree();
  else if (isGistFilesSource()) await hooks.refreshGistTree();
  else await hooks.refreshFilesTree();
}

/**
 * @param {Element} row
 * @returns {string}
 */
export function filesEntryIdFromRow(row) {
  return (
    row.getAttribute("data-gist-id") ||
    row.getAttribute("data-drive-id") ||
    row.getAttribute("data-path") ||
    ""
  );
}

/**
 * @param {string} id
 * @returns {{ id: string, name: string, kind: "file"|"directory" } | null}
 */
export function getActiveTreeEntry(id) {
  if (!id && isGistFilesSource()) {
    return { id: "", name: "Gists", kind: "directory" };
  }
  if (!id && !isDriveFilesSource()) {
    return state.rootDirHandle ? { id: "", name: state.rootDirHandle.name, kind: "directory" } : null;
  }
  if (isGistFilesSource()) {
    const entry = gistEntries.get(id);
    return entry ? { id: entry.id, name: entry.name, kind: "file" } : null;
  }
  if (isDriveFilesSource()) {
    const entry = driveEntries.get(id);
    return entry ? { id: entry.id, name: entry.name, kind: entry.kind } : null;
  }
  const entry = fsEntries.get(id);
  return entry ? { id, name: entry.handle.name, kind: entry.kind } : null;
}

/**
 * Shared tree row DOM for Local, Drive, and Gist listings.
 * @param {{
 *   id: string,
 *   kind: "file"|"directory",
 *   name: string,
 *   idAttr?: "path"|"driveId"|"gistId",
 *   twistieText?: string,
 *   twistieSpacer?: boolean,
 *   rowClass?: string,
 *   action?: string,
 * }} opts
 */

hooks.isDriveFilesSource = isDriveFilesSource;
hooks.isGistFilesSource = isGistFilesSource;
hooks.isCloudFilesSource = isCloudFilesSource;
hooks.refreshActiveFilesTree = refreshActiveFilesTree;
hooks.filesEntryIdFromRow = filesEntryIdFromRow;
hooks.getActiveTreeEntry = getActiveTreeEntry;
