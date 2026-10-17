/**
 * IndexedDB persistence for draft + history revision bodies.
 * Keys: drafts (map by docKey) | tip | historyIndex | rev:{id}
 * Legacy: draft (single blob, migrated into drafts.untitled)
 */

const IDB_NAME = "md-preview-history";
const IDB_VERSION = 1;
const IDB_STORE = "kv";

const KEY_DRAFT = "draft"; // legacy single-draft blob
const KEY_DRAFTS = "drafts";
const KEY_TIP = "tip";
const KEY_INDEX = "historyIndex";
const DRAFTS_VERSION = 1;
const DRAFTS_MAX_KEYS = 30;

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;
let idbAvailable = true;

/**
 * @returns {boolean}
 */
export function isHistoryIdbAvailable() {
  return idbAvailable && typeof indexedDB !== "undefined";
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  if (!isHistoryIdbAvailable()) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(IDB_NAME, IDB_VERSION);
      } catch (err) {
        idbAvailable = false;
        reject(err);
        return;
      }
      req.onerror = () => {
        idbAvailable = false;
        dbPromise = null;
        reject(req.error || new Error("IndexedDB open failed"));
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }
  return dbPromise;
}

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onerror = () => reject(req.error || new Error("IndexedDB put failed"));
    req.onsuccess = () => resolve();
  });
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).delete(key);
    req.onerror = () => reject(req.error || new Error("IndexedDB delete failed"));
    req.onsuccess = () => resolve();
  });
}

/**
 * @param {string[]} keys
 * @returns {Promise<void>}
 */
async function idbDeleteMany(keys) {
  if (!keys.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB deleteMany failed"));
  });
}

/**
 * @param {Array<[string, unknown]>} puts
 * @param {string[]} [deletes]
 * @returns {Promise<void>}
 */
async function idbMutateMany(puts, deletes = []) {
  if (!puts.length && !deletes.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    for (const [key, value] of puts) store.put(value, key);
    for (const key of deletes) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB mutateMany failed"));
  });
}

/**
 * @param {Array<[string, unknown]>} entries
 * @returns {Promise<void>}
 */
async function idbSetMany(entries) {
  return idbMutateMany(entries, []);
}

/**
 * @returns {string}
 */
export function revKey(id) {
  return `rev:${id}`;
}

/**
 * @typedef {{ content: string, updatedAt: number }} DraftEntry
 * @typedef {{ v: number, byKey: Record<string, DraftEntry> }} DraftMap
 */

/**
 * @returns {Promise<DraftMap>}
 */
async function loadDraftMap() {
  try {
    const raw = await idbGet(KEY_DRAFTS);
    if (
      raw &&
      typeof raw === "object" &&
      /** @type {{ v?: unknown }} */ (raw).v === DRAFTS_VERSION &&
      /** @type {{ byKey?: unknown }} */ (raw).byKey &&
      typeof /** @type {{ byKey?: unknown }} */ (raw).byKey === "object"
    ) {
      return /** @type {DraftMap} */ (raw);
    }
  } catch {
    /* fall through to legacy */
  }

  /** @type {Record<string, DraftEntry>} */
  const byKey = {};
  try {
    const legacy = await idbGet(KEY_DRAFT);
    if (legacy && typeof legacy === "object") {
      const content = /** @type {{ content?: unknown }} */ (legacy).content;
      if (typeof content === "string") {
        byKey.untitled = {
          content,
          updatedAt: Number(/** @type {{ updatedAt?: unknown }} */ (legacy).updatedAt) || Date.now(),
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { v: DRAFTS_VERSION, byKey };
}

/**
 * @param {DraftMap} map
 * @param {string} keepKey
 */
function pruneDraftMap(map, keepKey) {
  const keys = Object.keys(map.byKey);
  if (keys.length <= DRAFTS_MAX_KEYS) return;
  const sorted = keys
    .slice()
    .sort((a, b) => (map.byKey[a]?.updatedAt || 0) - (map.byKey[b]?.updatedAt || 0));
  for (const key of sorted) {
    if (Object.keys(map.byKey).length <= DRAFTS_MAX_KEYS) break;
    if (key === keepKey || key === "untitled") continue;
    delete map.byKey[key];
  }
}

/**
 * @param {string} [docKey="untitled"]
 * @returns {Promise<{ content: string, updatedAt: number, docKey: string } | null>}
 */
export async function getDraft(docKey = "untitled") {
  try {
    const map = await loadDraftMap();
    const entry = map.byKey[docKey];
    if (!entry || typeof entry.content !== "string") return null;
    return {
      content: entry.content,
      updatedAt: Number(entry.updatedAt) || 0,
      docKey,
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} content
 * @param {string} [docKey="untitled"]
 * @returns {Promise<boolean>} true if written
 */
export async function setDraft(content, docKey = "untitled") {
  try {
    const map = await loadDraftMap();
    const key = docKey || "untitled";
    map.byKey[key] = { content: String(content ?? ""), updatedAt: Date.now() };
    pruneDraftMap(map, key);
    await idbSet(KEY_DRAFTS, map);
    try {
      await idbDelete(KEY_DRAFT);
    } catch {
      /* legacy key may already be gone */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a draft from one document key to another (e.g. rename).
 * @param {string} fromKey
 * @param {string} toKey
 * @returns {Promise<boolean>}
 */
export async function moveDraft(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return true;
  try {
    const map = await loadDraftMap();
    const entry = map.byKey[fromKey];
    if (entry) {
      map.byKey[toKey] = { ...entry, updatedAt: Date.now() };
      delete map.byKey[fromKey];
      pruneDraftMap(map, toKey);
      await idbSet(KEY_DRAFTS, map);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{ generation: number, content: string } | null>}
 */
export async function getTip() {
  try {
    const raw = await idbGet(KEY_TIP);
    if (!raw || typeof raw !== "object") return null;
    const content = /** @type {{ content?: unknown }} */ (raw).content;
    if (typeof content !== "string") return null;
    const generation = Number(/** @type {{ generation?: unknown }} */ (raw).generation) || 0;
    return { generation, content };
  } catch {
    return null;
  }
}

/**
 * @param {number} generation
 * @param {string} content
 * @returns {Promise<boolean>}
 */
export async function setTip(generation, content) {
  try {
    await idbSet(KEY_TIP, { generation, content: String(content ?? "") });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} id
 * @returns {Promise<{ patch?: string, content?: string } | null>}
 */
export async function getRev(id) {
  try {
    const raw = await idbGet(revKey(id));
    if (!raw || typeof raw !== "object") return null;
    return /** @type {{ patch?: string, content?: string }} */ (raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} id
 * @param {{ patch?: string, content?: string }} body
 * @returns {Promise<boolean>}
 */
export async function setRev(id, body) {
  try {
    await idbSet(revKey(id), body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic tip + revision bodies + history index for a history push.
 * localStorage is only a mirror — written by the caller after this succeeds.
 * @param {{
 *   generation: number,
 *   tipContent: string,
 *   revWrites: Array<{ id: string, body: { patch?: string, content?: string } }>,
 *   pruneIds: string[],
 *   indexEntries: object[],
 *   indexVersion?: number,
 * }} payload
 * @returns {Promise<boolean>}
 */
export async function commitHistoryBodies(payload) {
  try {
    /** @type {Array<[string, unknown]>} */
    const puts = [
      [KEY_TIP, { generation: payload.generation, content: payload.tipContent }],
      [
        KEY_INDEX,
        {
          v: payload.indexVersion ?? 3,
          generation: payload.generation,
          entries: payload.indexEntries ?? [],
        },
      ],
    ];
    for (const rev of payload.revWrites) {
      puts.push([revKey(rev.id), rev.body]);
    }
    const deletes = (payload.pruneIds || []).map(revKey);
    await idbMutateMany(puts, deletes);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{ v: number, generation: number, entries: object[] } | null>}
 */
export async function getHistoryIndex() {
  try {
    const raw = await idbGet(KEY_INDEX);
    if (!raw || typeof raw !== "object") return null;
    const parsed = /** @type {{ v?: unknown, generation?: unknown, entries?: unknown }} */ (raw);
    if (!Array.isArray(parsed.entries)) return null;
    return {
      v: Number(parsed.v) || 3,
      generation: Number(parsed.generation) || 0,
      entries: parsed.entries,
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort index write (e.g. backfill after recovering from localStorage).
 * @param {{ v?: number, generation: number, entries: object[] }} index
 * @returns {Promise<boolean>}
 */
export async function setHistoryIndex(index) {
  try {
    await idbSet(KEY_INDEX, {
      v: index.v ?? 3,
      generation: index.generation,
      entries: index.entries ?? [],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop tip + index + all given revision ids (e.g. reset chain).
 * @param {string[]} revIds
 * @returns {Promise<void>}
 */
export async function clearHistoryBodies(revIds = []) {
  try {
    await idbDeleteMany([KEY_TIP, KEY_INDEX, ...revIds.map(revKey)]);
  } catch {
    /* ignore */
  }
}

/**
 * Soft storage budget: leave headroom for Cache API / SW.
 * @param {number} [headroomRatio]
 * @returns {Promise<{ ok: boolean, usage: number, quota: number }>}
 */
export async function storageBudgetOk(headroomRatio = 0.85) {
  try {
    if (!navigator.storage?.estimate) return { ok: true, usage: 0, quota: Infinity };
    const { usage = 0, quota = Infinity } = await navigator.storage.estimate();
    if (!Number.isFinite(quota) || quota <= 0) return { ok: true, usage, quota };
    return { ok: usage / quota < headroomRatio, usage, quota };
  } catch {
    return { ok: true, usage: 0, quota: Infinity };
  }
}

/** Best-effort persistent storage (installed PWA / engaged origin). */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Probe whether IDB works (call once at boot).
 * @returns {Promise<boolean>}
 */
export async function probeHistoryIdb() {
  if (typeof indexedDB === "undefined") {
    idbAvailable = false;
    return false;
  }
  try {
    await openDb();
    return true;
  } catch {
    idbAvailable = false;
    return false;
  }
}
