import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  DRIVE_TOKEN_STORAGE_KEY,
  DRIVE_VAULT_META_KEY,
  clearVaultStorage,
  ensureVaultKey,
  hasSealedDriveSession,
  migrateAwayFromIdbVault,
  purgeLegacyCleartextToken,
  readVaultMeta,
  sealToken,
  setCachedVaultKey,
  unsealToken,
} from "../../src/drive/drive-token-vault.js";

function makeMemoryStorage() {
  /** @type {Map<string, string>} */
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
}

/**
 * @returns {Promise<CryptoKey>}
 */
async function testAesKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

describe("drive-token-vault", () => {
  /** @type {ReturnType<typeof makeMemoryStorage>} */
  let storage;
  /** @type {Storage | undefined} */
  let originalStorage;

  beforeEach(() => {
    storage = makeMemoryStorage();
    originalStorage = globalThis.localStorage;
    globalThis.localStorage = /** @type {Storage} */ (storage);
    setCachedVaultKey(null);
    clearVaultStorage();
  });

  afterEach(() => {
    setCachedVaultKey(null);
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  });

  it("seals and unseals a token without storing plaintext", async () => {
    const key = await testAesKey();
    const meta = { kind: "prf", credId: "Y3JlZA==", salt: "c2FsdA==" };
    const expiresAt = Date.now() + 3_600_000;
    await sealToken("ya29.test-token", expiresAt, key, meta);

    const raw = storage.getItem(DRIVE_TOKEN_STORAGE_KEY);
    assert.ok(raw);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.v, 1);
    assert.equal(parsed.kind, "prf");
    assert.equal(parsed.credId, meta.credId);
    assert.ok(typeof parsed.ct === "string" && parsed.ct.length > 0);
    assert.ok(typeof parsed.iv === "string" && parsed.iv.length > 0);
    assert.equal(parsed.token, undefined);
    assert.doesNotMatch(raw, /ya29\.test-token/);

    assert.equal(hasSealedDriveSession(), true);
    const opened = await unsealToken(key);
    assert.equal(opened?.token, "ya29.test-token");
    assert.equal(opened?.expiresAt, expiresAt);
  });

  it("reports no sealed session for legacy clear-text blobs and purges them", () => {
    storage.setItem(
      DRIVE_TOKEN_STORAGE_KEY,
      JSON.stringify({ token: "ya29.plain", expiresAt: Date.now() + 60_000 }),
    );
    assert.equal(hasSealedDriveSession(), false);
    purgeLegacyCleartextToken();
    assert.equal(storage.getItem(DRIVE_TOKEN_STORAGE_KEY), null);
  });

  it("expires sealed sessions past expiresAt", async () => {
    const key = await testAesKey();
    const meta = { kind: "prf", credId: "Y3JlZA==", salt: "c2FsdA==" };
    await sealToken("ya29.old", Date.now() - 1_000, key, meta);
    assert.equal(hasSealedDriveSession(), false);
    assert.equal(await unsealToken(key), null);
  });

  it("migrates away from IndexedDB vault meta and sealed blobs", () => {
    storage.setItem(
      DRIVE_VAULT_META_KEY,
      JSON.stringify({ kind: "idb", credId: "idb", salt: "idb" }),
    );
    storage.setItem(
      DRIVE_TOKEN_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        kind: "idb",
        credId: "idb",
        salt: "idb",
        iv: "YQ==",
        ct: "Yg==",
        expiresAt: Date.now() + 60_000,
      }),
    );
    assert.equal(migrateAwayFromIdbVault(), true);
    assert.equal(storage.getItem(DRIVE_TOKEN_STORAGE_KEY), null);
    assert.equal(storage.getItem(DRIVE_VAULT_META_KEY), null);
    assert.equal(hasSealedDriveSession(), false);
  });

  it("ensureVaultKey does not create an IndexedDB vault when WebAuthn is unavailable", async () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { isSecureContext: false },
    });
    try {
      await assert.rejects(() => ensureVaultKey(), (err) => err?.name === "NotSupportedError");
      assert.equal(readVaultMeta(), null);
      assert.equal(storage.getItem(DRIVE_VAULT_META_KEY), null);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("rejects sealing with an IndexedDB meta kind", async () => {
    const key = await testAesKey();
    await assert.rejects(
      () =>
        sealToken("ya29.x", Date.now() + 60_000, key, {
          kind: "idb",
          credId: "idb",
          salt: "idb",
        }),
      /IndexedDB vault sealing is no longer supported/,
    );
  });

  it("clearVaultStorage removes sealed blob and meta", async () => {
    const key = await testAesKey();
    await sealToken("ya29.x", Date.now() + 60_000, key, {
      kind: "prf",
      credId: "YQ==",
      salt: "Yg==",
    });
    clearVaultStorage();
    assert.equal(storage.getItem(DRIVE_TOKEN_STORAGE_KEY), null);
    assert.equal(storage.getItem(DRIVE_VAULT_META_KEY), null);
    assert.equal(hasSealedDriveSession(), false);
  });
});
