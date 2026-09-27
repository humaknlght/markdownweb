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
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else if (ext === ".jpg" || ext === ".jpeg" || ext === ".avif" || ext === ".png") {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }

  return headers;
}

/**
 * @param {string} urlPath
 * @param {string} rootDir
 * @returns {string | null}
 */
export function safeResolve(urlPath, rootDir) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  let rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (rel.endsWith("/")) rel += "index.html";
  const full = path.resolve(rootDir, rel);
  if (!full.startsWith(rootDir + path.sep) && full !== rootDir) {
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
