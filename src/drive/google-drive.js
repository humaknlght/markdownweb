/**
 * Main-app Google Drive bridge: auth via COEP-free helper popup, then Drive REST
 * on the main page (drawer listing + open/save). Scoped to the markdown-editor folder.
 *
 * Token lifetime:
 * - In-memory only while the tab stays alive (never written to sessionStorage)
 * - WebAuthn PRF seal in localStorage → Unlock + passkey after refresh / new tab / cold start
 * - Without PRF, refresh or closing the tab requires Connect again
 * - No IndexedDB silent vault (legacy IDB seals are purged)
 */

import {
  decryptDriveAuthHandoff,
  exportDriveAuthHandoffKey,
  generateDriveAuthHandoffKey,
} from "./drive-auth-handoff.js";
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
  ensureVaultKey,
  getCachedVaultKey,
  hasSealedDriveSession,
  migrateAwayFromIdbVault,
  purgeLegacyCleartextToken,
  readVaultMeta,
  sealToken,
  setCachedVaultKey,
  unsealToken,
} from "./drive-token-vault.js";

export {
  DRIVE_DEFAULT_FOLDER_NAME,
  createDriveFolder,
  getDriveFileMeta,
  listDriveAppFolder,
  listDriveAppFiles,
  listDriveFolderChildren,
  readDriveFileText,
  readDriveFileWithMeta,
  ensureDriveAppFolder,
} from "./google-drive-api.js";

export { hasSealedDriveSession } from "./drive-token-vault.js";

/** Drop tokens this early so a refresh near expiry does not use a dead token. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TTL_SEC = 3600;

/**
 * Legacy key that once held a plaintext access token for same-tab refresh.
 * Kept only so boot/disconnect can purge leftover values; never written again.
 */
export const DRIVE_TOKEN_SESSION_KEY = "md-editor:driveAccessTokenSession";

/** @type {string | null} */
let accessToken = null;

/** True when the last connect could not PRF-seal — memory only (lost on refresh). */
let memoryOnlySession = false;

/** Remove any leftover plaintext token from older builds. */
function purgeLegacySessionToken() {
  try {
    sessionStorage.removeItem(DRIVE_TOKEN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {boolean}
 */
export function googleDriveEnabled() {
  return isGoogleDriveConfigured();
}

/**
 * In-memory access token for this tab only (not persisted to sessionStorage).
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
  purgeLegacySessionToken();
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
  purgeLegacySessionToken();
  const ttlSec = Math.max(60, Number(expiresInSec) || DEFAULT_TOKEN_TTL_SEC);
  const expiresAt = Date.now() + ttlSec * 1000 - TOKEN_EXPIRY_SKEW_MS;

  const key = getCachedVaultKey();
  const meta = readVaultMeta();
  if (!key || !meta || meta.kind !== "prf") {
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
 * Boot restore: memory only. Never reads a plaintext token from sessionStorage.
 * PRF-sealed localStorage blobs need Unlock Drive after refresh / cold start.
 * @returns {Promise<boolean>}
 */
export async function tryRestoreDriveAccessToken() {
  if (accessToken) return true;
  purgeLegacyCleartextToken();
  purgeLegacySessionToken();
  migrateAwayFromIdbVault();
  return false;
}

/**
 * Unlock a PRF-sealed session. Requires a user gesture (passkey).
 * @returns {Promise<string | null>} access token or null if none / cancelled / failed
 */
export async function unlockDriveAccessToken() {
  if (accessToken) return accessToken;
  purgeLegacyCleartextToken();
  purgeLegacySessionToken();
  migrateAwayFromIdbVault();
  if (!hasSealedDriveSession()) return null;

  const meta = readVaultMeta();
  if (!meta || meta.kind !== "prf") {
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
    setCachedVaultKey(key);
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
 *
 * The access token is AES-GCM sealed for the hop (ephemeral key in ?k= / memory);
 * cleartext tokens on the channel are ignored.
 * @returns {Promise<{ action: string, accessToken?: string, expiresIn?: number, sealed?: boolean }>}
 */
async function openDriveAuthHelper() {
  if (!isGoogleDriveConfigured()) {
    throw new Error("Google Drive is not configured");
  }

  abortPendingAuth?.();

  const handoffKey = await generateDriveAuthHandoffKey();
  const keyParam = await exportDriveAuthHandoffKey(handoffKey);
  const req = crypto.randomUUID();
  const url = new URL(DRIVE_HELPER_PATH, window.location.href);
  url.searchParams.set("mode", "auth");
  url.searchParams.set("req", req);
  url.searchParams.set("k", keyParam);

  return new Promise((resolve, reject) => {
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
          try {
            // Reject cleartext tokens — only the ephemeral-key ciphertext is trusted.
            if (typeof msg.accessToken === "string" || !msg.iv || !msg.ct) {
              finish(reject, new Error("Rejected cleartext or incomplete Drive auth handoff"));
              return;
            }
            const opened = await decryptDriveAuthHandoff(handoffKey, {
              iv: msg.iv,
              ct: msg.ct,
            });
            const result = await persistDriveSession(opened.accessToken, opened.expiresIn);
            finish(resolve, {
              action: msg.action,
              accessToken: opened.accessToken,
              expiresIn: opened.expiresIn,
              sealed: result.sealed,
            });
          } catch (err) {
            finish(reject, err instanceof Error ? err : new Error(String(err)));
          }
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
 * Prepare WebAuthn PRF vault key under the current user gesture (before OAuth popup).
 * Soft-fails to memory-only when PRF is unavailable.
 * @returns {Promise<{ ready: boolean, reason?: string }>}
 */
export async function prepareDriveTokenVault() {
  purgeLegacyCleartextToken();
  purgeLegacySessionToken();
  migrateAwayFromIdbVault();
  try {
    await ensureVaultKey();
    return { ready: true };
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") throw err;
    console.warn("[google-drive] vault prepare failed", err);
    setCachedVaultKey(null);
    memoryOnlySession = true;
    return {
      ready: false,
      reason:
        err?.message ||
        "Could not seal Drive session with a passkey — sign-in will not survive refresh or closing this tab",
    };
  }
}

/**
 * Ensure we have a usable access token (memory, unlock sealed session, or OAuth).
 * Call from a user-gesture handler (Connect) so WebAuthn can run.
 * @returns {Promise<string>}
 */
export async function ensureDriveAccessToken() {
  if (accessToken) return accessToken;

  purgeLegacyCleartextToken();
  purgeLegacySessionToken();

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
 * @returns {Promise<{ id: string, name: string, mimeType?: string, modifiedTime?: string }>}
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
