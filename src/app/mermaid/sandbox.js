import { fetchEsmCdnGraph } from "../../lib/esm-cdn-graph.js";
import {
  MERMAID_HAND_FONT,
  MERMAID_SANDBOX_CDN_ENTRIES,
  MERMAID_SANDBOX_MESSAGE,
  MERMAID_SANDBOX_PATH,
  MERMAID_SANDBOX_READY_TIMEOUT_MS,
  MERMAID_SANDBOX_RENDER_TIMEOUT_MS,
} from "../constants.js";
import { hooks } from "../hooks.js";
import { CDN_INTEGRITY } from "../lazy-modules.js";
import {
  adoptMermaidSvgStyles,
  DOMPurify,
  normalizeSandboxResults,
  parseSandboxMermaidSvg,
  resanitizeMermaidSvgElement,
  stripRemoteMediaAttributes,
} from "../vendor-deps.js";

/** @type {HTMLIFrameElement | null} */
let sandboxFrame = null;
/** @type {Promise<HTMLIFrameElement> | null} */
let sandboxReady = null;
/** @type {Promise<Record<string, string>> | null} */
let sandboxModulesPromise = null;
let reqSeq = 0;
/** @type {ReturnType<typeof DOMPurify> | null} */
let svgPurify = null;
/** @type {{ sheetCount: number, names: string[] } | null} */
let mermaidVarCache = null;

/**
 * @param {MessageEvent} event
 * @param {Window | null} win
 */
function isSandboxMessage(event, win) {
  return (
    win != null &&
    event.source === win &&
    event.origin === "null" &&
    event.data?.type === MERMAID_SANDBOX_MESSAGE
  );
}

const MERMAID_SANDBOX_URL_PLACEHOLDER = "__MERMAID_SANDBOX_URL__";

/** Unreplaced placeholder keeps `./mermaid-sandbox/`. Dev and production name the hashed file. */
function resolveMermaidSandboxPath() {
  try {
    const configured = window.__MD_MERMAID_SANDBOX__;
    if (
      typeof configured === "string" &&
      configured &&
      configured !== MERMAID_SANDBOX_URL_PLACEHOLDER
    ) {
      return configured;
    }
  } catch {
    /* ignore */
  }
  return MERMAID_SANDBOX_PATH;
}

const PAGE_OFFLINE_CACHE = "md-editor-offline";
const PAGE_OFFLINE_URL = "/md-offline";
const PAGE_SANDBOX_CACHE = "md-editor-mermaid";

/** Tell the service worker the page is offline without relying on its onLine flag. */
async function notePageOfflineState() {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(PAGE_OFFLINE_CACHE);
    if (navigator.onLine === false) {
      await cache.put(PAGE_OFFLINE_URL, new Response("1"));
    } else {
      await cache.delete(PAGE_OFFLINE_URL);
    }
  } catch {
    /* a missing Cache API still leaves the network path */
  }
}

/** Keep a copy of the renderer document the worker can match by URL. */
async function rememberSandboxDocument(url) {
  if (typeof caches === "undefined" || navigator.onLine === false) return;
  try {
    const response = await fetch(url, { cache: "reload" });
    if (!response.ok) return;
    const cache = await caches.open(PAGE_SANDBOX_CACHE);
    await cache.put(url, response);
  } catch {
    /* the service worker precache is the other copy */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => {
    void notePageOfflineState();
  });
  window.addEventListener("online", () => {
    void notePageOfflineState();
  });
}

function resetSandboxFrame() {
  sandboxFrame?.remove();
  sandboxFrame = null;
  sandboxReady = null;
}

/** Fetch Mermaid / svg2roughjs via the SW cache (SRI) for the opaque frame. */
function loadSandboxModules() {
  sandboxModulesPromise ??= fetchEsmCdnGraph(
    MERMAID_SANDBOX_CDN_ENTRIES,
    CDN_INTEGRITY,
  ).catch((err) => {
    sandboxModulesPromise = null;
    throw err;
  });
  return sandboxModulesPromise;
}

/**
 * The offline re-boot only works once this worker controls the page and can
 * answer the iframe navigation from cache. Install used to wait on every CDN
 * module, so CI rendered the first diagram over the network and then went
 * offline before the worker activated.
 * @returns {Promise<void>}
 */
function waitForServiceWorkerControl() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    return Promise.resolve();
  }
  const sw = navigator.serviceWorker;
  const timed = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return Promise.race([sw.ready.catch(() => null), timed(5000)]).then(
    async () => {
      if (sw.controller) return;
      try {
        const reg = await sw.getRegistration();
        reg?.waiting?.postMessage("SKIP_WAITING");
        reg?.installing?.postMessage("SKIP_WAITING");
      } catch {
        /* registration can be missing in tests that block workers */
      }
      if (sw.controller) return;
      await new Promise((resolve) => {
        let timer = 0;
        const finish = () => {
          clearTimeout(timer);
          sw.removeEventListener("controllerchange", finish);
          resolve();
        };
        timer = setTimeout(finish, 2000);
        sw.addEventListener("controllerchange", finish);
      });
    },
  );
}

/** @returns {Promise<HTMLIFrameElement>} */
function ensureSandboxFrame() {
  if (sandboxReady) return sandboxReady;
  sandboxReady = new Promise((resolve, reject) => {
    waitForServiceWorkerControl().then(async () => {
      // Fetch the SRI graph only after the worker controls the page so the
      // offline re-boot can read those modules back from the SW cache.
      const modulesPromise = loadSandboxModules();
      const url = new URL(resolveMermaidSandboxPath(), window.location.href)
        .href;
      await notePageOfflineState();
      await rememberSandboxDocument(url);
      startSandboxFrame(modulesPromise, resolve, reject);
    }, reject);
  });
  return sandboxReady;
}

/**
 * @param {Promise<Record<string, string>>} modulesPromise
 * @param {(frame: HTMLIFrameElement) => void} resolve
 * @param {(err: Error) => void} reject
 */
function startSandboxFrame(modulesPromise, resolve, reject) {
  const iframe = document.createElement("iframe");
  // Do not set the iframe sandbox attribute. Chromium treats that navigation
  // as a unique-origin request and, while offline, fails it before the
  // service worker can answer. The response CSP `sandbox allow-scripts`
  // still gives the loaded document an opaque origin.
  iframe.id = "mermaid-sandbox-frame";
  iframe.title = "Mermaid renderer";
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  // Laid out (not display:none) so Mermaid can measure text; never visible.
  iframe.className = "mermaid-measure-frame";

  /** @param {MessageEvent} event */
  const onMessage = (event) => {
    if (!isSandboxMessage(event, iframe.contentWindow)) return;
    if (event.data.action === "error") {
      cleanup();
      iframe.remove();
      sandboxReady = null;
      reject(new Error(String(event.data.error || "Mermaid renderer failed")));
      return;
    }
    if (event.data.action === "boot") {
      modulesPromise
        .then((modules) => {
          iframe.contentWindow?.postMessage(
            {
              type: MERMAID_SANDBOX_MESSAGE,
              action: "modules",
              modules,
            },
            "*",
          );
        })
        .catch((err) => {
          cleanup();
          iframe.remove();
          sandboxReady = null;
          reject(err);
        });
      return;
    }
    if (event.data.action !== "ready") return;
    cleanup();
    sandboxFrame = iframe;
    resolve(iframe);
  };
  const fail = () => {
    cleanup();
    iframe.remove();
    sandboxReady = null;
    reject(new Error("Mermaid renderer failed to load"));
  };
  const timer = window.setTimeout(fail, MERMAID_SANDBOX_READY_TIMEOUT_MS);
  const cleanup = () => {
    window.clearTimeout(timer);
    window.removeEventListener("message", onMessage);
  };
  window.addEventListener("message", onMessage);
  iframe.src = new URL(resolveMermaidSandboxPath(), window.location.href).href;
  document.body.appendChild(iframe);
}

/** `--mermaid-*` custom property names declared in the app stylesheets. */
function mermaidVarNames() {
  const sheets = document.styleSheets;
  if (mermaidVarCache?.sheetCount === sheets.length) {
    return mermaidVarCache.names;
  }
  const names = new Set();
  /** @param {CSSRuleList} rules */
  const walk = (rules) => {
    for (const rule of rules) {
      const style = /** @type {CSSStyleRule} */ (rule).style;
      if (style) {
        for (const prop of style) {
          if (prop.startsWith("--mermaid")) names.add(prop);
        }
      }
      const nested = /** @type {CSSGroupingRule} */ (rule).cssRules;
      if (nested) walk(nested);
    }
  };
  for (const sheet of sheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      /* cross-origin sheets are not readable */
    }
  }
  mermaidVarCache = { sheetCount: sheets.length, names: [...names] };
  return mermaidVarCache.names;
}

/**
 * Computed values the sandbox needs to lay out text like the app: theme
 * tokens (themeCSS fonts, sketch colors) and the inherited body font.
 */
function mermaidSandboxEnvironment() {
  const rootStyle = getComputedStyle(document.documentElement);
  /** @type {Record<string, string>} */
  const vars = {};
  for (const name of mermaidVarNames()) {
    const value = rootStyle.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  const bodyStyle = getComputedStyle(document.body);
  return {
    vars,
    font: {
      family: bodyStyle.fontFamily,
      size: bodyStyle.fontSize,
      lineHeight: bodyStyle.lineHeight,
      letterSpacing: bodyStyle.letterSpacing,
    },
  };
}

/**
 * Render Mermaid sources in the sandbox frame.
 * @param {{ source: string, width: number }[]} items
 * @param {{ sketch?: boolean }} [opts]
 */
export async function renderMermaidInSandbox(items, { sketch = false } = {}) {
  if (sandboxFrame && !sandboxFrame.isConnected) {
    resetSandboxFrame();
  }
  const iframe = await ensureSandboxFrame();
  const win = iframe.contentWindow;
  if (!win) {
    resetSandboxFrame();
    throw new Error("Mermaid renderer unavailable");
  }
  const req = `mm-${++reqSeq}`;
  const message = {
    type: MERMAID_SANDBOX_MESSAGE,
    action: "render",
    req,
    items,
    config: hooks.mermaidConfig(),
    env: mermaidSandboxEnvironment(),
    sketch,
    handFont: MERMAID_HAND_FONT,
  };

  return new Promise((resolve, reject) => {
    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      if (!isSandboxMessage(event, win) || event.data.req !== req) return;
      cleanup();
      if (event.data.action === "result") {
        resolve(normalizeSandboxResults(event.data.results, items.length));
      } else {
        reject(new Error(String(event.data.error || "Mermaid render failed")));
      }
    };
    const timer = window.setTimeout(() => {
      cleanup();
      // A wedged renderer would also stall every later request in its queue.
      resetSandboxFrame();
      reject(new Error("Mermaid render timed out"));
    }, MERMAID_SANDBOX_RENDER_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    // Opaque-origin frame: "*" is the only target origin that matches it.
    win.postMessage(message, "*");
  });
}

/**
 * Sanitize a sandbox result and parse it into the preview document.
 * @param {{ svg: string | null, scopeId: string }} result
 * @param {Document} doc
 * @returns {SVGSVGElement | null}
 */
function ensureSvgPurify() {
  if (!svgPurify) {
    svgPurify = DOMPurify(window);
    svgPurify.addHook("afterSanitizeAttributes", (node) => {
      stripRemoteMediaAttributes(/** @type {Element} */ (node));
    });
  }
  return svgPurify;
}

export function adoptSandboxMermaidSvg(result, doc) {
  return parseSandboxMermaidSvg(result, doc, ensureSvgPurify());
}

/**
 * Re-sanitize a preview Mermaid SVG before showing it in the zoom iframe
 * (scriptable-document defense in depth).
 * @param {Element} svg
 * @param {Document} doc
 */
export function resanitizeMermaidSvgForZoom(svg, doc) {
  return resanitizeMermaidSvgElement(svg, doc, ensureSvgPurify());
}

hooks.renderMermaidInSandbox = renderMermaidInSandbox;
hooks.adoptSandboxMermaidSvg = adoptSandboxMermaidSvg;
hooks.adoptMermaidSvgStyles = adoptMermaidSvgStyles;
hooks.resanitizeMermaidSvgForZoom = resanitizeMermaidSvgForZoom;

export { adoptMermaidSvgStyles };
