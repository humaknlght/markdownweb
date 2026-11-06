import { hooks } from "../hooks.js";

/**
 * Parse Mermaid `click <id> href <url>` lines (gantt / flowchart).
 * Ignores `call` callbacks — those need page JS we will not enable.
 * Only http(s) URLs are kept so javascript:/data: cannot be smuggled in.
 * @param {string} src
 * @returns {Map<string, string>}
 */
export function parseMermaidClickHrefs(src) {
  /** @type {Map<string, string>} */
  const hrefById = new Map();
  const re = /^\s*click\s+(\S+)\s+href\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/gim;
  let match;
  while ((match = re.exec(String(src ?? "")))) {
    const id = match[1];
    const url = match[2] ?? match[3] ?? match[4] ?? "";
    if (!id || !url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    hrefById.set(id, url);
  }
  return hrefById;
}

/**
 * Wrap SVG nodes Mermaid tagged with task ids in real `<a href>` links.
 * Works without preview-frame `allow-scripts` (unlike Mermaid's bindFunctions).
 * @param {SVGElement} svg
 * @param {Map<string, string>} hrefById
 */
export function applyMermaidHrefLinks(svg, hrefById) {
  // Avoid `instanceof SVGElement` — that global is missing in plain Node tests.
  if (!svg || String(svg.tagName).toLowerCase() !== "svg" || !hrefById?.size) return;
  const doc = svg.ownerDocument;
  if (!doc) return;
  const svgNS = "http://www.w3.org/2000/svg";
  const cssEscape = doc.defaultView?.CSS?.escape?.bind(doc.defaultView.CSS);

  for (const [taskId, url] of hrefById) {
    let targets;
    try {
      const esc = cssEscape ? cssEscape(taskId) : taskId.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      targets = [
        ...svg.querySelectorAll(`[id$="-${esc}"], [id$="-${esc}-text"]`),
      ];
    } catch {
      continue;
    }
    for (const el of targets) {
      if (el.closest("a")) continue;
      if (el.closest(".mermaid-zoom-btn")) continue;
      const parent = el.parentNode;
      if (!parent) continue;
      const a = doc.createElementNS(svgNS, "a");
      a.setAttribute("href", url);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      parent.insertBefore(a, el);
      a.appendChild(el);
    }
  }
}

/**
 * Apply http(s) click-href links from the diagram source onto a rendered SVG.
 * @param {SVGElement} svg
 * @param {string} src
 */
export function linkMermaidSvgClicks(svg, src) {
  applyMermaidHrefLinks(svg, parseMermaidClickHrefs(src));
}

hooks.parseMermaidClickHrefs = parseMermaidClickHrefs;
hooks.applyMermaidHrefLinks = applyMermaidHrefLinks;
hooks.linkMermaidSvgClicks = linkMermaidSvgClicks;
