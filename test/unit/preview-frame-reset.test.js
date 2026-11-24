import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import {
  adoptPreviewFrameReset,
  PREVIEW_FRAME_RESET_CSS,
} from "../../src/app/preview-frame-reset.js";

describe("preview frame reset", () => {
  it("hides iframe overflow and drops the fixed page background", () => {
    assert.match(PREVIEW_FRAME_RESET_CSS, /overflow:hidden!important/);
    assert.match(PREVIEW_FRAME_RESET_CSS, /background-image:none!important/);
    assert.match(PREVIEW_FRAME_RESET_CSS, /html\.md-preview-frame body/);
  });

  it("adopts the reset sheet onto the preview document", () => {
    const { window: win, document: doc } = new JSDOM(
      "<!DOCTYPE html><html class='md-preview-frame'><head></head><body></body></html>",
    ).window;
    /** @type {string[]} */
    const synced = [];
    class FakeSheet {
      /** @param {string} css */
      replaceSync(css) {
        synced.push(css);
      }
    }
    win.CSSStyleSheet = FakeSheet;
    /** @type {FakeSheet[]} */
    const adopted = [];
    Object.defineProperty(doc, "adoptedStyleSheets", {
      configurable: true,
      get: () => adopted,
      set: (next) => {
        adopted.length = 0;
        adopted.push(...next);
      },
    });

    assert.equal(adoptPreviewFrameReset(doc), true);
    assert.equal(adopted.length, 1);
    assert.match(synced[0], /overflow:hidden!important/);
  });
});
