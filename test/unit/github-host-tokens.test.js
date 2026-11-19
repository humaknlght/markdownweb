import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import "fake-indexeddb/auto";
import {
  GIST_TOKEN_STORAGE_KEY,
  GIST_VAULT_META_KEY,
  sealToken,
  setCachedVaultKey,
} from "../../src/gist/gist-token-vault.js";
import {
  clearGistAccessToken,
  setGistPersonalAccessToken,
} from "../../src/gist/github-gist.js";
import {
  assertTokenNotSavedForOtherHost,
  clearSharedGithubTokenOnce,
  findOtherHostWithToken,
  GITHUB_HOST_TOKEN_KEY_PREFIX,
  GITHUB_TOKEN_SCOPE_MIGRATION_KEY,
  getGithubHostToken,
  hasSealedGithubHostToken,
  removeGithubHostToken,
  setGithubHostToken,
  unlockGithubHostToken,
} from "../../src/gist/github-host-tokens.js";

const HOST_A = "git.example.test";
const HOST_B = "ghe.other.test";
const META = { kind: "prf", credId: "Y3JlZA==", salt: "c2FsdA==" };

function makeMemoryStorage() {
  /** @type {Map<string, string>} */
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
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

/**
 * Simulate an unlocked PRF vault (key cached, meta stored).
 * @returns {Promise<CryptoKey>}
 */
async function readyVault() {
  const key = await testAesKey();
  globalThis.localStorage.setItem(GIST_VAULT_META_KEY, JSON.stringify(META));
  setCachedVaultKey(key);
  return key;
}

describe("github-host-tokens", () => {
  /** @type {ReturnType<typeof makeMemoryStorage>} */
  let storage;
  /** @type {Storage | undefined} */
  let originalStorage;

  beforeEach(() => {
    storage = makeMemoryStorage();
    originalStorage = globalThis.localStorage;
    globalThis.localStorage = /** @type {Storage} */ (storage);
    setCachedVaultKey(null);
  });

  afterEach(() => {
    removeGithubHostToken(HOST_A);
    removeGithubHostToken(HOST_B);
    clearGistAccessToken();
    setCachedVaultKey(null);
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  });

  it("refuses github.com as an enterprise host", async () => {
    await assert.rejects(setGithubHostToken("github.com", "ghp_x"));
    await assert.rejects(setGithubHostToken("", "ghp_x"));
  });

  it("keeps a memory-only token when the vault is not ready", async () => {
    const result = await setGithubHostToken(HOST_A, "ghp_host_a");
    assert.equal(result.sealed, false);
    assert.equal(getGithubHostToken(HOST_A), "ghp_host_a");
    assert.equal(getGithubHostToken(HOST_B), null);
    assert.equal(hasSealedGithubHostToken(HOST_A), false);
  });

  it("seals one blob per host without storing plaintext", async () => {
    await readyVault();
    const result = await setGithubHostToken(HOST_A, "ghp_host_a_secret");
    assert.equal(result.sealed, true);

    const raw = storage.getItem(`${GITHUB_HOST_TOKEN_KEY_PREFIX}${HOST_A}`);
    assert.ok(raw);
    assert.doesNotMatch(raw, /ghp_host_a_secret/);
    assert.equal(hasSealedGithubHostToken(HOST_A), true);
    assert.equal(hasSealedGithubHostToken(HOST_B), false);

    removeGithubHostToken(HOST_A);
    assert.equal(getGithubHostToken(HOST_A), null);
    assert.equal(hasSealedGithubHostToken(HOST_A), false);
  });

  it("unlocks a sealed host token with the cached vault key", async () => {
    const key = await readyVault();
    const expiresAt = Date.now() + 3_600_000;
    await sealToken(
      "ghp_sealed_a",
      expiresAt,
      key,
      META,
      `${GITHUB_HOST_TOKEN_KEY_PREFIX}${HOST_A}`,
    );
    assert.equal(getGithubHostToken(HOST_A), null);
    assert.equal(await unlockGithubHostToken(HOST_A), "ghp_sealed_a");
    assert.equal(getGithubHostToken(HOST_A), "ghp_sealed_a");
  });

  it("refuses the github.com token for an enterprise host", async () => {
    await setGistPersonalAccessToken("ghp_github_com");
    assert.equal(
      await findOtherHostWithToken("ghp_github_com", HOST_A),
      "github.com",
    );
    await assert.rejects(setGithubHostToken(HOST_A, "ghp_github_com"), {
      name: "TokenReuseError",
      message: /already saved for github\.com/,
    });
    assert.equal(getGithubHostToken(HOST_A), null);
  });

  it("refuses an enterprise token for github.com", async () => {
    await setGithubHostToken(HOST_A, "ghp_host_a");
    await assert.rejects(
      assertTokenNotSavedForOtherHost("ghp_host_a", "github.com"),
      { name: "TokenReuseError", message: new RegExp(HOST_A) },
    );
  });

  it("refuses a token saved for another enterprise host", async () => {
    await setGithubHostToken(HOST_A, "ghp_shared");
    await assert.rejects(setGithubHostToken(HOST_B, "ghp_shared"), {
      name: "TokenReuseError",
    });
    assert.equal(getGithubHostToken(HOST_B), null);
  });

  it("finds a reused token in a sealed blob that is not unlocked yet", async () => {
    const key = await readyVault();
    await sealToken(
      "ghp_sealed_b",
      Date.now() + 3_600_000,
      key,
      META,
      `${GITHUB_HOST_TOKEN_KEY_PREFIX}${HOST_B}`,
    );
    assert.equal(getGithubHostToken(HOST_B), null);
    assert.equal(await findOtherHostWithToken("ghp_sealed_b", HOST_A), HOST_B);
  });

  it("clears the shared GitHub token once", () => {
    storage.setItem(GIST_TOKEN_STORAGE_KEY, '{"v":1}');
    storage.setItem(GIST_VAULT_META_KEY, JSON.stringify(META));

    assert.equal(clearSharedGithubTokenOnce(), true);
    assert.equal(storage.getItem(GIST_TOKEN_STORAGE_KEY), null);
    assert.ok(storage.getItem(GIST_VAULT_META_KEY), "keeps the passkey vault");
    assert.equal(storage.getItem(GITHUB_TOKEN_SCOPE_MIGRATION_KEY), "1");

    storage.setItem(GIST_TOKEN_STORAGE_KEY, '{"v":1}');
    assert.equal(clearSharedGithubTokenOnce(), false);
    assert.ok(storage.getItem(GIST_TOKEN_STORAGE_KEY), "runs only once");
  });

  it("only marks the cleanup done when no GitHub token is saved", () => {
    assert.equal(clearSharedGithubTokenOnce(), false);
    assert.equal(storage.getItem(GITHUB_TOKEN_SCOPE_MIGRATION_KEY), "1");
  });

  it("allows replacing the token for the same host", async () => {
    await setGithubHostToken(HOST_A, "ghp_old");
    await setGithubHostToken(HOST_A, "ghp_old");
    await setGithubHostToken(HOST_A, "ghp_new");
    assert.equal(getGithubHostToken(HOST_A), "ghp_new");
    assert.equal(await findOtherHostWithToken("ghp_new", HOST_B), HOST_A);
  });
});
