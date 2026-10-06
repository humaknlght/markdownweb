import { marked } from "marked";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { alertExtension } from "../../src/alert.js";
import { defListExtension } from "../../src/deflist.js";
import { emojiExtension } from "../../src/emoji.js";
import { frontmatterExtension } from "../../src/frontmatter.js";
import { tablePipesExtension } from "../../src/tablePipes.js";

const { window } = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const DOMPurify = createDOMPurify(window);

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if ("target" in node) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

let configured = false;

function ensureMarked() {
  if (configured) return;
  marked.setOptions({ gfm: true, breaks: false });
  marked.use(tablePipesExtension());
  marked.use(frontmatterExtension());
  marked.use(emojiExtension());
  marked.use(alertExtension());
  marked.use(defListExtension());
  configured = true;
}

/**
 * Parse Markdown with the same extension order as the app (no sanitize).
 * @param {string} source
 * @returns {string}
 */
export function parseMarkdown(source) {
  ensureMarked();
  return marked.parse(source ?? "");
}

/**
 * Parse Markdown then sanitize like the app.
 * @param {string} source
 * @returns {string}
 */
export function renderMarkdownHtml(source) {
  return DOMPurify.sanitize(parseMarkdown(source), {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ["data-source-line", "data-source-line-end"],
  });
}

export { marked, DOMPurify, window };
