/**
 * marked extension: Pandoc / MultiMarkdown-style footnotes.
 *
 * Inline: `See note.[^1]`
 * Definition:
 *   [^1]: Footnote text.
 *
 *     Indented continuation paragraphs stay in the footnote.
 */

import { escapeHtml } from "./markdown-utils.js";

/** @typedef {{ label: string, text: string, tokens: unknown[] }} FootnoteDef */

/**
 * @returns {{
 *   defs: Map<string, FootnoteDef>,
 *   refOrder: string[],
 *   refCounts: Map<string, number>,
 * }}
 */
function createFootnoteState() {
  return {
    defs: new Map(),
    refOrder: [],
    refCounts: new Map(),
  };
}

/** Per-parse state; reset in hooks.preprocess. */
let state = createFootnoteState();

const DEF_START_RE = /^\[\^([^\]\n]+)\]:/;
const DEF_LINE_RE = /^\[\^([^\]\n]+)\]:[ \t]?(.*)$/;
const REF_RE = /^\[\^([^\]\n]+)\]/;

/**
 * True when a line is indented enough to continue a footnote body
 * (4 spaces or a tab), matching CommonMark indented-code indent rules.
 * @param {string} line
 */
function isFootnoteContinuation(line) {
  return /^(?: {4}|\t)/.test(line);
}

/**
 * Strip one level of footnote indentation from a continuation line.
 * @param {string} line
 */
function unindentFootnoteLine(line) {
  if (line.startsWith("\t")) return line.slice(1);
  if (line.startsWith("    ")) return line.slice(4);
  return line.replace(/^ {1,3}/, "");
}

/**
 * Parse one footnote definition at the start of `src`.
 * @param {string} src
 * @returns {{ raw: string, label: string, text: string }|null}
 */
export function parseFootnoteDef(src) {
  const firstNl = src.indexOf("\n");
  const firstLine = firstNl === -1 ? src : src.slice(0, firstNl);
  const match = firstLine.match(DEF_LINE_RE);
  if (!match) return null;

  const label = match[1];
  const lines = [match[2] ?? ""];
  let i = firstNl === -1 ? src.length : firstNl + 1;

  while (i < src.length) {
    const nextNl = src.indexOf("\n", i);
    const line = nextNl === -1 ? src.slice(i) : src.slice(i, nextNl);
    const atEof = nextNl === -1;

    if (line.trim() === "") {
      if (atEof) break;
      const after = nextNl + 1;
      const peekNl = src.indexOf("\n", after);
      const peek = peekNl === -1 ? src.slice(after) : src.slice(after, peekNl);
      if (peek.trim() === "") break;
      if (!isFootnoteContinuation(peek)) break;
      lines.push("");
      i = nextNl + 1;
      continue;
    }

    if (!isFootnoteContinuation(line)) break;
    lines.push(unindentFootnoteLine(line));
    if (atEof) {
      i = src.length;
      break;
    }
    i = nextNl + 1;
  }

  let raw = src.slice(0, i);
  // Prefer not to swallow a final blank line after the definition.
  if (raw.endsWith("\n\n")) raw = raw.slice(0, -1);
  else if (raw.endsWith("\r\n\r\n")) raw = raw.slice(0, -2);

  return {
    raw,
    label,
    text: lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""),
  };
}

/**
 * Index of a footnote definition start in `src`, or -1.
 * @param {string} src
 */
export function findFootnoteDefStart(src) {
  const lines = src.split(/\r?\n/);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (DEF_START_RE.test(lines[i])) return offset;
    offset += lines[i].length;
    if (i < lines.length - 1) offset += 1;
  }
  return -1;
}

/**
 * @param {string} label
 */
function slugLabel(label) {
  const slug = String(label)
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "note";
}

/**
 * @param {string} label
 */
function registerRef(label) {
  if (!state.refOrder.includes(label)) state.refOrder.push(label);
  const n = (state.refCounts.get(label) || 0) + 1;
  state.refCounts.set(label, n);
  return n;
}

/**
 * @param {string} label
 */
function footnoteNumber(label) {
  const index = state.refOrder.indexOf(label);
  return index === -1 ? 0 : index + 1;
}

/**
 * @param {{ parse: (tokens: unknown[]) => string }} parser
 */
function renderFootnotesSection(parser) {
  const used = state.refOrder.filter((label) => state.defs.has(label));
  if (used.length === 0) return "";

  let body = "";
  for (const label of used) {
    const def = state.defs.get(label);
    const num = footnoteNumber(label);
    const slug = slugLabel(label);
    const count = state.refCounts.get(label) || 1;
    let content = parser.parse(def.tokens);
    content = content.replace(/\n$/, "");

    let backrefs = "";
    for (let i = 1; i <= count; i++) {
      const refId = i === 1 ? `fnref-${slug}` : `fnref-${slug}-${i}`;
      backrefs +=
        `<a href="#${escapeHtml(refId)}" class="footnote-backref" ` +
        `aria-label="Back to reference ${num}">↩</a>`;
      if (i < count) backrefs += " ";
    }

    if (/<\/p>\s*$/i.test(content)) {
      content = content.replace(/<\/p>\s*$/i, ` ${backrefs}</p>`);
    } else if (content) {
      content += `\n<p>${backrefs}</p>`;
    } else {
      content = `<p>${backrefs}</p>`;
    }

    body += `<li id="fn-${escapeHtml(slug)}">\n${content}\n</li>\n`;
  }

  return (
    `<section class="footnotes" data-footnotes>\n` +
    `<hr>\n` +
    `<ol>\n${body}</ol>\n` +
    `</section>\n`
  );
}

/** marked extension: `[^id]` refs + `[^id]:` definitions → endnotes */
export function footnoteExtension() {
  return {
    hooks: {
      preprocess(src) {
        state = createFootnoteState();
        return src;
      },
      processAllTokens(tokens) {
        const used = state.refOrder.some((label) => state.defs.has(label));
        if (used) {
          tokens.push({ type: "footnotesSection", raw: "" });
        }
        return tokens;
      },
    },
    extensions: [
      {
        name: "footnoteDef",
        level: "block",
        start(src) {
          const index = findFootnoteDefStart(src);
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          const parsed = parseFootnoteDef(src);
          if (!parsed) return;

          const tokens = this.lexer.blockTokens(parsed.text, []);
          if (!state.defs.has(parsed.label)) {
            state.defs.set(parsed.label, {
              label: parsed.label,
              text: parsed.text,
              tokens,
            });
          }

          return {
            type: "footnoteDef",
            raw: parsed.raw,
            label: parsed.label,
            text: parsed.text,
            tokens,
          };
        },
        renderer() {
          return "";
        },
      },
      {
        name: "footnoteRef",
        level: "inline",
        start(src) {
          const index = src.indexOf("[^");
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          const match = REF_RE.exec(src);
          if (!match) return;
          if (src[match[0].length] === ":") return;

          const label = match[1];
          const occurrence = registerRef(label);
          return {
            type: "footnoteRef",
            raw: match[0],
            label,
            occurrence,
          };
        },
        renderer(token) {
          const slug = slugLabel(token.label);
          const num = footnoteNumber(token.label);
          const display = num > 0 ? String(num) : "?";
          const refId =
            token.occurrence > 1
              ? `fnref-${slug}-${token.occurrence}`
              : `fnref-${slug}`;
          return (
            `<sup class="footnote-ref">` +
            `<a href="#fn-${escapeHtml(slug)}" id="${escapeHtml(refId)}">` +
            `${escapeHtml(display)}` +
            `</a></sup>`
          );
        },
      },
      {
        name: "footnotesSection",
        level: "block",
        renderer() {
          return renderFootnotesSection(this.parser);
        },
      },
    ],
  };
}

/** Reset parse state (tests). */
export function resetFootnoteState() {
  state = createFootnoteState();
}
