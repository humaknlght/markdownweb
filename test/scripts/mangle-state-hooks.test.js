import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildPropMangleMap,
  mangleStateHooksSource,
  rewriteHooksToDirectImports,
  stripUnreferencedExports,
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
      map,
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
      { mangleStateObjectKeys: true },
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
      keep,
    );
    assert.match(out, /export function keepMe/);
    assert.match(out, /^function dropMe/m);
    assert.match(out, /^async function dropAsync/m);
  });

  it("preserves third-party object keys named hooks/state", () => {
    const map = buildPropMangleMap(["paintGen"]);
    const out = mangleStateHooksSource(
      [
        'import { hooks } from "./hooks.js";',
        "marked.use({ hooks: { processAllTokens(t) { return t; } } });",
        "hooks.paintGen;",
        "const cfg = { state: true, hooks: false };",
      ].join("\n"),
      map,
    );
    assert.match(out, /marked\.use\(\{\s*hooks:\s*\{/);
    assert.match(out, /const cfg = \{\s*state:\s*true,\s*hooks:\s*false/);
    assert.match(out, /\bh\.\w+/); // hooks.paintGen → h.<mangled>
    assert.doesNotMatch(out, /\bhooks\.paintGen\b/);
  });

  it("preserves platform .state / .hooks property access", () => {
    const map = buildPropMangleMap(["deferredInstallPrompt"]);
    const out = mangleStateHooksSource(
      [
        'import { state } from "./state.js";',
        'import { hooks } from "./hooks.js";',
        'if (worker.state === "installed") offerUpdate(worker);',
        'if (audioCtx.state === "suspended") audioCtx.resume();',
        "const apiHooks = marked.hooks;",
        "state.deferredInstallPrompt = null;",
        "hooks.paintGen;",
      ].join("\n"),
      map,
    );
    assert.match(out, /worker\.state === "installed"/);
    assert.match(out, /audioCtx\.state === "suspended"/);
    assert.match(out, /marked\.hooks/);
    assert.match(out, /\bs\.\w+ = null/); // state bag shortened
    assert.doesNotMatch(out, /\bstate\.deferredInstallPrompt\b/);
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
      path.resolve("src/app"),
    );
    assert.match(out, /import \{ showToast \} from "\.\/ui-feedback\.js"/);
    assert.match(out, /showToast\("hi"\)/);
    assert.doesNotMatch(out, /hooks\.showToast/);
  });
});
