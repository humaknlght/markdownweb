/**
 * Personal access tokens for GitHub-compatible (GHE-style) hosts, one per host.
 * Each token is only ever sent to the host it was entered for; the github.com
 * (Gist) token never goes to these hosts and vice versa.
 *
 * Storage mirrors the Gist token: memory while the tab lives, optionally sealed
 * at rest with the same WebAuthn PRF vault (one localStorage blob per host).
 */

import { normalizeHost } from "../url-fetch/github-url.js";
import {
  deriveVaultKey,
  ensureVaultKey,
  GIST_TOKEN_STORAGE_KEY,
  getCachedVaultKey,
  readVaultMeta,
  sealToken,
  unsealToken,
} from "./gist-token-vault.js";
import { getGistAccessToken } from "./github-gist.js";

export const GITHUB_HOST_TOKEN_KEY_PREFIX = "md-editor:githubHostToken:";
export const GITHUB_TOKEN_SCOPE_MIGRATION_KEY = "md-editor:githubTokenScopeV1";

const GITHUB_COM = "github.com";
const DEFAULT_PAT_TTL_SEC = 365 * 24 * 60 * 60;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** @type {Map<string, string>} */
const hostTokens = new Map();

/**
 * @param {string} host
 * @returns {string}
 */
function storageKeyFor(host) {
  return `${GITHUB_HOST_TOKEN_KEY_PREFIX}${host}`;
}

/**
 * @param {string} host
 * @returns {string}
 */
function enterpriseHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized || normalized === GITHUB_COM) {
    throw new Error("Enterprise host is required");
  }
  return normalized;
}

/**
 * @param {string} host
 * @returns {{ credId: string, salt: string } | null} unexpired sealed blob
 */
function readSealedBlob(host) {
  try {
    const raw = localStorage.getItem(storageKeyFor(host));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.v !== 1 ||
      typeof parsed.ct !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.credId !== "string" ||
      typeof parsed.salt !== "string"
    ) {
      return null;
    }
    const expiresAt = Number(parsed.expiresAt);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;
    return { credId: parsed.credId, salt: parsed.salt };
  } catch {
    return null;
  }
}

/**
 * @returns {string[]} hosts with a sealed token blob in localStorage
 */
function sealedHosts() {
  /** @type {string[]} */
  const hosts = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(GITHUB_HOST_TOKEN_KEY_PREFIX)) {
        hosts.push(key.slice(GITHUB_HOST_TOKEN_KEY_PREFIX.length));
      }
    }
  } catch {
    /* ignore */
  }
  return hosts;
}

/**
 * Decrypt a sealed blob only if the vault key is already cached (no passkey prompt).
 * @param {string} storageKey
 * @returns {Promise<string | null>}
 */
async function peekSealedToken(storageKey) {
  const key = getCachedVaultKey();
  if (!key) return null;
  try {
    return (await unsealToken(key, storageKey))?.token || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} host
 * @returns {string | null} in-memory token for this host
 */
export function getGithubHostToken(host) {
  return hostTokens.get(normalizeHost(host)) || null;
}

/**
 * @param {string} host
 * @returns {boolean}
 */
export function hasSealedGithubHostToken(host) {
  return Boolean(readSealedBlob(normalizeHost(host)));
}

/**
 * Unlock a sealed host token. May require a user gesture (passkey).
 * @param {string} host
 * @returns {Promise<string | null>}
 */
export async function unlockGithubHostToken(host) {
  const normalized = enterpriseHost(host);
  const existing = hostTokens.get(normalized);
  if (existing) return existing;
  const blob = readSealedBlob(normalized);
  if (!blob) return null;

  const storageKey = storageKeyFor(normalized);
  try {
    const meta = readVaultMeta();
    const key =
      meta?.kind === "prf" && meta.credId === blob.credId
        ? (await ensureVaultKey()).key
        : await deriveVaultKey(blob.credId, blob.salt);
    const opened = await unsealToken(key, storageKey);
    if (!opened?.token) {
      localStorage.removeItem(storageKey);
      return null;
    }
    hostTokens.set(normalized, opened.token);
    return opened.token;
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError")
      throw err;
    if (err?.name === "NotSupportedError") return null;
    localStorage.removeItem(storageKey);
    return null;
  }
}

/**
 * Find another host that already has this exact token saved.
 * Checks in-memory tokens and sealed blobs the cached vault key can open.
 * @param {string} token
 * @param {string} host the host the token is being saved for
 * @returns {Promise<string | null>}
 */
export async function findOtherHostWithToken(token, host) {
  const value = String(token || "").trim();
  const target = normalizeHost(host);
  if (!value) return null;

  if (target !== GITHUB_COM) {
    const gistToken =
      getGistAccessToken() || (await peekSealedToken(GIST_TOKEN_STORAGE_KEY));
    if (gistToken === value) return GITHUB_COM;
  }
  for (const [other, saved] of hostTokens) {
    if (other !== target && saved === value) return other;
  }
  for (const other of sealedHosts()) {
    if (other === target || hostTokens.has(other)) continue;
    if ((await peekSealedToken(storageKeyFor(other))) === value) return other;
  }
  return null;
}

/**
 * Refuse a token that is already saved for a different host, so one host's
 * token is never sent to another. Call before the token is used anywhere.
 * @param {string} token
 * @param {string} host
 */
export async function assertTokenNotSavedForOtherHost(token, host) {
  const other = await findOtherHostWithToken(token, host);
  if (!other) return;
  const target = normalizeHost(host);
  throw Object.assign(
    new Error(
      `This token is already saved for ${other}. Create a separate token on ${target}.`,
    ),
    { name: "TokenReuseError" },
  );
}

/**
 * Store a PAT for an enterprise host (user pasted it). Seals when the PRF vault is ready.
 * @param {string} host
 * @param {string} pat
 * @returns {Promise<{ sealed: boolean }>}
 */
export async function setGithubHostToken(host, pat) {
  const normalized = enterpriseHost(host);
  const token = String(pat || "").trim();
  if (!token) throw new Error("Personal access token is required");
  await assertTokenNotSavedForOtherHost(token, normalized);

  const storageKey = storageKeyFor(normalized);
  hostTokens.set(normalized, token);
  localStorage.removeItem(storageKey);

  const key = getCachedVaultKey();
  const meta = readVaultMeta();
  if (!key || meta?.kind !== "prf") return { sealed: false };
  const expiresAt =
    Date.now() + DEFAULT_PAT_TTL_SEC * 1000 - TOKEN_EXPIRY_SKEW_MS;
  try {
    await sealToken(token, expiresAt, key, meta, storageKey);
    return { sealed: true };
  } catch {
    return { sealed: false };
  }
}

/**
 * One-time cleanup: older builds sent the single "Connect GitHub" token to
 * enterprise hosts too, so it may hold an enterprise token. Drop it so every
 * user re-enters each token for its host.
 * Keeps the passkey vault so no new passkey is needed.
 * @returns {boolean} true if a saved token was cleared
 */
export function clearSharedGithubTokenOnce() {
  try {
    if (localStorage.getItem(GITHUB_TOKEN_SCOPE_MIGRATION_KEY)) return false;
    localStorage.setItem(GITHUB_TOKEN_SCOPE_MIGRATION_KEY, "1");
    if (localStorage.getItem(GIST_TOKEN_STORAGE_KEY) == null) return false;
    localStorage.removeItem(GIST_TOKEN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget the token for one enterprise host (memory and sealed blob).
 * @param {string} host
 */
export function removeGithubHostToken(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return;
  hostTokens.delete(normalized);
  try {
    localStorage.removeItem(storageKeyFor(normalized));
  } catch {
    /* ignore */
  }
}
