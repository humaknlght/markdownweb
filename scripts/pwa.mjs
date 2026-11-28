import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectDevFirstPartyModuleUrls } from "./dev-module-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "..", "src");
const DEV_FIRST_PARTY_MODULES = collectDevFirstPartyModuleUrls(srcDir);

/** @param {string} url */
export function isMermaidSandboxCdnUrl(url) {
  return /\/npm\/(?:mermaid@|svg2roughjs@|roughjs@|points-on-|path-data-parser@|hachure-fill@)/.test(
    url,
  );
}

/** Full Mermaid / svg2roughjs graphs from the SRI manifest (for SW precache). */
export function mermaidSandboxCdnGraphUrls(
  integrity = JSON.parse(
    readFileSync(path.join(srcDir, "cdn-integrity.json"), "utf8"),
  ),
) {
  return Object.keys(integrity).filter(isMermaidSandboxCdnUrl);
}

/** CDN modules the app needs fully offline (import map). highlight.js language
 * grammars (beyond markdown/xml) load on demand and are cached by the SW after
 * first use. */
/**
 * Mermaid + svg2roughjs entry URLs. The opaque sandbox cannot use the SW or
 * the parent HTTP cache; the app fetches these graphs (SRI) and feeds them
 * into the frame as blob: modules. Entries stay in CDN_PRECACHE; the full
 * graph is appended at build/dev from cdn-integrity.json.
 */
export const MERMAID_SANDBOX_CDN_ENTRIES = [
  "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs",
  // RoughJS SVG sketch for Mermaid Hand-drawn look (all diagram types).
  "https://cdn.jsdelivr.net/npm/svg2roughjs@3.2.3/+esm",
];

export const CDN_PRECACHE = [
  "https://cdn.jsdelivr.net/npm/marked@18.1.1/lib/marked.esm.js",
  "https://cdn.jsdelivr.net/npm/dompurify@3.4.17/dist/purify.es.mjs",
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/core.min.js",
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/markdown.min.js",
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/xml.min.js",
  "https://cdn.jsdelivr.net/npm/gemoji@8.1.0/+esm",
  "https://cdn.jsdelivr.net/npm/yaml@2.9.1/+esm",
  "https://cdn.jsdelivr.net/npm/@octokit/rest@22.0.1/+esm",
  ...MERMAID_SANDBOX_CDN_ENTRIES,
];

/**
 * CDN modules hashed into `cdn-integrity.json` for on-demand SRI loads but not
 * entry-preached beyond what CDN_PRECACHE / the Mermaid graph cover. Kept as an
 * alias of the Mermaid entries so the integrity walker still seeds that graph.
 */
export const CDN_LAZY = [...MERMAID_SANDBOX_CDN_ENTRIES];

export const ICON_FILES = ["assets/icon-192.png", "assets/icon-512.png"];

/** Precache list for `npm run dev` (unhashed src/ paths + CDN modules). */
export const DEV_PRECACHE = [
  "./",
  "./index.html",
  // drive-helper/ and url-fetch-helper/ are intentionally omitted — they must
  // hit the network for their own CSP / COEP (see buildServiceWorker bypass).
  // mermaid-sandbox/ is precached so the opaque renderer shell works offline;
  // Mermaid ESM still arrives via parent-fed blobs from the CDN graph below.
  "./mermaid-sandbox/",
  "./mermaid-sandbox/index.html",
  "./privacy.html",
  "./styles/styles.css",
  "./styles/print.css",
  "./styles/privacy.css",
  ...DEV_FIRST_PARTY_MODULES,
  "./drive/drive-helper.js",
  "./url-fetch/url-fetch-helper.js",
  "./assets/fancy.avif",
  "./GUIDE.md",
  "./manifest.webmanifest",
  ...ICON_FILES.map((name) => `./${name}`),
  ...new Set([...CDN_PRECACHE, ...mermaidSandboxCdnGraphUrls()]),
];

function contentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 8);
}

/**
 * Service worker for the src/dev server. Versioned from DEV_PRECACHE only so
 * production builds (hashed dist assets) do not rewrite a tracked src/sw.js.
 */
/**
 * @param {string[]} [extraPrecacheUrls] Dev-only URLs such as the hashed sandbox document.
 */
export function buildDevServiceWorker(extraPrecacheUrls = []) {
  const precacheUrls = [...DEV_PRECACHE, ...extraPrecacheUrls];
  return buildServiceWorker({
    precacheUrls,
    version: `dev-${precacheVersion(precacheUrls)}`,
  });
}

/**
 * JSON text that matches Biome's JSON formatter: 2-space indent, trailing
 * newline, and primitive arrays kept on one line (so `npm run build` does not
 * dirty `src/manifest.webmanifest` under `biome check`).
 * @param {unknown} value
 * @param {number} [indent]
 */
export function formatJsonLikeBiome(value, indent = 0) {
  const pad = " ".repeat(indent);
  const padIn = " ".repeat(indent + 2);
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const allPrimitive = value.every(
      (item) => item === null || typeof item !== "object",
    );
    if (allPrimitive) {
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    return `[\n${value
      .map((item) => `${padIn}${formatJsonLikeBiome(item, indent + 2)}`)
      .join(",\n")}\n${pad}]`;
  }
  const keys = Object.keys(value);
  if (!keys.length) return "{}";
  return `{\n${keys
    .map(
      (key) =>
        `${padIn}${JSON.stringify(key)}: ${formatJsonLikeBiome(value[key], indent + 2)}`,
    )
    .join(",\n")}\n${pad}}`;
}

export function buildManifest(iconNames) {
  const icon192 = iconNames?.icon192 ?? "./assets/icon-192.png";
  const icon512 = iconNames?.icon512 ?? "./assets/icon-512.png";
  // Lets an installed Chromium PWA appear in “Open with” / default-app lists
  // for Markdown (and related text) files. Requires launchQueue handling in-app.
  return `${formatJsonLikeBiome({
    name: "Markdown Editor",
    short_name: "MD Editor",
    description:
      "Edit Markdown with a live HTML preview. Mermaid diagrams, themes, share links, and optional Drive or Gist. Everything runs securely in your browser.",
    id: "./",
    start_url: "./?source=pwa",
    scope: "./",
    display_override: ["window-controls-overlay"],
    display: "standalone",
    orientation: "any",
    background_color: "#0d1117",
    theme_color: "#0d1117",
    lang: "en",
    icons: [
      {
        src: icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    file_handlers: [
      {
        action: "./",
        accept: {
          "text/markdown": [".md", ".markdown", ".mdown", ".mkd"],
          "text/plain": [".txt"],
          "text/html": [".html", ".htm"],
        },
        launch_type: "single-client",
      },
    ],
    launch_handler: {
      client_mode: "focus-existing",
    },
  })}\n`;
}

/**
 * True when pathname is a helper directory index (network-only; own CSP).
 * @param {string} pathname
 * @param {string} dirName
 */
function isHelperDirPath(pathname, dirName) {
  const parts = pathname.split("/").filter(Boolean);
  const i = parts.indexOf(dirName);
  if (i < 0) return false;
  return parts.length === i + 1 || parts[i + 1] === "index.html";
}

/** True when the URL is under the COEP-free Google Drive auth helper directory. */
export function isDriveHelperPath(pathname) {
  return isHelperDirPath(pathname, "drive-helper");
}

/** True when the URL is under the URL-fetch helper directory. */
export function isUrlFetchHelperPath(pathname) {
  return isHelperDirPath(pathname, "url-fetch-helper");
}

/** True when the URL is the opaque-origin Mermaid renderer page. */
export function isMermaidSandboxPath(pathname) {
  return isMermaidSandboxNavigation(pathname);
}

/**
 * Renderer document: the dev directory / `index.html`, or the content-hashed
 * `index.<hash>.html` named by the app shell.
 * @param {string} pathname
 */
export function isMermaidSandboxNavigation(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const i = parts.indexOf("mermaid-sandbox");
  if (i < 0) return false;
  if (parts.length === i + 1) return true;
  if (parts.length !== i + 2) return false;
  const file = parts[i + 1];
  return file === "index.html" || /^index\.[a-f0-9]{8}\.html$/i.test(file);
}

/**
 * Serve the opaque Mermaid renderer document.
 *
 * The page is precached. Return that document before any network fetch.
 * Playwright's Chromium can leave `navigator.onLine` true in the worker
 * while the page is offline, and `fetch` of the navigation then never
 * settles — including the timeout — so the iframe stays on the previous
 * diagram. A content-hashed URL misses this cache after the file changes,
 * so dev edits still revalidate. Falling back to the app `index.html`
 * would boot the wrong CSP and the renderer would never post `boot`.
 *
 * @param {Request} request
 * @param {string} cacheName
 * @param {{
 *   fetch?: typeof fetch,
 *   caches?: CacheStorage,
 *   onLine?: boolean,
 *   timeoutMs?: number,
 *   Response?: typeof Response,
 * }} [deps]
 */
export async function respondMermaidNavigation(request, cacheName, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const cachesImpl = deps.caches ?? caches;
  const onLine = deps.onLine ?? navigator.onLine;
  const timeoutMs = deps.timeoutMs ?? 4000;
  const ResponseImpl = deps.Response ?? Response;

  const isSandboxDocument = (response) => {
    const csp = response?.headers?.get("content-security-policy") || "";
    // The app shell is frame-ancestors 'none'. The sandbox policy also
    // contains 'none' (default-src), so that token alone is not the shell.
    // A cache hit may omit Content-Security-Policy; the mermaid URL is enough.
    return !/frame-ancestors\s+'none'/.test(csp);
  };

  const matchCached = async () => {
    // ignoreVary: the sandbox response is stored with Vary: Accept-Encoding,
    // and a navigation request does not send the same header as install.
    // Match URL strings only. caches.match(navigationRequest) throws because
    // the request mode is "navigate", which skips the precache keys below.
    // Skip the app shell. Its CSP is frame-ancestors 'none', and Chromium
    // 159 reports that as ERR_BLOCKED_BY_RESPONSE inside the iframe.
    const loose = { ignoreVary: true, ignoreSearch: true };
    const urls = [
      request.url,
      "./mermaid-sandbox/index.html",
      "./mermaid-sandbox/",
    ];
    for (const url of urls) {
      try {
        const hit = await cachesImpl.match(url, loose);
        if (hit && isSandboxDocument(hit)) return hit;
      } catch {
        /* a navigate-mode Request is not a valid cache key */
      }
    }
    return null;
  };

  const cached = await matchCached();
  if (cached) return cached;
  if (onLine === false) return ResponseImpl.error();

  // A navigate Request can stay pending forever under offline emulation.
  // Fetch the URL string, and still race a timer for a cache miss.
  let timer;
  const pending = Promise.resolve()
    .then(() => fetchImpl(request.url))
    .then((fresh) => {
      if (!fresh?.ok) throw new Error(String(fresh?.status || "fetch"));
      return fresh;
    });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    const fresh = await Promise.race([pending, timeout]);
    if (!isSandboxDocument(fresh)) throw new Error("not sandbox");
    try {
      const cache = await cachesImpl.open(cacheName);
      // URL string, not the navigation Request — Cache.put rejects mode "navigate".
      await cache.put(request.url, fresh.clone());
    } catch {
      /* the install precache still covers the next offline boot */
    }
    return fresh;
  } catch {
    pending.catch(() => {});
    return (await matchCached()) || ResponseImpl.error();
  } finally {
    clearTimeout(timer);
  }
}

/** Drive auth or URL-fetch helper — SW must not intercept (fresh CSP / COEP). */
export function isIsolatedHelperPath(pathname) {
  return isDriveHelperPath(pathname) || isUrlFetchHelperPath(pathname);
}

/**
 * Same-origin URLs that must revalidate (no content hash in the filename).
 * Hashed assets use cache-first and the browser HTTP cache instead.
 * @param {string} pathname
 */
export function isMutableShellPath(pathname) {
  if (isIsolatedHelperPath(pathname)) return false;
  const file = pathname.endsWith("/")
    ? "index.html"
    : pathname.split("/").pop() || "";
  return (
    file === "index.html" ||
    file === "google-drive-config.json" ||
    file === "github-gist-config.json" ||
    file === "manifest.webmanifest" ||
    file === "sw.js" ||
    file === "GUIDE.md"
  );
}

export function buildServiceWorker({ precacheUrls, version }) {
  const urls = JSON.stringify(precacheUrls, null, 2);
  return `/* Markdown Editor service worker — generated at build time */
/* eslint-disable no-restricted-globals */
const CACHE = ${JSON.stringify(`md-editor-${version}`)};
const PRECACHE = ${urls};

function isMutableShell(pathname) {
  const file = pathname.endsWith("/")
    ? "index.html"
    : pathname.split("/").pop() || "";
  return (
    file === "index.html" ||
    file === "google-drive-config.json" ||
    file === "github-gist-config.json" ||
    file === "manifest.webmanifest" ||
    file === "sw.js" ||
    file === "GUIDE.md"
  );
}

function isIsolatedHelperPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  for (const dirName of ["drive-helper", "url-fetch-helper"]) {
    const i = parts.indexOf(dirName);
    if (i < 0) continue;
    if (parts.length === i + 1 || parts[i + 1] === "index.html") return true;
  }
  return false;
}

${isMermaidSandboxNavigation.toString()}

${respondMermaidNavigation.toString()}

self.addEventListener("install", (event) => {
  // Activate before the CDN list finishes. A hung jsDelivr fetch would
  // otherwise keep this worker in "installing", so the page goes offline
  // with no controller and the Mermaid iframe never reloads.
  self.skipWaiting();
  const put = async (cache, url) => {
    const timer = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), 8000);
    });
    try {
      const response = await Promise.race([
        fetch(url, {
          mode: "cors",
          credentials: "omit",
          cache: "reload",
        }),
        timer,
      ]);
      if (response.ok) await cache.put(url, response);
    } catch {
      /* one failed asset must not block install */
    }
  };
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const local = PRECACHE.filter((url) => !url.startsWith("https://"));
      await Promise.all(local.map((url) => put(cache, url)));
      // CDN graphs are filled by the controlling fetch handler on first use.
      const remote = PRECACHE.filter((url) => url.startsWith("https://"));
      void Promise.all(remote.map((url) => put(cache, url)));
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname === "cdn.jsdelivr.net";

  // Never intercept isolated helpers. A cached navigation response for
  // index.html (main CSP + COEP) would break Drive GIS / URL-fetch CSP.
  // mermaid-sandbox/ is intercepted on purpose: it is precached and must
  // still load when the worker's own fetch is offline.
  if (isIsolatedHelperPath(url.pathname)) return;

  // Any mode: a sandboxed iframe document request is not always "navigate",
  // and the mutable-shell path below has no timeout when fetch stalls.
  if (isMermaidSandboxNavigation(url.pathname)) {
    event.respondWith(respondMermaidNavigation(request, CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const file = url.pathname.endsWith("/")
          ? "index.html"
          : url.pathname.split("/").pop() || "index.html";
        const shell =
          file === "privacy.html" ? "./privacy.html" : "./index.html";
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          await cache.put(shell, fresh.clone());
          return fresh;
        } catch {
          return (
            (await caches.match(shell)) ||
            (await caches.match("./index.html")) ||
            (await caches.match("./")) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  if (!sameOrigin && !isCdn) return;

  // CDN (pinned URLs) and content-hashed same-origin assets: cache-first.
  // Unhashed shell files revalidate so deploys/edits show up without a new CACHE name.
  const cacheFirst = isCdn || !isMutableShell(url.pathname);
  if (cacheFirst) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(request, fresh.clone());
          }
          return fresh;
        } catch {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(request, { cache: "no-cache" });
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match(request)) || Response.error();
      }
    })()
  );
});
`;
}

export function precacheVersion(urls) {
  return contentHash(Buffer.from(urls.join("\\n"), "utf8"));
}
