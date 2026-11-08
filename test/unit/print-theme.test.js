import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("print.css theme cascade", () => {
  it("uses higher-specificity line-num color without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html\.md-preview-frame\[data-theme\]\s+\.preview\s+\.line-num\s*\{[^}]*color:\s*var\(--syntax-comment\);/s,
    );
    assert.doesNotMatch(
      print,
      /html\.md-preview-frame\[data-theme\]\s+\.preview\s+\.line-num\s*\{[^}]*color:\s*var\(--syntax-comment\)\s*!important/s,
    );
  });

  it("clears page background-image in print without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*background-image:\s*none;/s,
    );
    assert.doesNotMatch(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*background-image:\s*none\s*!important/s,
    );
  });

  it("sets print body color without !important", async () => {
    const print = await fs.readFile(
      path.join(root, "src/styles/print.css"),
      "utf8",
    );
    assert.match(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*color:\s*#1f2328;/s,
    );
    assert.doesNotMatch(
      print,
      /html\[data-theme\]\s+body\s*\{[^}]*color:\s*#1f2328\s*!important/s,
    );
  });
});
