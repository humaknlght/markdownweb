/**
 * Walk and rewrite jsDelivr ESM graphs so an opaque sandbox can load them from
 * parent-fed sources (blob URLs + import map) instead of the network.
 */

/** @param {string} spec */
export function isEsmModuleSpecifier(spec) {
  if (!spec || /[,\s()<>{}]/.test(spec)) return false;
  if (spec.startsWith("/npm/") && /\/\+esm(?:\?|$)/.test(spec)) return true;
  if (!/^\.{1,2}\/|^https:\/\/cdn\.jsdelivr\.net\//.test(spec)) return false;
  return /\.(?:mjs|js)(?:\?.*)?$/.test(spec) || /\/\+esm(?:\?|$)/.test(spec);
}

/** @param {string} source */
export function collectEsmModuleSpecifiers(source) {
  return [
    ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    // Side-effect imports: `import "./chunk.mjs";` (no from / call).
    ...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
  ]
    .map((match) => match[1])
    .filter(isEsmModuleSpecifier);
}

/**
 * Rewrite relative / root-absolute ESM specifiers to absolute jsDelivr URLs so
 * an import map keyed by those URLs can resolve nested chunks inside blobs.
 * @param {string} source
 * @param {string} baseUrl
 */
export function absolutizeEsmModuleSpecifiers(source, baseUrl) {
  /** @param {string} spec */
  const abs = (spec) => {
    try {
      return new URL(spec, baseUrl).href;
    } catch {
      return spec;
    }
  };
  let out = String(source);
  out = out.replace(/\bfrom\s*(["'])([^"']+)\1/g, (match, quote, spec) => {
    if (!isEsmModuleSpecifier(spec)) return match;
    return `from ${quote}${abs(spec)}${quote}`;
  });
  out = out.replace(
    /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g,
    (match, quote, spec) => {
      if (!isEsmModuleSpecifier(spec)) return match;
      return `import(${quote}${abs(spec)}${quote})`;
    },
  );
  out = out.replace(/\bimport\s*(["'])([^"']+)\1/g, (match, quote, spec) => {
    if (!isEsmModuleSpecifier(spec)) return match;
    return `import ${quote}${abs(spec)}${quote}`;
  });
  return out;
}

/**
 * Fetch an entry module and every jsDelivr dependency listed in `integrity`.
 * Uses request SRI so a compromised cache/CDN cannot feed the sandbox.
 * @param {string[]} entries
 * @param {Record<string, string>} integrity url → sha384-…
 * @param {(url: string, init: RequestInit) => Promise<Response>} [fetchImpl]
 */
export async function fetchEsmCdnGraph(
  entries,
  integrity,
  fetchImpl = globalThis.fetch.bind(globalThis),
) {
  /** @type {Record<string, string>} */
  const modules = {};
  const queue = [...entries];
  const seen = new Set();

  while (queue.length) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const hash = integrity[url];
    if (typeof hash !== "string" || !hash.startsWith("sha384-")) {
      throw new Error(`Missing SRI for ${url}`);
    }
    const res = await fetchImpl(url, {
      mode: "cors",
      credentials: "omit",
      integrity: hash,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }
    const source = absolutizeEsmModuleSpecifiers(await res.text(), url);
    modules[url] = source;
    for (const spec of collectEsmModuleSpecifiers(source)) {
      if (
        spec.startsWith("https://cdn.jsdelivr.net/") &&
        typeof integrity[spec] === "string"
      ) {
        queue.push(spec);
      }
    }
  }

  return modules;
}
