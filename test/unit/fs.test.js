import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectEditableExtension,
  ensureEditableExtension,
  isEditableFileName,
  suggestedUntitledName,
} from "../../src/fs.js";

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
});
