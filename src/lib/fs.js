/** File System Access API helpers for the Files drawer. */

const IDB_NAME = "md-preview-fs";
const IDB_VERSION = 1;
const IDB_STORE = "handles";
const DIR_HANDLE_KEY = "directory";
const FILE_HANDLE_KEY = "currentFile";

export const EDITABLE_FILE_RE = /\.(md|markdown|mdown|mkd|txt|html|htm)$/i;

/**
 * @returns {boolean}
 */
export function isFsAccessSupported() {
  return typeof window.showDirectoryPicker === "function";
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isEditableFileName(name) {
  return EDITABLE_FILE_RE.test(name);
}

/**
 * Infer the best editable extension from document contents.
 * Prefers strong HTML-document signals; otherwise markdown (this app's default).
 * Plain prose with no markup hints becomes `.txt`.
 *
 * @param {string} [text]
 * @returns {"md"|"html"|"txt"}
 */
export function detectEditableExtension(text) {
  const sample = String(text || "").replace(/^\uFEFF/, "");
  if (!sample.trim()) return "md";

  const head = sample.slice(0, 4000);
  const withoutComments = head.replace(/<!--[\s\S]*?-->/g, "").trimStart();

  if (/^<!DOCTYPE\s+html\b/i.test(withoutComments) || /^<html[\s>]/i.test(withoutComments)) {
    return "html";
  }

  // Tag-heavy document that starts with markup and lacks markdown structure.
  if (/^<[a-zA-Z!/?]/.test(withoutComments)) {
    const tagCount = (sample.match(/<\/?[a-zA-Z][a-zA-Z0-9:-]*\b[^>]*>/g) || []).length;
    const mdSignals = (sample.match(/^#{1,6}\s|^\s{0,3}[-*+]\s|^\s{0,3}\d+\.\s|```|^\|.+\||\[.+\]\(.+\)/gm) || [])
      .length;
    if (tagCount >= 3 && tagCount > mdSignals * 2) return "html";
  }

  const hasHtmlTag = /<[a-zA-Z!/?]/.test(sample);
  const hasMarkdown = /^#{1,6}\s|^\s{0,3}[-*+]\s|^\s{0,3}\d+\.\s|```|\*\*[^*]+\*\*|__[^_]+__|\[.+\]\(.+\)|^>\s/m.test(
    sample,
  );
  if (!hasHtmlTag && !hasMarkdown) return "txt";

  return "md";
}

/**
 * @param {string} [text]
 * @returns {string}
 */
export function suggestedUntitledName(text) {
  return `untitled.${detectEditableExtension(text)}`;
}

/**
 * @param {string} name
 * @param {string} [text] Content used to pick a default extension when none is given.
 * @returns {string}
 */
export function ensureEditableExtension(name, text = "") {
  const trimmed = String(name || "").trim();
  const ext = detectEditableExtension(text);
  if (!trimmed) return `untitled.${ext}`;
  if (EDITABLE_FILE_RE.test(trimmed)) return trimmed;
  return `${trimmed}.${ext}`;
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
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
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(value, key);
    req.onerror = () => reject(req.error || new Error("IndexedDB put failed"));
    req.onsuccess = () => resolve();
  });
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
async function idbDelete(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.delete(key);
    req.onerror = () => reject(req.error || new Error("IndexedDB delete failed"));
    req.onsuccess = () => resolve();
  });
}

/**
 * @param {FileSystemHandle} handle
 * @param {"read"|"readwrite"} mode
 * @returns {Promise<PermissionState>}
 */
export async function queryHandlePermission(handle, mode = "readwrite") {
  if (!handle?.queryPermission) return "granted";
  return handle.queryPermission({ mode });
}

/**
 * @param {FileSystemHandle} handle
 * @param {"read"|"readwrite"} mode
 * @returns {Promise<PermissionState>}
 */
export async function ensureHandlePermission(handle, mode = "readwrite") {
  if (!handle) return "denied";
  const current = await queryHandlePermission(handle, mode);
  if (current === "granted") return current;
  if (!handle.requestPermission) return current;
  return handle.requestPermission({ mode });
}

/**
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function openDirectory() {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbSet(DIR_HANDLE_KEY, handle);
  return handle;
}

/**
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function loadStoredDirectory() {
  try {
    const handle = await idbGet(DIR_HANDLE_KEY);
    if (handle && handle.kind === "directory") return /** @type {FileSystemDirectoryHandle} */ (handle);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @returns {Promise<void>}
 */
export async function clearStoredDirectory() {
  try {
    await idbDelete(DIR_HANDLE_KEY);
    await idbDelete(FILE_HANDLE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {FileSystemFileHandle|null|undefined} handle
 * @returns {Promise<void>}
 */
export async function storeCurrentFileHandle(handle) {
  try {
    if (handle && handle.kind === "file") {
      await idbSet(FILE_HANDLE_KEY, handle);
    } else {
      await idbDelete(FILE_HANDLE_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * @returns {Promise<FileSystemFileHandle|null>}
 */
export async function loadStoredCurrentFileHandle() {
  try {
    const handle = await idbGet(FILE_HANDLE_KEY);
    if (handle && handle.kind === "file") return /** @type {FileSystemFileHandle} */ (handle);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolve a slash-separated path under a root directory to a file handle.
 * @param {FileSystemDirectoryHandle} rootDir
 * @param {string} path
 * @returns {Promise<FileSystemFileHandle|null>}
 */
export async function resolveFilePath(rootDir, path) {
  const parts = String(path || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!rootDir || !parts.length) return null;
  try {
    let dir = rootDir;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    return await dir.getFileHandle(parts[parts.length - 1]);
  } catch {
    return null;
  }
}

/**
 * Restore a previously stored directory handle.
 * @returns {Promise<{ handle: FileSystemDirectoryHandle|null, permission: PermissionState|null }>}
 */
export async function restoreDirectory() {
  const handle = await loadStoredDirectory();
  if (!handle) return { handle: null, permission: null };
  const permission = await queryHandlePermission(handle, "readwrite");
  if (permission === "granted") return { handle, permission };
  return { handle, permission };
}

/**
 * @typedef {{ name: string, kind: "file"|"directory", handle: FileSystemHandle }} FsEntry
 */

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<FsEntry[]>}
 */
export async function listDirectory(dirHandle) {
  /** @type {FsEntry[]} */
  const dirs = [];
  /** @type {FsEntry[]} */
  const files = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "directory") {
      dirs.push({ name, kind: "directory", handle });
    } else if (handle.kind === "file" && isEditableFileName(name)) {
      files.push({ name, kind: "file", handle });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  dirs.sort(byName);
  files.sort(byName);
  return [...dirs, ...files];
}

/**
 * @param {FileSystemFileHandle} fileHandle
 * @returns {Promise<string>}
 */
export async function readTextFile(fileHandle) {
  const file = await fileHandle.getFile();
  return file.text();
}

/**
 * @param {FileSystemFileHandle} fileHandle
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function writeTextFile(fileHandle, text) {
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} name
 * @param {string} [text]
 * @returns {Promise<FileSystemFileHandle>}
 */
export async function createFile(dirHandle, name, text = "") {
  const fileName = ensureEditableExtension(name, text);
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  await writeTextFile(fileHandle, text);
  return fileHandle;
}

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} name
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function createFolder(dirHandle, name) {
  const folderName = String(name || "").trim();
  if (!folderName) throw new Error("Folder name required");
  return dirHandle.getDirectoryHandle(folderName, { create: true });
}

/**
 * @param {FileSystemDirectoryHandle} parentHandle
 * @param {string} name
 * @param {boolean} [recursive]
 * @returns {Promise<void>}
 */
export async function removeEntry(parentHandle, name, recursive = true) {
  await parentHandle.removeEntry(name, { recursive });
}

/**
 * Rename a file or directory within its parent.
 * Prefers handle.move(); falls back to copy+delete for files.
 *
 * @param {FileSystemDirectoryHandle} parentHandle
 * @param {FileSystemHandle} handle
 * @param {string} newName
 * @returns {Promise<FileSystemHandle>}
 */
export async function renameEntry(parentHandle, handle, newName) {
  const next = String(newName || "").trim();
  if (!next) throw new Error("Name required");
  if (next === handle.name) return handle;

  if (typeof handle.move === "function") {
    await handle.move(next);
    return handle;
  }

  if (handle.kind === "file") {
    const text = await readTextFile(/** @type {FileSystemFileHandle} */ (handle));
    const created = await createFile(parentHandle, next, text);
    await removeEntry(parentHandle, handle.name, false);
    return created;
  }

  throw new Error("Rename is not supported in this browser");
}

/**
 * Save-as via the system save picker (no folder open).
 * @param {string} suggestedName
 * @param {string} text
 * @returns {Promise<FileSystemFileHandle|null>}
 */
export async function saveWithPicker(suggestedName, text) {
  if (typeof window.showSaveFilePicker !== "function") return null;
  const name = ensureEditableExtension(suggestedName || "", text);
  const ext = detectEditableExtension(text);
  /** @type {Record<string, string[]>} */
  const accept =
    ext === "html"
      ? { "text/html": [".html", ".htm"], "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] }
      : ext === "txt"
        ? { "text/plain": [".txt"], "text/markdown": [".md", ".markdown"], "text/html": [".html", ".htm"] }
        : { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"], "text/html": [".html", ".htm"] };
  const handle = await window.showSaveFilePicker({
    suggestedName: name,
    types: [
      {
        description: "Text",
        accept,
      },
    ],
  });
  await writeTextFile(handle, text);
  return handle;
}
