/**
 * COEP-free helper window: OAuth 2.0 token redirect (no GIS script, no client secret).
 * Google returns the access token in the URL fragment of ./drive-helper/.
 * Results go to the editor over a BroadcastChannel tagged with the request id,
 * so the flow does not depend on window.opener surviving Google's COOP.
 */

import { DRIVE_AUTH_CHANNEL, makeDriveMessage } from "./google-drive-api.js";
import {
  GOOGLE_DRIVE,
  GOOGLE_DRIVE_HELPER_CONFIG_URL,
  GOOGLE_DRIVE_SCOPE,
  isGoogleDriveConfigured,
  loadGoogleDriveConfig,
} from "./google-drive-config.js";

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SS_STATE = "md-drive-oauth-state";
const SS_REQ = "md-drive-oauth-req";

const statusEl = document.getElementById("status");
const channel = new BroadcastChannel(DRIVE_AUTH_CHANNEL);

/** Editor request id: from ?req= on first load, from sessionStorage after Google. */
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

/** Canonical redirect URI: …/drive-helper/ (must match Cloud Console). */
function oauthRedirectUri() {
  const { origin, pathname } = window.location;
  const m = pathname.match(/^(.*\/drive-helper)(?:\/(?:index\.html)?)?\/?$/);
  const basePath = m ? `${m[1]}/` : pathname.endsWith("/") ? pathname : `${pathname}/`;
  return `${origin}${basePath}`;
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function beginOAuthRedirect() {
  const state = randomState();
  sessionStorage.setItem(SS_STATE, state);
  sessionStorage.setItem(SS_REQ, req);

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
 * @returns {boolean} true if this load was an OAuth callback
 */
function tryHandleOAuthCallback() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const error = params.get("error");
  const accessToken = params.get("access_token");
  const expiresInRaw = params.get("expires_in");
  const expiresIn = expiresInRaw ? Number(expiresInRaw) : undefined;
  if (!error && !accessToken) return false;

  // Drop the token from the URL / history before doing anything else.
  history.replaceState(null, "", window.location.pathname + window.location.search);

  const expected = sessionStorage.getItem(SS_STATE);
  req = sessionStorage.getItem(SS_REQ) || "";
  sessionStorage.removeItem(SS_STATE);
  sessionStorage.removeItem(SS_REQ);

  if (!req) {
    setStatus("Open Google Drive from the Markdown editor.");
    return true;
  }

  if (error) {
    if (error === "access_denied") replyCancel();
    else replyError(params.get("error_description") || error);
    return true;
  }

  const state = params.get("state");
  if (!state || state !== expected) {
    replyError("OAuth state mismatch — try Connect Drive again");
    return true;
  }

  setStatus("Connected");
  send({
    action: "auth",
    accessToken,
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresIn } : {}),
  });
  closeSoon();
  return true;
}

async function main() {
  if (tryHandleOAuthCallback()) return;

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
