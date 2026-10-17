/**
 * Ephemeral AES-GCM key for the OAuth helper → editor BroadcastChannel hop.
 * The raw key is passed once in the popup URL (?k=), held in the helper's
 * sessionStorage across the Google redirect, and kept only in memory in the
 * editor. Auth results are ciphertext (iv + ct) — never a cleartext token.
 */

const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * @param {BufferSource} buf
 * @returns {string}
 */
export function bytesToBase64Url(buf) {
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
export function base64UrlToBytes(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isDriveAuthHandoffKeyParam(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    return base64UrlToBytes(value).length === KEY_BYTES;
  } catch {
    return false;
  }
}

/** @returns {Promise<CryptoKey>} */
export async function generateDriveAuthHandoffKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * @param {CryptoKey} key
 * @returns {Promise<string>} base64url raw key (32 bytes)
 */
export async function exportDriveAuthHandoffKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64Url(raw);
}

/**
 * @param {string} param base64url raw key
 * @returns {Promise<CryptoKey>}
 */
export async function importDriveAuthHandoffKey(param) {
  if (!isDriveAuthHandoffKeyParam(param)) {
    throw new Error("Invalid handoff key");
  }
  const raw = base64UrlToBytes(param);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * @typedef {{ accessToken: string, expiresIn?: number }} DriveAuthHandoffPayload
 * @typedef {{ iv: string, ct: string }} DriveAuthHandoffCipher
 */

/**
 * @param {CryptoKey} key
 * @param {DriveAuthHandoffPayload} payload
 * @returns {Promise<DriveAuthHandoffCipher>}
 */
export async function encryptDriveAuthHandoff(key, payload) {
  if (typeof payload?.accessToken !== "string" || !payload.accessToken) {
    throw new Error("Missing access token");
  }
  const body = {
    accessToken: payload.accessToken,
    ...(Number.isFinite(payload.expiresIn) && payload.expiresIn > 0
      ? { expiresIn: payload.expiresIn }
      : {}),
  };
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(body));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(ct),
  };
}

/**
 * @param {CryptoKey} key
 * @param {DriveAuthHandoffCipher} cipher
 * @returns {Promise<DriveAuthHandoffPayload>}
 */
export async function decryptDriveAuthHandoff(key, cipher) {
  if (typeof cipher?.iv !== "string" || typeof cipher?.ct !== "string") {
    throw new Error("Invalid auth cipher");
  }
  const iv = base64UrlToBytes(cipher.iv);
  const ct = base64UrlToBytes(cipher.ct);
  if (iv.length !== IV_BYTES) throw new Error("Invalid auth cipher");
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
  if (typeof parsed?.accessToken !== "string" || !parsed.accessToken) {
    throw new Error("Invalid auth payload");
  }
  const expiresIn = Number(parsed.expiresIn);
  return {
    accessToken: parsed.accessToken,
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresIn } : {}),
  };
}
