import hljs from "highlight.js";
import { collectEditorLanguages } from "../markdown/markdown-utils.js";

const HLJS_LANG_CDN =
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages";

/** @type {Map<string, Promise<boolean>>} */
const hljsLangLoads = new Map();

// Markdown grammar uses xml as a subLanguage for embedded HTML.
// withMarkdownEscapes aligns emphasis, lists, and blockquotes with CommonMark / marked.
hljs.registerLanguage("xml", hljsXml);
hljs.registerLanguage("html", hljsXml);
hljs.registerLanguage("markdown", withMarkdownEscapes(hljsMarkdown));

function registerHljsAliases(canonical, grammar) {
  hljs.registerLanguage(canonical, grammar);
  for (const [alias, target] of Object.entries(HLJS_LANG_ALIASES)) {
    if (target === canonical) hljs.registerLanguage(alias, grammar);
  }
}

/**
 * Ensure a highlight.js grammar is registered. Returns true if a network load
 * just completed (caller may want to re-render).
 * CDN languages require an SRI allowlist entry; mermaid loads from a local chunk.
 */
export function ensureHljsLanguage(name) {
  const canonical = canonicalHljsLang(name);
  if (!canonical) return Promise.resolve(false);
  if (hljs.getLanguage(canonical)) return Promise.resolve(false);

  let pending = hljsLangLoads.get(canonical);
  if (pending) return pending;

  if (canonical === "mermaid") {
    // Not on the highlight.js CDN — local grammar, code-split from the app entry.
    pending = import("../markdown/hljs-mermaid.js")
      .then((mod) => {
        const grammar = mod.default;
        if (typeof grammar !== "function") return false;
        hljs.registerLanguage("mermaid", grammar);
        return true;
      })
      .catch(() => false);
    hljsLangLoads.set(canonical, pending);
    return pending;
  }

  const url = `${HLJS_LANG_CDN}/${canonical}.min.js`;
  if (!CDN_INTEGRITY_URLS.has(url)) return Promise.resolve(false);

  pending = import(url)
    .then((mod) => {
      const grammar = mod.default;
      if (typeof grammar !== "function") return false;
      registerHljsAliases(canonical, grammar);
      return true;
    })
    .catch(() => false);

  hljsLangLoads.set(canonical, pending);
  return pending;
}

export async function ensureHljsLanguagesForSource(source) {
  const langs = collectEditorLanguages(source);
  if (!langs.length) return false;
  const results = await Promise.all(langs.map((lang) => ensureHljsLanguage(lang)));
  return results.some(Boolean);
}
