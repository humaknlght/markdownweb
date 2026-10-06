#!/usr/bin/env node
/**
 * Generate Subresource Integrity hashes for every CDN module the app may load
 * (import-map entries, Mermaid nested chunks, on-demand highlight.js languages).
 *
 * Usage:
 *   node scripts/cdn-integrity.mjs
 *   npm run update:cdn-sri
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDN_PRECACHE } from "./pwa.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");

export const CDN_INTEGRITY_JSON = path.join(srcDir, "cdn-integrity.json");

const HLJS_LANG_DIR =
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/";
const FETCH_CONCURRENCY = 8;

function sha384Integrity(buffer) {
  return `sha384-${createHash("sha384").update(buffer).digest("base64")}`;
}

/** Only keep path-like ESM specifiers (avoids false matches in minified code). */
function isModuleSpecifier(spec) {
  if (!spec || /[,\s()<>{}]/.test(spec)) return false;
  if (!/^\.{1,2}\/|^https:\/\/cdn\.jsdelivr\.net\//.test(spec)) return false;
  return /\.(?:mjs|js)(?:\?.*)?$/.test(spec);
}

function collectModuleSpecifiers(source) {
  return [
    ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ]
    .map((match) => match[1])
    .filter(isModuleSpecifier);
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function walkModuleGraph(entryUrl) {
  const seen = new Set();
  const queue = [entryUrl];
  const files = new Map();

  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);

    const buffer = await fetchBuffer(url);
    files.set(url, buffer);

    const text = buffer.toString("utf8");
    for (const spec of collectModuleSpecifiers(text)) {
      let abs;
      try {
        abs = new URL(spec, url).href;
      } catch {
        continue;
      }
      if (
        abs.startsWith("https://cdn.jsdelivr.net/") &&
        /\.(?:mjs|js)(?:\?.*)?$/.test(abs) &&
        !seen.has(abs)
      ) {
        queue.push(abs);
      }
    }
  }

  return files;
}

async function listHljsLanguageUrls() {
  const html = await (await fetch(HLJS_LANG_DIR)).text();
  const hrefs = [...html.matchAll(/href="([^"]+\.min\.js)"/g)].map((m) => m[1]);
  if (!hrefs.length) {
    throw new Error(`No highlight.js language files listed at ${HLJS_LANG_DIR}`);
  }
  return hrefs.map((href) =>
    href.startsWith("http")
      ? href
      : href.startsWith("/")
        ? `https://cdn.jsdelivr.net${href}`
        : new URL(href, HLJS_LANG_DIR).href,
  );
}

async function mapPool(items, concurrency, worker) {
  const results = new Map();
  let index = 0;

  async function run() {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      results.set(item, await worker(item));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

/**
 * Build absolute-URL → sha384 integrity metadata for every CDN module the app
 * can load.
 */
export async function computeCdnIntegrity() {
  const integrity = {};

  const mermaidEntry = CDN_PRECACHE.find((u) => u.includes("/mermaid@"));
  if (!mermaidEntry) {
    throw new Error("CDN_PRECACHE is missing the Mermaid entry URL");
  }

  const graphFiles = await walkModuleGraph(mermaidEntry);
  for (const [url, buffer] of graphFiles) {
    integrity[url] = sha384Integrity(buffer);
  }

  const seeds = CDN_PRECACHE.filter((u) => u !== mermaidEntry);
  const langUrls = await listHljsLanguageUrls();
  const remaining = [
    ...new Set([...seeds, ...langUrls].filter((u) => !(u in integrity))),
  ];

  const fetched = await mapPool(remaining, FETCH_CONCURRENCY, fetchBuffer);
  for (const [url, buffer] of fetched) {
    integrity[url] = sha384Integrity(buffer);
  }

  const sorted = Object.fromEntries(
    Object.entries(integrity).sort(([a], [b]) => a.localeCompare(b)),
  );
  return sorted;
}

export async function loadCdnIntegrity(filePath = CDN_INTEGRITY_JSON) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid CDN integrity manifest: ${filePath}`);
  }
  return parsed;
}

/**
 * Replace the import map's integrity object and sync modulepreload integrity
 * attributes with the given URL → hash map.
 */
export function applyCdnIntegrity(html, integrity) {
  if (!integrity || typeof integrity !== "object") {
    throw new Error("applyCdnIntegrity requires an integrity object");
  }

  const importMapRe =
    /(<script\b[^>]*\btype=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/i;
  if (!importMapRe.test(html)) {
    throw new Error("HTML is missing a <script type=\"importmap\"> block");
  }

  let next = html.replace(importMapRe, (_, open, body, close) => {
    const map = JSON.parse(body);
    map.integrity = integrity;
    return `${open}${JSON.stringify(map)}${close}`;
  });

  next = next.replace(
    /<link\b([^>]*\brel=["']modulepreload["'][^>]*)>/gi,
    (full, attrs) => {
      const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
      if (!hrefMatch) return full;
      const href = hrefMatch[1];
      const hash = integrity[href];
      if (!hash) return full;

      let updated = attrs;
      if (/\bintegrity=["'][^"']*["']/i.test(updated)) {
        updated = updated.replace(
          /\bintegrity=["'][^"']*["']/i,
          `integrity="${hash}"`,
        );
      } else {
        updated = `${updated.trimEnd()} integrity="${hash}"`;
      }
      if (!/\bcrossorigin=/i.test(updated)) {
        updated = `${updated.trimEnd()} crossorigin="anonymous"`;
      }
      return `<link${updated.startsWith(" ") ? "" : " "}${updated}>`;
    },
  );

  return next;
}

export async function writeCdnIntegrityArtifacts(integrity) {
  const json = `${JSON.stringify(integrity, null, 2)}\n`;
  await writeFile(CDN_INTEGRITY_JSON, json);
  return {
    count: Object.keys(integrity).length,
    jsonPath: CDN_INTEGRITY_JSON,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const integrity = await computeCdnIntegrity();
  const { count, jsonPath } = await writeCdnIntegrityArtifacts(integrity);
  console.log(`Wrote ${count} CDN integrity hashes`);
  console.log(`  ${path.relative(root, jsonPath)}`);
}
