import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import {
  buildPropMangleMap,
  collectImportedExportNames,
  createStateHooksManglePlugin,
  mangleStateHooksSource,
  rewriteHooksToDirectImports,
  stripUnreferencedExports,
} from "../../scripts/mangle-state-hooks.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("mangle-state-hooks", () => {
  it("rewrites state members but leaves strings and regex bodies alone", () => {
    const map = buildPropMangleMap(["splitPercent", "lineWrapEnabled"]);
    const out = mangleStateHooksSource(
      [
        "state.splitPercent = 50;",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source for mangler
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

  it("keeps app exports imported from outside src/app (e.g. lib)", async () => {
    const srcRoot = path.join(repoRoot, "src");
    const imported = await collectImportedExportNames(srcRoot);
    assert.ok(
      imported.has("PRINT_FRAME_SANDBOX"),
      "PRINT_FRAME_SANDBOX is imported from src/lib/export.js",
    );
    const kept = stripUnreferencedExports(
      'export const PRINT_FRAME_SANDBOX = "allow-modals";\nexport const ONLY_APP_INTERNAL = 1;\n',
      imported,
    );
    assert.match(kept, /export const PRINT_FRAME_SANDBOX/);
  });

  it("production esbuild with mangler compiles (cross-folder app exports)", {
    timeout: 60_000,
  }, async () => {
    // Mirrors scripts/build.mjs JS bundling: mangler must not strip exports
    // that src/lib (etc.) imports from src/app, or esbuild fails.
    const appDir = path.join(repoRoot, "src/app");
    const outdir = await fs.mkdtemp(
      path.join(os.tmpdir(), "md-mangle-bundle-"),
    );
    const plugin = await createStateHooksManglePlugin(appDir);
    const result = await esbuild.build({
      entryPoints: [
        path.join(appDir, "app.js"),
        path.join(repoRoot, "src/drive/drive-helper.js"),
      ],
      bundle: true,
      minify: true,
      format: "esm",
      splitting: true,
      target: ["es2020"],
      write: false,
      outdir,
      entryNames: "[name]",
      chunkNames: "chunk-[hash]",
      legalComments: "none",
      treeShaking: true,
      plugins: [plugin],
      external: ["marked", "dompurify", "highlight.js", "gemoji", "yaml"],
      logLevel: "silent",
    });
    assert.ok(result.outputFiles.length > 0);
    const joined = result.outputFiles.map((f) => f.text).join("\n");
    assert.match(
      joined,
      /allow-same-origin allow-popups allow-modals/,
      "PRINT_FRAME_SANDBOX must survive mangler + bundle",
    );
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
