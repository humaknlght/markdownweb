import { createHash } from "node:crypto";

/** CDN modules the app needs fully offline (import map). Mermaid ESM entry is
 * precached; diagram chunks are cached on first use by the service worker.
 * highlight.js language grammars (beyond markdown/xml) load on demand and are
 * cached by the SW after first use. */
export const CDN_PRECACHE = [
  "https://cdn.jsdelivr.net/npm/marked@18.1.1/lib/marked.esm.js",
  "https://cdn.jsdelivr.net/npm/dompurify@3.4.17/dist/purify.es.mjs",
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/core.min.js",
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/markdown.min.js",
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/xml.min.js",
  "https://cdn.jsdelivr.net/npm/gemoji@8.1.0/+esm",
  "https://cdn.jsdelivr.net/npm/yaml@2.9.1/+esm",
  "https://cdn.jsdelivr.net/npm/@octokit/rest@22.0.1/+esm",
  "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs",
];

/**
 * CDN modules loaded on demand (not SW-precached). Their full module graphs are
 * still hashed into `cdn-integrity.json` so dynamic `import()` is SRI-gated.
 */
export const CDN_LAZY = [
  // RoughJS SVG sketch for Mermaid Hand-drawn look (all diagram types).
  "https://cdn.jsdelivr.net/npm/svg2roughjs@3.2.3/+esm",
];

export const ICON_FILES = [
  "assets/icon-192.png",
  "assets/icon-512.png",
];

/** Precache list for `npm run dev` (unhashed src/ paths + CDN modules). */
export const DEV_PRECACHE = [
  "./",
  "./index.html",
  // drive-helper/ is intentionally omitted — auth popup must hit the network
  // for COEP-free / Google CSP headers (see buildServiceWorker fetch bypass).
  "./privacy.html",
  "./styles/styles.css",
  "./styles/print.css",
  "./app/app.js",
  "./drive/drive-helper.js",
  "./assets/fancy.avif",
  "./GUIDE.md",
  "./manifest.webmanifest",
  ...ICON_FILES.map((name) => `./${name}`),
  ...CDN_PRECACHE,
];

function contentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 8);
}

/**
 * Service worker for the src/dev server. Versioned from DEV_PRECACHE only so
 * production builds (hashed dist assets) do not rewrite a tracked src/sw.js.
 */
export function buildDevServiceWorker() {
  return buildServiceWorker({
    precacheUrls: DEV_PRECACHE,
    version: `dev-${precacheVersion(DEV_PRECACHE)}`,
  });
}

export function buildManifest(iconNames) {
  const icon192 = iconNames?.icon192 ?? "./assets/icon-192.png";
  const icon512 = iconNames?.icon512 ?? "./assets/icon-512.png";
  return `${JSON.stringify(
    {
      name: "Markdown Editor",
      short_name: "MD Editor",
      description:
        "Paste or upload Markdown and see a live HTML preview in your browser.",
      id: "./",
      start_url: "./?source=pwa",
      scope: "./",
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
      // Lets an installed Chromium PWA appear in “Open with” / default-app lists
      // for Markdown (and related text) files. Requires launchQueue handling in-app.
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
    },
    null,
    2
  )}\n`;
}

/** True when the URL is under the COEP-free Google Drive auth helper directory. */
export function isDriveHelperPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const i = parts.indexOf("drive-helper");
  if (i < 0) return false;
  // /…/drive-helper, /…/drive-helper/, /…/drive-helper/index.html
  return parts.length === i + 1 || parts[i + 1] === "index.html";
}

/**
 * Same-origin URLs that must revalidate (no content hash in the filename).
 * Hashed assets use cache-first and the browser HTTP cache instead.
 * @param {string} pathname
 */
export function isMutableShellPath(pathname) {
  if (isDriveHelperPath(pathname)) return false;
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

function isDriveHelperPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const i = parts.indexOf("drive-helper");
  if (i < 0) return false;
  return parts.length === i + 1 || parts[i + 1] === "index.html";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const response = await fetch(url, {
              mode: "cors",
              credentials: "omit",
              cache: "reload",
            });
            if (response.ok) await cache.put(url, response);
          } catch {
            /* one failed CDN/asset must not block install */
          }
        })
      );
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

  // Never intercept the Drive auth helper. A cached navigation response for
  // index.html (main CSP + COEP) was being served at this URL and blocked GIS.
  if (isDriveHelperPath(url.pathname)) return;

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
