import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  DRIVE_TOKEN_STORAGE_KEY,
  DRIVE_VAULT_META_KEY,
  clearVaultStorage,
  ensureIdbVaultKey,
  ensureVaultKey,
  hasSealedDriveSession,
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
    const meta = { credId: "Y3JlZA==", salt: "c2FsdA==" };
    await sealToken("ya29.old", Date.now() - 1_000, key, meta);
    assert.equal(hasSealedDriveSession(), false);
    assert.equal(await unsealToken(key), null);
  });

  it("falls back to IndexedDB AES when WebAuthn is unavailable", async () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { isSecureContext: false },
    });
    try {
      const { key, kind } = await ensureVaultKey();
      assert.equal(kind, "idb");
      assert.ok(key);
      const meta = readVaultMeta();
      assert.equal(meta?.kind, "idb");
      await sealToken("ya29.idb", Date.now() + 60_000, key, meta);
      const stored = storage.getItem(DRIVE_TOKEN_STORAGE_KEY);
      assert.ok(stored);
      assert.doesNotMatch(stored, /ya29\.idb/);
      assert.equal(JSON.parse(stored).token, undefined);
      setCachedVaultKey(null);
      const again = await ensureIdbVaultKey();
      const opened = await unsealToken(again.key);
      assert.equal(opened?.token, "ya29.idb");
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("ensureVaultKey defaults to IndexedDB for new sessions", async () => {
    const { key, kind } = await ensureVaultKey();
    assert.equal(kind, "idb");
    assert.ok(key);
    const meta = readVaultMeta();
    assert.equal(meta?.kind, "idb");
    await sealToken("ya29.new", Date.now() + 60_000, key, meta);
    assert.doesNotMatch(storage.getItem(DRIVE_TOKEN_STORAGE_KEY) || "", /ya29\.new/);
  });

  it("clearVaultStorage removes sealed blob and meta", async () => {
    const key = await testAesKey();
    await sealToken("ya29.x", Date.now() + 60_000, key, {
      credId: "YQ==",
      salt: "Yg==",
    });
    clearVaultStorage();
    assert.equal(storage.getItem(DRIVE_TOKEN_STORAGE_KEY), null);
    assert.equal(storage.getItem(DRIVE_VAULT_META_KEY), null);
    assert.equal(hasSealedDriveSession(), false);
  });
});
