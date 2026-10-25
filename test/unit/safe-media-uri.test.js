import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  isSafeMediaUri,
  stripRemoteMediaAttributes,
} from "../../src/lib/safe-media-uri.js";

describe("safe-media-uri", () => {
  it("classifies URIs for no-phone-home policy", () => {
    assert.equal(isSafeMediaUri(""), true);
    assert.equal(isSafeMediaUri("data:image/gif;base64,R0lG"), true);
    assert.equal(isSafeMediaUri("blob:null/abc"), true);
    assert.equal(isSafeMediaUri("#frag"), true);
    assert.equal(isSafeMediaUri("?q=1"), true);
    assert.equal(isSafeMediaUri("https://raw.githubusercontent.com/a/b/c.png"), false);
    assert.equal(isSafeMediaUri("HTTPS://Evil.Example/x"), false);
  });

  it("clears svg image and use hrefs", () => {
    const { window: win } = new JSDOM(`<!DOCTYPE html><div id="root"></div>`);
    const root = win.document.getElementById("root");
    root.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">` +
      `<image href="https://evil.test/a.svg"></image>` +
      `<use xlink:href="https://evil.test/b.svg"></use>` +
      `</svg>`;
    const image = root.querySelector("image");
    const use = root.querySelector("use");
    assert.ok(image);
    assert.ok(use);
    stripRemoteMediaAttributes(image);
    stripRemoteMediaAttributes(use);
    assert.equal(image.getAttribute("href"), null);
    assert.equal(use.getAttribute("xlink:href"), null);
    assert.equal(use.getAttributeNS("http://www.w3.org/1999/xlink", "href"), null);
  });
});
