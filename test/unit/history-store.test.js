import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  clearHistoryBodies,
  commitHistoryBodies,
  getDraft,
  getHistoryIndex,
  getRev,
  getTip,
  isHistoryIdbAvailable,
  moveDraft,
  revKey,
  setDraft,
  setRev,
  setTip,
} from "../../src/history-store.js";

describe("history-store", () => {
  beforeEach(async () => {
    await clearHistoryBodies();
    // also wipe drafts by overwriting with empty via setDraft then clear
  });

  it("reports IndexedDB availability under fake-indexeddb", () => {
    assert.equal(isHistoryIdbAvailable(), true);
  });

  it("builds rev keys", () => {
    assert.equal(revKey("abc"), "rev:abc");
  });

  it("round-trips drafts by doc key", async () => {
    assert.equal(await setDraft("hello", "doc1"), true);
    const draft = await getDraft("doc1");
    assert.equal(draft.content, "hello");
    assert.equal(draft.docKey, "doc1");
    assert.equal(await getDraft("missing"), null);
  });

  it("moves a draft between keys", async () => {
    await setDraft("x", "old");
    assert.equal(await moveDraft("old", "new"), true);
    assert.equal((await getDraft("new")).content, "x");
    assert.equal(await getDraft("old"), null);
  });

  it("round-trips tip and revisions", async () => {
    assert.equal(await setTip(5, "tip-content"), true);
    assert.deepEqual(await getTip(), { generation: 5, content: "tip-content" });
    assert.equal(await setRev("id1", { patch: "p" }), true);
    assert.deepEqual(await getRev("id1"), { patch: "p" });
  });

  it("commits tip, index, and rev bodies atomically", async () => {
    const ok = await commitHistoryBodies({
      generation: 1,
      tipContent: "tip",
      revWrites: [{ id: "r1", body: { content: "full" } }],
      pruneIds: [],
      indexEntries: [{ id: "r1" }],
    });
    assert.equal(ok, true);
    assert.deepEqual(await getTip(), { generation: 1, content: "tip" });
    assert.deepEqual(await getRev("r1"), { content: "full" });
    const index = await getHistoryIndex();
    assert.equal(index.generation, 1);
    assert.deepEqual(index.entries, [{ id: "r1" }]);
  });
});
