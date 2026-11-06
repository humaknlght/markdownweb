import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPreviewFrameCsp,
  previewFrameOriginSrc,
  PREVIEW_FRAME_CSP,
} from "../../src/app/constants.js";

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
