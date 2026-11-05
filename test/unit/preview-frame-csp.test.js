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
    const csp = buildPreviewFrameCsp(origin);
    assert.match(csp, new RegExp(`style-src 'self' 'unsafe-inline' ${origin}`));
    assert.match(csp, new RegExp(`img-src 'self' data: blob: ${origin}`));
    assert.match(csp, new RegExp(`media-src 'self' data: blob: ${origin}`));
    assert.match(csp, /script-src 'none'/);
    assert.equal(csp.includes("https://evil.example"), false);
  });

  it("omits non-http origins from style/img/media sources", () => {
    assert.equal(previewFrameOriginSrc(""), "");
    assert.equal(previewFrameOriginSrc("null"), "");
    assert.equal(previewFrameOriginSrc("file://"), "");
    assert.equal(buildPreviewFrameCsp(""), PREVIEW_FRAME_CSP);
    assert.match(PREVIEW_FRAME_CSP, /style-src 'self' 'unsafe-inline';/);
    assert.doesNotMatch(
      PREVIEW_FRAME_CSP,
      /style-src 'self' 'unsafe-inline' https?:/,
    );
  });
});
