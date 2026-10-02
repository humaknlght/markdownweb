import { extractFrontmatter } from "./frontmatter.js";

/** Fence aliases → CDN grammar basename (null = skip / plain text). */
export const HLJS_LANG_ALIASES = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  html: "xml",
  htm: "xml",
  svg: "xml",
  "c++": "cpp",
  cplusplus: "cpp",
  "c#": "csharp",
  cs: "csharp",
  rb: "ruby",
  plaintext: null,
  text: null,
  plain: null,
  txt: null,
};

export const SPLIT_MIN = 15;
export const SPLIT_MAX = 85;

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {string} name
 * @returns {string}
 */
export function canonicalHljsLang(name) {
  const raw = (name || "").trim().split(/\s+/)[0].toLowerCase();
  if (!raw) return "";
  if (Object.prototype.hasOwnProperty.call(HLJS_LANG_ALIASES, raw)) {
    return HLJS_LANG_ALIASES[raw] || "";
  }
  if (!/^[a-z][a-z0-9+-]*$/i.test(raw)) return "";
  return raw;
}

/**
 * Collect fenced-code language tags from markdown source (excludes mermaid).
 * Mermaid is registered locally for the editor; preview renders it as SVG, so
 * we never fetch a CDN grammar for it.
 * @param {string} source
 * @returns {string[]}
 */
export function collectFenceLanguages(source) {
  const langs = [];
  const re = /^ {0,3}(`{3,}|~{3,})([^\n`]*)/gm;
  let match;
  while ((match = re.exec(source || ""))) {
    const info = match[2].trim();
    if (!info) continue;
    const lang = info.split(/\s+/)[0];
    if (!lang || lang.toLowerCase() === "mermaid") continue;
    langs.push(lang);
  }
  return langs;
}

/**
 * Highlight markdown for the editor overlay. Closed fenced blocks use a
 * registered highlight.js language when available (including local mermaid);
 * fence markers stay `hljs-code`. Text content stays aligned with the textarea.
 *
 * @param {string} source
 * @param {{ highlight: Function, getLanguage: Function }} hljs
 * @returns {string}
 */
export function highlightEditorMarkdown(source, hljs) {
  if (!source) return "";

  /** @param {string} text @param {string} [language] */
  function highlightChunk(text, language = "markdown") {
    if (!text) return "";
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(text, { language, ignoreIllegals: true }).value;
      }
    } catch {
      /* fall through */
    }
    if (language !== "markdown") {
      try {
        return hljs.highlight(text, { language: "markdown", ignoreIllegals: true }).value;
      } catch {
        /* fall through */
      }
    }
    return escapeHtml(text);
  }

  const fenceRe =
    /^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(^ {0,3}\1[ \t]*$)/gm;
  let out = "";
  let last = 0;
  let match;
  while ((match = fenceRe.exec(source))) {
    const full = match[0];
    const body = match[3];
    const before = source.slice(last, match.index);
    if (before) out += highlightChunk(before, "markdown");

    const openEnd = full.indexOf("\n") + 1;
    const open = full.slice(0, openEnd);
    const close = full.slice(openEnd + body.length);
    const lang = canonicalHljsLang(match[2].trim().split(/\s+/)[0]);

    out += `<span class="hljs-code">${escapeHtml(open.slice(0, -1))}</span>\n`;
    if (lang && hljs.getLanguage(lang)) {
      out += highlightChunk(body, lang);
    } else {
      out += `<span class="hljs-code">${escapeHtml(body)}</span>`;
    }
    out += `<span class="hljs-code">${escapeHtml(close)}</span>`;
    last = match.index + full.length;
  }

  if (last < source.length) out += highlightChunk(source.slice(last), "markdown");
  return out;
}

/**
 * Wrap highlight.js HTML so each source line is its own `.code-line` span,
 * re-opening any tags still open across newlines.
 * @param {string} html
 * @returns {string}
 */
export function wrapHighlightedLines(html) {
  const lines = String(html || "").replace(/\n$/, "").split("\n");
  const openTags = [];
  let out = "";

  for (const line of lines) {
    const prefix = openTags.join("");
    const tagRe = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;
    let match = tagRe.exec(line);
    while (match) {
      const [tag, name] = match;
      if (tag.startsWith("</")) {
        openTags.pop();
      } else if (!/\/\s*>$/.test(tag) && name.toLowerCase() !== "br") {
        openTags.push(tag);
      }
      match = tagRe.exec(line);
    }
    const suffix = openTags
      .map((tag) => `</${tag.match(/^<([a-zA-Z][\w:-]*)/)[1]}>`)
      .reverse()
      .join("");
    out += `<span class="code-line"><span class="line-src">${prefix}${line}${suffix}</span></span>`;
  }

  return out || `<span class="code-line"><span class="line-src"></span></span>`;
}

/**
 * @param {string} markdown
 * @returns {string}
 */
export function titleFromMarkdown(markdown) {
  const fm = extractFrontmatter(markdown);
  if (fm?.data && typeof fm.data.title === "string") {
    const fromFm = fm.data.title.trim();
    if (fromFm) return fromFm.slice(0, 80);
  }
  const body = fm ? fm.body : markdown;
  const lines = String(body || "").split(/\r?\n/);
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) return heading[1].trim().slice(0, 80);
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 80);
  }
  return "Untitled";
}

/**
 * @param {number} ts
 * @param {number} [now]
 * @returns {string}
 */
export function formatRelativeTime(ts, now = Date.now()) {
  const diff = now - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/**
 * @param {number} value
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 */
export function clampSplit(value, min = SPLIT_MIN, max = SPLIT_MAX) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {string} parentPath
 * @param {string} name
 * @returns {string}
 */
export function joinFsPath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name;
}

/**
 * @param {string} path
 * @returns {string}
 */
export function parentPathOf(path) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * @param {string | null | undefined} raw
 * @returns {{ v: number, docKey: string, content: string } | null}
 */
export function parseDraftMirror(raw) {
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.v === 1 &&
      typeof parsed.docKey === "string" &&
      typeof parsed.content === "string"
    ) {
      return parsed;
    }
  } catch {
    /* legacy plain string */
  }
  return { v: 1, docKey: "untitled", content: raw };
}
