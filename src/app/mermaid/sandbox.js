import { fetchEsmCdnGraph } from "../../lib/esm-cdn-graph.js";
import {
  MERMAID_HAND_FONT,
  MERMAID_SANDBOX_CDN_ENTRIES,
  MERMAID_SANDBOX_FRAME_SANDBOX,
  MERMAID_SANDBOX_MESSAGE,
  MERMAID_SANDBOX_PATH,
  MERMAID_SANDBOX_READY_TIMEOUT_MS,
  MERMAID_SANDBOX_RENDER_TIMEOUT_MS,
} from "../constants.js";
import { hooks } from "../hooks.js";
import { CDN_INTEGRITY } from "../lazy-modules.js";
import {
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

/** @returns {Promise<HTMLIFrameElement>} */
function ensureSandboxFrame() {
  if (sandboxReady) return sandboxReady;
  // Start the SRI graph fetch immediately so it overlaps the iframe boot.
  const modulesPromise = loadSandboxModules();
  sandboxReady = new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", MERMAID_SANDBOX_FRAME_SANDBOX);
    iframe.id = "mermaid-sandbox-frame";
    iframe.title = "Mermaid renderer";
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    // Laid out (not display:none) so Mermaid can measure text; never visible.
    iframe.style.cssText =
      "position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;visibility:hidden;pointer-events:none;z-index:-1;";

    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      if (!isSandboxMessage(event, iframe.contentWindow)) return;
      if (event.data.action === "error") {
        cleanup();
        iframe.remove();
        sandboxReady = null;
        reject(
          new Error(String(event.data.error || "Mermaid renderer failed")),
        );
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
    iframe.src = new URL(MERMAID_SANDBOX_PATH, window.location.href).href;
    document.body.appendChild(iframe);
  });
  return sandboxReady;
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
hooks.resanitizeMermaidSvgForZoom = resanitizeMermaidSvgForZoom;
