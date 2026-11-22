/**
 * Sanitize Mermaid SVG markup before it reaches the preview, the zoom dialog,
 * or a standalone export. Mermaid runs in an opaque-origin sandbox frame; its
 * output is treated as untrusted markup.
 */

/** Tags blocked in untrusted markup (phishing chrome / controls). */
export const UNTRUSTED_FORBID_TAGS = [
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

/** Upper bound on one diagram's SVG markup from the sandbox. */
export const MERMAID_SVG_MAX_CHARS = 5 * 1024 * 1024;

const SVG_NS = "http://www.w3.org/2000/svg";
const MERMAID_SCOPE_ID_RE = /^mermaid-\d+$/;
const CSS_STYLE_RULE = 1;
const CSS_KEYFRAMES_RULE = 7;

/** Layout / class attrs kept on `<foreignObject>` shells (no event handlers). */
const FO_ATTR_ALLOW = new Set([
  "width",
  "height",
  "x",
  "y",
  "dx",
  "dy",
  "transform",
  "class",
  "style",
  "overflow",
  "opacity",
  "requiredfeatures",
  "requiredextensions",
]);

/**
 * @param {string} name
 * @param {string} value
 */
function isSafeForeignObjectAttr(name, value) {
  const n = String(name || "").toLowerCase();
  if (!n || n.startsWith("on")) return false;
  if (n === "href" || n === "xlink:href" || n === "src") return false;
  if (!FO_ATTR_ALLOW.has(n)) return false;
  if (n === "style" && /url\s*\(|expression\s*\(|-moz-binding/i.test(value)) {
    return false;
  }
  return true;
}

/**
 * @param {Element} fo
 * @returns {Record<string, string>}
 */
function allowlistedForeignObjectAttrs(fo) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const attr of [...fo.attributes]) {
    if (isSafeForeignObjectAttr(attr.name, attr.value)) {
      attrs[attr.name] = attr.value;
    }
  }
  return attrs;
}

/**
 * @param {string} html
 * @param {Document | null | undefined} ownerDocument
 * @returns {{ root: Element, wrapped: boolean, serializer: XMLSerializer | null } | null}
 */
function parseMarkupRoot(html, ownerDocument) {
  const raw = String(html);
  const view = ownerDocument?.defaultView;
  const Parser = view?.DOMParser || globalThis.DOMParser;
  if (!Parser) return null;
  const parser = new Parser();
  const svgDoc = parser.parseFromString(raw, "image/svg+xml");
  const svgRoot = svgDoc.documentElement;
  if (
    svgRoot &&
    svgRoot.localName === "svg" &&
    !svgRoot.querySelector("parsererror")
  ) {
    return {
      root: svgRoot,
      wrapped: false,
      serializer: view?.XMLSerializer
        ? new view.XMLSerializer()
        : typeof XMLSerializer !== "undefined"
          ? new XMLSerializer()
          : null,
    };
  }
  const htmlDoc = parser.parseFromString(
    `<div id="md-fo-root">${raw}</div>`,
    "text/html",
  );
  const wrap = htmlDoc.getElementById("md-fo-root");
  return wrap
    ? {
        root: wrap,
        wrapped: true,
        serializer: null,
      }
    : null;
}

/**
 * DOMPurify's SVG profile keeps `<foreignObject>` but strips its XHTML
 * children — Mermaid flowchart/ER/journey labels live there. Walk a parsed
 * tree (no open-tag regex), stash allowlisted FO attrs + sanitized HTML
 * interiors, purify the shell, then restore.
 * @param {string} html
 * @param {import("dompurify").DOMPurify} purify
 * @param {string[]} [forbidTags]
 * @param {Document} [ownerDocument] Document that provides DOMParser (jsdom/tests)
 * @returns {string}
 */
export function sanitizeKeepingForeignObjects(
  html,
  purify,
  forbidTags = UNTRUSTED_FORBID_TAGS,
  ownerDocument = typeof document !== "undefined" ? document : undefined,
) {
  const parsed = parseMarkupRoot(html, ownerDocument);
  if (!parsed) {
    return purify.sanitize(String(html), {
      USE_PROFILES: { html: true, svg: true },
      FORBID_TAGS: forbidTags,
    });
  }

  /** @type {{ attrs: Record<string, string>, inner: string }[]} */
  const stash = [];
  for (const fo of parsed.root.querySelectorAll("foreignObject")) {
    const cleanInner = purify.sanitize(fo.innerHTML, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: forbidTags,
    });
    const attrs = allowlistedForeignObjectAttrs(fo);
    const id = String(stash.length);
    stash.push({ attrs, inner: cleanInner });
    while (fo.firstChild) fo.removeChild(fo.firstChild);
    for (const attr of [...fo.attributes]) fo.removeAttribute(attr.name);
    for (const [name, value] of Object.entries(attrs)) {
      fo.setAttribute(name, value);
    }
    fo.setAttribute("data-export-fo", id);
  }

  const shellHtml = parsed.wrapped
    ? parsed.root.innerHTML
    : parsed.serializer
      ? parsed.serializer.serializeToString(parsed.root)
      : parsed.root.outerHTML;

  const clean = purify.sanitize(shellHtml, {
    USE_PROFILES: { html: true, svg: true },
    ADD_TAGS: ["foreignObject"],
    ADD_ATTR: [
      "data-export-fo",
      "width",
      "height",
      "x",
      "y",
      "dx",
      "dy",
      "transform",
      "overflow",
      "opacity",
    ],
    FORBID_TAGS: forbidTags,
  });

  const restoreView = ownerDocument?.defaultView;
  const RestoreParser = restoreView?.DOMParser || globalThis.DOMParser;
  if (!RestoreParser || !stash.length) return clean;

  const outDoc = new RestoreParser().parseFromString(
    `<div id="md-fo-out">${clean}</div>`,
    "text/html",
  );
  const outRoot = outDoc.getElementById("md-fo-out");
  if (!outRoot) return clean;

  for (const fo of outRoot.querySelectorAll("foreignObject")) {
    const id = fo.getAttribute("data-export-fo");
    fo.removeAttribute("data-export-fo");
    const entry = id != null ? stash[Number(id)] : null;
    if (!entry) {
      fo.remove();
      continue;
    }
    for (const attr of [...fo.attributes]) fo.removeAttribute(attr.name);
    for (const [name, value] of Object.entries(entry.attrs)) {
      fo.setAttribute(name, value);
    }
    fo.innerHTML = entry.inner;
  }

  return outRoot.innerHTML;
}

/**
 * Split a selector list on top-level commas. Returns null when the selector
 * uses a sibling combinator (`+` / `~`) outside brackets, which could reach
 * elements next to the diagram.
 * @param {string} selectorText
 * @returns {string[] | null}
 */
export function splitScopedSelectorList(selectorText) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const text = String(selectorText);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "\\") i++;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === "+" || ch === "~")) return null;
    else if (depth === 0 && ch === ",") {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/**
 * @param {string} selector
 * @param {string} prefix `#scope-id`
 */
function selectorStaysInScope(selector, prefix) {
  if (!selector.startsWith(prefix)) return false;
  const next = selector.charAt(prefix.length);
  // `#mermaid-1` must not also match `#mermaid-12` / escaped continuations.
  return next === "" || !/[\w\\-]/.test(next);
}

/**
 * Keep only `<style>` rules that target the diagram's own subtree
 * (`#mermaid-N …`) plus `@keyframes`. The SVG is shown in the zoom iframe and
 * may be exported, so unscoped rules must not restyle host chrome.
 * @param {Element} svg
 * @param {string} scopeId Mermaid's root SVG id from the classic render.
 */
export function scopeMermaidSvgStyles(svg, scopeId) {
  const styles = [...svg.querySelectorAll("style")];
  if (!styles.length) return;
  if (!MERMAID_SCOPE_ID_RE.test(String(scopeId))) {
    for (const style of styles) style.remove();
    return;
  }
  const prefix = `#${scopeId}`;
  const scratch = svg.ownerDocument.implementation.createHTMLDocument("");
  for (const style of styles) {
    const probe = scratch.createElement("style");
    probe.textContent = style.textContent || "";
    scratch.head.appendChild(probe);
    /** @type {string[]} */
    const kept = [];
    for (const rule of probe.sheet?.cssRules ?? []) {
      if (
        rule.type === CSS_KEYFRAMES_RULE ||
        /^@keyframes\s/i.test(rule.cssText)
      ) {
        kept.push(rule.cssText);
        continue;
      }
      if (rule.type !== CSS_STYLE_RULE) continue;
      const selectors = splitScopedSelectorList(
        /** @type {CSSStyleRule} */ (rule).selectorText,
      );
      if (selectors?.every((sel) => selectorStaysInScope(sel, prefix))) {
        kept.push(rule.cssText);
      }
    }
    probe.remove();
    style.textContent = kept.join("\n");
  }
}

/**
 * @param {unknown} value
 * @returns {{ cssWidth: number, cssHeight: number, viewBoxWidth: number, hostWidth: number } | null}
 */
function normalizeSourceSize(value) {
  if (!value || typeof value !== "object") return null;
  const v = /** @type {Record<string, unknown>} */ (value);
  /** @param {unknown} n */
  const num = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  return {
    cssWidth: num(v.cssWidth),
    cssHeight: num(v.cssHeight),
    viewBoxWidth: num(v.viewBoxWidth),
    hostWidth: num(v.hostWidth),
  };
}

/**
 * Coerce a sandbox reply into one entry per requested diagram. Anything
 * malformed or oversized becomes `{ svg: null }` (diagram stays as source).
 * @param {unknown} raw
 * @param {number} count
 * @param {number} [maxChars]
 * @returns {{ svg: string | null, scopeId: string, sourceSize: ReturnType<typeof normalizeSourceSize> }[]}
 */
export function normalizeSandboxResults(
  raw,
  count,
  maxChars = MERMAID_SVG_MAX_CHARS,
) {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: count }, (_, i) => {
    const entry = list[i];
    if (!entry || typeof entry !== "object") {
      return { svg: null, scopeId: "", sourceSize: null };
    }
    const svg =
      typeof entry.svg === "string" &&
      entry.svg.length > 0 &&
      entry.svg.length <= maxChars
        ? entry.svg
        : null;
    return {
      svg,
      scopeId: typeof entry.scopeId === "string" ? entry.scopeId : "",
      sourceSize: normalizeSourceSize(entry.sourceSize),
    };
  });
}

/**
 * Sanitize sandbox SVG markup and parse it into `doc`.
 * @param {{ svg: string | null, scopeId: string }} result
 * @param {Document} doc
 * @param {import("dompurify").DOMPurify} purify
 * @returns {SVGSVGElement | null}
 */
export function parseSandboxMermaidSvg(result, doc, purify) {
  if (!result?.svg) return null;
  const clean = sanitizeKeepingForeignObjects(
    result.svg,
    purify,
    UNTRUSTED_FORBID_TAGS,
    doc,
  );
  const tpl = doc.createElement("template");
  tpl.innerHTML = clean;
  const svg = tpl.content.firstElementChild;
  if (svg?.localName !== "svg" || svg.namespaceURI !== SVG_NS) {
    return null;
  }
  const scopeId =
    MERMAID_SCOPE_ID_RE.test(result.scopeId) && result.scopeId
      ? result.scopeId
      : MERMAID_SCOPE_ID_RE.test(svg.id)
        ? svg.id
        : "";
  scopeMermaidSvgStyles(svg, scopeId);
  return /** @type {SVGSVGElement} */ (doc.importNode(svg, true));
}

/**
 * Defense in depth when moving a preview SVG into another document (zoom).
 * Re-serializes and runs the full sanitize + style-scope pipeline again.
 * @param {Element} svg
 * @param {Document} doc
 * @param {import("dompurify").DOMPurify} purify
 * @returns {SVGSVGElement | null}
 */
export function resanitizeMermaidSvgElement(svg, doc, purify) {
  if (svg?.localName !== "svg" || svg.namespaceURI !== SVG_NS) {
    return null;
  }
  const markup = svg.outerHTML;
  if (!markup || markup.length > MERMAID_SVG_MAX_CHARS) return null;
  const scopeId = MERMAID_SCOPE_ID_RE.test(svg.id) ? svg.id : "";
  return parseSandboxMermaidSvg({ svg: markup, scopeId }, doc, purify);
}
