/** SRI allowlist from the page import map (injected at serve/build). */
export function cdnIntegrityUrlSet() {
  try {
    const el = document.querySelector('script[type="importmap"]');
    const map = JSON.parse(el?.textContent || "{}");
    return new Set(Object.keys(map.integrity || {}));
  } catch {
    return new Set();
  }
}
export const CDN_INTEGRITY_URLS = cdnIntegrityUrlSet();

/** Lazy-loaded export helpers — not needed until the user exports/prints. */
let exportModulePromise;
export function loadExportModule() {
  exportModulePromise ??= import("../lib/export.js");
  return exportModulePromise;
}

/** Lazy-loaded Chrome Writing Assistance helpers — only when APIs exist. */
let chromeAiModulePromise;
export function loadChromeAiModule() {
  chromeAiModulePromise ??= import("../lib/chrome-ai.js");
  return chromeAiModulePromise;
}

/** Lazy-loaded WebGL water backdrop for the secret Zen theme. */
let zenModulePromise;
export function loadZenModule() {
  zenModulePromise ??= import("../lib/theme-zen.js");
  return zenModulePromise;
}

/** In-flight Zen module load, if any (for teardown without starting a load). */
export function getZenModulePromise() {
  return zenModulePromise;
}

/** Lazy-loaded Zen stylesheet (not in the main CSS bundle). */
let zenCssPromise;
export function loadZenCss() {
  zenCssPromise ??= new Promise((resolve, reject) => {
    if (document.getElementById("zen-theme-css")) {
      resolve();
      return;
    }
    const href =
      typeof __ZEN_CSS_URL__ !== "undefined"
        ? /** @type {string} */ (__ZEN_CSS_URL__)
        : new URL("../styles/zen.css", import.meta.url).href;
    const link = document.createElement("link");
    link.id = "zen-theme-css";
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("Failed to load zen.css"));
    document.head.appendChild(link);
  });
  return zenCssPromise;
}

/** Cheap probe so unsupported browsers never fetch the chrome-ai chunk. */
export function anyWritingAiGlobalPresent() {
  return (
    typeof globalThis.Writer !== "undefined" ||
    typeof globalThis.Rewriter !== "undefined" ||
    typeof globalThis.Proofreader !== "undefined" ||
    typeof globalThis.LanguageModel !== "undefined"
  );
}
