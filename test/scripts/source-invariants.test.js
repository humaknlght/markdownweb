import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDN_LAZY, CDN_PRECACHE } from "../../scripts/pwa.mjs";
import {
  applyCdnIntegrity,
  loadCdnIntegrity,
} from "../../scripts/cdn-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(root, "src");

/** Strip line and block comments without touching string literals. */
function stripJsComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < source.length) {
        const ch = source[i];
        out += ch;
        if (ch === "\\" && quote !== "`") {
          i += 1;
          if (i < source.length) out += source[i];
        } else if (ch === quote) {
          i += 1;
          break;
        } else if (quote === "`" && ch === "$" && source[i + 1] === "{") {
          out += "{";
          i += 2;
          let depth = 1;
          while (i < source.length && depth > 0) {
            const t = source[i];
            out += t;
            if (t === "{") depth += 1;
            else if (t === "}") depth -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      continue;
    }
    if (c === "/" && n === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function isBareModuleSpecifier(spec) {
  if (!spec) return false;
  if (spec.startsWith("./") || spec.startsWith("../")) return false;
  if (spec.startsWith("/") || spec.startsWith("http:") || spec.startsWith("https:")) {
    return false;
  }
  return true;
}

/** Runtime bare imports in a JS source string (JSDoc type imports excluded via comment strip). */
function collectBareImports(source) {
  const code = stripJsComments(source);
  const found = new Set();
  for (const match of code.matchAll(
    /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  )) {
    const spec = match[1] || match[2];
    if (isBareModuleSpecifier(spec)) found.add(spec);
  }
  return found;
}

async function walkJsFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      files.push(...(await walkJsFiles(full)));
    } else if (ent.isFile() && ent.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

function parseImportMap(html) {
  const body = html.match(
    /<script\b[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  assert.ok(body, "import map missing");
  return JSON.parse(body);
}

describe("static source invariants", () => {
  it("maps every src bare import and precaches import-map CDN URLs", async () => {
    const html = await fs.readFile(path.join(srcDir, "index.html"), "utf8");
    const map = parseImportMap(html);
    const mapped = new Set(Object.keys(map.imports || {}));
    assert.ok(mapped.size > 0, "import map has no imports");

    const bare = new Set();
    for (const file of await walkJsFiles(srcDir)) {
      const source = await fs.readFile(file, "utf8");
      for (const spec of collectBareImports(source)) bare.add(spec);
    }
    assert.ok(bare.size > 0, "expected at least one bare import under src/");

    const missingMap = [...bare].filter((spec) => !mapped.has(spec)).sort();
    assert.deepEqual(
      missingMap,
      [],
      `bare imports missing from import map (breaks npm run dev / e2e src serve):\n  ${missingMap.join("\n  ")}`,
    );

    const integrity = await loadCdnIntegrity();
    const precache = new Set(CDN_PRECACHE);
    for (const [bareName, url] of Object.entries(map.imports)) {
      assert.match(
        url,
        /^https:\/\/cdn\.jsdelivr\.net\//,
        `import map "${bareName}" should point at jsDelivr`,
      );
      assert.ok(
        precache.has(url),
        `import map "${bareName}" URL missing from CDN_PRECACHE: ${url}`,
      );
      assert.equal(
        typeof integrity[url],
        "string",
        `import map "${bareName}" URL missing SRI: ${url}`,
      );
      assert.match(integrity[url], /^sha384-/);
    }
  });

  it("keeps import map, CDN_PRECACHE, and THEMES in sync", async () => {
    const html = await fs.readFile(path.join(root, "src/index.html"), "utf8");
    assert.match(html, /type="importmap"/);
    // Firefox speculative loading ignores import maps that appear after
    // classic scripts or modulepreload (bare CDN imports then fail).
    const importMapAt = html.indexOf('type="importmap"');
    const firstScriptAt = html.search(/<script(?![^>]*type="importmap")/i);
    const firstPreloadAt = html.indexOf('rel="modulepreload"');
    assert.ok(importMapAt >= 0, "import map missing");
    assert.ok(
      firstScriptAt < 0 || importMapAt < firstScriptAt,
      "import map must precede other <script> tags",
    );
    assert.ok(
      firstPreloadAt < 0 || importMapAt < firstPreloadAt,
      "import map must precede modulepreload links",
    );
    assert.match(html, /window\.__MD_SW__="__SW_URL__"/);
    assert.match(html, /marked@18\.1\.1/);
    assert.match(html, /dompurify@3\.4\.17/);
    assert.match(html, /gemoji@8\.1\.0/);
    assert.match(html, /yaml@2\.9\.1/);
    assert.match(html, /@octokit\/rest@22\.0\.1/);

    const constants = await fs.readFile(path.join(root, "src/app/constants.js"), "utf8");
    const lazy = await fs.readFile(path.join(root, "src/app/lazy-modules.js"), "utf8");
    assert.match(
      constants,
      /THEMES = \[\s*"github-light",\s*"github-dark",\s*"sepia",\s*"terminal",\s*"salesforce",\s*"fancy",\s*"zen",\s*\]/,
    );
    assert.match(lazy, /import\("\.\.\/lib\/export\.js"\)/);
    assert.doesNotMatch(lazy, /from ["']\.\.\/lib\/export\.js["']/);
    assert.match(lazy, /import\("\.\.\/lib\/chrome-ai\.js"\)/);
    assert.doesNotMatch(lazy, /from ["']\.\.\/lib\/chrome-ai\.js["']/);
    assert.match(lazy, /import\("\.\.\/lib\/theme-zen\.js"\)/);
    assert.doesNotMatch(lazy, /from ["']\.\.\/lib\/theme-zen\.js["']/);
    assert.match(lazy, /loadZenCss/);
    assert.match(lazy, /zen\.css/);
    const zenCss = await fs.readFile(path.join(root, "src/styles/zen.css"), "utf8");
    assert.match(zenCss, /data-theme="zen"/);
    assert.doesNotMatch(
      await fs.readFile(path.join(root, "src/styles/styles.css"), "utf8"),
      /\/\* Secret Zen theme/,
    );
    assert.doesNotMatch(lazy, /cdn-integrity-urls\.js/);
    assert.match(lazy, /cdnIntegrityUrlSet/);
    assert.match(lazy, /script\[type=["']importmap["']\]/);
    // Theme boot script list in HTML must mention the same themes
    for (const theme of [
      "github-light",
      "github-dark",
      "sepia",
      "terminal",
      "salesforce",
      "fancy",
      "zen",
    ]) {
      assert.match(html, new RegExp(theme));
    }
  });

  it("covers every CDN URL with an SRI hash", async () => {
    const integrity = await loadCdnIntegrity();
    const urls = Object.keys(integrity);
    assert.ok(urls.length >= 100, `expected a full CDN graph, got ${urls.length}`);

    for (const url of CDN_PRECACHE) {
      assert.equal(typeof integrity[url], "string", `missing SRI for ${url}`);
      assert.match(integrity[url], /^sha384-/);
    }

    assert.ok(CDN_LAZY.length >= 1, "expected at least one CDN_LAZY module");
    for (const url of CDN_LAZY) {
      assert.equal(typeof integrity[url], "string", `missing SRI for ${url}`);
      assert.match(integrity[url], /^sha384-/);
    }
    assert.ok(
      urls.some((u) => u.includes("/npm/roughjs@")),
      "expected svg2roughjs dependency roughjs in the SRI graph",
    );

    const mermaidEntry = CDN_PRECACHE.find((u) => u.includes("/mermaid@"));
    assert.ok(mermaidEntry);
    const mermaidChunks = urls.filter((u) =>
      u.includes("/chunks/mermaid.esm.min/"),
    );
    assert.ok(
      mermaidChunks.length >= 20,
      `expected Mermaid nested chunks, got ${mermaidChunks.length}`,
    );

    const hljsLangs = urls.filter(
      (u) => u.includes("/es/languages/") && u.endsWith(".min.js"),
    );
    assert.ok(
      hljsLangs.length >= 100,
      `expected highlight.js languages, got ${hljsLangs.length}`,
    );
    assert.ok(
      integrity[
        "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/javascript.min.js"
      ],
    );
  });

  it("injects the CDN integrity map into the import map", async () => {
    const html = await fs.readFile(path.join(root, "src/index.html"), "utf8");
    const integrity = await loadCdnIntegrity();
    const injected = applyCdnIntegrity(html, integrity);
    const body = injected.match(
      /<script\b[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];
    assert.ok(body, "import map missing after injection");
    const map = JSON.parse(body);
    assert.equal(Object.keys(map.integrity).length, Object.keys(integrity).length);
    assert.equal(
      map.integrity[
        "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs"
      ],
      integrity[
        "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs"
      ],
    );
    assert.match(injected, /languages\/javascript\.min\.js":\s*"sha384-/);

    // App allowlist is derived from this same injected map at runtime.
    assert.deepEqual(Object.keys(map.integrity).sort(), Object.keys(integrity).sort());
  });

  it("htaccess has security and cache rules", async () => {
    const ht = await fs.readFile(path.join(root, "public/.htaccess"), "utf8");
    assert.match(ht, /DirectorySlash On/);
    assert.match(ht, /__SCRIPT_SRC__/);
    assert.match(ht, /__GUIDE_URL__/);
    assert.match(ht, /SetEnvIf Request_URI "drive-helper" IS_DRIVE_HELPER/);
    assert.match(ht, /env=!IS_DRIVE_HELPER/);
    assert.doesNotMatch(ht, /__DRIVE_HELPER_CSP__/);
    const helperHt = await fs.readFile(
      path.join(root, "public/drive-helper/.htaccess"),
      "utf8",
    );
    assert.match(helperHt, /__DRIVE_HELPER_CSP__/);
    assert.match(helperHt, /Cross-Origin-Embedder-Policy "unsafe-none"/);
    assert.match(ht, /rel=prefetch/);
    assert.match(ht, /web-share=\(\)/);
    assert.match(ht, /fullscreen=\(self\)/);
    assert.match(ht, /writer=\(self\)/);
    assert.match(ht, /rewriter=\(self\)/);
    assert.match(ht, /proofreader=\(self\)/);
    assert.match(ht, /language-model=\(self\)/);
    assert.match(ht, /publickey-credentials-create=\(self\)/);
    assert.match(ht, /publickey-credentials-get=\(self\)/);
    assert.match(ht, /Origin-Trial/);
    assert.match(ht, /og-image/);
    assert.match(ht, /Cross-Origin-Resource-Policy/);
    assert.match(ht, /FileETag MTime Size/);
    assert.match(ht, /FilesMatch "\^sw\\.js/);
    assert.match(ht, /Cross-Origin-Embedder-Policy "require-corp"/);
    assert.match(ht, /www\.googleapis\.com/);
    assert.match(ht, /api\.github\.com/);
    assert.match(ht, /img-src 'self' data: blob:/);
    assert.doesNotMatch(ht, /img-src 'self' data: blob: https:/);
  });
});
