/**
 * Adversarial checks for the hybrid vault, path resolution, and export sanitize.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";
import {
  DRIVE_TOKEN_STORAGE_KEY,
  DRIVE_VAULT_META_KEY,
  clearVaultStorage,
  hasSealedDriveSession,
  migrateAwayFromIdbVault,
  sealToken,
  setCachedVaultKey,
  unsealToken,
} from "../../src/drive/drive-token-vault.js";
import {
  DRIVE_TOKEN_SESSION_KEY,
  clearDriveAccessToken,
  getDriveAccessToken,
  tryRestoreDriveAccessToken,
} from "../../src/drive/google-drive.js";
import { cleanPreviewHtml, buildHtmlDocument } from "../../src/lib/export.js";
import { resolveFilePath } from "../../src/lib/fs.js";
import {
  isSafeMediaUri,
  stripRemoteMediaAttributes,
} from "../../src/lib/safe-media-uri.js";

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

describe("security pen: vault", () => {
  /** @type {ReturnType<typeof makeMemoryStorage>} */
  let local;
  /** @type {ReturnType<typeof makeMemoryStorage>} */
  let session;
  /** @type {Storage | undefined} */
  let originalLocal;
  /** @type {Storage | undefined} */
  let originalSession;

  beforeEach(() => {
    local = makeMemoryStorage();
    session = makeMemoryStorage();
    originalLocal = globalThis.localStorage;
    originalSession = globalThis.sessionStorage;
    globalThis.localStorage = /** @type {Storage} */ (local);
    globalThis.sessionStorage = /** @type {Storage} */ (session);
    setCachedVaultKey(null);
    clearDriveAccessToken();
  });

  afterEach(() => {
    clearDriveAccessToken();
    setCachedVaultKey(null);
    if (originalLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocal;
    if (originalSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalSession;
  });

  it("refuses silent restore from a forged IDB vault after migration", async () => {
    local.setItem(
      DRIVE_VAULT_META_KEY,
      JSON.stringify({ kind: "idb", credId: "idb", salt: "idb" }),
    );
    local.setItem(
      DRIVE_TOKEN_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        kind: "idb",
        credId: "idb",
        salt: "idb",
        iv: "AAAA",
        ct: "BBBB",
        expiresAt: Date.now() + 3_600_000,
        token: "ya29.should-never-leak",
      }),
    );
    assert.equal(migrateAwayFromIdbVault(), true);
    assert.equal(hasSealedDriveSession(), false);
    assert.equal(await tryRestoreDriveAccessToken(), false);
    assert.equal(getDriveAccessToken(), null);
    assert.equal(local.getItem(DRIVE_TOKEN_STORAGE_KEY), null);
  });

  it("does not treat PRF ciphertext as a silent boot token", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await sealToken("ya29.sealed", Date.now() + 60_000, key, {
      kind: "prf",
      credId: "Y3JlZA==",
      salt: "c2FsdA==",
    });
    assert.equal(hasSealedDriveSession(), true);
    assert.equal(await tryRestoreDriveAccessToken(), false);
    assert.equal(getDriveAccessToken(), null);
    const opened = await unsealToken(key);
    assert.equal(opened?.token, "ya29.sealed");
  });

  it("never restores or retains a plaintext sessionStorage token", async () => {
    session.setItem(DRIVE_TOKEN_SESSION_KEY, "{not-json");
    assert.equal(await tryRestoreDriveAccessToken(), false);
    assert.equal(session.getItem(DRIVE_TOKEN_SESSION_KEY), null);

    session.setItem(
      DRIVE_TOKEN_SESSION_KEY,
      JSON.stringify({ token: "ya29.x", expiresAt: Date.now() + 1e6 }),
    );
    assert.equal(await tryRestoreDriveAccessToken(), false);
    assert.equal(getDriveAccessToken(), null);
    assert.equal(session.getItem(DRIVE_TOKEN_SESSION_KEY), null);
  });

  it("clears leftover session cache on disconnect without writing a new one", async () => {
    session.setItem(
      DRIVE_TOKEN_SESSION_KEY,
      JSON.stringify({ token: "ya29.live", expiresAt: Date.now() + 60_000 }),
    );
    clearDriveAccessToken();
    assert.equal(getDriveAccessToken(), null);
    assert.equal(session.getItem(DRIVE_TOKEN_SESSION_KEY), null);
    assert.equal(await tryRestoreDriveAccessToken(), false);
  });
});

describe("security pen: path traversal", () => {
  const root = {
    getDirectoryHandle: async () => {
      throw new Error("traversal attempted");
    },
    getFileHandle: async () => {
      throw new Error("open attempted");
    },
  };

  it("blocks nested traversal and dot segments", async () => {
    const attacks = [
      "../etc/passwd",
      "..\\secret",
      "foo/../../bar.md",
      "foo/./bar.md",
      "..",
      ".",
      "..../..../etc",
    ];
    for (const path of attacks) {
      const result = await resolveFilePath(/** @type {any} */ (root), path);
      assert.equal(result, null, path);
    }
  });
});

describe("security pen: export XSS", () => {
  /** @type {Window | undefined} */
  let previousWindow;

  afterEach(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    previousWindow = undefined;
    clearVaultStorage();
  });

  it("neutralizes common XSS payloads in exported HTML", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html>", { url: "https://example.test/" });
    previousWindow = globalThis.window;
    globalThis.window = /** @type {Window} */ (/** @type {unknown} */ (win));
    const el = win.document.createElement("article");
    el.innerHTML = [
      `<img src=x onerror=alert(1)>`,
      `<svg/onload=alert(1)>`,
      `<a href="javascript:alert(1)">x</a>`,
      `<iframe src="javascript:alert(1)"></iframe>`,
      `<math><mi//xlink:href="data:x,<script>alert(1)</script>">`,
      `<p>safe</p>`,
    ].join("");
    const html = cleanPreviewHtml(el);
    const doc = buildHtmlDocument(html, '"><script>alert(1)</script>');
    assert.doesNotMatch(html, /onerror/i);
    assert.doesNotMatch(html, /onload/i);
    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<iframe/i);
    assert.match(html, /safe/);
    assert.doesNotMatch(doc, /<script/i);
    assert.match(doc, /&lt;script&gt;/);
  });

  it("strips remote https images from exported HTML (no phone-home)", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html>", { url: "https://example.test/" });
    previousWindow = globalThis.window;
    globalThis.window = /** @type {Window} */ (/** @type {unknown} */ (win));
    const el = win.document.createElement("article");
    el.innerHTML = [
      `<p>before</p>`,
      `<img src="https://evil.test/beacon.png" alt="remote">`,
      `<img src="data:image/png;base64,AAAA" alt="data">`,
      `<img src="./local.png" alt="local">`,
      `<p>after</p>`,
    ].join("");
    const html = cleanPreviewHtml(el);
    assert.doesNotMatch(html, /https:\/\/evil\.test/);
    assert.match(html, /data:image\/png;base64,AAAA/);
    assert.match(html, /\.\/local\.png/);
    assert.match(html, /md-remote-media-blocked/);
    assert.match(html, /before/);
    assert.match(html, /after/);
  });
});

describe("security pen: safe media URI", () => {
  it("allows data, blob, and relative URIs only", () => {
    assert.equal(isSafeMediaUri("data:image/png;base64,AA"), true);
    assert.equal(isSafeMediaUri("blob:https://example.test/uuid"), true);
    assert.equal(isSafeMediaUri("./x.png"), true);
    assert.equal(isSafeMediaUri("/assets/x.png"), true);
    assert.equal(isSafeMediaUri("assets/x.png"), true);
    assert.equal(isSafeMediaUri("https://evil.test/x.png"), false);
    assert.equal(isSafeMediaUri("http://evil.test/x.png"), false);
    assert.equal(isSafeMediaUri("//evil.test/x.png"), false);
    assert.equal(isSafeMediaUri("javascript:alert(1)"), false);
  });

  it("strips remote attributes on media elements", () => {
    const { window: win } = new JSDOM("<!DOCTYPE html>");
    const img = win.document.createElement("img");
    img.setAttribute("src", "https://evil.test/t.png");
    img.setAttribute("alt", "x");
    stripRemoteMediaAttributes(img);
    assert.equal(img.hasAttribute("src"), false);
    assert.ok(img.classList.contains("md-remote-media-blocked"));
  });
});
