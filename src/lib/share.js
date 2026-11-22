/**
 * Share-URL encoding: base64url, deflate-raw (`mdz`), legacy uncompressed (`md`).
 */

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
export function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function base64UrlToUtf8(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

/**
 * @param {Uint8Array} bytes
 * @param {typeof CompressionStream | typeof DecompressionStream} TransformStreamCtor
 * @param {string} format
 * @returns {Promise<Uint8Array>}
 */
async function pipeThroughCompression(bytes, TransformStreamCtor, format) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new TransformStreamCtor(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function compressUtf8ToBase64Url(text) {
  const input = new TextEncoder().encode(text);
  const compressed = await pipeThroughCompression(
    input,
    CompressionStream,
    "deflate-raw",
  );
  return bytesToBase64Url(compressed);
}

/**
 * Upper bound on decoded share-URL content (`md` and `mdz`). Deflate can
 * expand ~1000x, so a URL-sized `mdz` could otherwise inflate to gigabytes.
 */
export const SHARE_MAX_DECODED_BYTES = 5 * 1024 * 1024;

/** Longest `md` value whose base64url decoding fits in the decoded limit. */
const MD_MAX_PARAM_CHARS = Math.ceil(SHARE_MAX_DECODED_BYTES / 3) * 4;

/**
 * @param {Uint8Array} bytes
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array>}
 */
async function inflateRawWithLimit(bytes, maxBytes) {
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new RangeError(`Decompressed payload exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * @param {string} value
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function decompressBase64UrlToUtf8(
  value,
  { maxBytes = SHARE_MAX_DECODED_BYTES } = {},
) {
  const inflated = await inflateRawWithLimit(base64UrlToBytes(value), maxBytes);
  return new TextDecoder().decode(inflated);
}

/**
 * @param {string | null | undefined} md
 * @returns {string | null}
 */
export function decodeMdParam(md) {
  if (md == null || md === "") return null;
  if (md.length > MD_MAX_PARAM_CHARS) return null;
  try {
    return base64UrlToUtf8(md);
  } catch {
    try {
      return decodeURIComponent(md);
    } catch {
      return md;
    }
  }
}

/**
 * @param {string | null | undefined} mdz
 * @returns {Promise<string | null>}
 */
export async function decodeMdzParam(mdz) {
  if (mdz == null || mdz === "") return null;
  try {
    return await decompressBase64UrlToUtf8(mdz);
  } catch {
    return null;
  }
}

/**
 * @param {URLSearchParams} searchParams
 * @param {{ themes?: string[], views?: string[] }} [opts]
 * @returns {Promise<{ markdown: string | null, theme: string | null, view: string | null }>}
 */
export async function readShareParams(
  searchParams,
  { themes = [], views = [] } = {},
) {
  const mdz = searchParams.get("mdz");
  let markdown = mdz ? await decodeMdzParam(mdz) : null;
  if (markdown == null) {
    markdown = decodeMdParam(searchParams.get("md"));
  }
  const themeRaw = searchParams.get("theme");
  const viewRaw = searchParams.get("view");
  return {
    markdown,
    theme: themes.includes(themeRaw) ? themeRaw : null,
    view: views.includes(viewRaw) ? viewRaw : null,
  };
}
