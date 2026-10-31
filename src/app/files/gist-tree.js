import { hooks } from "../hooks.js";
import {
  state,
  filesTree,
  gistPatModal,
  gistPatInput,
  gistEntries
} from "../state.js";
import { STORAGE_KEYS } from "../constants.js";
import {
  clearGistAccessToken,
  editableGistFiles,
  ensureGistAccessToken,
  hasSealedGistSession,
  isGistSessionMemoryOnly,
  listGists,
  prepareGistTokenVault,
  setGistPersonalAccessToken,
  tryRestoreGistAccessToken,
  unlockGistAccessToken,
  verifyGistToken
} from "../vendor-deps.js";

export function beginGistFilesLoading() {
  state.gistFilesLoading = true;
  if (filesTree) {
    filesTree.replaceChildren();
    filesTree.hidden = true;
  }
  hooks.updateFilesChrome();
}

export function endGistFilesLoading() {
  state.gistFilesLoading = false;
  hooks.updateFilesChrome();
}

export async function renderGistTree() {
  if (!hooks.isGistFilesSource() || !state.gistConnected) return;
  const token = await ensureGistAccessToken();
  const gists = await listGists(token);
  gistEntries.clear();
  const frag = document.createDocumentFragment();
  for (const gist of gists) {
    const files = editableGistFiles(gist);
    for (const file of files) {
      const id = hooks.gistEntryId(gist.id, file.filename);
      const label = gist.description
        ? `${file.filename} — ${gist.description}`
        : file.filename;
      gistEntries.set(id, {
        kind: "file",
        id,
        gistId: gist.id,
        filename: file.filename,
        name: label,
        description: gist.description || "",
        isPublic: gist.public,
      });
      const { li } = hooks.createFilesTreeItem({
        id,
        kind: "file",
        name: label,
        idAttr: "gistId",
        twistieSpacer: true,
      });
      frag.append(li);
    }
  }
  if (filesTree) {
    filesTree.replaceChildren(frag);
    filesTree.hidden = false;
  }
  hooks.highlightActiveFileInTree();
  hooks.updateFilesChrome();
}

export async function refreshGistTree() {
  if (!hooks.isGistFilesSource() || !state.gistConnected) return;
  beginGistFilesLoading();
  try {
    await renderGistTree();
  } catch (err) {
    console.error(err);
    if (err?.status === 401 || /401|auth|Bad credentials|token/i.test(String(err?.message || ""))) {
      clearGistAccessToken();
      state.gistConnected = false;
      gistEntries.clear();
      hooks.showToast("GitHub Gist session expired — connect again");
      return;
    }
    hooks.showToast(err?.message || "Could not refresh Gists");
  } finally {
    endGistFilesLoading();
  }
}

/**
 * @returns {Promise<string | null>} PAT or null if cancelled
 */
export function promptGistPersonalAccessToken() {
  return new Promise((resolve) => {
    if (!gistPatModal || typeof gistPatModal.showModal !== "function") {
      const raw = window.prompt("GitHub personal access token (gist scope)");
      resolve(raw == null ? null : String(raw).trim() || null);
      return;
    }
    if (gistPatInput) gistPatInput.value = "";
    const cancelBtn = gistPatModal.querySelector('button[value="cancel"]');
    const onCancel = () => {
      gistPatModal.close("cancel");
    };
    const onClose = () => {
      gistPatModal.removeEventListener("close", onClose);
      cancelBtn?.removeEventListener("click", onCancel);
      const value = gistPatModal.returnValue;
      if (value !== "connect") {
        resolve(null);
        return;
      }
      const token = String(gistPatInput?.value || "").trim();
      resolve(token || null);
    };
    cancelBtn?.addEventListener("click", onCancel);
    gistPatModal.addEventListener("close", onClose);
    gistPatModal.showModal();
    gistPatInput?.focus();
  });
}

export async function unlockGistAccessTokenSafe() {
  try {
    const token = await unlockGistAccessToken();
    return Boolean(token);
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") return false;
    throw err;
  }
}

export async function connectGithubGist() {
  if (!state.gistConfigured) return;
  if (!hooks.isBrowserOnline()) {
    hooks.updateFilesChrome();
    hooks.showToast("You need to be online to connect GitHub Gist");
    return;
  }
  try {
    if (!(await tryRestoreGistAccessToken())) {
      if (hasSealedGistSession()) {
        const unlocked = await unlockGistAccessTokenSafe();
        if (!unlocked) {
          hooks.showToast("Unlock cancelled — connect again to paste a new token");
          return;
        }
      } else {
        try {
          await prepareGistTokenVault();
        } catch (err) {
          if (err?.name === "AbortError" || err?.name === "NotAllowedError") throw err;
        }
        const pat = await promptGistPersonalAccessToken();
        if (!pat) return;
        await verifyGistToken(pat);
        await setGistPersonalAccessToken(pat);
      }
    }
    await ensureGistAccessToken();
    state.gistConnected = true;
    state.filesSource = "gist";
    try {
      localStorage.setItem(STORAGE_KEYS.filesSource, "gist");
    } catch {
      /* ignore */
    }
    beginGistFilesLoading();
    try {
      await renderGistTree();
    } finally {
      endGistFilesLoading();
    }
    if (isGistSessionMemoryOnly()) {
      hooks.showToast("Connected — Gists (session won’t survive refresh or closing this tab)");
    } else {
      hooks.showToast("Connected — Gists");
    }
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") return;
    console.error(err);
    state.gistConnected = false;
    endGistFilesLoading();
    const offlineish =
      !hooks.isBrowserOnline() ||
      err?.name === "TypeError" ||
      /Failed to fetch|NetworkError|ERR_INTERNET/i.test(String(err?.message || ""));
    hooks.showToast(
      offlineish
        ? "You need to be online to connect GitHub Gist"
        : err?.message || "Could not connect GitHub Gist",
    );
    hooks.updateFilesChrome();
  }
}

export async function disconnectGithubGist() {
  if (!state.gistConfigured) return;
  if (state.currentGistFile) {
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
  clearGistAccessToken();
  state.gistConnected = false;
  state.gistFilesLoading = false;
  gistEntries.clear();
  if (filesTree) {
    filesTree.replaceChildren();
    filesTree.hidden = true;
  }
  hooks.updateFilesChrome();
  hooks.showToast("Disconnected from GitHub Gist");
}

export function setFilesSource(next) {
  let source = "local";
  if (next === "drive" && state.driveConfigured) source = "drive";
  else if (next === "gist" && state.gistConfigured) source = "gist";
  state.filesSource = source;
  try {
    localStorage.setItem(STORAGE_KEYS.filesSource, state.filesSource);
  } catch {
    /* ignore */
  }
  if (state.filesSource === "drive") {
    state.gistFilesLoading = false;
    if (state.driveConnected) {
      hooks.beginDriveFilesLoading();
      void hooks.refreshActiveFilesTree();
    } else {
      state.driveFilesLoading = false;
      if (filesTree) {
        filesTree.replaceChildren();
        filesTree.hidden = true;
      }
      hooks.updateFilesChrome();
    }
  } else if (state.filesSource === "gist") {
    state.driveFilesLoading = false;
    if (state.gistConnected) {
      beginGistFilesLoading();
      void hooks.refreshActiveFilesTree();
    } else {
      state.gistFilesLoading = false;
      if (filesTree) {
        filesTree.replaceChildren();
        filesTree.hidden = true;
      }
      hooks.updateFilesChrome();
    }
  } else {
    state.driveFilesLoading = false;
    state.gistFilesLoading = false;
    hooks.updateFilesChrome();
    if (state.rootDirHandle && !state.awaitingFsPermission) {
      void hooks.refreshActiveFilesTree();
    }
  }
}

hooks.beginGistFilesLoading = beginGistFilesLoading;
hooks.endGistFilesLoading = endGistFilesLoading;
hooks.renderGistTree = renderGistTree;
hooks.refreshGistTree = refreshGistTree;
hooks.promptGistPersonalAccessToken = promptGistPersonalAccessToken;
hooks.unlockGistAccessTokenSafe = unlockGistAccessTokenSafe;
hooks.connectGithubGist = connectGithubGist;
hooks.disconnectGithubGist = disconnectGithubGist;
hooks.setFilesSource = setFilesSource;
