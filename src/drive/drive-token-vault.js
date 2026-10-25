/**
 * Seals the Google Drive access token at rest (never clear text in localStorage).
 * At-rest sealing uses WebAuthn PRF → AES-GCM (Unlock + passkey after refresh / cold start).
 * The live access token stays in memory only (see google-drive.js) — never sessionStorage.
 * When PRF is unavailable, the session is memory-only and is lost on refresh.
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
      kind: VAULT_KIND_PRF,
      credId: meta.credId,
      salt: meta.salt,
    }),
  );
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
  try {
    indexedDB.deleteDatabase(IDB_NAME);
  } catch {
    /* ignore */
  }
}

/**
 * Drop legacy IndexedDB-backed vaults (silent decrypt without a gesture).
 * @returns {boolean} true if something was cleared
 */
export function migrateAwayFromIdbVault() {
  let cleared = false;
  try {
    const meta = readVaultMeta();
    if (meta?.kind === VAULT_KIND_IDB) cleared = true;
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.kind === VAULT_KIND_IDB) cleared = true;
    }
  } catch {
    /* ignore */
  }
  if (cleared) clearVaultStorage();
  return cleared;
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
 * @returns {boolean} true if a PRF-sealed (non-plaintext) session blob exists and is unexpired
 */
export function hasSealedDriveSession() {
  try {
    migrateAwayFromIdbVault();
    const raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || typeof parsed?.ct !== "string" || typeof parsed?.iv !== "string") {
      return false;
    }
    if (parsed.kind === VAULT_KIND_IDB) return false;
    const expiresAt = Number(parsed.expiresAt);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return false;
    const meta = readVaultMeta();
    if (!meta || meta.kind !== VAULT_KIND_PRF) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove legacy clear-text token blobs (and expired/invalid sealed ones).
 */
export function purgeLegacyCleartextToken() {
  migrateAwayFromIdbVault();
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
 * Register a new WebAuthn credential with PRF and derive the vault AES key.
 * Requires a user gesture.
 * @returns {Promise<{ key: CryptoKey, meta: { kind: string, credId: string, salt: string } }>}
 */
export async function createPrfVaultKey() {
  if (!isWebAuthnAvailable()) {
    throw Object.assign(new Error("WebAuthn is not available"), { name: "NotSupportedError" });
  }

  const capability = await getPrfCapability();
  if (capability === false) {
    throw Object.assign(new Error("This authenticator does not support PRF"), {
      name: "NotSupportedError",
    });
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(32));

  const credential = /** @type {PublicKeyCredential | null} */ (
    await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          id: location.hostname,
          name: "Markdown Editor",
        },
        user: {
          id: userId,
          name: "drive-token-vault",
          displayName: "Google Drive vault",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "preferred",
          requireResidentKey: false,
          userVerification: "required",
        },
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

  if (!credential) {
    throw Object.assign(new Error("Passkey registration was cancelled"), { name: "AbortError" });
  }

  let prfBytes = prfResultFromCredential(credential);
  const credIdB64 = b64(credential.rawId);
  const saltB64 = b64(salt);

  // Some authenticators enable PRF on create but only return bytes on get.
  if (!prfBytes) {
    const key = await deriveVaultKey(credIdB64, saltB64);
    const meta = { kind: VAULT_KIND_PRF, credId: credIdB64, salt: saltB64 };
    writeVaultMeta(meta);
    vaultKey = key;
    return { key, meta };
  }

  const key = await aesKeyFromPrf(prfBytes);
  const meta = { kind: VAULT_KIND_PRF, credId: credIdB64, salt: saltB64 };
  writeVaultMeta(meta);
  vaultKey = key;
  return { key, meta };
}

/**
 * Resolve the vault AES key for sealing / unlocking.
 * Only PRF-backed keys are created. Requires a user gesture for create/get.
 * @returns {Promise<{ key: CryptoKey, persisted: boolean, kind: string, meta: { kind: string, credId: string, salt: string } }>}
 */
export async function ensureVaultKey() {
  migrateAwayFromIdbVault();

  if (vaultKey) {
    const meta = readVaultMeta();
    if (meta?.kind === VAULT_KIND_PRF) {
      return { key: vaultKey, persisted: true, kind: VAULT_KIND_PRF, meta };
    }
  }

  const existing = readVaultMeta();
  if (existing?.kind === VAULT_KIND_PRF) {
    const key = await deriveVaultKey(existing.credId, existing.salt);
    vaultKey = key;
    return { key, persisted: true, kind: VAULT_KIND_PRF, meta: existing };
  }

  const created = await createPrfVaultKey();
  return {
    key: created.key,
    persisted: true,
    kind: VAULT_KIND_PRF,
    meta: created.meta,
  };
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
  if (meta.kind === VAULT_KIND_IDB) {
    throw new Error("IndexedDB vault sealing is no longer supported");
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify({ token, expiresAt }));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const blob = {
    v: 1,
    kind: VAULT_KIND_PRF,
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
  if (parsed.kind === VAULT_KIND_IDB) {
    clearVaultStorage();
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
