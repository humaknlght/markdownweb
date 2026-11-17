/**
 * Main-app client for the same-origin url-fetch-helper iframe.
 */

import {
  isUrlFetchMessage,
  makeUrlFetchMessage,
  URL_FETCH_HELPER_PATH,
  URL_FETCH_TIMEOUT_MS,
} from "./url-fetch-api.js";

/** @type {HTMLIFrameElement | null} */
let helperFrame = null;
/** @type {Promise<HTMLIFrameElement> | null} */
let helperReady = null;
let reqSeq = 0;

/**
 * @returns {Promise<HTMLIFrameElement>}
 */
function ensureHelperFrame() {
  if (helperFrame?.contentWindow) return Promise.resolve(helperFrame);
  if (helperReady) return helperReady;

  helperReady = new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.src = new URL(URL_FETCH_HELPER_PATH, window.location.href).href;
    iframe.title = "URL fetch helper";
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.style.cssText =
      "position:absolute;width:0;height:0;border:0;clip:rect(0,0,0,0);overflow:hidden;";

    const timer = window.setTimeout(() => {
      cleanup();
      helperReady = null;
      iframe.remove();
      reject(new Error("URL fetch helper timed out"));
    }, 15_000);

    const cleanup = () => {
      window.clearTimeout(timer);
      iframe.removeEventListener("load", onLoad);
      iframe.removeEventListener("error", onError);
    };

    const onLoad = () => {
      cleanup();
      helperFrame = iframe;
      resolve(iframe);
    };
    const onError = () => {
      cleanup();
      helperReady = null;
      iframe.remove();
      reject(new Error("URL fetch helper failed to load"));
    };
    iframe.addEventListener("load", onLoad, { once: true });
    iframe.addEventListener("error", onError, { once: true });
    document.body.appendChild(iframe);
  });

  return helperReady;
}

/**
 * @param {string} url
 * @param {{ authorization?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<{ content: string, name: string }>}
 */
export async function fetchViaUrlHelper(url, opts = {}) {
  const frame = await ensureHelperFrame();
  const win = frame.contentWindow;
  if (!win) throw new Error("URL fetch helper unavailable");

  const req = `uf-${Date.now()}-${++reqSeq}`;
  const timeoutMs = opts.timeoutMs ?? URL_FETCH_TIMEOUT_MS + 5_000;

  return new Promise((resolve, reject) => {
    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== win) return;
      if (!isUrlFetchMessage(event.data)) return;
      if (event.data.req !== req) return;
      if (event.data.action === "ok") {
        cleanup();
        resolve({
          content: String(event.data.content ?? ""),
          name: String(event.data.name || "untitled.md"),
        });
        return;
      }
      if (event.data.action === "error") {
        cleanup();
        reject(
          Object.assign(new Error(String(event.data.error || "Fetch failed")), {
            code: String(event.data.code || "error"),
          }),
        );
      }
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(
        Object.assign(new Error("Request timed out"), { code: "timeout" }),
      );
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };

    window.addEventListener("message", onMessage);
    win.postMessage(
      makeUrlFetchMessage({
        action: "fetch",
        req,
        url,
        authorization: opts.authorization,
      }),
      window.location.origin,
    );
  });
}
