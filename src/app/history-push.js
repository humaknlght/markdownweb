import { hooks } from "./hooks.js";
import {
  state
} from "./state.js";
import {
  STORAGE_KEYS,
  HISTORY_LIMIT,
  HISTORY_MAX_CHARS,
  HISTORY_TIP_MAX,
  HISTORY_INDEX_VERSION,
  PATCH_MAX_CHARS
} from "./constants.js";
import {
  applyPatch,
  contentHash,
  makeRevisionBody,
  clearHistoryBodies,
  commitHistoryBodies,
  getHistoryIndex,
  getRev,
  getTip,
  setHistoryIndex,
  setTip,
  storageBudgetOk,
  titleFromMarkdown
} from "./vendor-deps.js";

export function pushHistoryLegacy(content) {
  if (content.length > HISTORY_MAX_CHARS) return;
  const entries = hooks.loadHistoryIndexEntries().filter((e) => e.content !== content);
  if (entries[0]?.content === content) {
    state.lastHistoryContent = content;
    return;
  }
  const entry = {
    id: hooks.newHistoryId(),
    title: titleFromMarkdown(content),
    content,
    savedAt: Date.now(),
    hash: contentHash(content),
  };
  hooks.saveLegacyHistory([entry, ...entries]);
  state.lastHistoryContent = content;
  hooks.renderHistoryMenu();
  hooks.broadcastStorage();
}

export async function pushHistory(markdown) {
  if (state.contentIsExternal || state.guideSession) return;
  const content = markdown ?? hooks.getMarkdownSource();
  if (!content.trim()) return;
  if (content === state.lastHistoryContent) return;

  if (!state.historyIdbReady) {
    pushHistoryLegacy(content);
    return;
  }

  if (content.length > HISTORY_TIP_MAX) return;

  const hash = contentHash(content);
  const hist = hooks.loadHistoryIndex();
  if (hist.entries[0]?.hash === hash) {
    state.lastHistoryContent = content;
    return;
  }

  const tip = await getTip();
  let oldContent = "";
  if (tip && (tip.generation === hist.generation || !hist.generation)) {
    oldContent = tip.content;
  } else if (tip) {
    oldContent = tip.content;
  } else if (typeof hist.entries[0]?.content === "string") {
    oldContent = hist.entries[0].content;
  }

  const generation = (tip?.generation || hist.generation || 0) + 1;

  // Re-saving a past revision (A→B→C→D then B again) would leave reverse
  // patches pointing at the wrong predecessor if we only dropped the matching
  // middle entry. Rebuild the chain from materialized bodies instead.
  const duplicateIdx = hist.entries.findIndex((e) => e.hash === hash);
  if (duplicateIdx > 0) {
    const kept = [
      {
        meta: { title: titleFromMarkdown(content), savedAt: Date.now() },
        content,
      },
    ];
    for (let i = 0; i < hist.entries.length; i++) {
      if (i === duplicateIdx) continue;
      const body = await hooks.materializeHistoryEntry(i);
      if (body == null || contentHash(body) === hash) continue;
      kept.push({ meta: hist.entries[i], content: body });
    }
    await hooks.rewriteHistoryChain(
      kept,
      generation,
      hist.entries.map((e) => e.id),
    );
    state.lastHistoryContent = content;
    void hooks.ensurePersistentStorage();
    hooks.renderHistoryMenu();
    hooks.broadcastStorage();
    return;
  }

  const newId = hooks.newHistoryId();

  /** @type {object[]} */
  let entries = [
    {
      id: newId,
      title: titleFromMarkdown(content),
      savedAt: Date.now(),
      hash,
      body: "tip",
    },
  ];
  /** @type {Array<{ id: string, body: { patch?: string, content?: string } }>} */
  const revWrites = [];
  let convertedOldTip = false;

  if (hist.entries[0] && oldContent !== "" && contentHash(oldContent) !== hash) {
    const oldMeta = hist.entries[0];
    const made = makeRevisionBody(content, oldContent, PATCH_MAX_CHARS);
    revWrites.push({
      id: oldMeta.id,
      body: made.kind === "patch" ? { patch: made.patch } : { content: made.content },
    });
    entries.push({
      id: oldMeta.id,
      title: oldMeta.title || titleFromMarkdown(oldContent),
      savedAt: oldMeta.savedAt || Date.now(),
      hash: oldMeta.hash || contentHash(oldContent),
      body: made.kind === "patch" ? "patch" : "full",
    });
    convertedOldTip = true;
  }

  for (const e of hist.entries.slice(convertedOldTip ? 1 : 0)) {
    if (e.hash === hash || e.id === newId) continue;
    if (e.body === "tip") continue;
    entries.push(e);
  }

  // Prefer fewer revisions when the origin is near its storage ceiling.
  const budget = await storageBudgetOk(0.85);
  const maxEntries = budget.ok ? HISTORY_LIMIT : Math.min(HISTORY_LIMIT, 5);
  entries = entries.slice(0, maxEntries);

  const keepRev = new Set(entries.slice(1).map((e) => e.id));
  const pruneIds = hist.entries.map((e) => e.id).filter((id) => id !== newId && !keepRev.has(id));
  // Drop revWrites for pruned ids
  const filteredWrites = revWrites.filter((r) => keepRev.has(r.id));

  const ok = await commitHistoryBodies({
    generation,
    tipContent: content,
    revWrites: filteredWrites,
    pruneIds,
    indexEntries: entries,
    indexVersion: HISTORY_INDEX_VERSION,
  });
  if (!ok) {
    pushHistoryLegacy(content);
    return;
  }

  try {
    hooks.saveHistoryIndex({ generation, entries });
  } catch {
    await clearHistoryBodies([...pruneIds, ...filteredWrites.map((r) => r.id)]);
    const tipOnly = [entries[0]];
    const tipOk = await commitHistoryBodies({
      generation,
      tipContent: content,
      revWrites: [],
      pruneIds: [],
      indexEntries: tipOnly,
      indexVersion: HISTORY_INDEX_VERSION,
    });
    if (!tipOk) await setTip(generation, content);
    hooks.saveHistoryIndex({ generation, entries: tipOnly });
  }

  state.lastHistoryContent = content;
  void hooks.ensurePersistentStorage();
  hooks.renderHistoryMenu();
  hooks.broadcastStorage();
}

hooks.pushHistoryLegacy = pushHistoryLegacy;
hooks.pushHistory = pushHistory;
