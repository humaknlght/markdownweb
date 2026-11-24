import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

class FakeSheet {
  constructor() {
    this._text = "";
  }
  replaceSync(text) {
    this._text = String(text);
  }
}

describe("dynamic-style", () => {
  async function loadHelper(win) {
    globalThis.document = win.document;
    globalThis.CSSStyleSheet = win.CSSStyleSheet;
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    // Fresh module per test so sheet / maps reset.
    return import(
      `../../src/lib/dynamic-style.js?t=${Date.now()}-${Math.random()}`
    );
  }

  function installDom() {
    const { window: win } = new JSDOM(
      "<!DOCTYPE html><html><body></body></html>",
    );
    win.CSSStyleSheet = FakeSheet;
    win.document.adoptedStyleSheets = [];
    return win;
  }

  it("sets and clears :root custom properties via adoptedStyleSheets", async () => {
    const win = installDom();
    const { setRootVars, ensureDynamicStyleSheet } = await loadHelper(win);
    const sheet = ensureDynamicStyleSheet();
    assert.equal(win.document.adoptedStyleSheets.includes(sheet), true);

    setRootVars({ "--split": "42%" });
    assert.match(sheet._text, /:root\{--split:42%\}/);

    setRootVars({ "--split": null, "--preview-frame-height": "120px" });
    assert.doesNotMatch(sheet._text, /--split/);
    assert.match(sheet._text, /--preview-frame-height:120px/);
  });

  it("setRule and setRawBlock round-trip", async () => {
    const win = installDom();
    const { setRule, clearRule, setRawBlock, ensureDynamicStyleSheet } =
      await loadHelper(win);
    ensureDynamicStyleSheet();
    const sheet = win.document.adoptedStyleSheets[0];

    setRule("#files-drawer", { width: "200px" });
    assert.match(sheet._text, /#files-drawer\{width:200px\}/);

    setRawBlock("print-orientation", "@media print{@page{size:landscape}}");
    assert.match(sheet._text, /@media print\{@page\{size:landscape\}\}/);

    clearRule("#files-drawer");
    setRawBlock("print-orientation", null);
    assert.equal(sheet._text, "");
  });
});
