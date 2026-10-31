import {
  alertExtension,
  defListExtension,
  emojiExtension,
  frontmatterExtension,
  tablePipesExtension,
  stripRemoteMediaAttributes,
  marked,
  DOMPurify
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

// Open all markdown links in a new tab; noopener/noreferrer blocks window.opener abuse.
// Strip remote media URLs so Accepted Markdown cannot phone home (CSP img-src is the backstop).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if ("target" in node) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  stripRemoteMediaAttributes(/** @type {Element} */ (node));
});


