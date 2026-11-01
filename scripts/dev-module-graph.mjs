import fs from "node:fs";
import path from "node:path";

/** Static `import … from './rel'` and side-effect `import './rel'` (not dynamic `import()`). */
const STATIC_IMPORT_RE =
  /^\s*import\s+(?!\()(?:[\w\s{},*]+\s+from\s+|\s*)["'](\.\.?\/[^"']+)["']/gm;

function readText(absPath) {
  return fs.readFileSync(absPath, "utf8");
}

/**
 * @param {string} filePath absolute path under src/
 * @param {string} srcDir absolute src root
 * @returns {string[]} absolute paths to local .js modules
 */
export function parseStaticRelativeImports(filePath, srcDir) {
  let text;
  try {
    text = readText(filePath);
  } catch {
    return [];
  }
  const dir = path.dirname(filePath);
  const out = [];
  const re = new RegExp(STATIC_IMPORT_RE.source, "gm");
  let m;
  while ((m = re.exec(text))) {
    const spec = m[1];
    if (!spec.endsWith(".js")) continue;
    const resolved = path.normalize(path.join(dir, spec));
    if (resolved.startsWith(srcDir) && resolved.endsWith(".js")) {
      out.push(resolved);
    }
  }
  return out;
}

function walkAppJsFiles(appDir) {
  /** @type {string[]} */
  const files = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.name.endsWith(".js")) files.push(abs);
    }
  }
  walk(appDir);
  return files;
}

function toPrecacheUrl(srcDir, absPath) {
  const rel = path.relative(srcDir, absPath).split(path.sep).join("/");
  return `./${rel}`;
}

/**
 * Same-origin module URLs for dev PWA precache and dev modulepreload injection:
 * all app JavaScript modules under src/app plus local deps reachable from static
 * `app/vendor-deps.js` (markdown, lib, drive, gist).
 *
 * @param {string} srcDir absolute path to src/
 * @returns {string[]} sorted `./…` urls
 */
export function collectDevFirstPartyModuleUrls(srcDir) {
  const srcDirAbs = path.resolve(srcDir);
  const appDir = path.join(srcDirAbs, "app");
  /** @type {Set<string>} */
  const absPaths = new Set(walkAppJsFiles(appDir));

  const vendorDeps = path.join(appDir, "vendor-deps.js");
  /** @type {string[]} */
  const queue = [vendorDeps];
  /** @type {Set<string>} */
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fs.existsSync(file)) continue;
    absPaths.add(file);
    for (const dep of parseStaticRelativeImports(file, srcDirAbs)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }

  const expand = [...absPaths];
  for (const file of expand) {
    for (const dep of parseStaticRelativeImports(file, srcDirAbs)) {
      absPaths.add(dep);
    }
  }

  return [...absPaths]
    .map((abs) => toPrecacheUrl(srcDirAbs, abs))
    .sort((a, b) => a.localeCompare(b));
}

const DEV_LOCAL_PRELOAD_MARKER = "<!-- dev-local-modulepreloads -->";

/**
 * Inject first-party modulepreload links before `</head>` (dev server only).
 * @param {string} html
 * @param {string} srcDir
 */
export function injectDevLocalModulepreloads(html, srcDir) {
  if (html.includes(DEV_LOCAL_PRELOAD_MARKER)) return html;
  const urls = collectDevFirstPartyModuleUrls(srcDir);
  const lines = urls.map(
    (href) => `  <link rel="modulepreload" href="${href}" />`,
  );
  const block = `  ${DEV_LOCAL_PRELOAD_MARKER}\n${lines.join("\n")}\n`;
  return html.replace("</head>", `${block}</head>`);
}
