import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  absolutizeEsmModuleSpecifiers,
  collectEsmModuleSpecifiers,
  fetchEsmCdnGraph,
  isEsmModuleSpecifier,
} from "../../src/lib/esm-cdn-graph.js";

describe("esm-cdn-graph", () => {
  it("recognizes jsDelivr ESM specifiers only", () => {
    assert.equal(isEsmModuleSpecifier("./chunk.mjs"), true);
    assert.equal(isEsmModuleSpecifier("/npm/x@1/+esm"), true);
    assert.equal(
      isEsmModuleSpecifier("https://cdn.jsdelivr.net/npm/x@1/y.mjs"),
      true,
    );
    assert.equal(isEsmModuleSpecifier("mermaid"), false);
    assert.equal(isEsmModuleSpecifier("./x,y.mjs"), false);
  });

  it("absolutizes relative and root-absolute imports", () => {
    const base =
      "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs";
    const out = absolutizeEsmModuleSpecifiers(
      'import"./chunks/a.mjs";import("./chunks/b.mjs");export{x}from"/npm/dep@1/+esm";',
      base,
    );
    assert.match(
      out,
      /import "https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@12\.2\.0\/dist\/chunks\/a\.mjs"/,
    );
    assert.match(
      out,
      /import\("https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@12\.2\.0\/dist\/chunks\/b\.mjs"\)/,
    );
    assert.match(out, /from "https:\/\/cdn\.jsdelivr\.net\/npm\/dep@1\/\+esm"/);
    assert.deepEqual(collectEsmModuleSpecifiers(out).sort(), [
      "https://cdn.jsdelivr.net/npm/dep@1/+esm",
      "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/chunks/a.mjs",
      "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/chunks/b.mjs",
    ]);
  });

  it("fetches a tiny graph with request SRI", async () => {
    const entry = "https://cdn.jsdelivr.net/npm/pkg@1/entry.mjs";
    const dep = "https://cdn.jsdelivr.net/npm/pkg@1/dep.mjs";
    const integrity = {
      [entry]: "sha384-entry",
      [dep]: "sha384-dep",
    };
    /** @type {string[]} */
    const seen = [];
    const modules = await fetchEsmCdnGraph(
      [entry],
      integrity,
      async (url, init) => {
        seen.push(`${url}|${init.integrity}`);
        const body =
          url === entry ? 'export{x}from"./dep.mjs";' : "export const x = 1;";
        return new Response(body, { status: 200 });
      },
    );
    assert.deepEqual(seen, [`${entry}|sha384-entry`, `${dep}|sha384-dep`]);
    assert.equal(
      modules[entry],
      'export{x}from "https://cdn.jsdelivr.net/npm/pkg@1/dep.mjs";',
    );
    assert.equal(modules[dep], "export const x = 1;");
  });
});
