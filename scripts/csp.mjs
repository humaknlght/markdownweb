import { createHash } from "node:crypto";

const CDN_SCRIPT_ORIGINS = ["https://cdn.jsdelivr.net"];

/**
 * Extract bodies of inline <script> tags (no src attribute).
 * CSP sha256 hashes must match these bodies exactly (as served).
 */
export function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
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
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' https://cdn.jsdelivr.net",
    // Drive REST uploads/downloads from the main app (token from helper popup).
    "connect-src 'self' https://cdn.jsdelivr.net https://www.googleapis.com",
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
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://www.googleapis.com",
    "frame-src https://accounts.google.com",
    "upgrade-insecure-requests",
  ].join("; ");
}
