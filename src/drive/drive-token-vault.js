/**
 * Seals the Google Drive access token at rest (never clear text in localStorage).
 * Prefer WebAuthn PRF → AES-GCM; fall back to a non-extractable AES key in IndexedDB
 * when the authenticator/browser has no PRF support.
 */

export const DRIVE_TOKEN_STORAGE_KEY = "md-editor:driveAccessToken";
export const DRIVE_VAULT_META_KEY = "md-editor:driveTokenVault";

const HKDF_INFO = new TextEncoder().encode("md-editor:drive-token-vault:v1");
const IV_BYTES = 12;
const IDB_NAME = "md-editor-drive-vault";
const IDB_STORE = "keys";
const IDB_KEY_NAME = "aes";
const VAULT_KIND_PRF = "prf";
const VAULT_KIND_IDB = "idb";

/** @type {CryptoKey | null} */
let vaultKey = null;

/**
 * @param {BufferSource} buf
 * @returns {string}
 */
function b64(buf) {
  const bytes = toUint8(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * @param {string} s
 * @returns {Uint8Array}
 */
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {BufferSource} value
 * @returns {Uint8Array}
 */
function toUint8(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Expected BufferSource");
}

/**
 * Normalize PRF/extension output to a standalone ArrayBuffer.
 * @param {unknown} value
 * @returns {ArrayBuffer | null}
 */
function asStandaloneArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

/**
 * @returns {boolean}
 */
export function isWebAuthnAvailable() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials?.create &&
    !!navigator.credentials?.get &&
    typeof PublicKeyCredential !== "undefined"
  );
}

/**
 * @returns {Promise<boolean | null>} true/false when known, null when unknown
 */
export async function getPrfCapability() {
  if (!isWebAuthnAvailable()) return false;
  try {
    if (typeof PublicKeyCredential.getClientCapabilities === "function") {
      const caps = await PublicKeyCredential.getClientCapabilities();
      if (caps && typeof caps === "object" && "extension:prf" in caps) {
        return Boolean(caps["extension:prf"]);
      }
    }
  } catch {
    /* unknown */
  }
  return null;
}

/**
 * @returns {{ kind: string, credId: string, salt: string } | null}
 */
export function readVaultMeta() {
  try {
    const raw = localStorage.getItem(DRIVE_VAULT_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.credId !== "string" || typeof parsed?.salt !== "string") return null;
    const kind = parsed.kind === VAULT_KIND_IDB ? VAULT_KIND_IDB : VAULT_KIND_PRF;
    return { kind, credId: parsed.credId, salt: parsed.salt };
  } catch {
    return null;
  }
}

/**
 * @param {{ kind?: string, credId: string, salt: string }} meta
 */
function writeVaultMeta(meta) {
  localStorage.setItem(
    DRIVE_VAULT_META_KEY,
    JSON.stringify({
      kind: meta.kind === VAULT_KIND_IDB ? VAULT_KIND_IDB : VAULT_KIND_PRF,
      credId: meta.credId,
      salt: meta.salt,
    }),
  );
}

export function clearVaultStorage() {
  vaultKey = null;
  try {
    localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    localStorage.removeItem(DRIVE_VAULT_META_KEY);
  } catch {
    /* ignore */
  }
  void deleteIdbVaultKey();
}

/**
 * @returns {boolean} true if a sealed (non-plaintext) session blob exists and is unexpired
 */
export function hasSealedDriveSession() {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || typeof parsed?.ct !== "string" || typeof parsed?.iv !== "string") {
      return false;
    }
    const expiresAt = Number(parsed.expiresAt);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove legacy clear-text token blobs (and expired/invalid sealed ones).
 */
export function purgeLegacyCleartextToken() {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token === "string") {
      localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
      return;
    }
    if (parsed?.v === 1) {
      const expiresAt = Number(parsed.expiresAt);
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
        localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    try {
      localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {ArrayBuffer} prfBytes
 * @returns {Promise<CryptoKey>}
 */
async function aesKeyFromPrf(prfBytes) {
  const ikm = await crypto.subtle.importKey("raw", prfBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: HKDF_INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * @param {PublicKeyCredential} credential
 * @returns {ArrayBuffer | null}
 */
function prfResultFromCredential(credential) {
  const ext =
    typeof credential.getClientExtensionResults === "function"
      ? credential.getClientExtensionResults()
      : /** @type {{ prf?: { results?: { first?: BufferSource } } }} */ (credential).clientExtensionResults;
  return asStandaloneArrayBuffer(ext?.prf?.results?.first);
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @returns {Promise<CryptoKey | null>}
 */
async function readIdbVaultKey() {
  const db = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY_NAME);
      req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
      req.onsuccess = () => resolve(req.result || null);
    });
  } finally {
    db.close();
  }
}

/**
 * @param {CryptoKey} key
 */
async function writeIdbVaultKey(key) {
  const db = await openIdb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
      tx.objectStore(IDB_STORE).put(key, IDB_KEY_NAME);
    });
  } finally {
    db.close();
  }
}

async function deleteIdbVaultKey() {
  try {
    const db = await openIdb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
        tx.objectStore(IDB_STORE).delete(IDB_KEY_NAME);
      });
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Non-extractable AES key in IndexedDB (no user prompt; used when PRF is unavailable).
 * @returns {Promise<{ key: CryptoKey, meta: { kind: string, credId: string, salt: string } }>}
 */
export async function ensureIdbVaultKey() {
  let key = await readIdbVaultKey();
  if (!key) {
    key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await writeIdbVaultKey(key);
  }
  const meta = { kind: VAULT_KIND_IDB, credId: "idb", salt: "idb" };
  writeVaultMeta(meta);
  vaultKey = key;
  return { key, meta };
}

/**
 * Resolve the vault AES key for sealing / unlocking.
 * New sessions use IndexedDB so a refresh can restore without a gesture.
 * Existing WebAuthn-PRF vaults still unlock via passkey when the user Connects.
 * @returns {Promise<{ key: CryptoKey, persisted: boolean, kind: string }>}
 */
export async function ensureVaultKey() {
  if (vaultKey) {
    const meta = readVaultMeta();
    return { key: vaultKey, persisted: true, kind: meta?.kind || VAULT_KIND_IDB };
  }

  const existing = readVaultMeta();
  if (existing?.kind === VAULT_KIND_IDB) {
    const { key } = await ensureIdbVaultKey();
    return { key, persisted: true, kind: VAULT_KIND_IDB };
  }

  if (existing?.kind === VAULT_KIND_PRF) {
    try {
      const key = await deriveVaultKey(existing.credId, existing.salt);
      vaultKey = key;
      return { key, persisted: true, kind: VAULT_KIND_PRF };
    } catch (err) {
      if (err?.name === "AbortError" || err?.name === "NotAllowedError") throw err;
      try {
        localStorage.removeItem(DRIVE_VAULT_META_KEY);
      } catch {
        /* ignore */
      }
      // Stale PRF meta — fall through to IndexedDB for a fresh seal after re-auth.
    }
  }

  // Default: non-extractable AES in IndexedDB (ciphertext in localStorage, silent restore).
  const idb = await ensureIdbVaultKey();
  return { key: idb.key, persisted: true, kind: VAULT_KIND_IDB };
}

/**
 * @param {string} credIdB64
 * @param {string} saltB64
 * @returns {Promise<CryptoKey>}
 */
export async function deriveVaultKey(credIdB64, saltB64) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const salt = unb64(saltB64);
  // Fresh copy — some authenticators reject views into larger ArrayBuffers.
  const allowId = toUint8(unb64(credIdB64)).slice();

  const assertion = /** @type {PublicKeyCredential | null} */ (
    await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: allowId }],
        userVerification: "required",
        timeout: 120_000,
        extensions: {
          prf: {
            eval: {
              first: salt,
            },
          },
        },
      },
    })
  );

  if (!assertion) {
    throw Object.assign(new Error("Passkey unlock was cancelled"), { name: "AbortError" });
  }

  const prfBytes = prfResultFromCredential(assertion);
  if (!prfBytes) {
    throw Object.assign(new Error("This authenticator did not return a PRF result"), {
      name: "NotSupportedError",
    });
  }

  return aesKeyFromPrf(prfBytes);
}

/**
 * @param {string} token
 * @param {number} expiresAt
 * @param {CryptoKey} key
 * @param {{ kind?: string, credId: string, salt: string }} meta
 */
export async function sealToken(token, expiresAt, key, meta) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify({ token, expiresAt }));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const blob = {
    v: 1,
    kind: meta.kind === VAULT_KIND_IDB ? VAULT_KIND_IDB : VAULT_KIND_PRF,
    credId: meta.credId,
    salt: meta.salt,
    iv: b64(iv),
    ct: b64(ct),
    expiresAt,
  };
  localStorage.setItem(DRIVE_TOKEN_STORAGE_KEY, JSON.stringify(blob));
  writeVaultMeta(meta);
  return blob;
}

/**
 * @param {CryptoKey} key
 * @returns {Promise<{ token: string, expiresAt: number } | null>}
 */
export async function unsealToken(key) {
  const raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed?.v !== 1 || typeof parsed.ct !== "string" || typeof parsed.iv !== "string") {
    return null;
  }
  const expiresAt = Number(parsed.expiresAt);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    return null;
  }
  const iv = unb64(parsed.iv);
  const ct = unb64(parsed.ct);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  const payload = JSON.parse(new TextDecoder().decode(plainBuf));
  if (typeof payload?.token !== "string") return null;
  const tokenExpires = Number(payload.expiresAt);
  if (Number.isFinite(tokenExpires) && Date.now() >= tokenExpires) {
    localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    return null;
  }
  return {
    token: payload.token,
    expiresAt: Number.isFinite(tokenExpires) ? tokenExpires : expiresAt,
  };
}

/**
 * @param {CryptoKey | null} key
 */
export function setCachedVaultKey(key) {
  vaultKey = key;
}

/** @returns {CryptoKey | null} */
export function getCachedVaultKey() {
  return vaultKey;
}
