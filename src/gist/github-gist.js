/**
 * Main-app GitHub Gist bridge: fine-grained PAT (paste once), optional WebAuthn PRF seal.
 * REST via Octokit on the main page (list / open / save private gists).
 *
 * Token lifetime:
 * - In-memory only while the tab stays alive (never written to sessionStorage)
 * - WebAuthn PRF seal in localStorage → Unlock + passkey after refresh / new tab / cold start
 * - Without PRF, refresh or closing the tab requires Connect again
 *
 * Note: Browser OAuth is not used — GitHub’s token endpoint does not allow CORS for
 * static hosts without SPA client support (and no server-side exchange is available).
 */

import { isGithubGistConfigured } from "./github-gist-config.js";
import {
  clearVaultStorage,
  ensureVaultKey,
  getCachedVaultKey,
  hasSealedGistSession,
  migrateAwayFromIdbVault,
  purgeLegacyCleartextToken,
  readVaultMeta,
  sealToken,
  setCachedVaultKey,
  unsealToken,
} from "./gist-token-vault.js";
import {
  createGistOctokit,
  createPrivateGist,
  deleteGist,
  editableGistFiles,
  getGist,
  listGists,
  readGistFileText,
  updateGistFile,
} from "./github-gist-api.js";

export {
  createPrivateGist,
  deleteGist,
  editableGistFiles,
  getGist,
  listGists,
  readGistFileText,
  updateGistFile,
};

export { createGistOctokit };

export { hasSealedGistSession } from "./gist-token-vault.js";

/** PATs do not expire like OAuth access tokens; seal with a long horizon. */
const DEFAULT_PAT_TTL_SEC = 365 * 24 * 60 * 60;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** Legacy key purge only — never written. */
export const GIST_TOKEN_SESSION_KEY = "md-editor:gistAccessTokenSession";

/** @type {string | null} */
let accessToken = null;

/** True when the last connect could not PRF-seal — memory only (lost on refresh). */
let memoryOnlySession = false;

function purgeLegacySessionToken() {
  try {
    sessionStorage.removeItem(GIST_TOKEN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {boolean}
 */
export function githubGistEnabled() {
  return isGithubGistConfigured();
}

/**
 * @returns {string | null}
 */
export function getGistAccessToken() {
  return accessToken;
}

export function clearGistAccessToken() {
  accessToken = null;
  memoryOnlySession = false;
  setCachedVaultKey(null);
  purgeLegacySessionToken();
  clearVaultStorage();
}

/**
 * @returns {boolean}
 */
export function isGistSessionMemoryOnly() {
  return memoryOnlySession && Boolean(accessToken);
}

/**
 * Prepare PRF vault under a user gesture (before storing the PAT).
 * @returns {Promise<{ ready: boolean, reason?: string }>}
 */
export async function prepareGistTokenVault() {
  migrateAwayFromIdbVault();
  purgeLegacyCleartextToken();
  try {
    const { key, meta } = await ensureVaultKey();
    setCachedVaultKey(key);
    if (meta?.kind === "prf") return { ready: true };
    return { ready: false, reason: "unsupported" };
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") throw err;
    if (err?.name === "NotSupportedError") return { ready: false, reason: "unsupported" };
    return { ready: false, reason: "error" };
  }
}

/**
 * @param {string} token
 * @param {number} [expiresInSec]
 * @returns {Promise<{ sealed: boolean }>}
 */
async function persistGistSession(token, expiresInSec) {
  accessToken = token;
  purgeLegacySessionToken();
  const ttlSec = Math.max(60, Number(expiresInSec) || DEFAULT_PAT_TTL_SEC);
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
 * Store a PAT after Connect (user pasted it). Optionally seals with PRF.
 * @param {string} pat
 * @returns {Promise<{ sealed: boolean }>}
 */
export async function setGistPersonalAccessToken(pat) {
  const token = String(pat || "").trim();
  if (!token) {
    clearGistAccessToken();
    throw new Error("Personal access token is required");
  }
  return persistGistSession(token, DEFAULT_PAT_TTL_SEC);
}

/**
 * Boot restore: memory only. Never reads plaintext from sessionStorage.
 * @returns {Promise<boolean>}
 */
export async function tryRestoreGistAccessToken() {
  if (accessToken) return true;
  purgeLegacyCleartextToken();
  purgeLegacySessionToken();
  migrateAwayFromIdbVault();
  return false;
}

/**
 * Unlock a PRF-sealed session. Requires a user gesture (passkey).
 * @returns {Promise<string | null>}
 */
export async function unlockGistAccessToken() {
  if (accessToken) return accessToken;
  purgeLegacyCleartextToken();
  purgeLegacySessionToken();
  migrateAwayFromIdbVault();
  if (!hasSealedGistSession()) return null;

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

/**
 * Ensure an in-memory PAT (unlock sealed session if needed).
 * @returns {Promise<string>}
 */
export async function ensureGistAccessToken() {
  if (accessToken) return accessToken;
  const unlocked = await unlockGistAccessToken();
  if (unlocked) return unlocked;
  throw Object.assign(new Error("Connect GitHub Gist with a personal access token"), {
    name: "NotAuthenticatedError",
  });
}

/**
 * Validate the token against the Gist API (does not require profile scopes).
 * @param {string} token
 */
export async function verifyGistToken(token) {
  const octokit = await createGistOctokit(token);
  await octokit.gists.list({ per_page: 1 });
  return { ok: true };
}
