/** Shared Google Drive REST helpers and opener↔helper message protocol. */

import { EDITABLE_FILE_RE, isEditableFileName } from "../lib/fs.js";

export const DRIVE_MSG_TYPE = "md-preview:google-drive";
export const DRIVE_MSG_VERSION = 1;

/** Auth popup (own directory + .htaccess so COEP/CSP stay Google-capable). */
export const DRIVE_HELPER_PATH = "./drive-helper/";

/** Same-origin BroadcastChannel the auth popup reports results on. */
export const DRIVE_AUTH_CHANNEL = "md-preview:google-drive-auth";

/** Default My Drive folder for new files created by this app. */
export const DRIVE_DEFAULT_FOLDER_NAME = "markdown-editor";

const DRIVE_FOLDER_ID_KEY = "md-preview:driveFolderId";

/** Mime types preferred in the Drive Picker for this editor. */
export const DRIVE_EDITABLE_MIME_TYPES = [
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "text/html",
].join(",");

/**
 * @typedef {{ id: string, name: string, mimeType?: string }} DriveFileMeta
 * @typedef {{
 *   type: typeof DRIVE_MSG_TYPE,
 *   v: number,
 *   action: string,
 *   file?: DriveFileMeta,
 *   content?: string,
 *   name?: string,
 *   accessToken?: string,
 *   expiresIn?: number,
 *   error?: string,
 *   req?: string,
 * }} DriveMessage
 */

/**
 * @param {unknown} data
 * @returns {data is DriveMessage}
 */
export function isDriveMessage(data) {
  if (!data || typeof data !== "object") return false;
  const msg = /** @type {Record<string, unknown>} */ (data);
  return msg.type === DRIVE_MSG_TYPE && msg.v === DRIVE_MSG_VERSION && typeof msg.action === "string";
}

/**
 * @param {Partial<DriveMessage> & { action: string }} fields
 * @returns {DriveMessage}
 */
export function makeDriveMessage(fields) {
  return {
    type: DRIVE_MSG_TYPE,
    v: DRIVE_MSG_VERSION,
    ...fields,
  };
}

/**
 * @param {string} [name]
 * @param {string} [mimeType]
 * @returns {boolean}
 */
export function isDriveEditableFile(name, mimeType = "") {
  if (name && isEditableFileName(name)) return true;
  const mime = String(mimeType || "").toLowerCase();
  if (
    mime === "text/markdown" ||
    mime === "text/x-markdown" ||
    mime === "text/plain" ||
    mime === "text/html"
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} accessToken
 * @param {string} fileId
 * @returns {Promise<string>}
 */
export async function readDriveFileText(accessToken, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive read failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.text();
}

/**
 * @param {string} accessToken
 * @param {string} q
 * @param {string} [fields]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function queryDriveFiles(accessToken, q, fields = "files(id,name,mimeType,modifiedTime)") {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("orderBy", "folder,name");
  url.searchParams.set("fields", fields);

  const res = await fetch(url.href, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive list failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = await res.json();
  return Array.isArray(json.files) ? json.files : [];
}

/**
 * @typedef {{ id: string, name: string, kind: "file"|"directory", mimeType?: string }} DriveTreeEntry
 */

/**
 * List files and folders directly inside a Drive folder (must be under the app folder).
 * @param {string} accessToken
 * @param {string} [folderId] Defaults to the markdown-editor root folder.
 * @returns {Promise<{ folderId: string, folderName: string, entries: DriveTreeEntry[] }>}
 */
export async function listDriveFolderChildren(accessToken, folderId) {
  const rootId = await ensureDriveAppFolder(accessToken);
  const id = folderId || rootId;
  const q = `'${id}' in parents and trashed=false`;
  const files = await queryDriveFiles(accessToken, q, "files(id,name,mimeType)");

  /** @type {DriveTreeEntry[]} */
  const entries = [];
  for (const f of files) {
    if (!f?.id || !f?.name) continue;
    const mime = String(f.mimeType || "");
    const name = String(f.name);
    if (mime === "application/vnd.google-apps.folder") {
      entries.push({ id: String(f.id), name, kind: "directory", mimeType: mime });
      continue;
    }
    if (!isDriveEditableFile(name, mime)) continue;
    entries.push({ id: String(f.id), name, kind: "file", mimeType: mime || undefined });
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return {
    folderId: id,
    folderName: id === rootId ? DRIVE_DEFAULT_FOLDER_NAME : "",
    entries,
  };
}

/**
 * List the markdown-editor root folder (compat wrapper).
 * @param {string} accessToken
 */
export async function listDriveAppFolder(accessToken) {
  return listDriveFolderChildren(accessToken);
}

/**
 * @param {string} accessToken
 * @returns {Promise<DriveFileMeta[]>}
 */
export async function listDriveAppFiles(accessToken) {
  const { entries } = await listDriveAppFolder(accessToken);
  return entries
    .filter((e) => e.kind === "file")
    .map((e) => ({ id: e.id, name: e.name, mimeType: e.mimeType }));
}

/**
 * Find or create the app's default Drive folder (`markdown-editor` in My Drive).
 * With `drive.file` scope this only sees folders this app created (or the user opened).
 * @param {string} accessToken
 * @param {string} [folderName]
 * @returns {Promise<string>} folder id
 */
export async function ensureDriveAppFolder(accessToken, folderName = DRIVE_DEFAULT_FOLDER_NAME) {
  const cached = readCachedFolderId();
  if (cached) {
    const stillThere = await driveFolderExists(accessToken, cached);
    if (stillThere) return cached;
    clearCachedFolderId();
  }

  const existing = await findDriveFolderByName(accessToken, folderName);
  if (existing) {
    writeCachedFolderId(existing);
    return existing;
  }

  const created = await createDriveFolder(accessToken, folderName);
  writeCachedFolderId(created);
  return created;
}

/**
 * @param {string} accessToken
 * @param {string} folderId
 * @returns {Promise<boolean>}
 */
async function driveFolderExists(accessToken, folderId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,mimeType,trashed`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return false;
  const json = await res.json();
  return (
    json?.mimeType === "application/vnd.google-apps.folder" && json?.trashed !== true
  );
}

/**
 * @param {string} accessToken
 * @param {string} folderName
 * @returns {Promise<string | null>}
 */
async function findDriveFolderByName(accessToken, folderName) {
  const q = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${folderName.replace(/'/g, "\\'")}'`,
    `trashed=false`,
  ].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("fields", "files(id,name)");

  const res = await fetch(url.href, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive folder lookup failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = await res.json();
  const id = json?.files?.[0]?.id;
  return id ? String(id) : null;
}

/**
 * Create a folder. When `parentId` is omitted, creates in My Drive root
 * (used for the initial markdown-editor folder). Otherwise nests under parentId.
 * @param {string} accessToken
 * @param {string} folderName
 * @param {string} [parentId]
 * @returns {Promise<string>}
 */
export async function createDriveFolder(accessToken, folderName, parentId) {
  /** @type {{ name: string, mimeType: string, parents?: string[] }} */
  const meta = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) meta.parents = [parentId];

  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(meta),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive folder create failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = await res.json();
  if (!json?.id) throw new Error("Drive folder create returned no id");
  return String(json.id);
}

function readCachedFolderId() {
  try {
    return localStorage.getItem(DRIVE_FOLDER_ID_KEY) || null;
  } catch {
    return null;
  }
}

/** @param {string} id */
function writeCachedFolderId(id) {
  try {
    localStorage.setItem(DRIVE_FOLDER_ID_KEY, id);
  } catch {
    /* ignore */
  }
}

function clearCachedFolderId() {
  try {
    localStorage.removeItem(DRIVE_FOLDER_ID_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} accessToken
 * @param {{ name: string, content: string, mimeType?: string, parentId?: string }} opts
 * @returns {Promise<DriveFileMeta>}
 */
export async function createDriveFile(accessToken, { name, content, mimeType, parentId }) {
  const mime = mimeType || mimeTypeForName(name);
  const parent = parentId || (await ensureDriveAppFolder(accessToken));
  const metadata = JSON.stringify({
    name,
    mimeType: mime,
    parents: [parent],
  });
  const boundary = `md_boundary_${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive create failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = await res.json();
  return { id: String(json.id), name: String(json.name || name), mimeType: json.mimeType };
}

/**
 * @param {string} accessToken
 * @param {string} fileId
 * @param {{ content: string, mimeType?: string, name?: string }} opts
 * @returns {Promise<DriveFileMeta>}
 */
export async function updateDriveFile(accessToken, fileId, { content, mimeType, name }) {
  const mime = mimeType || (name ? mimeTypeForName(name) : "text/plain");
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mime,
      },
      body: content,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Drive update failed (${res.status})${detail ? `: ${detail}` : ""}`);
    // @ts-expect-error attach status for token refresh
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return {
    id: String(json.id || fileId),
    name: String(json.name || name || ""),
    mimeType: json.mimeType || mime,
  };
}

/**
 * Rename a Drive file or folder (metadata only).
 * @param {string} accessToken
 * @param {string} fileId
 * @param {string} newName
 * @returns {Promise<DriveFileMeta>}
 */
export async function renameDriveItem(accessToken, fileId, newName) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newName }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Drive rename failed (${res.status})${detail ? `: ${detail}` : ""}`);
    // @ts-expect-error attach status for token refresh
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return {
    id: String(json.id || fileId),
    name: String(json.name || newName),
    mimeType: json.mimeType,
  };
}

/**
 * Move a Drive file or folder to trash.
 * @param {string} accessToken
 * @param {string} fileId
 * @returns {Promise<void>}
 */
export async function trashDriveItem(accessToken, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed: true }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Drive delete failed (${res.status})${detail ? `: ${detail}` : ""}`);
    // @ts-expect-error attach status for token refresh
    err.status = res.status;
    throw err;
  }
}

/**
 * @param {string} name
 * @returns {string}
 */
export function mimeTypeForName(name) {
  if (/\.html?$/i.test(name)) return "text/html";
  if (/\.txt$/i.test(name)) return "text/plain";
  if (EDITABLE_FILE_RE.test(name)) return "text/markdown";
  return "text/plain";
}
