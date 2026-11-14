import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPreviewFrameCsp,
  PREVIEW_FRAME_CSP,
  PREVIEW_FRAME_SANDBOX,
  PRINT_FRAME_SANDBOX,
  previewFrameOriginSrc,
} from "../../src/app/constants.js";

describe("preview / print frame sandbox", () => {
  it("shares the same base tokens and never enables scripts", () => {
    expectSandboxTokens(PREVIEW_FRAME_SANDBOX, [
      "allow-popups",
      "allow-same-origin",
    ]);
    expectSandboxTokens(PRINT_FRAME_SANDBOX, [
      "allow-modals",
      "allow-popups",
      "allow-same-origin",
    ]);
    assert.doesNotMatch(PREVIEW_FRAME_SANDBOX, /\ballow-scripts\b/);
    assert.doesNotMatch(PRINT_FRAME_SANDBOX, /\ballow-scripts\b/);
  });
});

/**
 * @param {string} sandbox
 * @param {string[]} expected
 */
function expectSandboxTokens(sandbox, expected) {
  assert.equal(sandbox.split(/\s+/).sort().join(" "), expected.join(" "));
}

describe("preview frame CSP", () => {
  it("whitelists the embedder origin so Firefox about:blank 'self' can load CSS", () => {
    const origin = "https://markdown.ericperret.org";
    assert.equal(
      buildPreviewFrameCsp(origin),
      [
        "default-src 'none'",
        "script-src 'none'",
        `style-src 'self' 'unsafe-inline' ${origin}`,
        `img-src 'self' data: blob: ${origin}`,
        `media-src 'self' data: blob: ${origin}`,
        "font-src https://cdn.jsdelivr.net",
        "base-uri 'none'",
        "form-action 'none'",
      ].join(";"),
    );
  });

  it("omits non-http origins from style/img/media sources", () => {
    assert.equal(previewFrameOriginSrc(""), "");
    assert.equal(previewFrameOriginSrc("null"), "");
    assert.equal(previewFrameOriginSrc("file://"), "");
    assert.equal(buildPreviewFrameCsp(""), PREVIEW_FRAME_CSP);
    assert.equal(
      PREVIEW_FRAME_CSP,
      [
        "default-src 'none'",
        "script-src 'none'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "font-src https://cdn.jsdelivr.net",
        "base-uri 'none'",
        "form-action 'none'",
      ].join(";"),
    );
  });
});
