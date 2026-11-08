import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { marked, Renderer } from "marked";
import { applyLinkTargetAttributes } from "../../src/lib/link-targets.js";
import { abbrExtension } from "../../src/markdown/abbr.js";
import { alertExtension } from "../../src/markdown/alert.js";
import { defListExtension } from "../../src/markdown/deflist.js";
import { emojiExtension } from "../../src/markdown/emoji.js";
import { footnoteExtension } from "../../src/markdown/footnotes.js";
import { frontmatterExtension } from "../../src/markdown/frontmatter.js";
import { headingIdExtension } from "../../src/markdown/heading-ids.js";
import { markHighlightExtension } from "../../src/markdown/mark-highlight.js";
import { escapeHtml } from "../../src/markdown/markdown-utils.js";
import { subSupExtension } from "../../src/markdown/subsup.js";
import { tablePipesExtension } from "../../src/markdown/tablePipes.js";

const { window } = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const DOMPurify = createDOMPurify(window);

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  applyLinkTargetAttributes(/** @type {Element} */ (node));
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
  marked.use(footnoteExtension());
  marked.use(headingIdExtension());
  marked.use(markHighlightExtension());
  marked.use(subSupExtension());
  marked.use(abbrExtension());
  // Mirror app checkbox / heading-id renderers used by unit HTML asserts.
  const rendererProto = Renderer.prototype;
  marked.use({
    renderer: {
      checkbox({ checked }) {
        return (
          `<span class="task-list-item-checkbox" role="checkbox" ` +
          `aria-checked="${checked ? "true" : "false"}" aria-disabled="true"></span> `
        );
      },
      listitem(token) {
        let html = rendererProto.listitem.call(this, token);
        if (token.task) {
          html = html.replace(/^<li>/, '<li class="task-list-item">');
        }
        return html;
      },
      heading(token) {
        const text = this.parser.parseInline(token.tokens);
        const level = token.depth;
        const id =
          typeof token.customId === "string" && token.customId
            ? ` id="${escapeHtml(token.customId)}"`
            : "";
        return `<h${level}${id}>${text}</h${level}>\n`;
      },
    },
  });
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
    FORBID_TAGS: [
      "form",
      "input",
      "button",
      "select",
      "textarea",
      "option",
      "optgroup",
      "fieldset",
      "legend",
    ],
  });
}

export { DOMPurify, marked, window };
