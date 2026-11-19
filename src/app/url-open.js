/**
 * Open Markdown from a URL (or file) without relaxing main-page CSP.
 */

import {
  addGithubCompatibleHost,
  classifyOpenUrl,
  githubContentsApiUrl,
  githubRawContentUrl,
  parseGithubFileUrl,
  readGithubCompatibleHosts,
  tokenAllowedFor,
  writeGithubCompatibleHosts,
} from "../url-fetch/github-url.js";
import { fileNameFromUrl, parseHttpsUrl } from "../url-fetch/url-fetch-api.js";
import { fetchViaUrlHelper } from "../url-fetch/url-fetch-client.js";
import { hooks } from "./hooks.js";
import {
  fileInput,
  openUrlConnectGithubBtn,
  openUrlDialog,
  openUrlDropZone,
  openUrlError,
  openUrlFallbackPanel,
  openUrlForm,
  openUrlHostInput,
  openUrlHostsList,
  openUrlInboxBtn,
  openUrlInboxLatestBtn,
  openUrlInput,
  openUrlLinkBtn,
  openUrlMainPanel,
  openUrlNeedAuth,
  openUrlOpenBtn,
  openUrlPickFileBtn,
  openUrlStatus,
  state,
} from "./state.js";
import {
  assertTokenNotSavedForOtherHost,
  ensureHandlePermission,
  findLatestEditableInDirectory,
  getGistAccessToken,
  getGithubHostToken,
  hasSealedGistSession,
  hasSealedGithubHostToken,
  isFsAccessSupported,
  loadStoredOpenInboxDirectory,
  pickOpenInboxDirectory,
  prepareGistTokenVault,
  readTextFileMeta,
  removeGithubHostToken,
  setGistPersonalAccessToken,
  setGithubHostToken,
  unlockGistAccessToken,
  unlockGithubHostToken,
} from "./vendor-deps.js";

const GITHUB_COM = "github.com";

/** @type {string} */
let pendingFallbackUrl = "";

/**
 * Load remote/external Markdown into the editor with the trust modal.
 * @param {{ text: string, name?: string, fromUrl?: boolean }} opts
 */
export function loadExternalUrlContent({ text, name = "", fromUrl = true }) {
  hooks.stashPreExternalState();
  state.pendingExternalFromUrl = Boolean(fromUrl);
  hooks.setEditorValue(text);
  hooks.bindCurrentUrlDocument(name || "Opened from URL");
  hooks.updateSaveButton();
  hooks.setContentExternal(true);
  if (state.currentView !== "edit") hooks.setView("edit", { syncUrl: false });
  if (name) hooks.showToast(`Loaded ${name}`);
}

/**
 * @param {boolean} show
 */
function setOpening(show) {
  if (openUrlOpenBtn) {
    openUrlOpenBtn.disabled = show;
    openUrlOpenBtn.textContent = show ? "Opening…" : "Open";
  }
  if (openUrlStatus) {
    openUrlStatus.hidden = !show;
    openUrlStatus.textContent = show ? "Opening…" : "";
  }
}

/**
 * @param {string} message
 */
function setDialogError(message) {
  if (!openUrlError) return;
  openUrlError.hidden = !message;
  openUrlError.textContent = message || "";
}

/**
 * @param {"main" | "fallback"} mode
 * @param {string} [url]
 */
function showPanel(mode, url = "") {
  if (openUrlMainPanel) openUrlMainPanel.hidden = mode !== "main";
  if (openUrlFallbackPanel) openUrlFallbackPanel.hidden = mode !== "fallback";
  pendingFallbackUrl = mode === "fallback" ? url : "";
  if (openUrlLinkBtn) {
    openUrlLinkBtn.hidden = !pendingFallbackUrl;
  }
  if (mode === "fallback" && openUrlNeedAuth) openUrlNeedAuth.hidden = true;
}

function renderHostsList() {
  if (!openUrlHostsList) return;
  const hosts = readGithubCompatibleHosts();
  openUrlHostsList.replaceChildren();
  for (const host of hosts) {
    const li = document.createElement("li");
    li.className = "open-url-host-item";
    const label = document.createElement("span");
    label.textContent = host;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn open-url-host-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      writeGithubCompatibleHosts(hosts.filter((h) => h !== host));
      removeGithubHostToken(host);
      renderHostsList();
    });
    li.append(label, remove);
    openUrlHostsList.append(li);
  }
}

async function refreshInboxButtons() {
  const supported = isFsAccessSupported();
  if (openUrlInboxBtn) openUrlInboxBtn.hidden = !supported;
  if (!openUrlInboxLatestBtn) return;
  if (!supported) {
    openUrlInboxLatestBtn.hidden = true;
    return;
  }
  const dir = await loadStoredOpenInboxDirectory();
  openUrlInboxLatestBtn.hidden = !dir;
}

/**
 * Token saved for exactly this host: the Gist token for github.com, otherwise
 * the per-host enterprise token. Never falls back to another host's token.
 * @param {string} host
 * @returns {Promise<string | null>}
 */
async function resolveTokenForHost(host) {
  const isGithubCom = host === GITHUB_COM;
  const existing = isGithubCom
    ? getGistAccessToken()
    : getGithubHostToken(host);
  if (existing) return existing;
  const sealed = isGithubCom
    ? hasSealedGistSession()
    : hasSealedGithubHostToken(host);
  if (!sealed) return null;
  try {
    return isGithubCom
      ? await unlockGistAccessToken()
      : await unlockGithubHostToken(host);
  } catch {
    return null;
  }
}

/**
 * @param {string} host
 */
function showNeedAuth(host) {
  if (openUrlConnectGithubBtn) {
    openUrlConnectGithubBtn.textContent =
      host === GITHUB_COM
        ? "Connect GitHub token"
        : `Connect token for ${host}`;
  }
  if (openUrlNeedAuth) openUrlNeedAuth.hidden = false;
}

/**
 * @param {string} urlString
 * @returns {Promise<"ok" | "need_auth" | "fallback" | "error">}
 */
export async function openMarkdownFromUrl(urlString) {
  const kind = classifyOpenUrl(urlString);
  if (kind === "invalid") {
    setDialogError("Enter an https:// URL");
    return "error";
  }
  if (kind === "auth-fallback") {
    showPanel("fallback", urlString);
    setDialogError("");
    return "fallback";
  }

  if (kind === "github") {
    return openGithubContentsUrl(urlString);
  }

  // Public https fetch via helper (includes raw.githubusercontent.com).
  try {
    setOpening(true);
    const result = await fetchViaUrlHelper(urlString);
    if (!hooks.confirmDiscardIfDirty()) return "error";
    closeOpenUrlDialog();
    loadExternalUrlContent({
      text: result.content,
      name: result.name || fileNameFromUrl(urlString),
      fromUrl: true,
    });
    hooks.clearShareMarkdownFromUrl();
    return "ok";
  } catch (err) {
    // Private raw.githubusercontent.com (401/403) → Contents API + PAT.
    if (err?.code === "unauthorized" && parseGithubFileUrl(urlString)) {
      setOpening(false);
      return openGithubContentsUrl(urlString);
    }
    // CORS / auth failures → guided download fallback.
    if (
      err?.code === "network" ||
      err?.code === "unauthorized" ||
      err?.code === "http_error"
    ) {
      showPanel("fallback", urlString);
      setDialogError("");
      return "fallback";
    }
    setDialogError(String(err?.message || "Could not open URL"));
    return "error";
  } finally {
    setOpening(false);
  }
}

/**
 * Open a github.com / GHE file URL: try public raw (github.com) or Contents API
 * without a token first; only prompt for a PAT on 401/403.
 * @param {string} urlString
 * @returns {Promise<"ok" | "need_auth" | "fallback" | "error">}
 */
async function openGithubContentsUrl(urlString) {
  const target = parseGithubFileUrl(urlString);
  if (!target) {
    setDialogError("Could not parse GitHub file URL");
    return "error";
  }

  /**
   * @param {{ content: string, name: string }} result
   * @returns {"ok" | "error"}
   */
  const finishOk = (result) => {
    if (!hooks.confirmDiscardIfDirty()) return "error";
    closeOpenUrlDialog();
    loadExternalUrlContent({
      text: result.content,
      name: result.name || target.name,
      fromUrl: true,
    });
    hooks.clearShareMarkdownFromUrl();
    return "ok";
  };

  try {
    setOpening(true);

    // Public github.com files: raw CDN first (no PAT, CORS-friendly).
    const rawUrl = githubRawContentUrl(target);
    if (rawUrl) {
      try {
        return finishOk(await fetchViaUrlHelper(rawUrl));
      } catch (err) {
        // Private / missing → Contents API (+ PAT if needed). Keep other errors.
        if (
          err?.code !== "unauthorized" &&
          err?.code !== "not_found" &&
          err?.code !== "network"
        ) {
          throw err;
        }
      }
    }

    const apiUrl = githubContentsApiUrl(target);
    const token = tokenAllowedFor(apiUrl, target.host)
      ? await resolveTokenForHost(target.host)
      : null;
    try {
      return finishOk(
        await fetchViaUrlHelper(
          apiUrl,
          token ? { authorization: `Bearer ${token}` } : undefined,
        ),
      );
    } catch (err) {
      // Unauthenticated private repos often look like 404; offer a PAT either way.
      if (
        err?.code === "unauthorized" ||
        (!token && err?.code === "not_found")
      ) {
        showNeedAuth(target.host);
        const site = target.host === GITHUB_COM ? "GitHub" : target.host;
        setDialogError(
          token
            ? `${site} returned unauthorized — check the token scopes (Contents read).`
            : err?.code === "not_found"
              ? `File not found, or the repository is private — connect a personal access token from ${site} with Contents access.`
              : `Connect a personal access token from ${site} that can read this repository (Contents).`,
        );
        return "need_auth";
      }
      throw err;
    }
  } catch (err) {
    setDialogError(String(err?.message || "Could not open GitHub URL"));
    return "error";
  } finally {
    setOpening(false);
  }
}

/**
 * Boot / deep-link entry: `#url=` / `?url=` when no md/mdz.
 * @returns {Promise<boolean>} true if remote Markdown was loaded into the editor
 */
export async function tryOpenUrlFromLocation() {
  const fromHash = new URLSearchParams(window.location.hash.slice(1));
  const fromSearch = new URLSearchParams(window.location.search);
  const urlParam = fromHash.get("url") || fromSearch.get("url");
  if (!urlParam) return false;

  // md/mdz take precedence (share-url already consumed them).
  if (
    fromHash.get("md") ||
    fromHash.get("mdz") ||
    fromSearch.get("md") ||
    fromSearch.get("mdz")
  ) {
    hooks.clearOpenUrlFromLocation();
    return false;
  }

  const kind = classifyOpenUrl(urlParam);
  if (kind === "invalid") {
    hooks.showToast("Invalid open URL");
    hooks.clearOpenUrlFromLocation();
    return false;
  }

  if (kind === "auth-fallback") {
    openOpenUrlDialog({ fallbackUrl: urlParam });
    hooks.clearOpenUrlFromLocation();
    return false;
  }

  const result = await openMarkdownFromUrl(urlParam);
  if (result === "ok") {
    hooks.clearOpenUrlFromLocation();
    return true;
  }
  openOpenUrlDialog({
    url: urlParam,
    fallbackUrl: result === "fallback" ? urlParam : "",
    preserveError: result === "error" || result === "need_auth",
  });
  hooks.clearOpenUrlFromLocation();
  return false;
}

/**
 * @param {{ url?: string, fallbackUrl?: string, preserveError?: boolean }} [opts]
 */
export function openOpenUrlDialog(opts = {}) {
  if (!openUrlDialog || typeof openUrlDialog.showModal !== "function") {
    void hooks.openLocalFileChooser();
    return;
  }
  showPanel(opts.fallbackUrl ? "fallback" : "main", opts.fallbackUrl || "");
  if (!opts.preserveError) setDialogError("");
  if (openUrlNeedAuth && !opts.preserveError) openUrlNeedAuth.hidden = true;
  if (openUrlInput) {
    openUrlInput.value = opts.url || opts.fallbackUrl || "";
  }
  renderHostsList();
  void refreshInboxButtons();
  if (!openUrlDialog.open) {
    openUrlDialog.returnValue = "";
    openUrlDialog.showModal();
  }
  if (!opts.fallbackUrl) openUrlInput?.focus();
}

export function closeOpenUrlDialog() {
  if (openUrlDialog?.open) {
    openUrlDialog.returnValue = "";
    openUrlDialog.close();
  }
  showPanel("main");
  setDialogError("");
  setOpening(false);
}

/** Unified Open entry (file or URL) — replaces bare file picker for Ctrl/Cmd+O. */
export function openUnifiedOpenDialog() {
  openOpenUrlDialog();
}

function setupOpenUrlDialog() {
  if (!openUrlDialog) return;

  openUrlForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = openUrlInput?.value?.trim() || "";
    if (!value) {
      setDialogError("Paste an https:// URL");
      return;
    }
    void openMarkdownFromUrl(value);
  });

  openUrlPickFileBtn?.addEventListener("click", () => {
    closeOpenUrlDialog();
    void hooks.openLocalFileChooser();
  });

  openUrlLinkBtn?.addEventListener("click", () => {
    const url = parseHttpsUrl(pendingFallbackUrl || openUrlInput?.value || "");
    if (!url) {
      hooks.showToast("No link to open");
      return;
    }
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  });

  const bindDropZone = (el) => {
    if (!el) return;
    el.addEventListener("dragover", (e) => {
      if (!hooks.isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      el.classList.add("is-dragover");
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("is-dragover");
    });
    el.addEventListener("drop", (e) => {
      if (!hooks.isFileDrag(e)) return;
      e.preventDefault();
      el.classList.remove("is-dragover");
      closeOpenUrlDialog();
      void hooks.handleDrop(e.dataTransfer);
    });
  };
  bindDropZone(openUrlDropZone);
  bindDropZone(document.getElementById("open-url-fallback-drop"));

  document
    .getElementById("open-url-add-host-btn")
    ?.addEventListener("click", () => {
      const host = openUrlHostInput?.value?.trim() || "";
      if (!addGithubCompatibleHost(host)) {
        hooks.showToast("Enter a hostname like github.example.com");
        return;
      }
      if (openUrlHostInput) openUrlHostInput.value = "";
      renderHostsList();
      hooks.showToast("Enterprise host saved in this browser");
    });

  openUrlConnectGithubBtn?.addEventListener("click", () => {
    void (async () => {
      const url = openUrlInput?.value?.trim() || "";
      const host = parseGithubFileUrl(url)?.host || GITHUB_COM;
      try {
        try {
          await prepareGistTokenVault();
        } catch (err) {
          if (err?.name === "AbortError" || err?.name === "NotAllowedError")
            return;
        }
        const pat = await hooks.promptGistPersonalAccessToken({ host });
        if (!pat) return;
        if (host === GITHUB_COM) {
          await assertTokenNotSavedForOtherHost(pat, GITHUB_COM);
          await setGistPersonalAccessToken(pat);
          hooks.showToast("GitHub token saved in this browser");
        } else {
          await setGithubHostToken(host, pat);
          hooks.showToast(`Token for ${host} saved in this browser`);
        }
        if (openUrlNeedAuth) openUrlNeedAuth.hidden = true;
        setDialogError("");
        if (url) await openMarkdownFromUrl(url);
      } catch (err) {
        if (err?.name === "AbortError" || err?.name === "NotAllowedError")
          return;
        if (err?.name === "TokenReuseError") {
          setDialogError(err.message);
          return;
        }
        hooks.showToast(err?.message || "Could not save GitHub token");
      }
    })();
  });

  openUrlInboxBtn?.addEventListener("click", async () => {
    try {
      const dir = await pickOpenInboxDirectory();
      if (!dir) return;
      hooks.showToast(`Inbox folder: ${dir.name}`);
      await refreshInboxButtons();
    } catch (err) {
      if (err?.name === "AbortError") return;
      hooks.showToast("Could not set inbox folder");
    }
  });

  openUrlInboxLatestBtn?.addEventListener("click", async () => {
    try {
      const dir = await loadStoredOpenInboxDirectory();
      if (!dir) {
        hooks.showToast("Choose an inbox folder first");
        return;
      }
      const permission = await ensureHandlePermission(dir, "read");
      if (permission !== "granted") {
        hooks.showToast("Allow access to the inbox folder");
        return;
      }
      const latest = await findLatestEditableInDirectory(dir);
      if (!latest) {
        hooks.showToast("No Markdown files in the inbox folder");
        return;
      }
      if (!hooks.confirmDiscardIfDirty()) return;
      const { text, lastModified } = await readTextFileMeta(latest.handle);
      closeOpenUrlDialog();
      hooks.loadExternalLocalFile({
        text,
        name: latest.name,
        handle: latest.handle,
        lastModified,
      });
    } catch (err) {
      console.error(err);
      hooks.showToast("Could not open inbox file");
    }
  });

  // Choose file inside fallback uses the hidden file input.
  document
    .getElementById("open-url-fallback-file-btn")
    ?.addEventListener("click", () => {
      closeOpenUrlDialog();
      fileInput?.click();
    });

  openUrlDialog.querySelectorAll('button[value="cancel"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      closeOpenUrlDialog();
    });
  });
}

setupOpenUrlDialog();

hooks.loadExternalUrlContent = loadExternalUrlContent;
hooks.openMarkdownFromUrl = openMarkdownFromUrl;
hooks.tryOpenUrlFromLocation = tryOpenUrlFromLocation;
hooks.openOpenUrlDialog = openOpenUrlDialog;
hooks.closeOpenUrlDialog = closeOpenUrlDialog;
hooks.openUnifiedOpenDialog = openUnifiedOpenDialog;
