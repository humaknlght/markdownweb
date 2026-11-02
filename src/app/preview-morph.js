/**
 * Patch the live preview DOM to match newly rendered HTML.
 * Unchanged blocks stay in place. A partial paste keeps every block outside the
 * edit, and patches inside the list, quote, or paragraph that received it.
 * Images with the same src stay the same elements, so they are not re-decoded.
 */

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const MEDIA = new Set(["IMG", "VIDEO", "AUDIO", "SOURCE", "IFRAME"]);
const RUNTIME_CLASS = /^(?:is-collapsed|md-section-folded|md-section-anim|is-expanded)$/;
/** Skip LCS when sibling lists are huge; fall back to a full replace. */
const LCS_CELL_LIMIT = 250_000;

/**
 * @param {HTMLElement} preview
 * @param {string} html Sanitized preview markup.
 * @param {(el: Element) => string | undefined} [mermaidSource]
 *   Live Mermaid hosts store their fence text outside the DOM once an SVG is mounted.
 */
export function morphPreviewHtml(preview, html, mermaidSource = () => undefined) {
  const pool = collectMedia(preview);
  const doc = preview.ownerDocument;
  const tpl = doc.createElement("template");
  tpl.innerHTML = html;
  const oldKids = [...preview.childNodes];
  const newKids = [...tpl.content.childNodes];

  preview.replaceChildren(...alignNodes(oldKids, newKids, mermaidSource));
  adoptMedia(preview, pool);
}

/**
 * @param {Node[]} oldKids
 * @param {Node[]} newKids
 * @param {(el: Element) => string | undefined} mermaidSource
 * @returns {Node[]}
 */
function alignNodes(oldKids, newKids, mermaidSource) {
  if (oldKids.length * newKids.length > LCS_CELL_LIMIT) {
    return newKids.map((node) => node.cloneNode(true));
  }

  const oldKeys = oldKids.map((node) => nodeKey(node, true, mermaidSource));
  const newKeys = newKids.map((node) => nodeKey(node, false, mermaidSource));
  const pairs = lcsPairs(oldKeys, newKeys);
  /** @type {Map<Node, Node>} */
  const exact = new Map();
  const matchedOld = new Set();
  const matchedNew = new Set();
  for (const [oldIndex, newIndex] of pairs) {
    exact.set(newKids[newIndex], oldKids[oldIndex]);
    matchedOld.add(oldIndex);
    matchedNew.add(newIndex);
  }

  // Exact text matches are already paired. What remains is the pasted or edited
  // region. Pair those by tag so a list/blockquote/paragraph keeps its element
  // and only the children that actually changed are rebuilt.
  /** @type {Node[]} */
  const oldLeft = [];
  /** @type {Node[]} */
  const newLeft = [];
  oldKids.forEach((node, index) => {
    if (!matchedOld.has(index) && node.nodeType === ELEMENT_NODE) oldLeft.push(node);
  });
  newKids.forEach((node, index) => {
    if (!matchedNew.has(index) && node.nodeType === ELEMENT_NODE) newLeft.push(node);
  });
  const structPairs = lcsPairs(
    oldLeft.map((node) => structKey(node)),
    newLeft.map((node) => structKey(node)),
  );
  /** @type {Map<Node, Node>} */
  const similar = new Map();
  for (const [oldIndex, newIndex] of structPairs) {
    similar.set(newLeft[newIndex], oldLeft[oldIndex]);
  }

  const next = [];
  for (const fresh of newKids) {
    const kept = exact.get(fresh);
    if (kept && syncSourceLines(kept, fresh)) {
      next.push(kept);
      continue;
    }
    const host = similar.get(fresh);
    if (host && host.nodeName === fresh.nodeName) {
      patchElement(/** @type {Element} */ (host), /** @type {Element} */ (fresh), mermaidSource);
      next.push(host);
      continue;
    }
    next.push(fresh.cloneNode(true));
  }
  return next;
}

/**
 * Tag identity for an edited block, ignoring text so a partial paste still
 * lines up with the block it landed in.
 * @param {Node} node
 */
function structKey(node) {
  if (node.nodeType !== ELEMENT_NODE) return "";
  const el = /** @type {Element} */ (node);
  return `${el.nodeName}\0${el.id || ""}`;
}

/**
 * Keep `live`, copy attributes from the new markup, and patch its children.
 * @param {Element} live
 * @param {Element} fresh
 * @param {(el: Element) => string | undefined} mermaidSource
 */
function patchElement(live, fresh, mermaidSource) {
  const runtime = [...live.classList].filter((name) => RUNTIME_CLASS.test(name));
  copyAttrs(fresh, live);
  for (const name of runtime) live.classList.add(name);
  live.replaceChildren(...alignNodes([...live.childNodes], [...fresh.childNodes], mermaidSource));
}

/**
 * @param {Node} node
 * @param {boolean} live
 * @param {(el: Element) => string | undefined} mermaidSource
 */
function nodeKey(node, live, mermaidSource) {
  if (node.nodeType === TEXT_NODE) return `t\0${node.data}`;
  if (node.nodeType !== ELEMENT_NODE) return `o\0${node.nodeName}`;
  const el = /** @type {Element} */ (node);
  if (MEDIA.has(el.nodeName)) {
    return `m\0${el.nodeName}\0${el.getAttribute("src") || ""}\0${el.getAttribute("srcset") || ""}\0${el.getAttribute("alt") || ""}`;
  }
  return `e\0${el.nodeName}\0${stableClass(el, live)}\0${el.id || ""}\0${fingerprint(el, live, mermaidSource)}`;
}

/**
 * @param {Element} el
 * @param {boolean} live
 */
function stableClass(el, live) {
  const raw = el.getAttribute("class") || "";
  if (!live) return raw;
  return raw
    .split(/\s+/)
    .filter((name) => name && !RUNTIME_CLASS.test(name))
    .join(" ");
}

/**
 * Text identity, ignoring editor chrome that is not part of the Markdown HTML
 * (section twisties, code line numbers).
 * @param {Node} node
 * @param {boolean} live
 * @param {(el: Element) => string | undefined} mermaidSource
 */
function fingerprint(node, live, mermaidSource) {
  if (node.nodeType === TEXT_NODE) return node.data;
  if (node.nodeType !== ELEMENT_NODE) return "";
  const el = /** @type {Element} */ (node);
  if (el.classList.contains("line-num") || el.classList.contains("md-section-toggle")) return "";
  if (el.classList.contains("md-section-label")) return el.textContent ?? "";
  if (el.classList.contains("mermaid")) {
    if (live) {
      const stored = mermaidSource(el);
      if (typeof stored === "string") return stored;
    }
    return el.textContent ?? "";
  }
  if (MEDIA.has(el.nodeName)) {
    return `${el.getAttribute("alt") || ""}\0${el.getAttribute("src") || ""}\0${el.getAttribute("title") || ""}`;
  }
  let out = "";
  for (const child of el.childNodes) out += fingerprint(child, live, mermaidSource);
  return out;
}

/**
 * Copy `data-source-line` markers onto a kept subtree.
 * Returns false when the marker shape changed and the node should be replaced.
 * @param {Node} live
 * @param {Node} tmpl
 */
function syncSourceLines(live, tmpl) {
  if (live.nodeType !== ELEMENT_NODE || tmpl.nodeType !== ELEMENT_NODE) return true;
  const liveEls = sourceLineEls(/** @type {Element} */ (live));
  const tmplEls = sourceLineEls(/** @type {Element} */ (tmpl));
  if (liveEls.length !== tmplEls.length) return false;
  for (let i = 0; i < liveEls.length; i++) copySourceAttrs(liveEls[i], tmplEls[i]);
  return true;
}

/**
 * @param {Element} node
 * @returns {Element[]}
 */
function sourceLineEls(node) {
  /** @type {Element[]} */
  const list = [];
  const walk = (el) => {
    if (el.hasAttribute("data-source-line") || el.hasAttribute("data-source-line-end")) list.push(el);
    for (const child of el.children) walk(child);
  };
  walk(node);
  return list;
}

/**
 * @param {Element} live
 * @param {Element} tmpl
 */
function copySourceAttrs(live, tmpl) {
  for (const name of ["data-source-line", "data-source-line-end"]) {
    const value = tmpl.getAttribute(name);
    if (value == null) {
      if (live.hasAttribute(name)) live.removeAttribute(name);
    } else if (live.getAttribute(name) !== value) {
      live.setAttribute(name, value);
    }
  }
}

/**
 * @param {string[]} oldKeys
 * @param {string[]} newKeys
 * @returns {Array<[number, number]>}
 */
function lcsPairs(oldKeys, newKeys) {
  const n = oldKeys.length;
  const m = newKeys.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) {
    const oldKey = oldKeys[i - 1];
    for (let j = 1; j <= m; j++) {
      if (oldKey === newKeys[j - 1]) dp[at(i, j)] = dp[at(i - 1, j - 1)] + 1;
      else dp[at(i, j)] = Math.max(dp[at(i - 1, j)], dp[at(i, j - 1)]);
    }
  }
  /** @type {Array<[number, number]>} */
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (oldKeys[i - 1] === newKeys[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[at(i - 1, j)] >= dp[at(i, j - 1)]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairs.reverse();
  return pairs;
}

/**
 * @param {ParentNode} root
 */
function collectMedia(root) {
  /** @type {Map<string, Element[]>} */
  const pool = new Map();
  for (const el of root.querySelectorAll("img, video, audio, source, iframe")) {
    const key = mediaKey(el);
    if (!key) continue;
    const list = pool.get(key);
    if (list) list.push(el);
    else pool.set(key, [el]);
  }
  return pool;
}

/**
 * @param {Element} el
 */
function mediaKey(el) {
  const src = el.getAttribute("src");
  if (!src) return "";
  return `${el.nodeName}\0${src}\0${el.getAttribute("srcset") || ""}`;
}

/**
 * Swap newly parsed media for the already-decoded elements with the same src.
 * @param {ParentNode} root
 * @param {Map<string, Element[]>} pool
 */
function adoptMedia(root, pool) {
  for (const el of [...root.querySelectorAll("img, video, audio, source, iframe")]) {
    const key = mediaKey(el);
    const list = key ? pool.get(key) : undefined;
    if (!list?.length) continue;
    const old = list.shift();
    if (!old || old === el) continue;
    copyAttrs(el, old);
    el.replaceWith(old);
  }
}

/**
 * Copy attributes from the freshly parsed element onto the decoded one.
 * Skips a no-op src write so the browser does not reload the image.
 * @param {Element} from
 * @param {Element} to
 */
function copyAttrs(from, to) {
  const seen = new Set();
  for (const attr of from.attributes) {
    seen.add(attr.name);
    if (to.getAttribute(attr.name) !== attr.value) to.setAttribute(attr.name, attr.value);
  }
  for (const attr of [...to.attributes]) {
    if (!seen.has(attr.name)) to.removeAttribute(attr.name);
  }
}
