import { createHash } from "node:crypto";
import path from "node:path";

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".avif": "image/avif",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export const CORP = "same-origin";

/**
 * @param {string} logicalPath
 * @param {string | null} encoding
 * @param {{ htmlHeaders?: Record<string, string>, mime?: Record<string, string>, corp?: string }} [opts]
 * @returns {Record<string, string>}
 */
export function headersFor(logicalPath, encoding, opts = {}) {
  const mime = opts.mime || MIME;
  const corp = opts.corp || CORP;
  const htmlHeaders = opts.htmlHeaders || {};
  const ext = path.extname(logicalPath).toLowerCase();
  const base = path.basename(logicalPath);
  const headers = {
    "Cross-Origin-Resource-Policy": corp,
    "Content-Type": mime[ext] || "application/octet-stream",
    Vary: "Accept-Encoding",
  };

  if (encoding) {
    headers["Content-Encoding"] = encoding;
  }

  if (
    /^og-image\.[a-f0-9]+\.png$/i.test(base) ||
    /^icon-(192|512|maskable-512)(\.[a-f0-9]+)?\.png$/i.test(base)
  ) {
    headers["Cross-Origin-Resource-Policy"] = "cross-origin";
  }

  if (ext === ".html") {
    Object.assign(headers, htmlHeaders);
  } else if (base === "sw.js" || ext === ".webmanifest" || base === "GUIDE.md") {
    headers["Cache-Control"] = "no-cache";
  } else if (/^GUIDE\.[a-f0-9]+\.md$/i.test(base)) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else if (ext === ".css" || ext === ".js" || ext === ".mjs") {
    // Hashed dist assets (app.<hash>.js, styles.<hash>.css, chunk-XXXX.js) are
    // immutable. Bare names used by `npm run dev` (app.js, markdown-utils.js)
    // must revalidate or browsers keep stale modules for a year.
    const hashed =
      /\.[a-f0-9]{8,}\.(?:css|js|mjs)$/i.test(base) ||
      /^chunk-[A-Z0-9]+\.js$/i.test(base);
    headers["Cache-Control"] = hashed
      ? "public, max-age=31536000, immutable"
      : "no-cache";
  } else if (ext === ".jpg" || ext === ".jpeg" || ext === ".avif" || ext === ".png") {
    const hashed = /\.[a-f0-9]{8,}\.(?:jpg|jpeg|avif|png)$/i.test(base);
    headers["Cache-Control"] = hashed
      ? "public, max-age=31536000, immutable"
      : "no-cache";
  } else if (ext === ".mp3") {
    const hashed = /\.[a-f0-9]{8,}\.mp3$/i.test(base);
    headers["Cache-Control"] = hashed
      ? "public, max-age=31536000, immutable"
      : "no-cache";
  }

  return headers;
}

/**
 * True when `candidate` is `rootDir` or a path inside it (after resolve).
 * Uses the path.relative pattern CodeQL recognizes for js/path-injection.
 * @param {string} candidate
 * @param {string} rootDir
 * @returns {boolean}
 */
export function isInsideRoot(candidate, rootDir) {
  const root = path.resolve(rootDir);
  const full = path.resolve(candidate);
  const rel = path.relative(root, full);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * @param {string} urlPath
 * @param {string} rootDir
 * @returns {string | null}
 */
export function safeResolve(urlPath, rootDir) {
  const root = path.resolve(rootDir);
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  let rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (rel.endsWith("/")) rel += "index.html";
  const full = path.resolve(root, rel);
  if (!isInsideRoot(full, root)) {
    return null;
  }
  return full;
}

/**
 * @param {string} logicalPath
 * @param {string | undefined} acceptEncoding
 * @param {(filePath: string) => Promise<boolean>} exists
 * @returns {Promise<{ path: string, encoding: string | null }>}
 */
export async function resolveWithCompression(logicalPath, acceptEncoding, exists) {
  const accept = (acceptEncoding || "").toLowerCase();
  const candidates = [];
  if (accept.includes("br")) candidates.push({ path: `${logicalPath}.br`, encoding: "br" });
  if (accept.includes("gzip") || accept.includes("deflate")) {
    candidates.push({ path: `${logicalPath}.gz`, encoding: "gzip" });
  }

  for (const candidate of candidates) {
    if (await exists(candidate.path)) {
      return candidate;
    }
  }

  return { path: logicalPath, encoding: null };
}

/**
 * Strong ETag from response body bytes. Encoding distinguishes br/gzip variants.
 * @param {Buffer | string} body
 * @param {string | null} [encoding]
 * @returns {string}
 */
export function strongEtag(body, encoding = null) {
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const tag = encoding ? `${digest}-${encoding}` : digest;
  return `"${tag}"`;
}

/** @param {number | Date} date */
export function toHttpDate(date) {
  return new Date(date).toUTCString();
}

/**
 * Conditional GET: honor If-None-Match over If-Modified-Since when both present.
 * @param {Record<string, string | string[] | undefined>} reqHeaders
 * @param {{ etag: string, lastModifiedMs: number }} resource
 */
export function isNotModified(reqHeaders, { etag, lastModifiedMs }) {
  const inm = reqHeaders["if-none-match"];
  if (typeof inm === "string" && inm.trim()) {
    if (inm.trim() === "*") return true;
    const tags = inm.split(",").map((t) => t.trim());
    for (const tag of tags) {
      const normalized = tag.startsWith("W/") ? tag.slice(2).trim() : tag;
      if (normalized === etag) return true;
    }
    return false;
  }

  const ims = reqHeaders["if-modified-since"];
  if (typeof ims === "string") {
    const since = Date.parse(ims);
    // HTTP dates are second-resolution; compare at that granularity.
    if (
      !Number.isNaN(since) &&
      Math.floor(lastModifiedMs / 1000) <= Math.floor(since / 1000)
    ) {
      return true;
    }
  }
  return false;
}
