import { hooks } from "./hooks.js";
import {
  state,
  editor,
  preview,
  themeSelect,
  widthSelect,
  mermaidLookSelect,
  photoCredit
} from "./state.js";
import {
  STORAGE_KEYS,
  THEMES,
  WIDTHS,
  MERMAID_LOOKS
} from "./constants.js";
import {
  loadZenModule,
  loadZenCss,
  getZenModulePromise,
} from "./lazy-modules.js";

export function preferredGithubTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "github-dark"
    : "github-light";
}

export function setTheme(theme, { persist = true } = {}) {
  const next = THEMES.includes(theme) ? theme : preferredGithubTheme();
  document.documentElement.dataset.theme = next;
  themeSelect.value = next;
  if (photoCredit) {
    photoCredit.hidden = next !== "fancy";
  }
  syncZenTheme(next === "zen");
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next);
    } catch {
      /* storage may be unavailable */
    }
  }
}

/** Desired Zen backdrop state — guards against theme flips during import. */
/** @type {null | ((e: Event) => void)} */

export function detachZenTypingRipples() {
  if (!state.zenTypingListener) return;
  editor.removeEventListener("input", state.zenTypingListener);
  state.zenTypingListener = null;
}

export function attachZenTypingRipples(mod) {
  detachZenTypingRipples();
  if (hooks.prefersReducedMotion()) return;
  state.zenTypingListener = () => {
    const now = performance.now();
    if (now - state.zenTypingLastMs < 100) return;
    state.zenTypingLastMs = now;
    const len = Math.max(1, editor.value.length);
    const x = Math.min(1, Math.max(0, editor.selectionStart / len));
    const y = 0.35 + Math.random() * 0.3;
    mod.addZenRipple({ x, y, strength: 0.16 });
  };
  editor.addEventListener("input", state.zenTypingListener);
}

export async function syncZenTheme(active) {
  state.zenThemeWanted = active;
  if (!active) {
    detachZenTypingRipples();
    const zenPending = getZenModulePromise();
    if (zenPending) {
      try {
        const mod = await zenPending;
        mod.stopZenBackdrop();
      } catch {
        /* module load failed; nothing to stop */
      }
    }
    return;
  }
  try {
    // Stylesheet + WebGL chunk load only when Zen is unlocked.
    const [, mod] = await Promise.all([loadZenCss(), loadZenModule()]);
    if (!state.zenThemeWanted) {
      mod.stopZenBackdrop();
      detachZenTypingRipples();
      return;
    }
    mod.startZenBackdrop({ reducedMotion: hooks.prefersReducedMotion() });
    attachZenTypingRipples(mod);
  } catch {
    /* CSS / WebGL unavailable — fall back to whatever tokens are present */
  }
}

/** Secret unlock: 7 rapid clicks on the brand title. */

export function setupZenBrandUnlock() {
  const brand = document.querySelector(".brand");
  if (!brand) return;
  brand.addEventListener("click", () => {
    if (document.documentElement.dataset.theme === "zen") return;
    window.clearTimeout(state.zenBrandClickTimer);
    state.zenBrandClicks += 1;
    state.zenBrandClickTimer = window.setTimeout(() => {
      state.zenBrandClicks = 0;
    }, 2000);
    if (state.zenBrandClicks < 7) return;
    state.zenBrandClicks = 0;
    setTheme("zen");
    hooks.showToast("Zen");
  });
}

export function setPreviewWidth(width, { persist = true } = {}) {
  const next = WIDTHS.includes(width) ? width : "readable";
  const changed = preview.dataset.width !== next;
  preview.dataset.width = next;
  widthSelect.value = next;
  hooks.invalidateScrollAnchors();
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.width, next);
    } catch {
      /* storage may be unavailable */
    }
  }
  // Fluid Mermaid diagrams (gantt) need a width sync / possible re-layout.
  if (changed) hooks.scheduleMermaidScale();
}

/**
 * @param {string} look
 * @param {{ persist?: boolean, rerender?: boolean }} [opts]
 */
export function setMermaidLook(look, { persist = true, rerender = true } = {}) {
  const next = MERMAID_LOOKS.includes(look) ? look : "classic";
  const changed = state.mermaidLook !== next;
  state.mermaidLook = /** @type {"classic" | "handDrawn"} */ (next);
  document.documentElement.dataset.mermaidLook = next;
  if (mermaidLookSelect) mermaidLookSelect.value = next;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.mermaidLook, next);
    } catch {
      /* storage may be unavailable */
    }
  }
  if (changed && rerender) {
    void (async () => {
      if (next === "handDrawn") await hooks.ensureExcalifontLoaded();
      await hooks.rerenderAllMermaidDiagrams();
    })();
  }
}

hooks.preferredGithubTheme = preferredGithubTheme;
hooks.setTheme = setTheme;
hooks.detachZenTypingRipples = detachZenTypingRipples;
hooks.attachZenTypingRipples = attachZenTypingRipples;
hooks.syncZenTheme = syncZenTheme;
hooks.setupZenBrandUnlock = setupZenBrandUnlock;
hooks.setPreviewWidth = setPreviewWidth;
hooks.setMermaidLook = setMermaidLook;
