import createDOMPurify from "dompurify";
import { extractFrontmatter } from "../markdown/frontmatter.js";
import { installSafeMediaHooks } from "./safe-media-uri.js";

/** Generator / provenance stamped into every export. */
export const GENERATOR_URL = "https://dev.ericperret.org/markdown/";

/** @type {WeakSet<object>} */
const purifyMediaHooksInstalled = new WeakSet();

/** Tags blocked in standalone exports (phishing chrome / controls). */
const EXPORT_FORBID_TAGS = [
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "optgroup",
  "fieldset",
  "legend",
];

/**
 * DOMPurify's SVG profile keeps `<foreignObject>` but strips its XHTML
 * children — Mermaid flowchart/ER/journey labels live there. Stash those
 * subtrees, sanitize the shell + the HTML interiors separately, then restore.
 * @param {string} html
 * @param {ReturnType<typeof createDOMPurify>} purify
 * @returns {string}
 */
function preserveMermaidForeignObjects(html, purify) {
  /** @type {{ attrs: string, inner: string }[]} */
  const stash = [];
  const withPlaceholders = String(html).replace(
    /<foreignObject(\s[^>]*)?>[\s\S]*?<\/foreignObject>/gi,
    (match, attrs = "") => {
      const innerMatch = match.match(
        /^<foreignObject\b[^>]*>([\s\S]*)<\/foreignObject>$/i,
      );
      const inner = innerMatch ? innerMatch[1] : "";
      const cleanInner = purify.sanitize(inner, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: EXPORT_FORBID_TAGS,
      });
      const id = stash.length;
      stash.push({ attrs: String(attrs || ""), inner: cleanInner });
      // Keep width/height/x/y on the placeholder so layout survives sanitize.
      const safeAttrs = String(attrs || "").trim();
      return `<foreignObject${safeAttrs ? ` ${safeAttrs}` : ""} data-export-fo="${id}"></foreignObject>`;
    },
  );

  let clean = purify.sanitize(withPlaceholders, {
    USE_PROFILES: { html: true, svg: true },
    ADD_TAGS: ["foreignObject"],
    ADD_ATTR: ["data-export-fo"],
    FORBID_TAGS: EXPORT_FORBID_TAGS,
  });

  clean = clean.replace(
    /<foreignObject\b([^>]*?)data-export-fo="(\d+)"([^>]*)>\s*<\/foreignObject>/gi,
    (_, before, id, after) => {
      const entry = stash[Number(id)];
      if (!entry) return "";
      // Drop the placeholder attr; keep any other attrs DOMPurify left on the shell.
      const shellAttrs = `${before} ${after}`
        .replace(/\s*data-export-fo="\d+"/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      const attrs = shellAttrs ? ` ${shellAttrs}` : "";
      return `<foreignObject${attrs}>${entry.inner}</foreignObject>`;
    },
  );

  return clean;
}

/**
 * Re-sanitize preview HTML before embedding in standalone exports.
 * @param {string} html
 * @returns {string}
 */
function sanitizeExportHtml(html) {
  const root = typeof window !== "undefined" ? window : globalThis;
  const purify = createDOMPurify(/** @type {Window} */ (root));
  if (!purifyMediaHooksInstalled.has(purify)) {
    installSafeMediaHooks(purify);
    purifyMediaHooksInstalled.add(purify);
  }
  return preserveMermaidForeignObjects(html, purify);
}

/**
 * @param {string} title
 * @returns {string}
 */
export function exportBasename(title) {
  const base = String(title || "Untitled")
    .replace(/[^\p{L}\p{N}\s._-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base || "markdown";
}

/**
 * @param {Blob|string} data
 * @param {string} filename
 * @param {string} [mime]
 */
export function downloadBlob(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/**
 * @param {HTMLElement} previewEl
 * @returns {string}
 */
export function cleanPreviewHtml(previewEl) {
  return sanitizeExportHtml(preparePreviewClone(previewEl).innerHTML);
}

/**
 * Prefer this for PDF: clone keeps Mermaid SVG structure and inlines computed
 * paints so diagrams survive outside the app stylesheet.
 * @param {HTMLElement} previewEl
 * @returns {string}
 */
export function cleanPreviewHtmlForPrint(previewEl) {
  const clone = preparePreviewClone(previewEl);
  // Only top-level diagram SVGs — nested marker/icon <svg>s shift indices
  // and would bake the wrong computed paints onto the wrong tree.
  const liveSvgs = previewEl.querySelectorAll(".mermaid > svg");
  const cloneSvgs = clone.querySelectorAll(".mermaid > svg");
  const count = Math.min(liveSvgs.length, cloneSvgs.length);
  for (let i = 0; i < count; i++) {
    inlineSvgComputedStyles(liveSvgs[i], cloneSvgs[i]);
  }
  return sanitizeExportHtml(clone.innerHTML);
}

/**
 * Clone the live preview and strip UI-only chrome so exports match the full
 * document (all slides, no fold toggles / collapsed-only visibility).
 * @param {HTMLElement} previewEl
 * @returns {HTMLElement}
 */
function preparePreviewClone(previewEl) {
  const clone = /** @type {HTMLElement} */ (previewEl.cloneNode(true));
  cleanupClone(clone);
  return clone;
}

/**
 * Fluid Mermaid charts (gantt, etc.) are laid out for the live preview host
 * width. Standalone HTML cannot re-run Mermaid, so unlock the captured px
 * width and let the SVG fill the article — otherwise fullscreen export keeps
 * empty side margins from `margin: 0 auto` + a stale max-width.
 * @param {SVGElement} svg
 */
function prepareFluidMermaidSvgForExport(svg) {
  const fluid =
    svg.dataset.mermaidFluid === "1" ||
    svg.getAttribute("aria-roledescription") === "gantt";
  if (!fluid) return;
  svg.setAttribute("data-export-fluid", "");
  svg.style.removeProperty("max-width");
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.margin = "0";
  svg.setAttribute("width", "100%");
  if (svg.getAttribute("viewBox")) {
    svg.removeAttribute("height");
  }
}

/** @param {HTMLElement} clone */
function cleanupClone(clone) {
  for (const el of clone.querySelectorAll("[data-source-line], [data-source-line-end]")) {
    el.removeAttribute("data-source-line");
    el.removeAttribute("data-source-line-end");
  }
  for (const mark of clone.querySelectorAll("mark.speech-word")) {
    mark.replaceWith(...mark.childNodes);
  }
  for (const el of clone.querySelectorAll("[data-pending]")) {
    el.removeAttribute("data-pending");
  }

  // Adapt fluid charts before stripping the fluid/natural markers.
  for (const svg of clone.querySelectorAll(".mermaid > svg")) {
    prepareFluidMermaidSvgForExport(/** @type {SVGElement} */ (svg));
  }

  for (const el of clone.querySelectorAll(
    "[data-processed], [data-mermaid-natural], [data-mermaid-fluid]",
  )) {
    el.removeAttribute("data-processed");
    el.removeAttribute("data-mermaid-natural");
    el.removeAttribute("data-mermaid-fluid");
  }

  // Section fold chrome (▼ buttons) must not appear in exports.
  for (const el of clone.querySelectorAll(".md-section-toggle")) {
    el.remove();
  }

  // Mermaid zoom controls are screen-only chrome.
  for (const el of clone.querySelectorAll(".mermaid-zoom-btn")) {
    el.remove();
  }

  // Unwrap temporary fold animation wrappers (deepest first).
  const anims = [...clone.querySelectorAll(".md-section-anim")].reverse();
  for (const wrap of anims) {
    const parent = wrap.parentNode;
    if (!parent) continue;
    const inner =
      wrap.querySelector(":scope > .md-section-anim-inner") || wrap;
    while (inner.firstChild) parent.insertBefore(inner.firstChild, wrap);
    wrap.remove();
  }

  for (const el of clone.querySelectorAll(".md-section-folded")) {
    el.classList.remove("md-section-folded");
  }
  for (const el of clone.querySelectorAll(".is-collapsed, .is-expanded")) {
    el.classList.remove("is-collapsed", "is-expanded");
  }

  // Reveal every slide / section, including those hidden in slides/present.
  for (const el of clone.querySelectorAll("[hidden]")) {
    el.removeAttribute("hidden");
  }
}

/**
 * @param {string} markdown
 * @param {string} title
 * @returns {string}
 */
export function buildMarkdownFile(markdown, title) {
  const source = String(markdown ?? "").replace(/^\uFEFF/, "");
  if (extractFrontmatter(source)) {
    return source;
  }
  const safeTitle = yamlEscape(title || "Untitled");
  return (
    `---\n` +
    `title: ${safeTitle}\n` +
    `generator: ${GENERATOR_URL}\n` +
    `---\n\n` +
    source
  );
}

/** CSS custom properties mirrored from the live preview theme into HTML/PDF exports. */
const EXPORT_STYLE_VARS = [
  "--color-scheme",
  "--preview-bg",
  "--preview-fg",
  "--preview-muted",
  "--preview-link",
  "--preview-link-hover",
  "--preview-rule",
  "--preview-code-bg",
  "--preview-pre-bg",
  "--preview-pre-border",
  "--preview-quote",
  "--preview-font",
  "--preview-size",
  "--heading-color",
  "--font-mono",
  "--syntax-comment",
  "--syntax-keyword",
  "--syntax-string",
  "--syntax-number",
  "--syntax-literal",
  "--syntax-built-in",
  "--syntax-type",
  "--syntax-attr",
  "--syntax-title",
  "--syntax-meta",
  "--syntax-deletion",
  "--syntax-addition",
  "--mermaid-bg",
  "--mermaid-fg",
  "--mermaid-font",
  "--mermaid-node-bg",
  "--mermaid-node-border",
  "--mermaid-cluster-bg",
  "--mermaid-cluster-border",
  "--mermaid-line",
  "--mermaid-label-bg",
  "--mermaid-note-bg",
  "--mermaid-note-fg",
  "--mermaid-series-1",
  "--mermaid-series-2",
  "--mermaid-series-3",
  "--mermaid-series-4",
  "--mermaid-series-fg",
  "--mermaid-active-on-node-fg",
  "--mermaid-active-on-cluster-fg",
  "--mermaid-active-on-line-fg",
  "--mermaid-exclude",
  "--mermaid-gantt-0",
  "--mermaid-gantt-1",
  "--mermaid-gantt-2",
  "--mermaid-gantt-3",
  "--mermaid-gantt-section-opacity",
];

/** Defaults match github-light / readable so unit tests stay stable offline. */
const DEFAULT_EXPORT_STYLE_VARS = {
  "--color-scheme": "light",
  "--preview-bg": "#ffffff",
  "--preview-fg": "#1f2328",
  "--preview-muted": "#656d76",
  "--preview-link": "#0969da",
  "--preview-link-hover": "#0550ae",
  "--preview-rule": "#d1d9e0",
  "--preview-code-bg": "#f6f8fa",
  "--preview-pre-bg": "#f6f8fa",
  "--preview-pre-border": "#d1d9e0",
  "--preview-quote": "#d1d9e0",
  "--preview-font": '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  "--preview-size": "1rem",
  "--heading-color": "inherit",
  "--font-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  "--syntax-comment": "#6a737d",
  "--syntax-keyword": "#cc3745",
  "--syntax-string": "#032f62",
  "--syntax-number": "#005cc5",
  "--syntax-literal": "#005cc5",
  "--syntax-built-in": "#bb5107",
  "--syntax-type": "#6f42c1",
  "--syntax-attr": "#005cc5",
  "--syntax-title": "#6f42c1",
  "--syntax-meta": "#6a737d",
  "--syntax-deletion": "#b31d28",
  "--syntax-addition": "#207f37",
  "--mermaid-bg": "#ffffff",
  "--mermaid-fg": "#333333",
  "--mermaid-font":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  "--mermaid-node-bg": "#ececff",
  "--mermaid-node-border": "#9370db",
  "--mermaid-cluster-bg": "#ffffde",
  "--mermaid-cluster-border": "#6b6b22",
  "--mermaid-line": "#333333",
  "--mermaid-label-bg": "#e8e8e8",
  "--mermaid-note-bg": "#fff5ad",
  "--mermaid-note-fg": "#333333",
  "--mermaid-series-1": "var(--mermaid-node-bg)",
  "--mermaid-series-2": "var(--mermaid-cluster-bg)",
  "--mermaid-series-3": "var(--mermaid-label-bg)",
  "--mermaid-series-4": "var(--mermaid-node-bg)",
  "--mermaid-series-fg": "var(--mermaid-fg)",
  "--mermaid-active-on-node-fg": "#000000",
  "--mermaid-active-on-cluster-fg": "#ffffff",
  "--mermaid-active-on-line-fg": "#ffffff",
  "--mermaid-exclude": "#eeeeee",
  "--mermaid-gantt-0": "#c5b8f0",
  "--mermaid-gantt-1": "#e8d878",
  "--mermaid-gantt-2": "#e8a0b4",
  "--mermaid-gantt-3": "#7ebfa8",
  "--mermaid-gantt-section-opacity": "0.4",
};

/**
 * Snapshot live preview settings (width, line wrap, theme tokens) for exports.
 * @param {HTMLElement} previewEl
 * @returns {{
 *   width: "readable" | "full",
 *   lineWrap: boolean,
 *   theme: string,
 *   vars: Record<string, string>
 * }}
 */
export function exportStyleOptionsFromPreview(previewEl) {
  const doc = previewEl?.ownerDocument || (typeof document !== "undefined" ? document : null);
  const root = doc?.documentElement;
  /** @type {Record<string, string>} */
  const vars = {};
  if (root && typeof getComputedStyle === "function") {
    const cs = getComputedStyle(root);
    for (const name of EXPORT_STYLE_VARS) {
      const value = sanitizeCssValue(cs.getPropertyValue(name));
      if (value) vars[name] = value;
    }
  }
  const width = previewEl?.dataset?.width === "full" ? "full" : "readable";
  const lineWrap = root?.dataset?.lineWrap !== "off";
  const theme = sanitizeCssValue(root?.dataset?.theme || "github-light") || "github-light";
  return { width, lineWrap, theme, vars };
}

/**
 * Theme-specific preview rules that are not expressible as shared CSS variables.
 * Keep these aligned with styles.css / zen.css `.preview` overrides.
 * @param {string} theme
 * @returns {string}
 */
function themeExportCss(theme) {
  if (theme === "salesforce") {
    return `
    body {
      background: #f4f4f4;
      padding: 1rem;
    }
    article {
      background: #ffffff;
      border-radius: 1rem;
      padding: 1.5rem 1.75rem 2.5rem;
      box-shadow: 0 2px 8px rgba(8, 7, 7, 0.08), 0 8px 24px rgba(1, 118, 211, 0.12);
    }
    h1, h2 { border-bottom-color: #90d0fe; }
    a { font-weight: 600; }
    code:not(pre code) {
      color: #014486;
      border-radius: 0.5rem;
    }
    blockquote {
      background: #eaf5fe;
      border-left-width: 4px;
      border-radius: 0 0.75rem 0.75rem 0;
      padding: 0.65rem 1rem;
      color: #032d60;
    }
    pre, pre code { color: #eaf5fe; }
    pre { border-radius: 1rem; }
`;
  }
  if (theme === "fancy") {
    return `
    body { background: #062436; }
    h1, h2 { border-bottom-color: rgba(255, 255, 255, 0.2); }
    blockquote {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 0 10px 10px 0;
      padding: 0.55rem 0.9rem;
    }
    pre { border-radius: 10px; }
    .mermaid, .mermaid svg { background: transparent; }
    .line-num {
      background: transparent;
      border-right-color: rgba(255, 255, 255, 0.14);
      color: rgba(244, 248, 251, 0.5);
    }
`;
  }
  if (theme === "zen") {
    return `
    body { background: #0b1c24; }
    h1, h2 { border-bottom-color: rgba(140, 200, 210, 0.22); }
    blockquote {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 0 10px 10px 0;
      padding: 0.55rem 0.9rem;
    }
    pre { border-radius: 10px; }
    .mermaid, .mermaid svg { background: transparent; }
    .line-num {
      background: transparent;
      border-right-color: rgba(140, 200, 210, 0.16);
      color: rgba(232, 244, 246, 0.5);
    }
`;
  }
  return "";
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeCssValue(value) {
  // Drop anything that could break out of a CSS declaration or </style>.
  return String(value ?? "")
    .replace(/[;{}<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function formatExportRootVars(vars) {
  const merged = { ...DEFAULT_EXPORT_STYLE_VARS, ...vars };
  return Object.entries(merged)
    .map(([name, value]) => `      ${name}: ${sanitizeCssValue(value)};`)
    .join("\n");
}

/**
 * @typedef {object} HtmlExportOptions
 * @property {"readable"|"full"} [width]
 * @property {boolean} [lineWrap]
 * @property {string} [theme]
 * @property {Record<string, string>} [vars]
 */

/**
 * @param {string} bodyHtml
 * @param {string} title
 * @param {HtmlExportOptions} [options]
 * @returns {string}
 */
export function buildHtmlDocument(bodyHtml, title, options = {}) {
  const safeTitle = escapeHtml(title || "Untitled");
  const width = options.width === "full" ? "full" : "readable";
  const lineWrap = options.lineWrap !== false;
  const theme = sanitizeCssValue(options.theme || "github-light") || "github-light";
  const maxWidth = width === "full" ? "none" : "52rem";
  const rootVars = formatExportRootVars(options.vars || {});
  const colorScheme = sanitizeCssValue(
    options.vars?.["--color-scheme"] || DEFAULT_EXPORT_STYLE_VARS["--color-scheme"],
  );
  const themeCss = themeExportCss(theme);
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" data-width="${width}" data-line-wrap="${lineWrap ? "on" : "off"}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="${GENERATOR_URL}" />
  <meta name="color-scheme" content="${colorScheme}" />
  <link rel="canonical" href="${GENERATOR_URL}" />
  <title>${safeTitle}</title>
  <style>
    :root {
${rootVars}
    }
    @page { margin: 0.75in; }
    body {
      margin: 0;
      padding: 0;
      font: var(--preview-size)/1.65 var(--preview-font);
      color: var(--preview-fg);
      background: var(--preview-bg);
      color-scheme: var(--color-scheme);
    }
    article {
      max-width: ${maxWidth};
      width: 100%;
      margin: 0 auto;
      padding: 1.25rem 1.5rem 2.5rem;
      box-sizing: border-box;
      overflow-wrap: anywhere;
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.25;
      margin: 1.4em 0 0.55em;
      font-weight: 650;
      color: var(--heading-color);
    }
    h1 { font-size: 1.85em; border-bottom: 1px solid var(--preview-rule); padding-bottom: 0.3em; }
    h2 { font-size: 1.45em; border-bottom: 1px solid var(--preview-rule); padding-bottom: 0.25em; }
    h3 { font-size: 1.2em; }
    p, ul, ol, pre, blockquote, table { margin: 0 0 1em; }
    a { color: var(--preview-link); }
    a:hover { color: var(--preview-link-hover); }
    code {
      font-family: var(--font-mono);
      font-size: 0.875em;
      background: var(--preview-code-bg);
      padding: 0.15em 0.35em;
      border-radius: 3px;
    }
    pre {
      background: var(--preview-pre-bg);
      border: 1px solid var(--preview-pre-border);
      border-radius: 6px;
      padding: 0.85rem 0;
      overflow: auto;
    }
    pre code {
      background: transparent;
      padding: 0;
      font-size: 0.85em;
      line-height: 1.5;
      color: inherit;
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      min-width: 100%;
    }
    html[data-line-wrap="off"] pre code {
      grid-template-columns: max-content minmax(min-content, 1fr);
    }
    .code-line { display: contents; }
    .line-num {
      position: sticky;
      left: 0;
      z-index: 1;
      box-sizing: border-box;
      padding: 0 1rem 0 0.75rem;
      border-right: 1px solid var(--preview-pre-border);
      color: var(--syntax-comment);
      text-align: right;
      white-space: nowrap;
      user-select: none;
      background: var(--preview-pre-bg);
    }
    .line-src {
      min-width: 0;
      min-height: 1.5em;
      padding: 0 1rem;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    html[data-line-wrap="off"] .line-src {
      min-width: min-content;
      white-space: pre;
      overflow-wrap: normal;
      word-break: normal;
    }
    blockquote {
      margin-left: 0;
      padding: 0 1em;
      color: var(--preview-muted);
      border-left: 0.25em solid var(--preview-quote);
    }
    blockquote > :first-child { margin-top: 0; }
    blockquote > :last-child { margin-bottom: 0; }
    table {
      border-collapse: collapse;
      width: 100%;
      display: block;
      overflow: auto;
    }
    th, td { border: 1px solid var(--preview-rule); padding: 0.4em 0.7em; }
    th { background: var(--preview-code-bg); font-weight: 600; }
    img { max-width: 100%; height: auto; }
    hr { border: 0; border-top: 1px solid var(--preview-rule); margin: 1.5em 0; }
    .hljs-comment, .hljs-quote { color: var(--syntax-comment); font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-doctag { color: var(--syntax-keyword); }
    .hljs-string, .hljs-regexp, .hljs-attribute { color: var(--syntax-string); }
    .hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable { color: var(--syntax-number); }
    .hljs-built_in, .hljs-builtin-name, .hljs-symbol { color: var(--syntax-built-in); }
    .hljs-type, .hljs-title.class_ { color: var(--syntax-type); }
    .hljs-attr, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id, .hljs-name { color: var(--syntax-attr); }
    .hljs-title, .hljs-section { color: var(--syntax-title); }
    .hljs-meta, .hljs-meta .hljs-keyword, .hljs-meta .hljs-string { color: var(--syntax-meta); }
    .hljs-deletion { color: var(--syntax-deletion); }
    .hljs-addition { color: var(--syntax-addition); }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: 700; }
    .mermaid {
      overflow: visible;
      margin: 1rem 0;
      background: var(--mermaid-bg);
      font-family: var(--mermaid-font);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .mermaid svg {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 auto;
      background: var(--mermaid-bg);
    }
    /* Fluid charts (gantt): fill the article instead of centering a frozen px width. */
    .mermaid svg[data-export-fluid],
    .mermaid svg[aria-roledescription="gantt"] {
      width: 100%;
      max-width: 100%;
      margin: 0;
    }
    /* Gantt weekend/exclude bands — never inherit a stroke from parent <g>/<svg>. */
    .mermaid .exclude-range {
      fill: var(--mermaid-exclude) !important;
      stroke: none !important;
      stroke-width: 0 !important;
    }
    .mermaid rect.section {
      opacity: var(--mermaid-gantt-section-opacity) !important;
    }
    .mermaid .section0 { fill: var(--mermaid-gantt-0) !important; }
    .mermaid .section1 { fill: var(--mermaid-gantt-1) !important; }
    .mermaid .section2 { fill: var(--mermaid-gantt-2) !important; }
    .mermaid .section3 { fill: var(--mermaid-gantt-3) !important; }
    .export-generator {
      margin-top: 2.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--preview-rule);
      font-size: 0.75rem;
      color: var(--preview-muted);
    }
${themeCss}  </style>
</head>
<body>
  <article data-width="${width}">
${bodyHtml}
    <p class="export-generator">Generated by ${GENERATOR_URL}</p>
  </article>
</body>
</html>
`;
}

/**
 * PDF export via the browser print engine so Mermaid SVGs render correctly
 * and export stays fast (no html2canvas). User chooses "Save as PDF".
 * @param {HTMLElement} previewEl
 * @param {string} title
 * @param {HtmlExportOptions} [options]
 * @returns {Promise<void>}
 */
export async function printPreviewAsPdf(previewEl, title, options) {
  const style = options || exportStyleOptionsFromPreview(previewEl);
  const html = buildHtmlDocument(cleanPreviewHtmlForPrint(previewEl), title, style);
  await printHtmlDocument(html);
}

/**
 * @param {string} html
 * @returns {Promise<void>}
 */
function printHtmlDocument(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.title = "Export PDF";
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
      iframe.remove();
      reject(new Error("Print frame unavailable"));
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      win.removeEventListener("afterprint", finish);
      iframe.remove();
      resolve();
    };

    win.addEventListener("afterprint", finish);

    doc.open();
    doc.write(html);
    doc.close();

    const triggerPrint = async () => {
      try {
        await waitForImages(doc);
        // Let SVG layout settle before the print snapshot.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        win.focus();
        win.print();
        // Some browsers never fire afterprint when the dialog is dismissed oddly.
        window.setTimeout(finish, 60_000);
      } catch (err) {
        finish();
        reject(err);
      }
    };

    if (doc.readyState === "complete") {
      void triggerPrint();
    } else {
      iframe.addEventListener("load", () => void triggerPrint(), { once: true });
    }
  });
}

/**
 * @param {HTMLElement} previewEl
 * @param {string} title
 * @returns {Blob}
 */
export function buildDocxBlob(previewEl, title) {
  const body = htmlToDocxBody(sanitizedPreviewRoot(previewEl));
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title || "Untitled")}</dc:title>
  <dc:creator>${GENERATOR_URL}</dc:creator>
  <dc:description>Generated by ${GENERATOR_URL}</dc:description>
  <cp:keywords>${GENERATOR_URL}</cp:keywords>
  <cp:lastModifiedBy>${GENERATOR_URL}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>${GENERATOR_URL}</Application>
  <Company>${GENERATOR_URL}</Company>
</Properties>`,
    "docProps/custom.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Generator">
    <vt:lpwstr>${GENERATOR_URL}</vt:lpwstr>
  </property>
</Properties>`,
  };
  return new Blob([createZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/**
 * Clone + sanitize into a walkable DOM fragment for text exporters.
 * @param {HTMLElement} previewEl
 * @returns {HTMLElement}
 */
function sanitizedPreviewRoot(previewEl) {
  const html = sanitizeExportHtml(preparePreviewClone(previewEl).innerHTML);
  const wrap = previewEl.ownerDocument.createElement("div");
  wrap.innerHTML = html;
  return wrap;
}

/**
 * @param {HTMLElement} previewEl
 * @param {string} title
 * @returns {string}
 */
export function buildRtfDocument(previewEl, title) {
  const body = htmlToRtf(sanitizedPreviewRoot(previewEl));
  return (
    `{\\rtf1\\ansi\\deff0\\uc1\n` +
    `{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fmodern\\fcharset0 Courier New;}}\n` +
    `{\\info\n` +
    `{\\title ${rtfEscape(title || "Untitled")}}\n` +
    `{\\author ${GENERATOR_URL}}\n` +
    `{\\operator ${GENERATOR_URL}}\n` +
    `{\\doccomm Generated by ${GENERATOR_URL}}\n` +
    `{\\company ${GENERATOR_URL}}\n` +
    `}\n` +
    `\\fs24\n` +
    body +
    `\n}`
  );
}

function yamlEscape(value) {
  const s = String(value);
  if (/[:#{}[\],&*?|>!%@`]/.test(s) || /^\s|\s$/.test(s) || s === "") {
    return JSON.stringify(s);
  }
  return s;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

/**
 * @param {Element} sourceRoot
 * @param {Element} cloneRoot
 */
function inlineSvgComputedStyles(sourceRoot, cloneRoot) {
  const props = [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "color",
    "display",
    "visibility",
    "stop-color",
    "stop-opacity",
  ];
  // Structural containers: baking stroke/fill here inherits onto gantt
  // weekend bands (exclude-range) and draws an extra border in HTML export.
  const containerTags = new Set(["svg", "g", "defs", "clipPath", "mask", "marker", "symbol"]);

  const walk = (src, dst) => {
    if (src.nodeType !== 1 || dst.nodeType !== 1) return;
    const tag = src.tagName.toLowerCase();
    const isContainer = containerTags.has(tag);
    const cs = getComputedStyle(src);

    if (!isContainer) {
      for (const prop of props) {
        const value = cs.getPropertyValue(prop);
        if (!value) continue;
        dst.style.setProperty(prop, value);
      }
      const fill = cs.fill;
      if (fill && fill !== "none") dst.setAttribute("fill", rgbToSvgColor(fill));
      const stroke = cs.stroke;
      if (stroke && stroke !== "none") dst.setAttribute("stroke", rgbToSvgColor(stroke));
      else if (cs.getPropertyValue("stroke") === "none") dst.setAttribute("stroke", "none");
    }

    // Gantt weekends: force no stroke + resolved exclude fill (DOMPurify may
    // drop style="", but presentation attributes survive).
    if (dst.classList?.contains("exclude-range")) {
      dst.setAttribute("stroke", "none");
      dst.style.setProperty("stroke", "none");
      dst.style.setProperty("stroke-width", "0");
      const fill = cs.fill;
      if (fill && fill !== "none") {
        const hex = rgbToSvgColor(fill);
        dst.setAttribute("fill", hex);
        dst.style.setProperty("fill", hex);
      }
    }

    const srcChildren = [...src.children];
    const dstChildren = [...dst.children];
    const len = Math.min(srcChildren.length, dstChildren.length);
    for (let i = 0; i < len; i++) walk(srcChildren[i], dstChildren[i]);
  };

  walk(sourceRoot, cloneRoot);
}

/** @param {string} color */
function rgbToSvgColor(color) {
  const m = String(color).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) return color;
  const r = Math.round(Number(m[1]));
  const g = Math.round(Number(m[2]));
  const b = Math.round(Number(m[3]));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** @param {ParentNode} root */
async function waitForImages(root) {
  const images = [...root.querySelectorAll("img")];
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }),
    ),
  );
}

/**
 * @param {HTMLElement} root
 * @returns {string}
 */
function htmlToDocxBody(root) {
  /** @type {string[]} */
  const parts = [];

  const para = (text, { bold = false, heading = 0, code = false } = {}) => {
    const content = escapeXml(text);
    let rPr = "";
    if (heading) rPr += `<w:b/><w:sz w:val="${Math.max(24, 48 - heading * 4)}"/>`;
    else if (bold) rPr += `<w:b/>`;
    if (code) rPr += `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/>`;
    const rPrXml = rPr ? `<w:rPr>${rPr}</w:rPr>` : "";
    const pPr = heading
      ? `<w:pPr><w:pStyle w:val="Heading${heading}"/><w:spacing w:before="240" w:after="120"/></w:pPr>`
      : `<w:pPr><w:spacing w:after="120"/></w:pPr>`;
    parts.push(
      `    <w:p>${pPr}<w:r>${rPrXml}<w:t xml:space="preserve">${content}</w:t></w:r></w:p>`,
    );
  };

  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = (node.textContent || "").replace(/\s+/g, " ");
      if (text.trim()) para(text.trim());
      return;
    }
    if (node.nodeType !== 1) return;
    const el = /** @type {HTMLElement} */ (node);
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    if (/^H[1-6]$/.test(tag)) {
      para(el.innerText || el.textContent || "", { bold: true, heading: Number(tag[1]) });
      return;
    }
    if (tag === "P" || tag === "LI" || tag === "BLOCKQUOTE") {
      para(el.innerText || el.textContent || "");
      return;
    }
    if (tag === "PRE") {
      for (const line of (el.textContent || "").replace(/\n$/, "").split("\n")) {
        para(line, { code: true });
      }
      return;
    }
    if (tag === "HR") {
      para("―".repeat(20));
      return;
    }
    if (tag === "TABLE") {
      for (const row of el.querySelectorAll("tr")) {
        const cells = [...row.children].map((c) => (c.textContent || "").trim());
        para(cells.join(" | "));
      }
      return;
    }
    if (tag === "IMG") {
      para(`[Image: ${el.getAttribute("alt") || "image"}]`);
      return;
    }
    if (tag === "BR") {
      para("");
      return;
    }
    if (tag === "UL" || tag === "OL") {
      for (const child of el.children) walk(child);
      return;
    }
    if (el.childNodes.length) {
      for (const child of el.childNodes) walk(child);
    } else if ((el.textContent || "").trim()) {
      para(el.textContent || "");
    }
  };

  for (const child of root.childNodes) walk(child);
  if (!parts.length) para("");
  return parts.join("\n");
}

/**
 * @param {HTMLElement} root
 * @returns {string}
 */
function htmlToRtf(root) {
  /** @type {string[]} */
  const parts = [];

  const emit = (text, { bold = false, size = 24, mono = false } = {}) => {
    const font = mono ? "\\f1 " : "\\f0 ";
    const weight = bold ? "\\b " : "";
    parts.push(`{${font}${weight}\\fs${size} ${rtfUnicode(text)}\\par}\n`);
  };

  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text) emit(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = /** @type {HTMLElement} */ (node);
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      emit(el.innerText || el.textContent || "", { bold: true, size: Math.max(24, 36 - level * 2) });
      return;
    }
    if (tag === "P" || tag === "LI" || tag === "BLOCKQUOTE") {
      emit(el.innerText || el.textContent || "");
      return;
    }
    if (tag === "PRE") {
      for (const line of (el.textContent || "").replace(/\n$/, "").split("\n")) {
        emit(line, { mono: true, size: 18 });
      }
      return;
    }
    if (tag === "HR") {
      emit("----------------------------------------");
      return;
    }
    if (tag === "TABLE") {
      for (const row of el.querySelectorAll("tr")) {
        const cells = [...row.children].map((c) => (c.textContent || "").trim());
        emit(cells.join(" | "));
      }
      return;
    }
    if (tag === "IMG") {
      emit(`[Image: ${el.getAttribute("alt") || "image"}]`);
      return;
    }
    if (tag === "BR") {
      parts.push("\\par\n");
      return;
    }
    if (el.childNodes.length) {
      for (const child of el.childNodes) walk(child);
    } else if ((el.textContent || "").trim()) {
      emit(el.textContent || "");
    }
  };

  for (const child of root.childNodes) walk(child);
  return parts.join("") || "\\par\n";
}

function rtfEscape(text) {
  return rtfUnicode(text);
}

function rtfUnicode(text) {
  let out = "";
  for (const ch of String(text)) {
    const code = ch.codePointAt(0) || 0;
    if (ch === "\\" || ch === "{" || ch === "}") {
      out += `\\${ch}`;
    } else if (code === 10 || code === 13) {
      out += "\\par ";
    } else if (code < 128) {
      out += ch;
    } else if (code <= 0xffff) {
      const signed = code > 32767 ? code - 65536 : code;
      out += `\\u${signed}?`;
    } else {
      out += "?";
    }
  }
  return out;
}

/* ---- Minimal ZIP (STORE) writer for DOCX ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Record<string, string>} files
 * @returns {Uint8Array}
 */
function createZip(files) {
  const encoder = new TextEncoder();
  /** @type {{ name: string, data: Uint8Array, crc: number, offset: number }[]} */
  const entries = [];
  /** @type {Uint8Array[]} */
  const chunks = [];
  let offset = 0;

  const u16 = (n) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  };
  const u32 = (n) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  };

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = [
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ];
    entries.push({ name, data, crc, offset });
    for (const part of local) {
      chunks.push(part);
      offset += part.length;
    }
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const central = [
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(entry.crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(entry.offset),
      nameBytes,
    ];
    for (const part of central) {
      chunks.push(part);
      centralSize += part.length;
      offset += part.length;
    }
  }

  const end = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ];
  for (const part of end) chunks.push(part);

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
