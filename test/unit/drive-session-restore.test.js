import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  DRIVE_TOKEN_SESSION_KEY,
  clearDriveAccessToken,
  getDriveAccessToken,
  setDriveAccessToken,
  tryRestoreDriveAccessToken,
} from "../../src/drive/google-drive.js";

function makeMemoryStorage() {
  /** @type {Map<string, string>} */
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

describe("drive session restore", () => {
  /** @type {ReturnType<typeof makeMemoryStorage>} */
  let session;
  /** @type {ReturnType<typeof makeMemoryStorage>} */
  let local;
  /** @type {Storage | undefined} */
  let originalSession;
  /** @type {Storage | undefined} */
  let originalLocal;

  beforeEach(() => {
    session = makeMemoryStorage();
    local = makeMemoryStorage();
    originalSession = globalThis.sessionStorage;
    originalLocal = globalThis.localStorage;
    globalThis.sessionStorage = /** @type {Storage} */ (session);
    globalThis.localStorage = /** @type {Storage} */ (local);
    clearDriveAccessToken();
  });

  afterEach(() => {
    clearDriveAccessToken();
    if (originalSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalSession;
    if (originalLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocal;
  });

  it("keeps the live token in memory without writing sessionStorage", async () => {
    setDriveAccessToken("ya29.live", 3600);
    assert.equal(getDriveAccessToken(), "ya29.live");
    assert.equal(session.getItem(DRIVE_TOKEN_SESSION_KEY), null);
    assert.equal(await tryRestoreDriveAccessToken(), true);
  });

  it("purges leftover plaintext sessionStorage and does not restore it", async () => {
    session.setItem(
      DRIVE_TOKEN_SESSION_KEY,
      JSON.stringify({ token: "ya29.legacy", expiresAt: Date.now() + 60_000 }),
    );
    assert.equal(await tryRestoreDriveAccessToken(), false);
    assert.equal(getDriveAccessToken(), null);
    assert.equal(session.getItem(DRIVE_TOKEN_SESSION_KEY), null);
  });

  it("does not silently restore a PRF-sealed localStorage blob", async () => {
    local.setItem(
      "md-editor:driveAccessToken",
      JSON.stringify({
        v: 1,
        kind: "prf",
        credId: "YQ==",
        salt: "Yg==",
        iv: "YQ==",
        ct: "Yg==",
        expiresAt: Date.now() + 60_000,
      }),
    );
    local.setItem(
      "md-editor:driveTokenVault",
      JSON.stringify({ kind: "prf", credId: "YQ==", salt: "Yg==" }),
    );
    assert.equal(await tryRestoreDriveAccessToken(), false);
    assert.equal(getDriveAccessToken(), null);
  });
});
