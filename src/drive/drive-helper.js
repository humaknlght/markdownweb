/**
 * COEP-free helper window: OAuth 2.0 implicit grant (response_type=token).
 * Intentional: tokens stay in the browser fragment and never pass through a
 * host-side token-exchange proxy (no client secret on the static server).
 * Google returns the access token in the URL fragment of ./drive-helper/.
 * Results go to the editor over a BroadcastChannel tagged with the request id,
 * so the flow does not depend on window.opener surviving Google's COOP.
 *
 * The editor passes an ephemeral AES key in ?k= (stripped into sessionStorage before
 * redirect). Auth success broadcasts ciphertext only — never the access token.
 * sessionStorage also holds a short-lived CSRF nonce — never the access token or req id.
 */

import {
  encryptDriveAuthHandoff,
  importDriveAuthHandoffKey,
  isDriveAuthHandoffKeyParam,
} from "./drive-auth-handoff.js";
import { DRIVE_AUTH_CHANNEL, makeDriveMessage } from "./google-drive-api.js";
import {
  GOOGLE_DRIVE,
  GOOGLE_DRIVE_HELPER_CONFIG_URL,
  GOOGLE_DRIVE_SCOPE,
  isGoogleDriveConfigured,
  loadGoogleDriveConfig,
} from "./google-drive-config.js";

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
/** CSRF nonce only (random bytes we generated) — not a credential. */
const SS_NONCE = "md-dh-csrf";
/** Ephemeral BroadcastChannel handoff key (base64url raw AES-256). */
const SS_HANDOFF = "md-dh-handoff";

const statusEl = document.getElementById("status");
const channel = new BroadcastChannel(DRIVE_AUTH_CHANNEL);

/** Editor request id: from ?req= on first load, from OAuth state after Google. */
let req = new URLSearchParams(window.location.search).get("req") || "";

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

/**
 * @param {Parameters<typeof makeDriveMessage>[0]} fields
 */
function send(fields) {
  if (!req) return;
  channel.postMessage(makeDriveMessage({ ...fields, req }));
}

function closeSoon() {
  // Let the broadcast flush before the window goes away.
  window.setTimeout(() => window.close(), 100);
}

function replyCancel() {
  send({ action: "cancel" });
  closeSoon();
}

/**
 * @param {string} error
 */
function replyError(error) {
  send({ action: "error", error });
  closeSoon();
}

/**
 * Pull ?k= into sessionStorage and strip it from the address bar before any
 * navigation (so it never appears on the Google redirect or in history after).
 */
function captureHandoffKeyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const k = params.get("k");
  if (!k) return;
  if (isDriveAuthHandoffKeyParam(k)) {
    try {
      sessionStorage.setItem(SS_HANDOFF, k);
    } catch {
      /* private mode — encrypt step will fail and report */
    }
  }
  params.delete("k");
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  history.replaceState(null, "", next);
}

function clearHandoffKey() {
  try {
    sessionStorage.removeItem(SS_HANDOFF);
  } catch {
    /* ignore */
  }
}

/** @returns {Promise<CryptoKey | null>} */
async function loadHandoffKey() {
  let raw = "";
  try {
    raw = sessionStorage.getItem(SS_HANDOFF) || "";
  } catch {
    return null;
  }
  if (!isDriveAuthHandoffKeyParam(raw)) return null;
  try {
    return await importDriveAuthHandoffKey(raw);
  } catch {
    return null;
  }
}

/** Canonical redirect URI: …/drive-helper/ (must match Cloud Console). */
function oauthRedirectUri() {
  const { origin, pathname } = window.location;
  const m = pathname.match(/^(.*\/drive-helper)(?:\/(?:index\.html)?)?\/?$/);
  const basePath = m ? `${m[1]}/` : pathname.endsWith("/") ? pathname : `${pathname}/`;
  return `${origin}${basePath}`;
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} value
 * @returns {string}
 */
function toBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} state
 * @returns {string}
 */
function fromBase64Url(state) {
  const b64 = state.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Build OAuth `state` carrying the BroadcastChannel req id; persist CSRF nonce only.
 * @param {string} reqId
 * @returns {string}
 */
function beginOAuthState(reqId) {
  const nonce = randomNonce();
  try {
    sessionStorage.setItem(SS_NONCE, nonce);
  } catch {
    /* private mode — CSRF check may fail on return */
  }
  return toBase64Url(JSON.stringify({ n: nonce, r: reqId }));
}

/**
 * Verify CSRF nonce and recover the editor req id from Google's echoed state.
 * @param {string | null} stateParam
 * @returns {string} req id or ""
 */
function finishOAuthState(stateParam) {
  let expected = "";
  try {
    expected = sessionStorage.getItem(SS_NONCE) || "";
    sessionStorage.removeItem(SS_NONCE);
  } catch {
    /* ignore */
  }
  if (!stateParam || !expected) return "";
  try {
    const parsed = JSON.parse(fromBase64Url(stateParam));
    if (typeof parsed?.n !== "string" || parsed.n !== expected) return "";
    if (typeof parsed?.r !== "string" || !parsed.r) return "";
    return parsed.r;
  } catch {
    return "";
  }
}

function beginOAuthRedirect() {
  const state = beginOAuthState(req);

  const params = new URLSearchParams({
    client_id: GOOGLE_DRIVE.clientId,
    redirect_uri: oauthRedirectUri(),
    response_type: "token",
    scope: GOOGLE_DRIVE_SCOPE,
    state,
    include_granted_scopes: "true",
  });
  setStatus("Redirecting to Google…");
  send({ action: "redirecting" });
  window.location.assign(`${OAUTH_AUTH_URL}?${params}`);
}

/**
 * Handle return from Google (#access_token= / #error=).
 * @returns {Promise<boolean>} true if this load was an OAuth callback
 */
async function tryHandleOAuthCallback() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const error = params.get("error");
  const accessToken = params.get("access_token");
  const expiresInRaw = params.get("expires_in");
  const expiresIn = expiresInRaw ? Number(expiresInRaw) : undefined;
  if (!error && !accessToken) return false;

  // Drop the token from the URL / history before doing anything else.
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (window.location.hash) {
    // replaceState failed to clear the fragment — refuse to proceed with a live hash.
    clearHandoffKey();
    setStatus("Could not clear OAuth fragment — try Connect Drive again.");
    return true;
  }

  req = finishOAuthState(params.get("state"));

  if (!req) {
    // CSRF failed or state missing — drop any token; cannot notify the editor.
    clearHandoffKey();
    setStatus("OAuth state mismatch — try Connect Drive again.");
    return true;
  }

  if (error) {
    clearHandoffKey();
    if (error === "access_denied") replyCancel();
    else replyError(params.get("error_description") || error);
    return true;
  }

  if (!accessToken) {
    clearHandoffKey();
    replyError("Missing access token — try Connect Drive again");
    return true;
  }

  const handoffKey = await loadHandoffKey();
  clearHandoffKey();
  if (!handoffKey) {
    setStatus("Missing handoff key — try Connect Drive again.");
    replyError("Missing handoff key — try Connect Drive again");
    return true;
  }

  try {
    const cipher = await encryptDriveAuthHandoff(handoffKey, {
      accessToken,
      ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresIn } : {}),
    });
    setStatus("Connected");
    send({
      action: "auth",
      iv: cipher.iv,
      ct: cipher.ct,
    });
    closeSoon();
  } catch (err) {
    console.error(err);
    replyError(err?.message || "Failed to seal auth result");
  }
  return true;
}

async function main() {
  captureHandoffKeyFromUrl();
  if (await tryHandleOAuthCallback()) return;

  if (!req) {
    setStatus("Open Google Drive from the Markdown editor.");
    return;
  }

  setStatus("Loading configuration…");
  await loadGoogleDriveConfig(GOOGLE_DRIVE_HELPER_CONFIG_URL);
  if (!isGoogleDriveConfigured()) {
    setStatus("Google Drive is not configured.");
    replyError("Google Drive is not configured");
    return;
  }

  try {
    beginOAuthRedirect();
  } catch (err) {
    console.error(err);
    replyError(err?.message || String(err));
  }
}

document.getElementById("cancel-btn")?.addEventListener("click", () => {
  replyCancel();
});

void main();
