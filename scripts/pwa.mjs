import { createHash } from "node:crypto";

/** CDN modules the app needs fully offline (import map + Mermaid). */
export const CDN_PRECACHE = [
  "https://cdn.jsdelivr.net/npm/marked@15.0.7/lib/marked.esm.js",
  "https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.es.mjs",
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/es/highlight.min.js",
  "https://cdn.jsdelivr.net/npm/gemoji@8.1.0/+esm",
  "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js",
];

export const ICON_FILES = [
  "icon-192.png",
  "icon-512.png",
];

function contentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 8);
}

export function buildManifest(iconNames) {
  const icon192 = iconNames?.icon192 ?? "./icon-192.png";
  const icon512 = iconNames?.icon512 ?? "./icon-512.png";
  return `${JSON.stringify(
    {
      name: "Markdown Preview",
      short_name: "Markdown",
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
    },
    null,
    2
  )}\n`;
}

export function buildServiceWorker({ precacheUrls, version }) {
  const urls = JSON.stringify(precacheUrls, null, 2);
  return `/* Markdown Preview service worker — generated at build time */
/* eslint-disable no-restricted-globals */
const CACHE = ${JSON.stringify(`md-preview-${version}`)};
const PRECACHE = ${urls};

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

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          await cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          return (
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
});
`;
}

export function precacheVersion(urls) {
  return contentHash(Buffer.from(urls.join("\\n"), "utf8"));
}
