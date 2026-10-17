import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DRIVE_MSG_TYPE,
  DRIVE_MSG_VERSION,
  createDriveFile,
  createDriveFolder,
  ensureDriveAppFolder,
  escapeDriveQueryValue,
  listDriveAppFolder,
  listDriveFolderChildren,
  renameDriveItem,
  trashDriveItem,
  isDriveEditableFile,
  isDriveMessage,
  makeDriveMessage,
  mimeTypeForName,
  readDriveFileText,
  updateDriveFile,
} from "../../src/drive/google-drive-api.js";
import {
  GOOGLE_DRIVE,
  applyGoogleDriveConfig,
  isGoogleDriveConfigured,
  loadGoogleDriveConfig,
  resetGoogleDriveConfigForTests,
} from "../../src/drive/google-drive-config.js";

describe("google-drive-config", () => {
  beforeEach(() => {
    resetGoogleDriveConfigForTests();
  });

  it("starts disabled with empty credentials", () => {
    assert.equal(GOOGLE_DRIVE.clientId, "");
    assert.equal(isGoogleDriveConfigured(), false);
  });

  it("applies a complete config object", () => {
    assert.equal(
      applyGoogleDriveConfig({
        clientId: " id.apps.googleusercontent.com ",
      }),
      true,
    );
    assert.equal(GOOGLE_DRIVE.clientId, "id.apps.googleusercontent.com");
    assert.equal(isGoogleDriveConfigured(), true);
  });

  it("rejects incomplete config", () => {
    assert.equal(applyGoogleDriveConfig({ apiKey: "only-key" }), false);
    assert.equal(isGoogleDriveConfigured(), false);
  });

  it("loads optional JSON via fetch and treats 404 as disabled", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({ ok: false, status: 404 }));
    try {
      assert.equal(await loadGoogleDriveConfig(), false);
      assert.equal(isGoogleDriveConfigured(), false);
    } finally {
      globalThis.fetch = original;
      resetGoogleDriveConfigForTests();
    }
  });

  it("loads credentials from a successful JSON response", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        clientId: "c.apps.googleusercontent.com",
      }),
    }));
    try {
      assert.equal(await loadGoogleDriveConfig(), true);
      assert.equal(GOOGLE_DRIVE.clientId, "c.apps.googleusercontent.com");
      assert.equal(isGoogleDriveConfigured(), true);
    } finally {
      globalThis.fetch = original;
      resetGoogleDriveConfigForTests();
    }
  });
});

describe("google-drive-api helpers", () => {
  it("escapes backslash before apostrophe in Drive q literals", () => {
    assert.equal(escapeDriveQueryValue("plain"), "plain");
    assert.equal(escapeDriveQueryValue("quinn's"), "quinn\\'s");
    assert.equal(escapeDriveQueryValue("a\\b"), "a\\\\b");
    assert.equal(escapeDriveQueryValue("quinn's paper\\essay"), "quinn\\'s paper\\\\essay");
  });

  it("validates editable Drive files", () => {
    assert.equal(isDriveEditableFile("notes.md"), true);
    assert.equal(isDriveEditableFile("page.html"), true);
    assert.equal(isDriveEditableFile("readme.txt"), true);
    assert.equal(isDriveEditableFile("photo.png"), false);
    assert.equal(isDriveEditableFile("doc", "text/plain"), true);
    assert.equal(isDriveEditableFile("doc", "application/pdf"), false);
  });

  it("maps names to mime types", () => {
    assert.equal(mimeTypeForName("a.md"), "text/markdown");
    assert.equal(mimeTypeForName("a.txt"), "text/plain");
    assert.equal(mimeTypeForName("a.html"), "text/html");
  });

  it("builds and recognizes postMessage payloads", () => {
    const msg = makeDriveMessage({
      action: "open",
      file: { id: "1", name: "a.md" },
      content: "# Hi",
      accessToken: "tok",
    });
    assert.equal(msg.type, DRIVE_MSG_TYPE);
    assert.equal(msg.v, DRIVE_MSG_VERSION);
    assert.equal(isDriveMessage(msg), true);
    assert.equal(isDriveMessage({ type: "other", v: 1, action: "open" }), false);
    assert.equal(isDriveMessage(null), false);
  });

  it("reads Drive file text via fetch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url, init) => {
      assert.match(String(url), /files\/abc123\?alt=media/);
      assert.equal(init.headers.Authorization, "Bearer tok");
      return {
        ok: true,
        text: async () => "# Hello",
      };
    });
    try {
      const text = await readDriveFileText("tok", "abc123");
      assert.equal(text, "# Hello");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("creates and updates Drive files via fetch", async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = mock.fn(async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      if (String(url).includes("uploadType=multipart")) {
        assert.match(String(init.body), /"parents":\["folder1"\]/);
        return {
          ok: true,
          json: async () => ({ id: "new1", name: "doc.md", mimeType: "text/markdown" }),
        };
      }
      return {
        ok: true,
        json: async () => ({ id: "new1", name: "doc.md", mimeType: "text/markdown" }),
      };
    });
    try {
      const created = await createDriveFile("tok", {
        name: "doc.md",
        content: "# X",
        parentId: "folder1",
      });
      assert.equal(created.id, "new1");
      assert.match(calls[0].url, /uploadType=multipart/);
      assert.equal(calls[0].method, "POST");

      const updated = await updateDriveFile("tok", "new1", { name: "doc.md", content: "# Y" });
      assert.equal(updated.id, "new1");
      assert.equal(calls[1].method, "PATCH");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("lists only the markdown-editor folder contents", async () => {
    const original = globalThis.fetch;
    const originalStorage = globalThis.localStorage;
    const store = new Map([["md-editor:driveFolderId", "folder1"]]);
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.fetch = mock.fn(async (url) => {
      const href = String(url);
      if (href.includes("/files/folder1?")) {
        return {
          ok: true,
          json: async () => ({
            id: "folder1",
            mimeType: "application/vnd.google-apps.folder",
            trashed: false,
          }),
        };
      }
      if (href.includes("/files?") && href.includes("q=")) {
        const q = decodeURIComponent(new URL(href).searchParams.get("q") || "");
        assert.match(q, /'folder1' in parents and trashed=false/);
        assert.doesNotMatch(q, /mimeType=/);
        return {
          ok: true,
          json: async () => ({
            files: [
              { id: "a", name: "notes.md", mimeType: "text/markdown" },
              { id: "d", name: "sub", mimeType: "application/vnd.google-apps.folder" },
              { id: "b", name: "skip.png", mimeType: "image/png" },
            ],
          }),
        };
      }
      return { ok: false, status: 500, text: async () => href };
    });
    try {
      const { folderId, entries } = await listDriveAppFolder("tok");
      assert.equal(folderId, "folder1");
      assert.equal(entries.length, 2);
      assert.equal(entries[0].kind, "directory");
      assert.equal(entries[0].name, "sub");
      assert.equal(entries[1].id, "a");
    } finally {
      globalThis.fetch = original;
      globalThis.localStorage = originalStorage;
    }
  });

  it("lists children of a nested Drive folder", async () => {
    const original = globalThis.fetch;
    const originalStorage = globalThis.localStorage;
    const store = new Map([["md-editor:driveFolderId", "root1"]]);
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.fetch = mock.fn(async (url) => {
      const href = String(url);
      if (href.includes("/files/root1?")) {
        return {
          ok: true,
          json: async () => ({
            id: "root1",
            mimeType: "application/vnd.google-apps.folder",
            trashed: false,
          }),
        };
      }
      if (href.includes("/files?") && href.includes("q=")) {
        const q = decodeURIComponent(new URL(href).searchParams.get("q") || "");
        assert.match(q, /'sub1' in parents and trashed=false/);
        return {
          ok: true,
          json: async () => ({
            files: [{ id: "nested", name: "deep.md", mimeType: "text/markdown" }],
          }),
        };
      }
      return { ok: false, status: 500, text: async () => href };
    });
    try {
      const { folderId, entries } = await listDriveFolderChildren("tok", "sub1");
      assert.equal(folderId, "sub1");
      assert.equal(entries.length, 1);
      assert.equal(entries[0].name, "deep.md");
    } finally {
      globalThis.fetch = original;
      globalThis.localStorage = originalStorage;
    }
  });

  it("creates a Drive subfolder under a parent", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url, init) => {
      assert.equal(init.method, "POST");
      const body = JSON.parse(String(init.body));
      assert.equal(body.name, "chapters");
      assert.equal(body.mimeType, "application/vnd.google-apps.folder");
      assert.deepEqual(body.parents, ["parent1"]);
      return { ok: true, json: async () => ({ id: "child1", name: "chapters" }) };
    });
    try {
      const id = await createDriveFolder("tok", "chapters", "parent1");
      assert.equal(id, "child1");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("renames and trashes Drive items", async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = mock.fn(async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      if (String(init.body).includes('"name"')) {
        return { ok: true, json: async () => ({ id: "f1", name: "renamed.md", mimeType: "text/markdown" }) };
      }
      return { ok: true, json: async () => ({ id: "f1", trashed: true }) };
    });
    try {
      const renamed = await renameDriveItem("tok", "f1", "renamed.md");
      assert.equal(renamed.name, "renamed.md");
      assert.equal(calls[0].method, "PATCH");
      assert.match(calls[0].url, /files\/f1/);

      await trashDriveItem("tok", "f1");
      assert.equal(calls[1].method, "PATCH");
      assert.match(String(calls[1].body), /"trashed":\s*true/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("ensures a markdown-editor folder before create when parentId is omitted", async () => {
    const original = globalThis.fetch;
    const originalStorage = globalThis.localStorage;
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.fetch = mock.fn(async (url, init) => {
      const href = String(url);
      if (href.includes("/files/folder-new?") && href.includes("fields=")) {
        return {
          ok: true,
          json: async () => ({
            id: "folder-new",
            mimeType: "application/vnd.google-apps.folder",
            trashed: false,
          }),
        };
      }
      if (href.includes("/files?") && href.includes("q=")) {
        return { ok: true, json: async () => ({ files: [] }) };
      }
      if (init?.method === "POST" && href.includes("/drive/v3/files") && !href.includes("uploadType")) {
        return { ok: true, json: async () => ({ id: "folder-new", name: "markdown-editor" }) };
      }
      if (href.includes("uploadType=multipart")) {
        assert.match(String(init.body), /"parents":\["folder-new"\]/);
        return {
          ok: true,
          json: async () => ({ id: "file1", name: "doc.md", mimeType: "text/markdown" }),
        };
      }
      return { ok: false, status: 500, text: async () => `unexpected ${href}` };
    });
    try {
      const folderId = await ensureDriveAppFolder("tok");
      assert.equal(folderId, "folder-new");
      const created = await createDriveFile("tok", { name: "doc.md", content: "# X" });
      assert.equal(created.id, "file1");
    } finally {
      globalThis.fetch = original;
      globalThis.localStorage = originalStorage;
    }
  });
});
