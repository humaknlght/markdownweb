import { hooks } from "./hooks.js";
import { state } from "./state.js";
import {
  STORAGE_KEYS,
  HISTORY_LIMIT,
  HISTORY_INDEX_VERSION
} from "./constants.js";
import {
  applyPatch,
  contentHash,
  getHistoryIndex,
  getRev,
  getTip,
  setHistoryIndex,
  setTip,
  titleFromMarkdown
} from "./vendor-deps.js";

export function newHistoryId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * In-memory history index (mirrored to localStorage; committed with tip in IDB).
 * @type {{ v: number, generation: number, entries: object[] } | null}
 */

export function loadHistoryIndexFromLs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history);
    if (!raw) return { v: HISTORY_INDEX_VERSION, generation: 0, entries: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { v: 1, generation: 0, entries: parsed };
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
      return {
        v: Number(parsed.v) || 2,
        generation: Number(parsed.generation) || 0,
        entries: parsed.entries,
      };
    }
  } catch {
    /* ignore */
  }
  return { v: HISTORY_INDEX_VERSION, generation: 0, entries: [] };
}

/**
 * @returns {{ v: number, generation: number, entries: object[] }}
 */
export function loadHistoryIndex() {
  if (state.historyIndexCache) {
    return {
      v: state.historyIndexCache.v,
      generation: state.historyIndexCache.generation,
      entries: state.historyIndexCache.entries.slice(),
    };
  }
  return loadHistoryIndexFromLs();
}

/** Flat entry list for menu / legacy helpers. */
export function loadHistoryIndexEntries() {
  return loadHistoryIndex().entries;
}

export function saveHistoryIndex(index) {
  const payload = {
    v: HISTORY_INDEX_VERSION,
    generation: index.generation,
    entries: index.entries.slice(0, HISTORY_LIMIT),
  };
  state.historyIndexCache = payload;
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

/**
 * Prefer IDB index (committed with tip) over localStorage when they diverge.
 * Call after IDB is ready and on cross-tab history updates.
 */
export async function hydrateHistoryIndexFromIdb() {
  if (!state.historyIdbReady) {
    state.historyIndexCache = loadHistoryIndexFromLs();
    return;
  }
  const tip = await getTip();
  const idbIndex = await getHistoryIndex();
  if (idbIndex && tip && Number(idbIndex.generation) === Number(tip.generation)) {
    saveHistoryIndex(idbIndex);
    return;
  }
  const ls = loadHistoryIndexFromLs();
  if (tip && Number(ls.generation) === Number(tip.generation) && ls.entries.length) {
    state.historyIndexCache = {
      v: HISTORY_INDEX_VERSION,
      generation: ls.generation,
      entries: ls.entries.slice(0, HISTORY_LIMIT),
    };
    void setHistoryIndex(state.historyIndexCache);
    return;
  }
  if (tip) {
    // Tip/index mismatch — keep newest tip restorable; older revs may be orphaned.
    saveHistoryIndex({
      generation: tip.generation,
      entries: [
        {
          id: newHistoryId(),
          title: titleFromMarkdown(tip.content),
          savedAt: Date.now(),
          hash: contentHash(tip.content),
          body: "tip",
        },
      ],
    });
    void setHistoryIndex(state.historyIndexCache);
    return;
  }
  state.historyIndexCache = ls;
}

export function saveLegacyHistory(entries) {
  const mapped = entries.slice(0, HISTORY_LIMIT).map((e) => ({
    id: e.id || newHistoryId(),
    title: e.title || "Untitled",
    content: e.content,
    savedAt: e.savedAt || Date.now(),
    hash: e.hash || contentHash(e.content || ""),
  }));
  state.historyIndexCache = { v: 1, generation: 0, entries: mapped };
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(mapped));
}

/**
 * @param {number} index
 * @returns {Promise<string | null>}
 */
export async function materializeHistoryEntry(index) {
  const hist = loadHistoryIndex();
  if (index < 0 || index >= hist.entries.length) return null;
  const entry = hist.entries[index];

  if (!state.historyIdbReady || hist.v < HISTORY_INDEX_VERSION || entry.content != null) {
    return typeof entry.content === "string" ? entry.content : null;
  }

  const tip = await getTip();
  if (!tip) return null;
  if (tip.generation !== hist.generation) {
    return index === 0 ? tip.content : null;
  }

  let content = tip.content;
  if (index === 0) return content;

  for (let i = 1; i <= index; i++) {
    const step = hist.entries[i];
    const rev = await getRev(step.id);
    if (!rev) return null;
    if (typeof rev.content === "string") {
      content = rev.content;
    } else if (typeof rev.patch === "string") {
      content = applyPatch(content, rev.patch);
    } else {
      return null;
    }
  }
  return content;
}

export async function migrateHistoryIfNeeded() {
  if (!state.historyIdbReady) return;
  const hist = loadHistoryIndex();
  const legacyBodies = hist.entries.filter((e) => typeof e.content === "string");
  const needsMigrate =
    hist.v < HISTORY_INDEX_VERSION || (legacyBodies.length > 0 && hist.entries.some((e) => !e.body));

  if (!needsMigrate) {
    const tip = await getTip();
    if (tip && tip.generation === hist.generation) return;
    if (!hist.entries.length) return;
    // Index without matching tip — rebuild tip from first legacy body if any.
    if (legacyBodies[0]) {
      await setTip(hist.generation || 1, legacyBodies[0].content);
    }
    return;
  }

  if (!legacyBodies.length) {
    saveHistoryIndex({ generation: hist.generation || 0, entries: hist.entries.filter((e) => e.body) });
    return;
  }

  const kept = legacyBodies.slice(0, HISTORY_LIMIT).map((e) => ({
    meta: e,
    content: e.content,
  }));
  await hooks.rewriteHistoryChain(kept, Math.max(1, hist.generation || 0) + 1, []);
}

hooks.newHistoryId = newHistoryId;
hooks.loadHistoryIndexFromLs = loadHistoryIndexFromLs;
hooks.loadHistoryIndex = loadHistoryIndex;
hooks.loadHistoryIndexEntries = loadHistoryIndexEntries;
hooks.saveHistoryIndex = saveHistoryIndex;
hooks.hydrateHistoryIndexFromIdb = hydrateHistoryIndexFromIdb;
hooks.saveLegacyHistory = saveLegacyHistory;
hooks.materializeHistoryEntry = materializeHistoryEntry;
hooks.migrateHistoryIfNeeded = migrateHistoryIfNeeded;
