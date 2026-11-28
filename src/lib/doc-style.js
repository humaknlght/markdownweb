/**
 * Per-element CSS on that element's own document.
 * A constructable stylesheet is allowed under `style-src 'self'`; `element.style`
 * is not.
 */

/** @type {WeakMap<Document, { sheet: CSSStyleSheet, seq: number, props: Map<string, Record<string, string>> }>} */
const states = new WeakMap();

const UNSAFE_DECL = /[{}]|\/\*|\*\//;

/**
 * @param {Document} doc
 */
function stateFor(doc) {
  const existing = states.get(doc);
  if (existing) return existing;
  const view = doc?.defaultView;
  if (!view || typeof view.CSSStyleSheet !== "function") return null;
  try {
    const sheet = new view.CSSStyleSheet();
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    const state = {
      sheet,
      seq: 0,
      /** @type {Map<string, Record<string, string>>} */
      props: new Map(),
    };
    states.set(doc, state);
    return state;
  } catch {
    return null;
  }
}

/**
 * @param {{ sheet: CSSStyleSheet, props: Map<string, Record<string, string>> }} state
 */
function rebuild(state) {
  const css = [];
  for (const [cls, props] of state.props) {
    const body = Object.entries(props)
      .map(([name, value]) => `${name}:${value}`)
      .join(";");
    if (body) css.push(`.${cls}{${body}}`);
  }
  try {
    state.sheet.replaceSync(css.join(""));
  } catch {
    /* one bad declaration must not drop the rest of the sheet */
  }
}

/**
 * Merge declarations onto `el`. A null or empty value removes that property.
 * @param {Element} el
 * @param {Record<string, string | null | undefined>} decls
 */
export function patchElementDecls(el, decls) {
  const state = stateFor(el?.ownerDocument);
  if (!state || !el) return;
  let cls = el.getAttribute("data-md-css");
  if (!cls) {
    cls = `md-dyn-${state.seq++}`;
    el.setAttribute("data-md-css", cls);
    el.classList.add(cls);
  }
  /** @type {Record<string, string>} */
  const props = { ...(state.props.get(cls) || {}) };
  for (const [name, value] of Object.entries(decls)) {
    if (value == null || value === "" || UNSAFE_DECL.test(String(value))) {
      delete props[name];
    } else {
      props[name] = String(value);
    }
  }
  if (Object.keys(props).length === 0) {
    state.props.delete(cls);
    el.classList.remove(cls);
    el.removeAttribute("data-md-css");
  } else {
    state.props.set(cls, props);
  }
  rebuild(state);
}
