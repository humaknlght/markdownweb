import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyPatch,
  contentHash,
  makePatch,
  makeRevisionBody,
} from "../../src/history-diff.js";

describe("history-diff", () => {
  it("hashes stably and treats null like empty", () => {
    assert.equal(contentHash("hello"), contentHash("hello"));
    assert.notEqual(contentHash("hello"), contentHash("world"));
    assert.equal(contentHash(null), contentHash(""));
    assert.equal(contentHash(undefined), contentHash(""));
  });

  it("round-trips insert/delete/replace patches", () => {
    const cases = [
      ["line1\nline2\nline3", "line1\nchanged\nline3"],
      ["", "new line"],
      ["old\nline", ""],
    ];
    for (const [base, target] of cases) {
      assert.equal(applyPatch(base, makePatch(base, target)), target);
    }
    // Equal strings produce empty ops; applying them yields "" (no "=" keep ops).
    assert.equal(makePatch("a", "a"), '{"v":1,"ops":[]}');
    assert.equal(applyPatch("a", makePatch("a", "a")), "");
  });

  it("returns empty ops for equal strings", () => {
    assert.equal(makePatch("a", "a"), '{"v":1,"ops":[]}');
  });

  it("returns the base on malformed patches", () => {
    assert.equal(applyPatch("base", "not json"), "base");
    assert.equal(applyPatch("base", "{}"), "base");
    assert.equal(applyPatch("base", '{"v":1,"ops":"bad"}'), "base");
  });

  it("uses a replace-all patch when the DP table would be huge", () => {
    const bigA = "x\n".repeat(2001);
    const bigB = "y\n".repeat(2001);
    const patch = JSON.parse(makePatch(bigA, bigB));
    assert.equal(patch.ops.length, 2);
    assert.equal(typeof patch.ops[0], "number");
    assert.equal(applyPatch(bigA, JSON.stringify(patch)), bigB);
  });

  it("chooses full content when the patch is not smaller", () => {
    const result = makeRevisionBody("", "x".repeat(200));
    assert.equal(result.kind, "full");
    assert.equal(result.content, "x".repeat(200));
  });

  it("prefers a compact patch for small edits", () => {
    const base = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const target = base.replace("line 10", "line 10 changed");
    const result = makeRevisionBody(base, target);
    assert.equal(result.kind, "patch");
    assert.equal(applyPatch(base, result.patch), target);
  });
});
