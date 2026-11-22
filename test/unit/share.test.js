import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  base64UrlToUtf8,
  bytesToBase64Url,
  compressUtf8ToBase64Url,
  decodeMdParam,
  decodeMdzParam,
  decompressBase64UrlToUtf8,
  readShareParams,
  SHARE_MAX_DECODED_BYTES,
} from "../../src/lib/share.js";

describe("share encoding", () => {
  it("round-trips UTF-8 and emoji through base64url", () => {
    const text = "Hello 👋 café";
    const encoded = bytesToBase64Url(new TextEncoder().encode(text));
    assert.doesNotMatch(encoded, /[+/=]/);
    assert.equal(base64UrlToUtf8(encoded), text);
  });

  it("round-trips deflate-raw mdz payloads", async () => {
    const text = "# Title\n\nBody with ✨ and non-latin: 日本語";
    const encoded = await compressUtf8ToBase64Url(text);
    assert.doesNotMatch(encoded, /[+/=]/);
    assert.equal(await decompressBase64UrlToUtf8(encoded), text);
    assert.equal(await decodeMdzParam(encoded), text);
  });

  it("rejects mdz payloads that inflate past the size limit", async () => {
    const bomb = await compressUtf8ToBase64Url(
      "a".repeat(SHARE_MAX_DECODED_BYTES + 1),
    );
    assert.ok(bomb.length < 20_000);
    await assert.rejects(decompressBase64UrlToUtf8(bomb), RangeError);
    assert.equal(await decodeMdzParam(bomb), null);
  });

  it("honors a custom inflate limit at the boundary", async () => {
    const encoded = await compressUtf8ToBase64Url("x".repeat(1000));
    assert.equal(
      await decompressBase64UrlToUtf8(encoded, { maxBytes: 1000 }),
      "x".repeat(1000),
    );
    await assert.rejects(
      decompressBase64UrlToUtf8(encoded, { maxBytes: 999 }),
      RangeError,
    );
  });

  it("decodes md as base64url, then URI, then raw", () => {
    const text = "plain markdown";
    const b64 = bytesToBase64Url(new TextEncoder().encode(text));
    assert.equal(decodeMdParam(b64), text);
    assert.equal(decodeMdParam(encodeURIComponent("a b")), "a b");
    assert.equal(decodeMdParam(""), null);
  });

  it("rejects md values that would decode past the size limit", () => {
    const atLimit = bytesToBase64Url(
      new Uint8Array(SHARE_MAX_DECODED_BYTES).fill(0x61),
    );
    assert.equal(decodeMdParam(atLimit)?.length, SHARE_MAX_DECODED_BYTES);
    assert.equal(decodeMdParam(`${atLimit}AAAA`), null);
  });

  it("prefers mdz and validates theme/view against allow-lists", async () => {
    const md = await compressUtf8ToBase64Url("hi");
    const params = new URLSearchParams({
      mdz: md,
      md: "ignored",
      theme: "fancy",
      view: "edit",
    });
    const result = await readShareParams(params, {
      themes: ["fancy"],
      views: ["edit", "reader"],
    });
    assert.equal(result.markdown, "hi");
    assert.equal(result.theme, "fancy");
    assert.equal(result.view, "edit");

    const bad = await readShareParams(
      new URLSearchParams({ theme: "nope", view: "nope" }),
      {
        themes: ["fancy"],
        views: ["edit"],
      },
    );
    assert.equal(bad.theme, null);
    assert.equal(bad.view, null);
  });

  it("falls back to md when mdz is corrupt", async () => {
    const md = bytesToBase64Url(new TextEncoder().encode("legacy"));
    const result = await readShareParams(
      new URLSearchParams({ mdz: "!!!", md }),
      {
        themes: [],
        views: [],
      },
    );
    assert.equal(result.markdown, "legacy");
  });
});
