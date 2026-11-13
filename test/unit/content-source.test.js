import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("content source chrome", () => {
  it("ships toolbar icons for fs, url, drive, and gist", async () => {
    const html = await fs.readFile(path.join(root, "src/index.html"), "utf8");
    assert.match(html, /id="current-file"/);
    for (const source of ["fs", "url", "drive", "gist"]) {
      assert.match(
        html,
        new RegExp(`data-source-icon="${source}"`),
        `missing ${source} icon`,
      );
    }
  });

  it("tracks contentSource on bind/clear and URL open paths", async () => {
    const model = await fs.readFile(
      path.join(root, "src/app/document-model.js"),
      "utf8",
    );
    assert.match(model, /state\.contentSource = "fs"/);
    assert.match(model, /state\.contentSource = "drive"/);
    assert.match(model, /state\.contentSource = "gist"/);
    assert.match(model, /state\.contentSource = "url"/);
    assert.match(model, /state\.contentSource = null/);
    assert.match(model, /export function bindCurrentUrlDocument/);
    assert.match(model, /export function resolveContentSource/);

    const boot = await fs.readFile(path.join(root, "src/app/boot.js"), "utf8");
    assert.match(boot, /bindCurrentUrlDocument\(\)/);
  });
});
