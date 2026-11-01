import { hooks } from "./hooks.js";
import {
  state,
  preview,
  previewPane,
  collapsedSections
} from "./state.js";

export function animateSectionFold(heading, collapsing) {
  hooks.unwrapSectionAnims();

  const els = hooks.sectionBodyElements(heading);
  if (!els.length) return Promise.resolve();

  // Snapshot before moving nodes: headingCoversElement walks siblings, and that
  // chain breaks once nested headings are relocated into the anim wrapper —
  // otherwise nested collapsed bodies briefly lose .md-section-folded.
  const stayFolded = new Set();
  if (!collapsing) {
    for (const node of els) {
      if (hooks.coveredByOtherCollapsedHeading(node, heading)) stayFolded.add(node);
    }
    // Expanding under a still-collapsed parent would build an empty
    // `.md-section-anim.is-expanded` (all children stay display:none) that can
    // linger and look like section bodies leaked under collapsed titles.
    if (stayFolded.size === els.length) return Promise.resolve();
  }

  // Tall sections (e.g. Getting started with the paste-image example) animate
  // through thousands of px and shove sibling titles off-screen within a frame.
  // Skip the height animation and let applySectionCollapse settle instantly.
  // On expand, folded nodes report offsetHeight 0 — also use content heuristics
  // so re-expanding a previously collapsed tall section still skips the anim.
  const paneH = previewPane?.clientHeight || window.innerHeight || 0;
  let bodyH = 0;
  let approxChars = 0;
  let revealCount = 0;
  for (const node of els) {
    if (stayFolded.has(node)) continue;
    revealCount += 1;
    approxChars += (node.textContent || "").length;
    if (node.classList.contains("md-section-folded")) continue;
    bodyH += node.offsetHeight || 0;
  }
  if (
    (paneH > 0 && bodyH > paneH * 1.25) ||
    revealCount > 12 ||
    approxChars > 4000
  ) {
    return Promise.resolve();
  }

  const wrap = document.createElement("div");
  wrap.className = "md-section-anim";
  const inner = document.createElement("div");
  inner.className = "md-section-anim-inner";
  wrap.appendChild(inner);
  heading.after(wrap);

  // Set the starting grid size BEFORE moving body nodes in. On expand, revealing
  // a previously folded body into a default 1fr wrapper for even one frame shoves
  // following section headings off-screen (they look like they vanish).
  wrap.classList.add(collapsing ? "is-expanded" : "is-collapsed");

  for (const node of els) {
    if (!collapsing && !stayFolded.has(node)) {
      node.classList.remove("md-section-folded");
    }
    inner.appendChild(node);
  }

  // Force layout so the initial grid row size is committed before toggling.
  void wrap.offsetHeight;

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      wrap.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (e) => {
      if (e.target !== wrap || e.propertyName !== "grid-template-rows") return;
      finish();
    };
    wrap.addEventListener("transitionend", onEnd);
    requestAnimationFrame(() => {
      wrap.classList.toggle("is-expanded", !collapsing);
      wrap.classList.toggle("is-collapsed", collapsing);
    });
    // Fallback if transitionend doesn't fire (display:none mid-flight, etc.).
    window.setTimeout(finish, 280);
  });
}

export function applySectionCollapse() {
  hooks.clearSectionFolds();
  if (hooks.isSlideNavView()) return;

  hooks.applyFoldClassesFromSet();
  void hooks.renderMermaidDiagrams();
  hooks.invalidateScrollAnchors();
}

export function enhanceSectionToggles() {
  for (const heading of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (heading.querySelector(":scope > .md-section-toggle")) continue;
    const label = document.createElement("span");
    label.className = "md-section-label";
    while (heading.firstChild) label.appendChild(heading.firstChild);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "md-section-toggle";
    btn.setAttribute("aria-expanded", "true");
    btn.title = "Collapse section";
    btn.setAttribute("aria-label", "Collapse section");
    const twistie = document.createElement("span");
    twistie.className = "md-section-twistie";
    twistie.setAttribute("aria-hidden", "true");
    // SVG (not ▼) so rotate(-90deg) pivots on the triangle's geometric center.
    twistie.innerHTML =
      '<svg viewBox="0 0 12 12" focusable="false"><path fill="currentColor" d="M0 0h12L6 12z"/></svg>';
    btn.appendChild(twistie);
    heading.append(btn, label);
  }
  applySectionCollapse();
}

export function setSectionCollapsed(heading, collapsed) {
  const key = hooks.sectionCollapseKey(heading);
  if (collapsed) collapsedSections.add(key);
  else collapsedSections.delete(key);
  applySectionCollapse();
  hooks.invalidateScrollAnchors();
}


export function toggleSectionCollapse(heading) {
  const key = hooks.sectionCollapseKey(heading);
  const collapsing = !collapsedSections.has(key);
  if (collapsing) collapsedSections.add(key);
  else collapsedSections.delete(key);

  hooks.updateSectionToggleUi(heading, collapsing);

  // Always invalidate any in-flight fold animation. Chaining a new height anim on
  // top of an interrupted one left `.md-section-anim.is-expanded` wrappers in the
  // DOM with is-collapsed headings — bodies stayed visible under "collapsed" titles.
  const busy = Boolean(preview.querySelector(".md-section-anim"));
  const gen = ++state.sectionFoldAnimGen;

  if (busy || hooks.isSlideNavView() || hooks.prefersReducedMotion()) {
    applySectionCollapse();
    hooks.invalidateScrollAnchors();
    return;
  }

  const animPromise = animateSectionFold(heading, collapsing);
  // Tall/empty skips resolve without creating a wrapper. Apply folds synchronously
  // in that case — deferring to a microtask left `is-collapsed` headings with
  // still-visible bodies until the next tick (and raced with rapid re-clicks).
  if (!preview.querySelector(".md-section-anim")) {
    applySectionCollapse();
    hooks.invalidateScrollAnchors();
    return;
  }

  animPromise
    .then(() => {
      if (gen !== state.sectionFoldAnimGen) return;
      applySectionCollapse();
      hooks.invalidateScrollAnchors();
    })
    .catch(() => {
      if (gen !== state.sectionFoldAnimGen) return;
      applySectionCollapse();
      hooks.invalidateScrollAnchors();
    });
}

/** Expand any collapsed headings that hide `el` (e.g. outline / sync-scroll jumps). */
export function ensurePreviewElementExpanded(el) {
  if (!el || hooks.isSlideNavView()) return;
  let changed = false;
  for (const heading of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!heading.classList.contains("is-collapsed")) continue;
    if (!hooks.headingCoversElement(heading, el) && heading !== el) continue;
    collapsedSections.delete(hooks.sectionCollapseKey(heading));
    changed = true;
  }
  if (changed) applySectionCollapse();
}

hooks.animateSectionFold = animateSectionFold;
hooks.applySectionCollapse = applySectionCollapse;
hooks.enhanceSectionToggles = enhanceSectionToggles;
hooks.setSectionCollapsed = setSectionCollapsed;
hooks.toggleSectionCollapse = toggleSectionCollapse;
hooks.ensurePreviewElementExpanded = ensurePreviewElementExpanded;
