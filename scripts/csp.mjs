import { createHash } from "node:crypto";

const CDN_SCRIPT_ORIGINS = ["https://cdn.jsdelivr.net"];

/**
 * Extract bodies of inline <script> tags (no src attribute).
 * CSP sha256 hashes must match these bodies exactly (as served).
 */
export function extractInlineScripts(html) {
  const scripts = [];
  // Closing `\b[^>]*` matches browser-tolerated forms like `</script >` / `</script foo>`.
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
  for (const match of html.matchAll(re)) {
    const attrs = match[1] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    scripts.push(match[2]);
  }
  return scripts;
}

export function sha256Base64(text) {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

/** Returns CSP tokens like ["'sha256-...'", ...] */
export function inlineScriptHashes(html) {
  return extractInlineScripts(html)
    .filter((body) => body.length > 0)
    .map((body) => `'sha256-${sha256Base64(body)}'`);
}

export function buildScriptSrc(hashes) {
  const parts = ["'self'", ...CDN_SCRIPT_ORIGINS, ...hashes];
  return parts.join(" ");
}

/** script-src for drive-helper/ (same-origin modules only; OAuth is a top-level redirect). */
export function buildDriveHelperScriptSrc(hashes = []) {
  const parts = ["'self'", ...hashes];
  return parts.join(" ");
}

export function buildContentSecurityPolicy(scriptSrc) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    // No 'unsafe-inline': dynamic CSS uses a constructable stylesheet + classes.
    "style-src 'self'",
    // No https: — Markdown preview must not phone home via remote images.
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' https://cdn.jsdelivr.net",
    // Drive REST + GitHub Gist API from the main app (tokens never in Markdown).
    "connect-src 'self' https://cdn.jsdelivr.net https://www.googleapis.com https://api.github.com",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * CSP for drive-helper/ — no COEP; OAuth is a top-level redirect to Google.
 * @param {string} scriptSrc
 */
export function buildDriveHelperContentSecurityPolicy(scriptSrc) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://www.googleapis.com",
    "frame-src https://accounts.google.com",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * CSP for mermaid-sandbox/ — the opaque-origin Mermaid / svg2roughjs renderer.
 * `sandbox allow-scripts` keeps the document cross-origin to the app even if
 * it is ever loaded without the iframe sandbox attribute. Scripts are the
 * classic bootstrap, a dynamic inline import map (parent-fed CDN→blob remap),
 * and blob: modules. `'unsafe-inline'` is required because the import map is
 * built at runtime (hashes would disable it under CSP3); the opaque origin
 * still confines any script. The frame never fetches script over the network.
 * @param {string[]} [_hashes] Unused — kept for call-site compatibility.
 */
export function buildMermaidSandboxContentSecurityPolicy(_hashes = []) {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'none'",
    // blob: = runtime / Mermaid module blobs; unsafe-inline = bootstrap + import map.
    "script-src blob: 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src https://cdn.jsdelivr.net",
    "sandbox allow-scripts",
  ].join("; ");
}

/** script-src for url-fetch-helper/ (same-origin modules only). */
export function buildUrlFetchHelperScriptSrc(hashes = []) {
  const parts = ["'self'", ...hashes];
  return parts.join(" ");
}

/**
 * CSP for url-fetch-helper/ — may connect to any https host.
 * Framed same-origin only; ships COEP require-corp to match the embedder.
 * @param {string} scriptSrc
 */
export function buildUrlFetchHelperContentSecurityPolicy(scriptSrc) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https:",
    "upgrade-insecure-requests",
  ].join("; ");
}
