import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  buildPropMangleMap,
  mangleStateHooksSource,
  stripUnreferencedExports,
  rewriteHooksToDirectImports,
} from "../../scripts/mangle-state-hooks.mjs";

describe("mangle-state-hooks", () => {
  it("rewrites state members but leaves strings and regex bodies alone", () => {
    const map = buildPropMangleMap(["splitPercent", "lineWrapEnabled"]);
    const out = mangleStateHooksSource(
      [
        "state.splitPercent = 50;",
        "const tip = `wrap ${state.lineWrapEnabled}`;",
        "const re = /state.splitPercent/;",
        'const s = "state.splitPercent";',
      ].join("\n"),
      map
    );
    assert.match(out, /\bs\.\w+ = 50/);
    assert.doesNotMatch(out, /\bs\.splitPercent\b/);
    assert.match(out, /\/state\.splitPercent\//);
    assert.match(out, /"state\.splitPercent"/);
  });

  it("mangles top-level state object keys when requested", () => {
    const map = buildPropMangleMap(["splitPercent", "lineWrapEnabled"]);
    const out = mangleStateHooksSource(
      "export const state = {\n  splitPercent: 50,\n  lineWrapEnabled: true,\n};\n",
      map,
      { mangleStateObjectKeys: true }
    );
    assert.match(out, /export const s = \{/);
    assert.doesNotMatch(out, /splitPercent:/);
    assert.doesNotMatch(out, /lineWrapEnabled:/);
    assert.match(out, /^\s*\w+: 50,/m);
  });

  it("strips unreferenced function exports", () => {
    const keep = new Set(["keepMe"]);
    const out = stripUnreferencedExports(
      "export function keepMe() {}\nexport function dropMe() {}\nexport async function dropAsync() {}\n",
      keep
    );
    assert.match(out, /export function keepMe/);
    assert.match(out, /^function dropMe/m);
    assert.match(out, /^async function dropAsync/m);
  });

  it("rewrites hooks calls to direct imports", () => {
    const ui = path.resolve("src/app/ui-feedback.js");
    const other = path.resolve("src/app/boot.js");
    const registry = new Map([
      ["showToast", { file: ui, localName: "showToast" }],
    ]);
    const out = rewriteHooksToDirectImports(
      other,
      'import { hooks } from "./hooks.js";\nhooks.showToast("hi");\n',
      registry,
      path.resolve("src/app")
    );
    assert.match(out, /import \{ showToast \} from "\.\/ui-feedback\.js"/);
    assert.match(out, /showToast\("hi"\)/);
    assert.doesNotMatch(out, /hooks\.showToast/);
  });
});
