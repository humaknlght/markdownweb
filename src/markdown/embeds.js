/** Collapse data-URI images longer than this into a one-line editor token. */
export const DATA_URI_COLLAPSE_MIN = 64;

/** Inline: `![alt](data:image/…)` */
const DATA_URI_IMG_RE =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/gi;

/**
 * Reference definition: `[label]: data:image/…` (optional indent / angle brackets / title).
 * Horizontal whitespace only inside the URI so the match stays on one line.
 */
const DATA_URI_REF_RE =
  /^([ \t]{0,3})\[([^\]]+)\]:[ \t]+<?(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/= \t]+)>?(?:[ \t]+("[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/gim;

/** Truncated URI fragment: `data:image/png;base64,iVBORw0KGgo…#3` */
const EMBED_URI_RE =
  /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]*…#(\d+)/g;

/** Truncated editor form: `![alt](data:image/png;base64,iVBORw0KGgo…#3)` */
const EMBED_IMG_RE =
  /!\[([^\]]*)\]\(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]*…#(\d+)\)/g;

/** Truncated reference: `[label]: data:image/png;base64,iVBORw0KGgo…#3` */
const EMBED_REF_RE =
  /^([ \t]{0,3})\[([^\]]+)\]:[ \t]+<?(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]*…#\d+)>?(?:[ \t]+("[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/gm;

/** @type {Map<number, string>} */
const imageEmbeds = new Map();
let nextEmbedId = 1;

/** Reset embed store (tests / new document). */
export function clearEmbeds() {
  imageEmbeds.clear();
  nextEmbedId = 1;
}

/**
 * @param {string} dataUrl
 * @returns {number}
 */
export function rememberEmbed(dataUrl) {
  for (const [id, url] of imageEmbeds) {
    if (url === dataUrl) return id;
  }
  const id = nextEmbedId++;
  imageEmbeds.set(id, dataUrl);
  return id;
}

/**
 * Compact a data URL; when long enough, return the truncated editor token.
 * @param {string} dataUrl
 * @returns {string}
 */
export function formatEmbedDataUrl(dataUrl) {
  const compact = String(dataUrl || "").replace(/\s+/g, "");
  const match = compact.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match || compact.length < DATA_URI_COLLAPSE_MIN) return compact;
  const mime = match[1];
  const head = match[2].slice(0, 12);
  const id = rememberEmbed(compact);
  return `data:${mime};base64,${head}…#${id}`;
}

/**
 * @param {string} alt
 * @param {string} dataUrl
 * @returns {string}
 */
export function formatEmbedMarkdown(alt, dataUrl) {
  return `![${alt}](${formatEmbedDataUrl(dataUrl)})`;
}

/**
 * @param {string} label
 * @param {string} dataUrl
 * @param {{ indent?: string, title?: string }} [opts]
 * @returns {string}
 */
export function formatEmbedReference(label, dataUrl, opts = {}) {
  const indent = opts.indent || "";
  const title = opts.title ? ` ${opts.title}` : "";
  return `${indent}[${label}]: ${formatEmbedDataUrl(dataUrl)}${title}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function expandEmbeds(text) {
  return String(text || "").replace(EMBED_URI_RE, (full, idStr) => {
    const dataUrl = imageEmbeds.get(Number(idStr));
    return dataUrl || full;
  });
}

/**
 * @param {string} text
 * @returns {string}
 */
export function collapseDataUris(text) {
  let out = String(text || "").replace(DATA_URI_IMG_RE, (_, alt, dataUrl) =>
    formatEmbedMarkdown(alt, dataUrl),
  );
  out = out.replace(DATA_URI_REF_RE, (_, indent, label, dataUrl, title) =>
    formatEmbedReference(label, dataUrl, { indent, title }),
  );
  return out;
}

/**
 * Apply a list of non-overlapping replacements while adjusting a selection range.
 * @param {string} src
 * @param {number} selStart
 * @param {number} selEnd
 * @param {Array<{ start: number, end: number, replacement: string }>} edits
 * @returns {{ text: string, caretStart: number, caretEnd: number }}
 */
function applyReplacementsPreservingSelection(src, selStart, selEnd, edits) {
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let last = 0;
  let caretStart = selStart;
  let caretEnd = selEnd;

  for (const { start, end, replacement } of edits) {
    out += src.slice(last, start);
    const delta = replacement.length - (end - start);

    if (selStart >= end) caretStart += delta;
    else if (selStart > start) caretStart = out.length + replacement.length;

    if (selEnd >= end) caretEnd += delta;
    else if (selEnd > start) caretEnd = out.length + replacement.length;

    out += replacement;
    last = end;
  }
  out += src.slice(last);
  return { text: out, caretStart, caretEnd };
}

/**
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {{ text: string, caretStart: number, caretEnd: number }}
 */
export function collapseDataUrisPreservingSelection(text, selStart, selEnd) {
  const src = String(text || "");
  /** @type {Array<{ start: number, end: number, replacement: string }>} */
  const edits = [];

  for (const match of src.matchAll(DATA_URI_IMG_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    edits.push({
      start,
      end,
      replacement: formatEmbedMarkdown(match[1], match[2]),
    });
  }

  for (const match of src.matchAll(DATA_URI_REF_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    edits.push({
      start,
      end,
      replacement: formatEmbedReference(match[2], match[3], {
        indent: match[1],
        title: match[4],
      }),
    });
  }

  return applyReplacementsPreservingSelection(src, selStart, selEnd, edits);
}

/**
 * Collapsed `![alt](data:…#id)` and `[label]: data:…#id` tokens; uri* covers the URI.
 * @param {string} text
 * @returns {Array<{ fullStart: number, fullEnd: number, uriStart: number, uriEnd: number }>}
 */
export function findCollapsedEmbeds(text) {
  const src = String(text || "");
  const embeds = [];

  for (const match of src.matchAll(EMBED_IMG_RE)) {
    const fullStart = match.index ?? 0;
    const fullEnd = fullStart + match[0].length;
    const paren = match[0].indexOf("](");
    if (paren < 0) continue;
    const uriStart = fullStart + paren + 1;
    const uriEnd = fullEnd;
    embeds.push({ fullStart, fullEnd, uriStart, uriEnd });
  }

  for (const match of src.matchAll(EMBED_REF_RE)) {
    const fullStart = match.index ?? 0;
    const fullEnd = fullStart + match[0].length;
    const uri = match[3];
    const uriStart = fullStart + match[0].indexOf(uri);
    const uriEnd = uriStart + uri.length;
    embeds.push({ fullStart, fullEnd, uriStart, uriEnd });
  }

  embeds.sort((a, b) => a.fullStart - b.fullStart);
  return embeds;
}

/**
 * @param {{ uriStart: number, uriEnd: number }} emb
 * @param {number} selStart
 * @param {number} selEnd
 * @param {string} inputType
 * @returns {boolean}
 */
export function collapsedEmbedUriTouched(emb, selStart, selEnd, inputType) {
  if (selStart < emb.uriEnd && selEnd > emb.uriStart) return true;
  if (selStart !== selEnd) return false;
  if (inputType === "deleteContentBackward" && selStart === emb.uriEnd) return true;
  if (inputType === "deleteContentForward" && selStart === emb.uriStart) return true;
  return false;
}
