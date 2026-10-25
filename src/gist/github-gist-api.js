/**
 * GitHub Gist REST via Octokit (bundled same-origin in dist; dynamic import for src/dev).
 * Calls api.github.com only.
 */

import { isEditableFileName } from "../lib/fs.js";

/** @type {typeof import("@octokit/rest").Octokit | null} */
let OctokitCtor = null;

async function loadOctokit() {
  if (!OctokitCtor) {
    const mod = await import("@octokit/rest");
    OctokitCtor = mod.Octokit;
  }
  return OctokitCtor;
}

/**
 * @param {string} token
 * @returns {Promise<import("@octokit/rest").Octokit>}
 */
export async function createGistOctokit(token) {
  const Octokit = await loadOctokit();
  return new Octokit({
    auth: token,
    userAgent: "markdown-editor",
  });
}

/**
 * @typedef {{ id: string, description: string, public: boolean, updatedAt: string, files: { filename: string, language: string | null, size: number }[] }} GistListItem
 */

/**
 * List the authenticated user's gists (including private).
 * @param {string} token
 * @returns {Promise<GistListItem[]>}
 */
export async function listGists(token) {
  const octokit = await createGistOctokit(token);
  /** @type {GistListItem[]} */
  const out = [];
  const iterator = octokit.paginate.iterator(octokit.gists.list, { per_page: 100 });
  for await (const { data } of iterator) {
    for (const gist of data) {
      const files = Object.keys(gist.files || {}).map((filename) => {
        const f = gist.files[filename];
        return {
          filename,
          language: f?.language ?? null,
          size: Number(f?.size) || 0,
        };
      });
      out.push({
        id: gist.id,
        description: gist.description || "",
        public: Boolean(gist.public),
        updatedAt: gist.updated_at || "",
        files,
      });
    }
  }
  return out;
}

/**
 * Editable markdown-ish files in a gist listing entry.
 * @param {GistListItem} gist
 * @returns {{ filename: string, language: string | null, size: number }[]}
 */
export function editableGistFiles(gist) {
  return (gist.files || []).filter((f) => isEditableFileName(f.filename));
}

/**
 * @param {string} token
 * @param {string} gistId
 * @returns {Promise<{ id: string, description: string, public: boolean, files: Record<string, { filename: string, content: string, language?: string | null }> }>}
 */
export async function getGist(token, gistId) {
  const octokit = await createGistOctokit(token);
  const { data } = await octokit.gists.get({ gist_id: gistId });
  /** @type {Record<string, { filename: string, content: string, language?: string | null }>} */
  const files = {};
  for (const [name, file] of Object.entries(data.files || {})) {
    if (!file) continue;
    files[name] = {
      filename: file.filename || name,
      content: file.content ?? "",
      language: file.language ?? null,
    };
  }
  return {
    id: data.id,
    description: data.description || "",
    public: Boolean(data.public),
    files,
  };
}

/**
 * Read one file's text from a gist.
 * @param {string} token
 * @param {string} gistId
 * @param {string} filename
 * @returns {Promise<string>}
 */
export async function readGistFileText(token, gistId, filename) {
  const gist = await getGist(token, gistId);
  const file = gist.files[filename];
  if (!file) throw new Error(`File not found in gist: ${filename}`);
  return file.content;
}

/**
 * Create a private gist with a single markdown file.
 * @param {string} token
 * @param {{ filename: string, content: string, description?: string }} opts
 * @returns {Promise<{ id: string, filename: string }>}
 */
export async function createPrivateGist(token, opts) {
  const filename = opts.filename || "untitled.md";
  const octokit = await createGistOctokit(token);
  const { data } = await octokit.gists.create({
    description: opts.description || "",
    public: false,
    files: {
      [filename]: { content: opts.content ?? "" },
    },
  });
  return { id: data.id, filename };
}

/**
 * Update one file in an existing gist.
 * @param {string} token
 * @param {string} gistId
 * @param {string} filename
 * @param {string} content
 * @returns {Promise<{ id: string, filename: string }>}
 */
export async function updateGistFile(token, gistId, filename, content) {
  const octokit = await createGistOctokit(token);
  const { data } = await octokit.gists.update({
    gist_id: gistId,
    files: {
      [filename]: { content },
    },
  });
  return { id: data.id, filename };
}

/**
 * Delete (trash) a gist.
 * @param {string} token
 * @param {string} gistId
 */
export async function deleteGist(token, gistId) {
  const octokit = await createGistOctokit(token);
  await octokit.gists.delete({ gist_id: gistId });
}
