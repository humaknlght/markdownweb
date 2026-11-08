/**
 * Preview / export link targets.
 *
 * Same-document fragments (`#…`) stay in-page (footnotes, heading ids).
 * External sites and other pages open in a new tab with noopener/noreferrer.
 */

/**
 * @param {string | null | undefined} href
 * @returns {boolean}
 */
export function isSameDocumentHref(href) {
  const raw = String(href ?? "").trim();
  // No href / empty: nothing to navigate.
  if (!raw) return true;
  return raw.startsWith("#");
}

/**
 * @param {string | null | undefined} href
 * @returns {boolean}
 */
export function shouldOpenLinkInNewTab(href) {
  if (href == null) return false;
  const raw = String(href).trim();
  if (!raw) return false;
  return !isSameDocumentHref(raw);
}

/**
 * Apply `target="_blank"` + `rel="noopener noreferrer"` to anchors that leave
 * the current document. Same-document hash links keep (or regain) in-page navigation.
 * @param {Element} node
 */
export function applyLinkTargetAttributes(node) {
  if (!node || node.nodeType !== 1) return;
  const tag = node.tagName?.toLowerCase?.() || "";
  if (tag !== "a" && tag !== "area") return;
  if (!node.hasAttribute("href")) return;

  const href = node.getAttribute("href") || "";
  if (shouldOpenLinkInNewTab(href)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
    return;
  }

  node.removeAttribute("target");
  // Drop the rel we set for new-tab links; leave unrelated rel values alone.
  const rel = (node.getAttribute("rel") || "").trim().toLowerCase();
  if (
    rel === "noopener noreferrer" ||
    rel === "noreferrer noopener" ||
    rel === "noopener" ||
    rel === "noreferrer"
  ) {
    node.removeAttribute("rel");
  }
}

/**
 * Register DOMPurify hook for markdown link targets. Safe to call once per purify instance.
 * @param {{ addHook: (entryPoint: string, hook: (node: Element) => void) => void }} purify
 */
export function installMarkdownLinkHooks(purify) {
  purify.addHook("afterSanitizeAttributes", (node) => {
    applyLinkTargetAttributes(/** @type {Element} */ (node));
  });
}
