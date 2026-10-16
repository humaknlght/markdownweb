/**
 * Google Drive credentials loaded at runtime from an optional JSON file.
 * Missing or empty config disables Drive UI. Each host supplies their own
 * Google Cloud OAuth Client ID — see CONTRIBUTING.md.
 *
 * File: ./google-drive-config.json (same directory as the app HTML).
 * Copy google-drive-config.example.json and fill in your values.
 *
 * Only `clientId` is required (OAuth + Drive REST). `apiKey` / `appId` are
 * optional leftovers from an earlier Picker-based flow and are ignored.
 */

/** Same-origin config path (relative to the page URL). */
export const GOOGLE_DRIVE_CONFIG_URL = "./google-drive-config.json";

/** @type {{ clientId: string, apiKey: string, appId: string }} */
export const GOOGLE_DRIVE = {
  clientId: "",
  apiKey: "",
  appId: "",
};

/** OAuth scope: only files the user opens or creates with this app. */
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** @type {Promise<boolean> | null} */
let loadPromise = null;

/**
 * @returns {boolean}
 */
export function isGoogleDriveConfigured() {
  return Boolean(GOOGLE_DRIVE.clientId?.trim());
}

/**
 * Apply a config object (from JSON). Clears credentials when fields are missing.
 * @param {unknown} data
 * @returns {boolean} Whether Drive is fully configured after apply
 */
export function applyGoogleDriveConfig(data) {
  GOOGLE_DRIVE.clientId = "";
  GOOGLE_DRIVE.apiKey = "";
  GOOGLE_DRIVE.appId = "";
  if (!data || typeof data !== "object") return false;
  const obj = /** @type {Record<string, unknown>} */ (data);
  GOOGLE_DRIVE.clientId = String(obj.clientId ?? "").trim();
  GOOGLE_DRIVE.apiKey = String(obj.apiKey ?? "").trim();
  GOOGLE_DRIVE.appId = String(obj.appId ?? "").trim();
  return isGoogleDriveConfigured();
}

/**
 * Fetch optional ./google-drive-config.json. 404 / network errors leave Drive disabled.
 * Safe to call multiple times; shares one in-flight promise.
 * @returns {Promise<boolean>}
 */
export function loadGoogleDriveConfig() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(GOOGLE_DRIVE_CONFIG_URL, { cache: "no-cache" });
      if (!res.ok) return false;
      const data = await res.json();
      return applyGoogleDriveConfig(data);
    } catch {
      applyGoogleDriveConfig(null);
      return false;
    }
  })();
  return loadPromise;
}

/** Test helper: reset cached load promise and credentials. */
export function resetGoogleDriveConfigForTests() {
  loadPromise = null;
  applyGoogleDriveConfig(null);
}
