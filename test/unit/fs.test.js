import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectEditableExtension,
  ensureEditableExtension,
  isEditableFileName,
  resolveFilePath,
  revisionStampChanged,
  suggestedUntitledName,
} from "../../src/lib/fs.js";

describe("fs helpers", () => {
  it("recognizes editable file names", () => {
    for (const name of ["readme.md", "doc.markdown", "notes.txt", "index.html", "x.HTM"]) {
      assert.equal(isEditableFileName(name), true, name);
    }
    assert.equal(isEditableFileName("image.png"), false);
    assert.equal(isEditableFileName("noext"), false);
  });

  it("detects extension from content", () => {
    assert.equal(detectEditableExtension(""), "md");
    assert.equal(detectEditableExtension("# Hello"), "md");
    assert.equal(detectEditableExtension("<!DOCTYPE html>\n<html>"), "html");
    assert.equal(detectEditableExtension("<html lang='en'>"), "html");
    assert.equal(detectEditableExtension("Just plain prose no markup"), "txt");
    assert.equal(detectEditableExtension("**bold** and [link](url)"), "md");
  });

  it("ignores leading HTML comments when detecting html documents", () => {
    assert.equal(detectEditableExtension("<!-- note -->\n<!DOCTYPE html>"), "html");
    assert.equal(detectEditableExtension("<!-- a --><!-- b -->\n<html>"), "html");
    // Unclosed leading comment: do not sniff the body as the document root.
    assert.equal(detectEditableExtension("<!--\n<!DOCTYPE html>"), "md");
  });

  it("ensures an editable extension", () => {
    assert.equal(ensureEditableExtension(""), "untitled.md");
    assert.equal(ensureEditableExtension("doc"), "doc.md");
    assert.equal(ensureEditableExtension("page.md"), "page.md");
    assert.equal(ensureEditableExtension("page", "<!DOCTYPE html>"), "page.html");
  });

  it("suggests untitled names", () => {
    assert.equal(suggestedUntitledName("# Hello"), "untitled.md");
    assert.equal(suggestedUntitledName(""), "untitled.md");
  });

  it("resolveFilePath rejects traversal and dot segments", async () => {
    const root = {
      getDirectoryHandle: async () => {
        throw new Error("should not traverse");
      },
      getFileHandle: async () => {
        throw new Error("should not open");
      },
    };
    assert.equal(await resolveFilePath(/** @type {any} */ (root), "../secret.md"), null);
    assert.equal(await resolveFilePath(/** @type {any} */ (root), "a/../b.md"), null);
    assert.equal(await resolveFilePath(/** @type {any} */ (root), "a/./b.md"), null);
    assert.equal(await resolveFilePath(/** @type {any} */ (root), ".."), null);
    assert.equal(await resolveFilePath(/** @type {any} */ (root), ""), null);
  });

  it("resolveFilePath walks safe segments", async () => {
    /** @type {string[]} */
    const dirs = [];
    const root = {
      getDirectoryHandle: async (name) => {
        dirs.push(name);
        return root;
      },
      getFileHandle: async (name) => ({ kind: "file", name }),
    };
    const file = await resolveFilePath(/** @type {any} */ (root), "docs/notes.md");
    assert.deepEqual(dirs, ["docs"]);
    assert.equal(file?.name, "notes.md");
  });

  it("revisionStampChanged detects mismatches and ignores empty stamps", () => {
    assert.equal(revisionStampChanged(null, "1"), false);
    assert.equal(revisionStampChanged("", "1"), false);
    assert.equal(revisionStampChanged("1", null), false);
    assert.equal(revisionStampChanged("1", ""), false);
    assert.equal(revisionStampChanged("1", "1"), false);
    assert.equal(revisionStampChanged("1", "2"), true);
    assert.equal(revisionStampChanged(100, "100"), false);
    assert.equal(revisionStampChanged(100, "101"), true);
  });
});
