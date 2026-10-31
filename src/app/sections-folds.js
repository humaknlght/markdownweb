import { hooks } from "./hooks.js";
import {
  state,
  preview,
  previewPane,
  collapsedSections
} from "./state.js";


export function headingTitleText(heading) {
  const label = heading.querySelector(":scope > .md-section-label");
  if (label) return label.textContent?.trim() || "";
  const clone = heading.cloneNode(true);
  clone.querySelectorAll(".md-section-toggle").forEach((el) => el.remove());
  return clone.textContent?.trim() || "";
}

export function sectionCollapseKey(heading) {
  // Prefer source line so duplicate titles collapse independently across re-renders.
  const line = Number(heading.getAttribute("data-source-line"));
  if (Number.isFinite(line) && line >= 1) return `line:${line}`;
  const all = [...preview.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const idx = all.indexOf(heading);
  return `idx:${idx}:${heading.tagName.slice(1)}:${headingTitleText(heading).toLowerCase()}`;
}

export function headingLevel(el) {
  if (!el || !/^H[1-6]$/.test(el.tagName)) return 0;
  return Number(el.tagName.slice(1));
}

/** True when `el` falls under `heading`'s fold range (until next same-or-higher heading). */
export function headingCoversElement(heading, el) {
  if (!heading || !el || heading === el) return false;
  const level = headingLevel(heading);
  if (!level) return false;
  let node = heading.nextElementSibling;
  while (node) {
    if (node === el) return true;
    if (headingLevel(node) && headingLevel(node) <= level) return false;
    node = node.nextElementSibling;
  }
  return false;
}

export function clearSectionFolds() {
  unwrapSectionAnims();
  preview.querySelectorAll(".md-section-folded").forEach((el) => {
    el.classList.remove("md-section-folded");
  });
}

export function unwrapSectionAnims() {
  // Wrappers may sit inside blockquotes/alerts, not only as preview children.
  const anims = [...preview.querySelectorAll(".md-section-anim")].reverse();
  for (const wrap of anims) {
    const parent = wrap.parentNode;
    if (!parent) continue;
    const inner = wrap.querySelector(":scope > .md-section-anim-inner") || wrap;
    while (inner.firstChild) parent.insertBefore(inner.firstChild, wrap);
    wrap.remove();
  }
}

/** Direct siblings that belong to this heading's fold range. */
export function sectionBodyElements(heading) {
  const level = headingLevel(heading);
  const els = [];
  let el = heading.nextElementSibling;
  while (el) {
    if (el.classList.contains("md-section-anim")) {
      // Defensive: an interrupted fold can leave a wrapper as a sibling. Unpack
      // its children but still honor the same-or-higher heading boundary —
      // otherwise sibling section titles get absorbed into this heading's body.
      const inner = el.querySelector(":scope > .md-section-anim-inner");
      const kids = inner ? [...inner.children] : [];
      for (const kid of kids) {
        const kidLevel = headingLevel(kid);
        if (kidLevel && kidLevel <= level) return els;
        els.push(kid);
      }
      el = el.nextElementSibling;
      continue;
    }
    const nextLevel = headingLevel(el);
    if (nextLevel && nextLevel <= level) break;
    els.push(el);
    el = el.nextElementSibling;
  }
  return els;
}

export function updateSectionToggleUi(heading, collapsed) {
  heading.classList.toggle("is-collapsed", collapsed);
  const toggle = heading.querySelector(":scope > .md-section-toggle");
  if (!toggle) return;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.title = collapsed ? "Expand section" : "Collapse section";
  toggle.setAttribute("aria-label", toggle.title);
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True if another collapsed heading (not `except`) currently covers `el`. */
export function coveredByOtherCollapsedHeading(el, except) {
  for (const heading of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (heading === except) continue;
    if (!collapsedSections.has(sectionCollapseKey(heading))) continue;
    if (headingCoversElement(heading, el)) return true;
  }
  return false;
}

/**
 * Apply `.md-section-folded` from `collapsedSections` without mermaid/scroll work.
 * Used to re-sync after an interrupted animation unwraps mid-flight.
 */
export function applyFoldClassesFromSet() {
  preview.querySelectorAll(".md-section-folded").forEach((el) => {
    el.classList.remove("md-section-folded");
  });
  if (hooks.isSlideNavView()) return;

  for (const heading of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const collapsed = collapsedSections.has(sectionCollapseKey(heading));
    updateSectionToggleUi(heading, collapsed);
    if (!collapsed) continue;

    const level = headingLevel(heading);
    let el = heading.nextElementSibling;
    while (el) {
      const nextLevel = headingLevel(el);
      if (nextLevel && nextLevel <= level) break;
      el.classList.add("md-section-folded");
      el = el.nextElementSibling;
    }
  }
}

/**
 * Animate fold/unfold of a section body via a temporary grid wrapper.
 * Resolves when the transition finishes (or immediately if nothing to animate).
 * Caller must ensure no `.md-section-anim` is already in the tree (interrupted
 * toggles settle via applySectionCollapse instead of chaining anims).
 */

hooks.headingTitleText = headingTitleText;
hooks.sectionCollapseKey = sectionCollapseKey;
hooks.headingLevel = headingLevel;
hooks.headingCoversElement = headingCoversElement;
hooks.clearSectionFolds = clearSectionFolds;
hooks.unwrapSectionAnims = unwrapSectionAnims;
hooks.sectionBodyElements = sectionBodyElements;
hooks.updateSectionToggleUi = updateSectionToggleUi;
hooks.prefersReducedMotion = prefersReducedMotion;
hooks.coveredByOtherCollapsedHeading = coveredByOtherCollapsedHeading;
hooks.applyFoldClassesFromSet = applyFoldClassesFromSet;
