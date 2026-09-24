/**
 * marked extension: YAML front matter at the start of a document → metadata table.
 * https://docs.github.com/en/contributing/writing-for-github-docs/using-yaml-frontmatter
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Opening `---` … closing `---` at the very start of the source (optional BOM). */
const FRONTMATTER_RE =
  /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

const TOKENIZER_RE =
  /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {string} rawYaml
 * @returns {{ data: Record<string, unknown>|null, parseError: boolean }}
 */
function parseFrontmatterData(rawYaml) {
  try {
    const parsed = parseYaml(rawYaml);
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { data: parsed, parseError: false };
    }
    if (String(rawYaml).trim() === "") {
      return { data: {}, parseError: false };
    }
    return { data: null, parseError: true };
  } catch {
    return { data: null, parseError: true };
  }
}

/**
 * @param {string} source
 * @returns {{ data: Record<string, unknown>|null, parseError: boolean, rawYaml: string, body: string, raw: string }|null}
 */
export function extractFrontmatter(source) {
  const text = String(source ?? "");
  const match = text.match(FRONTMATTER_RE);
  if (!match) return null;

  const rawYaml = match[1] ?? "";
  const raw = match[0].replace(/^\uFEFF/, "");
  const body = text.slice(match[0].length);
  const { data, parseError } = parseFrontmatterData(rawYaml);
  return { data, parseError, rawYaml, body, raw };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatFrontmatterValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return escapeHtml(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return escapeHtml(String(value));
  }
  try {
    const text = stringifyYaml(value).trimEnd();
    return `<pre class="markdown-frontmatter-nested">${escapeHtml(text)}</pre>`;
  } catch {
    return escapeHtml(String(value));
  }
}

/**
 * @param {{ data: Record<string, unknown>|null, parseError: boolean, rawYaml: string }} token
 * @returns {string}
 */
export function renderFrontmatterHtml({ data, parseError, rawYaml }) {
  if (parseError || data == null) {
    return (
      `<div class="markdown-frontmatter markdown-frontmatter-error">\n` +
      `<p class="markdown-frontmatter-error-label">Invalid YAML</p>\n` +
      `<pre>${escapeHtml(rawYaml)}</pre>\n` +
      `</div>\n`
    );
  }

  const keys = Object.keys(data);
  if (keys.length === 0) return "";

  let rows = "";
  for (const key of keys) {
    rows +=
      `<tr><th>${escapeHtml(key)}</th>` +
      `<td>${formatFrontmatterValue(data[key])}</td></tr>\n`;
  }

  return (
    `<table class="markdown-frontmatter" aria-label="Front matter">\n` +
    `<tbody>\n${rows}</tbody>\n` +
    `</table>\n`
  );
}

/** marked extension: leading YAML front matter → metadata table (first block only). */
export function frontmatterExtension() {
  return {
    extensions: [
      {
        name: "frontmatter",
        level: "block",
        start(src) {
          return src.match(/^---[ \t]*\r?\n/)?.index ?? -1;
        },
        tokenizer(src, tokens) {
          if (tokens.length > 0) return;
          const match = src.match(TOKENIZER_RE);
          if (!match) return;

          const raw = match[0];
          const rawYaml = match[1] ?? "";
          const { data, parseError } = parseFrontmatterData(rawYaml);
          return {
            type: "frontmatter",
            raw,
            rawYaml,
            data,
            parseError,
          };
        },
        renderer(token) {
          const html = renderFrontmatterHtml(token);
          if (!html) return "";

          const lineAttr =
            token._sourceLine != null && token._sourceLine >= 1
              ? ` data-source-line="${token._sourceLine}"` +
                (token._sourceLineEnd != null &&
                token._sourceLineEnd > token._sourceLine
                  ? ` data-source-line-end="${token._sourceLineEnd}"`
                  : "")
              : "";
          return html.replace(/^(\s*<[a-zA-Z][a-zA-Z0-9-]*)/, `$1${lineAttr}`);
        },
      },
    ],
  };
}
