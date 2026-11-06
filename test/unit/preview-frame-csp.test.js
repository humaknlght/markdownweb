import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPreviewFrameCsp,
  previewFrameOriginSrc,
  PREVIEW_FRAME_CSP,
} from "../../src/app/constants.js";

const BASE_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'none'",
  "font-src https://cdn.jsdelivr.net",
  "base-uri 'none'",
  "form-action 'none'",
];

/** @param {string} [originSrc] */
function expectedCsp(originSrc = "") {
  const withOrigin = originSrc ? ` ${originSrc}` : "";
  return [
    BASE_DIRECTIVES[0],
    BASE_DIRECTIVES[1],
    `style-src 'self' 'unsafe-inline'${withOrigin}`,
    `img-src 'self' data: blob:${withOrigin}`,
    `media-src 'self' data: blob:${withOrigin}`,
    BASE_DIRECTIVES[2],
    BASE_DIRECTIVES[3],
    BASE_DIRECTIVES[4],
  ].join("; ");
}

describe("preview frame CSP", () => {
  it("whitelists the embedder origin so Firefox about:blank 'self' can load CSS", () => {
    const origin = "https://markdown.ericperret.org";
    assert.equal(buildPreviewFrameCsp(origin), expectedCsp(origin));
  });

  it("omits non-http origins from style/img/media sources", () => {
    assert.equal(previewFrameOriginSrc(""), "");
    assert.equal(previewFrameOriginSrc("null"), "");
    assert.equal(previewFrameOriginSrc("file://"), "");
    assert.equal(previewFrameOriginSrc("https://evil.example/path"), "");
    assert.equal(buildPreviewFrameCsp(""), PREVIEW_FRAME_CSP);
    assert.equal(PREVIEW_FRAME_CSP, expectedCsp());
  });
});
