/**
 * COEP-free helper window: Google Identity Services token only.
 * File listing and open/save run in the main editor (files drawer).
 */

import { isDriveMessage, makeDriveMessage } from "./google-drive-api.js";
import {
  GOOGLE_DRIVE,
  GOOGLE_DRIVE_SCOPE,
  isGoogleDriveConfigured,
  loadGoogleDriveConfig,
} from "./google-drive-config.js";

const statusEl = document.getElementById("status");

/** @type {string | null} */
let accessToken = null;
/** @type {ReturnType<typeof google.accounts.oauth2.initTokenClient> | null} */
let tokenClient = null;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

/**
 * @param {ReturnType<typeof makeDriveMessage>} msg
 */
function reply(msg) {
  if (!window.opener || window.opener.closed) return;
  window.opener.postMessage(msg, window.location.origin);
}

function replyCancel() {
  reply(makeDriveMessage({ action: "cancel" }));
  window.close();
}

/**
 * @param {string} error
 */
function replyError(error) {
  reply(makeDriveMessage({ action: "error", error }));
  window.close();
}

/**
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

function initTokenClient() {
  // @ts-expect-error google global
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_DRIVE.clientId,
    scope: GOOGLE_DRIVE_SCOPE,
    callback: () => {},
  });
}

/**
 * @returns {Promise<string>}
 */
function requestAccessToken() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error("Token client not ready"));
      return;
    }
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error || "OAuth error"));
        return;
      }
      if (!resp.access_token) {
        reject(new Error("No access token returned"));
        return;
      }
      accessToken = resp.access_token;
      resolve(resp.access_token);
    };
    tokenClient.error_callback = (err) => {
      reject(new Error(err?.type || "OAuth popup closed"));
    };
    const prompt = accessToken ? "" : "consent";
    tokenClient.requestAccessToken({ prompt });
  });
}

async function runAuth() {
  setStatus("Sign in to Google…");
  await requestAccessToken();
  setStatus("Connected");
  reply(
    makeDriveMessage({
      action: "auth",
      accessToken: accessToken || undefined,
    }),
  );
}

async function main() {
  if (!window.opener) {
    setStatus("Open Google Drive from the Markdown editor.");
    return;
  }

  setStatus("Loading configuration…");
  await loadGoogleDriveConfig();
  if (!isGoogleDriveConfigured()) {
    setStatus("Google Drive is not configured.");
    replyError("Google Drive is not configured");
    return;
  }

  setStatus("Loading Google sign-in…");
  try {
    await loadScript("https://accounts.google.com/gsi/client");
    initTokenClient();
  } catch (err) {
    console.error(err);
    replyError(err?.message || "Failed to load Google sign-in");
    return;
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window.opener) return;
    if (!isDriveMessage(event.data)) return;

    if (event.data.action === "auth") {
      void runAuth().catch((err) => {
        if (err?.name === "AbortError" || /popup closed|cancelled/i.test(String(err?.message || err))) {
          replyCancel();
          return;
        }
        console.error(err);
        replyError(err?.message || String(err));
      });
    }
  });

  setStatus("Waiting for the editor…");
  reply(makeDriveMessage({ action: "ready" }));
}

document.getElementById("cancel-btn")?.addEventListener("click", () => {
  replyCancel();
});

void main();
