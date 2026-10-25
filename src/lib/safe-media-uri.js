/**
 * Allowlist for media URLs in preview / export HTML.
 * Remote http(s) URLs phone home; only same-document-safe schemes remain.
 */

const REMOTE_MEDIA_TAGS = new Set([
  "img",
  "source",
  "video",
  "audio",
  "image",
  "use",
  "track",
]);

const MEDIA_ATTRS = ["src", "href", "xlink:href"];

/**
 * @param {string} value
 * @returns {boolean} true when the URL may load without contacting a remote host
 */
export function isSafeMediaUri(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  // Protocol-relative //host/path phones home.
  if (raw.startsWith("//")) return false;
  const lower = raw.toLowerCase();
  if (lower.startsWith("data:") || lower.startsWith("blob:")) return true;
  // Hash / query-only or relative path (resolved against app origin = 'self').
  if (
    raw.startsWith("#") ||
    raw.startsWith("?") ||
    raw.startsWith("/") ||
    raw.startsWith("./") ||
    raw.startsWith("../")
  ) {
    return true;
  }
  // Bare relative path without scheme (e.g. assets/x.png).
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return true;
  // Explicit http(s) — blocked. Other schemes (javascript:, etc.) also blocked.
  return false;
}

const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * @param {Element} node
 * @param {string} attr
 * @returns {string | null}
 */
function readMediaAttr(node, attr) {
  if (attr === "xlink:href") {
    if (node.hasAttribute("xlink:href")) return node.getAttribute("xlink:href");
    if (typeof node.getAttributeNS === "function") {
      const ns = node.getAttributeNS(XLINK_NS, "href");
      if (ns != null) return ns;
    }
    return null;
  }
  if (!node.hasAttribute(attr)) return null;
  return node.getAttribute(attr);
}

/**
 * @param {Element} node
 * @param {string} attr
 */
function clearMediaAttr(node, attr) {
  if (attr === "xlink:href") {
    if (node.hasAttribute("xlink:href")) node.removeAttribute("xlink:href");
    if (typeof node.removeAttributeNS === "function") {
      try {
        node.removeAttributeNS(XLINK_NS, "href");
      } catch {
        /* ignore */
      }
    }
    return;
  }
  node.removeAttribute(attr);
}

/**
 * Strip remote media URLs from a DOM node (DOMPurify afterSanitizeAttributes).
 * Adds `md-remote-media-blocked` when an http(s) src/href was removed.
 * @param {Element} node
 */
export function stripRemoteMediaAttributes(node) {
  if (!node || node.nodeType !== 1) return;
  const tag = node.tagName?.toLowerCase?.() || "";
  if (!REMOTE_MEDIA_TAGS.has(tag)) return;

  let blocked = false;
  for (const attr of MEDIA_ATTRS) {
    const value = readMediaAttr(node, attr);
    if (value == null) continue;
    if (isSafeMediaUri(value)) continue;
    clearMediaAttr(node, attr);
    blocked = true;
  }
  if (blocked) {
    node.classList?.add?.("md-remote-media-blocked");
    if (tag === "img" && !node.getAttribute("alt")) {
      node.setAttribute("alt", "Remote image blocked");
    }
  }
}

/**
 * Register DOMPurify hook(s) for no-phone-home media. Safe to call once per purify instance.
 * @param {import("dompurify").DOMPurify} purify
 */
export function installSafeMediaHooks(purify) {
  purify.addHook("afterSanitizeAttributes", (node) => {
    stripRemoteMediaAttributes(/** @type {Element} */ (node));
  });
}
