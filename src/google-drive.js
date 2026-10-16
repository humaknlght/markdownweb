/**
 * Main-app Google Drive bridge: auth via COEP-free helper popup, then Drive REST
 * on the main page (drawer listing + open/save). Scoped to the markdown-editor folder.
 */

import {
  DRIVE_HELPER_PATH,
  createDriveFile,
  isDriveMessage,
  makeDriveMessage,
  renameDriveItem,
  trashDriveItem,
  updateDriveFile,
} from "./google-drive-api.js";
import { isGoogleDriveConfigured } from "./google-drive-config.js";

export {
  DRIVE_DEFAULT_FOLDER_NAME,
  createDriveFolder,
  listDriveAppFolder,
  listDriveAppFiles,
  listDriveFolderChildren,
  readDriveFileText,
  ensureDriveAppFolder,
} from "./google-drive-api.js";

/** @type {string | null} */
let accessToken = null;

/**
 * @returns {boolean}
 */
export function googleDriveEnabled() {
  return isGoogleDriveConfigured();
}

/**
 * @returns {string | null}
 */
export function getDriveAccessToken() {
  return accessToken;
}

/**
 * @param {string | null} token
 */
export function setDriveAccessToken(token) {
  accessToken = token || null;
}

export function clearDriveAccessToken() {
  accessToken = null;
}

/**
 * @returns {Promise<{ action: string, accessToken?: string }>}
 */
function openDriveAuthHelper() {
  return new Promise((resolve, reject) => {
    if (!isGoogleDriveConfigured()) {
      reject(new Error("Google Drive is not configured"));
      return;
    }

    const url = new URL(DRIVE_HELPER_PATH, window.location.href);
    url.searchParams.set("mode", "auth");

    const popup = window.open(
      url.href,
      "md-google-drive",
      "width=520,height=640,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      reject(new Error("Popup blocked — allow popups for this site to use Google Drive"));
      return;
    }

    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(closedPoll);
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (!popup.closed) popup.close();
      } catch {
        /* ignore */
      }
      fn(value);
    };

    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== popup) return;
      if (!isDriveMessage(event.data)) return;

      const msg = event.data;
      if (msg.action === "ready") {
        popup.postMessage(makeDriveMessage({ action: "auth" }), window.location.origin);
        return;
      }

      if (msg.action === "cancel") {
        finish(reject, Object.assign(new Error("Cancelled"), { name: "AbortError" }));
        return;
      }

      if (msg.action === "error") {
        finish(reject, new Error(msg.error || "Google Drive error"));
        return;
      }

      if (msg.action === "auth") {
        if (msg.accessToken) accessToken = msg.accessToken;
        finish(resolve, {
          action: msg.action,
          accessToken: msg.accessToken,
        });
      }
    };

    window.addEventListener("message", onMessage);

    let closeSeenAt = 0;
    const closedPoll = window.setInterval(() => {
      if (!popup.closed) {
        closeSeenAt = 0;
        return;
      }
      if (!closeSeenAt) {
        closeSeenAt = Date.now();
        return;
      }
      if (Date.now() - closeSeenAt < 500) return;
      finish(reject, Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    }, 100);
  });
}

/**
 * Ensure we have a usable access token (opens helper auth if needed).
 * @returns {Promise<string>}
 */
export async function ensureDriveAccessToken() {
  if (accessToken) return accessToken;
  const result = await openDriveAuthHelper();
  if (!result.accessToken) throw new Error("Could not authorize Google Drive");
  accessToken = result.accessToken;
  return accessToken;
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
      accessToken = null;
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
      accessToken = null;
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
      accessToken = null;
      token = await ensureDriveAccessToken();
      return trashDriveItem(token, fileId);
    }
    throw err;
  }
}
