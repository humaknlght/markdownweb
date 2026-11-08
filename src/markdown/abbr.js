/**
 * marked extension: PHP Markdown Extra abbreviations.
 *
 * *[HTML]: Hyper Text Markup Language
 *
 * The HTML specification…
 * → The <abbr title="Hyper Text Markup Language">HTML</abbr> specification…
 */

import { escapeHtml } from "./markdown-utils.js";

/** @type {Map<string, string>} */
let abbrs = new Map();

const DEF_RE = /^\*\[([^\]]+)\]:\s+(.+?)(?:\r?\n|$)/;

/**
 * Parse one abbreviation definition at the start of `src`.
 * @param {string} src
 * @returns {{ raw: string, abbr: string, title: string }|null}
 */
export function parseAbbrDef(src) {
  const match = src.match(DEF_RE);
  if (!match) return null;
  return {
    raw: match[0],
    abbr: match[1],
    title: match[2].trim(),
  };
}

/**
 * @param {string} src
 */
export function findAbbrDefStart(src) {
  const lines = src.split(/\r?\n/);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (DEF_RE.test(lines[i] + "\n") || /^\*\[[^\]]+\]:\s+\S/.test(lines[i])) {
      return offset;
    }
    offset += lines[i].length;
    if (i < lines.length - 1) offset += 1;
  }
  return -1;
}

/**
 * Apply collected abbreviations to text segments outside HTML tags.
 * Skips content inside code, pre, kbd, samp, and existing abbr elements.
 * @param {string} html
 * @param {Map<string, string>} map
 */
export function applyAbbreviations(html, map = abbrs) {
  if (!map.size) return html;

  const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  const patterns = entries.map(([abbr, title]) => ({
    abbr,
    title,
    re: new RegExp(`\\b${escapeRegExp(abbr)}\\b`, "g"),
  }));

  let skipDepth = 0;
  return html.replace(/(<[^>]+>)|([^<]+)/g, (whole, tag, text) => {
    if (tag) {
      if (/^<\/(?:code|pre|kbd|samp|abbr)\b/i.test(tag)) {
        skipDepth = Math.max(0, skipDepth - 1);
      } else if (
        /^<(?:code|pre|kbd|samp|abbr)\b/i.test(tag) &&
        !/\/>$/.test(tag)
      ) {
        skipDepth += 1;
      }
      return tag;
    }
    if (skipDepth > 0) return text;

    let out = text;
    for (const { re, abbr, title } of patterns) {
      re.lastIndex = 0;
      out = out.replace(
        re,
        `<abbr title="${escapeHtml(title)}">${escapeHtml(abbr)}</abbr>`,
      );
    }
    return out;
  });
}

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** marked extension: `*[ABBR]: title` → `<abbr title>` on matching words */
export function abbrExtension() {
  return {
    hooks: {
      preprocess(src) {
        abbrs = new Map();
        return src;
      },
      postprocess(html) {
        return applyAbbreviations(html, abbrs);
      },
    },
    extensions: [
      {
        name: "abbrDef",
        level: "block",
        start(src) {
          const index = findAbbrDefStart(src);
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          const parsed = parseAbbrDef(src);
          if (!parsed) return;
          if (!abbrs.has(parsed.abbr)) {
            abbrs.set(parsed.abbr, parsed.title);
          }
          return {
            type: "abbrDef",
            raw: parsed.raw,
            abbr: parsed.abbr,
            title: parsed.title,
          };
        },
        renderer() {
          return "";
        },
      },
    ],
  };
}

/** Reset parse state (tests). */
export function resetAbbrState() {
  abbrs = new Map();
}
