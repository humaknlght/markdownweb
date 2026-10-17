/**
 * Main-app Google Drive bridge: auth via COEP-free helper popup, then Drive REST
 * on the main page (drawer listing + open/save). Scoped to the markdown-editor folder.
 * Access tokens are sealed at rest with WebAuthn PRF (see drive-token-vault.js).
 */

import {
  DRIVE_AUTH_CHANNEL,
  DRIVE_HELPER_PATH,
  createDriveFile,
  createDriveFolder,
  isDriveMessage,
  renameDriveItem,
  trashDriveItem,
  updateDriveFile,
} from "./google-drive-api.js";
import { isGoogleDriveConfigured } from "./google-drive-config.js";
import {
  clearVaultStorage,
  ensureIdbVaultKey,
  ensureVaultKey,
  getCachedVaultKey,
  hasSealedDriveSession,
  purgeLegacyCleartextToken,
  readVaultMeta,
  sealToken,
  setCachedVaultKey,
  unsealToken,
} from "./drive-token-vault.js";

export {
  DRIVE_DEFAULT_FOLDER_NAME,
  createDriveFolder,
  listDriveAppFolder,
  listDriveAppFiles,
  listDriveFolderChildren,
  readDriveFileText,
  ensureDriveAppFolder,
} from "./google-drive-api.js";

export { hasSealedDriveSession } from "./drive-token-vault.js";

/** Drop tokens this early so a refresh near expiry does not use a dead token. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TTL_SEC = 3600;

/** @type {string | null} */
let accessToken = null;

/** True when the last connect could not seal (PRF unavailable) — memory-only. */
let memoryOnlySession = false;

/**
 * @returns {boolean}
 */
export function googleDriveEnabled() {
  return isGoogleDriveConfigured();
}

/**
 * In-memory token only (no silent localStorage restore — that requires WebAuthn).
 * @returns {string | null}
 */
export function getDriveAccessToken() {
  return accessToken;
}

/**
 * @param {string | null} token
 * @param {number} [expiresInSec]
 */
export function setDriveAccessToken(token, expiresInSec) {
  if (!token) {
    clearDriveAccessToken();
    return;
  }
  void persistDriveSession(token, expiresInSec);
}

export function clearDriveAccessToken() {
  accessToken = null;
  memoryOnlySession = false;
  setCachedVaultKey(null);
  clearVaultStorage();
}

/**
 * @deprecated Sync clear-text restore removed; use unlockDriveAccessToken / ensureDriveAccessToken.
 * Kept as a no-op false so callers that still import it do not silently load plaintext.
 * @returns {boolean}
 */
export function restoreDriveAccessToken() {
  purgeLegacyCleartextToken();
  return Boolean(accessToken);
}

/**
 * @param {string} token
 * @param {number} [expiresInSec]
 * @returns {Promise<{ sealed: boolean }>}
 */
async function persistDriveSession(token, expiresInSec) {
  accessToken = token;
  const ttlSec = Math.max(60, Number(expiresInSec) || DEFAULT_TOKEN_TTL_SEC);
  const expiresAt = Date.now() + ttlSec * 1000 - TOKEN_EXPIRY_SKEW_MS;

  const key = getCachedVaultKey();
  const meta = readVaultMeta();
  if (!key || !meta) {
    memoryOnlySession = true;
    return { sealed: false };
  }

  try {
    await sealToken(token, expiresAt, key, meta);
    memoryOnlySession = false;
    return { sealed: true };
  } catch {
    memoryOnlySession = true;
    return { sealed: false };
  }
}

/**
 * Silent restore for IndexedDB-sealed sessions (no user gesture).
 * PRF-backed vaults need Connect/Unlock and are skipped here.
 * @returns {Promise<boolean>}
 */
export async function tryRestoreDriveAccessToken() {
  if (accessToken) return true;
  purgeLegacyCleartextToken();
  if (!hasSealedDriveSession()) return false;
  const meta = readVaultMeta();
  if (!meta || meta.kind !== "idb") return false;
  try {
    const { key } = await ensureIdbVaultKey();
    const opened = await unsealToken(key);
    if (!opened?.token) {
      clearVaultStorage();
      return false;
    }
    accessToken = opened.token;
    memoryOnlySession = false;
    setCachedVaultKey(key);
    return true;
  } catch (err) {
    console.warn("[google-drive] silent sealed restore failed", err);
    return false;
  }
}

/**
 * Unlock a sealed session (IDB or WebAuthn PRF). PRF requires a user gesture.
 * @returns {Promise<string | null>} access token or null if none / cancelled / failed
 */
export async function unlockDriveAccessToken() {
  if (accessToken) return accessToken;
  purgeLegacyCleartextToken();
  if (!hasSealedDriveSession()) return null;

  const meta = readVaultMeta();
  if (!meta) {
    clearVaultStorage();
    return null;
  }

  try {
    const { key } = await ensureVaultKey();
    const opened = await unsealToken(key);
    if (!opened?.token) {
      clearVaultStorage();
      return null;
    }
    accessToken = opened.token;
    memoryOnlySession = false;
    return accessToken;
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") throw err;
    if (err?.name === "NotSupportedError") {
      memoryOnlySession = true;
      return null;
    }
    clearVaultStorage();
    return null;
  }
}

/** Abort for the auth attempt still waiting on a popup, if any. */
let abortPendingAuth = null;

const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

function abortError() {
  return Object.assign(new Error("Cancelled"), { name: "AbortError" });
}

/**
 * Results arrive over a same-origin BroadcastChannel instead of postMessage:
 * Google's sign-in page sends COOP, so after the popup visits it the opener
 * link is reported (and may later be severed). For the same reason
 * popup.closed is only polled until the helper leaves for Google.
 * @returns {Promise<{ action: string, accessToken?: string, expiresIn?: number, sealed?: boolean }>}
 */
function openDriveAuthHelper() {
  return new Promise((resolve, reject) => {
    if (!isGoogleDriveConfigured()) {
      reject(new Error("Google Drive is not configured"));
      return;
    }

    abortPendingAuth?.();

    const req = crypto.randomUUID();
    const url = new URL(DRIVE_HELPER_PATH, window.location.href);
    url.searchParams.set("mode", "auth");
    url.searchParams.set("req", req);

    const popup = window.open(
      url.href,
      "md-google-drive",
      "width=520,height=640,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      reject(new Error("Popup blocked — allow popups for this site to use Google Drive"));
      return;
    }

    const channel = new BroadcastChannel(DRIVE_AUTH_CHANNEL);
    let settled = false;
    let closedPoll = 0;

    const stopClosedPoll = () => {
      if (closedPoll) window.clearInterval(closedPoll);
      closedPoll = 0;
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      stopClosedPoll();
      window.clearTimeout(timeout);
      channel.close();
      if (abortPendingAuth === abort) abortPendingAuth = null;
      fn(value);
    };

    const abort = () => finish(reject, abortError());
    abortPendingAuth = abort;

    /** @param {MessageEvent} event */
    channel.onmessage = (event) => {
      const msg = event.data;
      if (!isDriveMessage(msg) || msg.req !== req) return;

      if (msg.action === "redirecting") {
        stopClosedPoll();
        return;
      }

      if (msg.action === "cancel") {
        abort();
        return;
      }

      if (msg.action === "error") {
        finish(reject, new Error(msg.error || "Google Drive error"));
        return;
      }

      if (msg.action === "auth") {
        void (async () => {
          let sealed = false;
          if (msg.accessToken) {
            const result = await persistDriveSession(msg.accessToken, msg.expiresIn);
            sealed = result.sealed;
          }
          finish(resolve, {
            action: msg.action,
            accessToken: msg.accessToken,
            expiresIn: msg.expiresIn,
            sealed,
          });
        })();
      }
    };

    // Closing the popup on Google's page goes unnoticed; Connect Drive again
    // supersedes this attempt, and the timeout releases it eventually.
    const timeout = window.setTimeout(abort, AUTH_TIMEOUT_MS);

    let closeSeenAt = 0;
    closedPoll = window.setInterval(() => {
      if (!popup.closed) {
        closeSeenAt = 0;
        return;
      }
      if (!closeSeenAt) {
        closeSeenAt = Date.now();
        return;
      }
      if (Date.now() - closeSeenAt < 500) return;
      abort();
    }, 100);
  });
}

/**
 * Prepare WebAuthn vault key under the current user gesture (before OAuth popup).
 * Soft-fails to memory-only when PRF is unavailable.
 * @returns {Promise<{ ready: boolean, reason?: string }>}
 */
export async function prepareDriveTokenVault() {
  purgeLegacyCleartextToken();
  try {
    await ensureVaultKey();
    return { ready: true };
  } catch (err) {
    // ensureVaultKey already falls back to IndexedDB; failure here means storage is blocked.
    console.warn("[google-drive] vault prepare failed", err);
    setCachedVaultKey(null);
    memoryOnlySession = true;
    return {
      ready: false,
      reason: err?.message || "Could not seal Drive session — it will not persist across refresh",
    };
  }
}

/**
 * Ensure we have a usable access token (unlock sealed session or open helper auth).
 * Call from a user-gesture handler (Connect) so WebAuthn can run.
 * @returns {Promise<string>}
 */
export async function ensureDriveAccessToken() {
  if (accessToken) return accessToken;

  purgeLegacyCleartextToken();

  if (hasSealedDriveSession()) {
    const unlocked = await unlockDriveAccessToken();
    if (unlocked) return unlocked;
  }

  // User gesture still holds: establish PRF key before the OAuth popup steals focus.
  const prep = await prepareDriveTokenVault();
  const result = await openDriveAuthHelper();
  if (!result.accessToken) throw new Error("Could not authorize Google Drive");
  // persist already ran inside openDriveAuthHelper; ensure memory is set
  accessToken = result.accessToken;
  if (!result.sealed && !prep.ready) {
    memoryOnlySession = true;
  }
  return result.accessToken;
}

/** @returns {boolean} */
export function isDriveSessionMemoryOnly() {
  return memoryOnlySession;
}

/**
 * @param {string} fileId
 * @param {{ name: string, content: string }} opts
 * @returns {Promise<{ id: string, name: string, mimeType?: string }>}
 */
export async function saveExistingDriveFile(fileId, { name, content }) {
  let token = await ensureDriveAccessToken();
  try {
    return await updateDriveFile(token, fileId, { name, content });
  } catch (err) {
    if (err?.status === 401) {
      clearDriveAccessToken();
      token = await ensureDriveAccessToken();
      return updateDriveFile(token, fileId, { name, content });
    }
    throw err;
  }
}

/**
 * Create a Drive file (defaults to markdown-editor root when parentId omitted).
 * @param {{ name: string, content: string, parentId?: string }} opts
 */
export async function createDriveFileWithToken(opts) {
  const token = await ensureDriveAccessToken();
  return createDriveFile(token, opts);
}

/**
 * Create a subfolder under a parent Drive folder.
 * @param {string} name
 * @param {string} parentId
 * @returns {Promise<string>} new folder id
 */
export async function createDriveFolderWithToken(name, parentId) {
  const token = await ensureDriveAccessToken();
  return createDriveFolder(token, name, parentId);
}

/**
 * @param {string} fileId
 * @param {string} newName
 */
export async function renameDriveItemWithToken(fileId, newName) {
  let token = await ensureDriveAccessToken();
  try {
    return await renameDriveItem(token, fileId, newName);
  } catch (err) {
    if (err?.status === 401) {
      clearDriveAccessToken();
      token = await ensureDriveAccessToken();
      return renameDriveItem(token, fileId, newName);
    }
    throw err;
  }
}

/**
 * @param {string} fileId
 */
export async function trashDriveItemWithToken(fileId) {
  let token = await ensureDriveAccessToken();
  try {
    return await trashDriveItem(token, fileId);
  } catch (err) {
    if (err?.status === 401) {
      clearDriveAccessToken();
      token = await ensureDriveAccessToken();
      return trashDriveItem(token, fileId);
    }
    throw err;
  }
}
