import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decryptDriveAuthHandoff,
  encryptDriveAuthHandoff,
  exportDriveAuthHandoffKey,
  generateDriveAuthHandoffKey,
  importDriveAuthHandoffKey,
  isDriveAuthHandoffKeyParam,
} from "../../src/drive/drive-auth-handoff.js";

describe("drive-auth-handoff", () => {
  it("round-trips base64url bytes", () => {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const encoded = bytesToBase64Url(raw);
    assert.equal(isDriveAuthHandoffKeyParam(encoded), true);
    assert.deepEqual(base64UrlToBytes(encoded), raw);
  });

  it("rejects malformed handoff key params", () => {
    assert.equal(isDriveAuthHandoffKeyParam(""), false);
    assert.equal(isDriveAuthHandoffKeyParam(null), false);
    assert.equal(isDriveAuthHandoffKeyParam("not-base64!!!"), false);
    assert.equal(isDriveAuthHandoffKeyParam(bytesToBase64Url(new Uint8Array(16))), false);
  });

  it("encrypts and decrypts an auth payload with an ephemeral key", async () => {
    const key = await generateDriveAuthHandoffKey();
    const param = await exportDriveAuthHandoffKey(key);
    const imported = await importDriveAuthHandoffKey(param);

    const cipher = await encryptDriveAuthHandoff(imported, {
      accessToken: "ya29.test-token",
      expiresIn: 3600,
    });
    assert.equal(typeof cipher.iv, "string");
    assert.equal(typeof cipher.ct, "string");
    assert.equal(cipher.ct.includes("ya29"), false);

    const opened = await decryptDriveAuthHandoff(key, cipher);
    assert.equal(opened.accessToken, "ya29.test-token");
    assert.equal(opened.expiresIn, 3600);
  });

  it("fails decrypt with a different key", async () => {
    const a = await generateDriveAuthHandoffKey();
    const b = await generateDriveAuthHandoffKey();
    const cipher = await encryptDriveAuthHandoff(a, { accessToken: "secret" });
    await assert.rejects(() => decryptDriveAuthHandoff(b, cipher));
  });

  it("rejects cleartext-shaped auth cipher input", async () => {
    const key = await generateDriveAuthHandoffKey();
    await assert.rejects(() => decryptDriveAuthHandoff(key, /** @type {any} */ ({})));
    await assert.rejects(() =>
      decryptDriveAuthHandoff(key, { iv: "x", ct: "y" }),
    );
  });
});
