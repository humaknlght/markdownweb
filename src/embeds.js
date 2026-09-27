/** Collapse data-URI images longer than this into a one-line editor token. */
export const DATA_URI_COLLAPSE_MIN = 64;

const DATA_URI_IMG_RE =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/gi;

/** Truncated editor form: `![alt](data:image/png;base64,iVBORw0KGgo…#3)` */
const EMBED_IMG_RE =
  /!\[([^\]]*)\]\(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]*…#(\d+)\)/g;

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
 * @param {string} alt
 * @param {string} dataUrl
 * @returns {string}
 */
export function formatEmbedMarkdown(alt, dataUrl) {
  const compact = String(dataUrl || "").replace(/\s+/g, "");
  const match = compact.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match || compact.length < DATA_URI_COLLAPSE_MIN) {
    return `![${alt}](${compact})`;
  }
  const mime = match[1];
  const head = match[2].slice(0, 12);
  const id = rememberEmbed(compact);
  return `![${alt}](data:${mime};base64,${head}…#${id})`;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function expandEmbeds(text) {
  return String(text || "").replace(EMBED_IMG_RE, (full, alt, idStr) => {
    const dataUrl = imageEmbeds.get(Number(idStr));
    if (!dataUrl) return full;
    return `![${alt}](${dataUrl})`;
  });
}

/**
 * @param {string} text
 * @returns {string}
 */
export function collapseDataUris(text) {
  return String(text || "").replace(DATA_URI_IMG_RE, (_, alt, dataUrl) =>
    formatEmbedMarkdown(alt, dataUrl),
  );
}

/**
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {{ text: string, caretStart: number, caretEnd: number }}
 */
export function collapseDataUrisPreservingSelection(text, selStart, selEnd) {
  let out = "";
  let last = 0;
  let caretStart = selStart;
  let caretEnd = selEnd;
  const src = String(text || "");

  for (const match of src.matchAll(DATA_URI_IMG_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    out += src.slice(last, start);
    const replacement = formatEmbedMarkdown(match[1], match[2]);
    const delta = replacement.length - match[0].length;

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
 * Collapsed `![alt](data:…#id)` tokens; uri* covers `(data:…#id)`.
 * @param {string} text
 * @returns {Array<{ fullStart: number, fullEnd: number, uriStart: number, uriEnd: number }>}
 */
export function findCollapsedEmbeds(text) {
  const embeds = [];
  for (const match of String(text || "").matchAll(EMBED_IMG_RE)) {
    const fullStart = match.index ?? 0;
    const fullEnd = fullStart + match[0].length;
    const paren = match[0].indexOf("](");
    if (paren < 0) continue;
    const uriStart = fullStart + paren + 1;
    const uriEnd = fullEnd;
    embeds.push({ fullStart, fullEnd, uriStart, uriEnd });
  }
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
