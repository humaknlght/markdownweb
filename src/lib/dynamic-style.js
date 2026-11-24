/**
 * Main-document dynamic CSS via a constructable stylesheet.
 * Allowed under `style-src 'self'` without `'unsafe-inline'` (unlike element.style
 * or injected <style> tags).
 */

const BOOT_KEY = "__MD_DYNAMIC_STYLE_SHEET__";

/** @type {CSSStyleSheet | null} */
let sheet = null;
/** @type {Map<string, string>} */
const rootVars = new Map();
/** @type {Map<string, Record<string, string>>} */
const rules = new Map();
/** @type {Map<string, string>} */
const rawBlocks = new Map();

/**
 * Own (or adopt the boot-script) constructable sheet.
 * @returns {CSSStyleSheet}
 */
export function ensureDynamicStyleSheet() {
  if (sheet) return sheet;
  const boot = globalThis[BOOT_KEY];
  if (boot instanceof CSSStyleSheet) {
    sheet = boot;
    delete globalThis[BOOT_KEY];
    // Keep first-paint --split until applySplit / setRootVars rebuilds.
    try {
      const split = getComputedStyle(document.documentElement)
        .getPropertyValue("--split")
        .trim();
      if (split) rootVars.set("--split", split);
    } catch {
      /* ignore */
    }
  } else {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  return sheet;
}

function rebuild() {
  const parts = [];
  if (rootVars.size > 0) {
    const decls = [...rootVars.entries()]
      .map(([name, value]) => `${name}:${value}`)
      .join(";");
    parts.push(`:root{${decls}}`);
  }
  for (const [selector, decls] of rules) {
    const body = Object.entries(decls)
      .map(([name, value]) => `${name}:${value}`)
      .join(";");
    parts.push(`${selector}{${body}}`);
  }
  for (const css of rawBlocks.values()) {
    parts.push(css);
  }
  ensureDynamicStyleSheet().replaceSync(parts.join(""));
}

/**
 * Set or clear :root custom properties. Pass `null`/empty to remove a name.
 * @param {Record<string, string | null | undefined>} vars
 */
export function setRootVars(vars) {
  for (const [name, value] of Object.entries(vars)) {
    if (value == null || value === "") rootVars.delete(name);
    else rootVars.set(name, value);
  }
  rebuild();
}

/**
 * Replace the declaration block for `selector`, or clear when decls is empty.
 * @param {string} selector
 * @param {Record<string, string> | null | undefined} decls
 */
export function setRule(selector, decls) {
  if (!decls || Object.keys(decls).length === 0) rules.delete(selector);
  else rules.set(selector, { ...decls });
  rebuild();
}

/** @param {string} selector */
export function clearRule(selector) {
  if (rules.delete(selector)) rebuild();
}

/**
 * Insert or clear a raw CSS block (e.g. `@media print { @page { … } }`).
 * @param {string} id
 * @param {string | null | undefined} css
 */
export function setRawBlock(id, css) {
  if (!css) rawBlocks.delete(id);
  else rawBlocks.set(id, css);
  rebuild();
}
