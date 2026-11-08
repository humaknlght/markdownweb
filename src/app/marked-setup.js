import {
  abbrExtension,
  alertExtension,
  applyLinkTargetAttributes,
  DOMPurify,
  defListExtension,
  emojiExtension,
  footnoteExtension,
  frontmatterExtension,
  headingIdExtension,
  marked,
  markHighlightExtension,
  stripRemoteMediaAttributes,
  subSupExtension,
  tablePipesExtension,
} from "./vendor-deps.js";

marked.setOptions({
  gfm: true,
  breaks: false,
});

marked.use(tablePipesExtension());
marked.use(frontmatterExtension());
marked.use(emojiExtension());
marked.use(alertExtension());
marked.use(defListExtension());
marked.use(footnoteExtension());
marked.use(headingIdExtension());
marked.use(markHighlightExtension());
marked.use(subSupExtension());
marked.use(abbrExtension());

// External sites / other pages → new tab (noopener). Same-document `#…` stays in-page.
// Strip remote media URLs so Accepted Markdown cannot phone home (CSP img-src is the backstop).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  applyLinkTargetAttributes(/** @type {Element} */ (node));
  stripRemoteMediaAttributes(/** @type {Element} */ (node));
});
