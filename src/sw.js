/* Markdown Preview service worker — generated at build time */
/* eslint-disable no-restricted-globals */
const CACHE = "md-preview-dev-c59c7e1d";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./fancy.jpg",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/marked@15.0.7/lib/marked.esm.js",
  "https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.es.mjs",
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/es/highlight.min.js",
  "https://cdn.jsdelivr.net/npm/gemoji@8.1.0/+esm",
  "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js"
];

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
