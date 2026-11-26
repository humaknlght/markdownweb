import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { applyCdnIntegrity } from "../../scripts/cdn-integrity.mjs";
import {
  buildContentSecurityPolicy,
  buildDriveHelperContentSecurityPolicy,
  buildDriveHelperScriptSrc,
  buildMermaidSandboxContentSecurityPolicy,
  buildScriptSrc,
  buildUrlFetchHelperContentSecurityPolicy,
  buildUrlFetchHelperScriptSrc,
  extractInlineScripts,
  inlineScriptHashes,
  sha256Base64,
} from "../../scripts/csp.mjs";
import { inlineMermaidSandboxBootstrap } from "../../scripts/mermaid-sandbox.mjs";
import { minifyPreviewFrameDocWrite } from "../../scripts/minify-preview-frame-html.mjs";
import {
  buildDevServiceWorker,
  buildManifest,
  buildServiceWorker,
  CDN_PRECACHE,
  DEV_PRECACHE,
  ICON_FILES,
  isDriveHelperPath,
  isIsolatedHelperPath,
  isMermaidSandboxPath,
  isMutableShellPath,
  isUrlFetchHelperPath,
  precacheVersion,
  respondMermaidNavigation,
} from "../../scripts/pwa.mjs";
import {
  headersFor,
  isInsideRoot,
  isNotModified,
  resolveWithCompression,
  safeResolve,
  strongEtag,
  toHttpDate,
} from "../../scripts/serve-utils.mjs";
import { copyGuideTo, guideSourcePath } from "../../scripts/sync-guide.mjs";
import { usedIdents } from "../../scripts/trim-unused-imports.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("minify-preview-frame-html.mjs", () => {
  it("minifies the doc.write HTML shell and keeps interpolations", async () => {
    const src = await fs.readFile(
      path.join(repoRoot, "src/app/preview-frame.js"),
      "utf8",
    );
    const out = await minifyPreviewFrameDocWrite(src);
    const before = src.match(/doc\.write\(`([\s\S]*?)`\);/)?.[1] ?? "";
    const after = out.match(/doc\.write\(`([\s\S]*?)`\);/)?.[1] ?? "";
    assert.ok(after.length < before.length);
    assert.match(after, /\$\{frameCsp\}/);
    assert.match(after, /\$\{cssHref\}/);
    assert.doesNotMatch(after, /Shared styles\.css/);
    assert.match(after, /id="preview"/);
  });

  it("throws when the template is missing", async () => {
    await assert.rejects(
      () => minifyPreviewFrameDocWrite("export function init() {}"),
      /expected doc\.write/,
    );
  });
});

describe("trim-unused-imports.mjs", () => {
  it("counts identifiers inside template literal expressions", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source for usedIdents
    const used = usedIdents("export const x = `/${FOO}`;\n");
    assert.equal(used.has("FOO"), true);
  });

  it("does not treat quotes inside regex literals as string delimiters", () => {
    const used = usedIdents(
      'function esc(v) { return String(v).replace(/["\\\\]/g, "\\\\$&"); }\n' +
        "function f() { return filesTree; }\n",
    );
    assert.equal(used.has("filesTree"), true);
  });
});

describe("csp.mjs", () => {
  it("extracts inline scripts and ignores src scripts", () => {
    assert.deepEqual(extractInlineScripts("<script>alert(1)</script>"), [
      "alert(1)",
    ]);
    assert.deepEqual(extractInlineScripts('<script src="a.js"></script>'), []);
    assert.deepEqual(extractInlineScripts('<script type="module">x</script>'), [
      "x",
    ]);
    // HTML5-tolerated end tags (whitespace / junk before `>`).
    assert.deepEqual(extractInlineScripts("<script>y</script >"), ["y"]);
    assert.deepEqual(extractInlineScripts('<script>z</script foo="bar">'), [
      "z",
    ]);
  });

  it("hashes SHA-256 in base64", () => {
    assert.equal(
      sha256Base64(""),
      "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
  });

  it("builds script-src and full CSP", () => {
    const hashes = inlineScriptHashes("<script>x</script>");
    const src = buildScriptSrc(hashes);
    assert.match(src, /'self'/);
    assert.match(src, /cdn\.jsdelivr\.net/);
    assert.match(src, /'sha256-/);
    const csp = buildContentSecurityPolicy(src);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /media-src 'self' data: blob:/);
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.doesNotMatch(csp, /img-src[^;]*https:/);
    assert.match(csp, /connect-src[^;]*www\.googleapis\.com/);
    assert.match(csp, /connect-src[^;]*api\.github\.com/);
    assert.doesNotMatch(csp, /apis\.google\.com/);
    assert.match(csp, /style-src 'self'(?:;|$)/);
    assert.doesNotMatch(csp, /style-src[^;]*unsafe-inline/);
  });

  it("builds Drive helper CSP without a Google script host", () => {
    const src = buildDriveHelperScriptSrc([]);
    assert.equal(src, "'self'");
    const csp = buildDriveHelperContentSecurityPolicy(src);
    assert.match(csp, /frame-src[^;]*accounts\.google\.com/);
    assert.match(csp, /connect-src[^;]*www\.googleapis\.com/);
    assert.doesNotMatch(csp, /oauth2\.googleapis\.com/);
    assert.doesNotMatch(csp, /docs\.google\.com/);
  });

  it("builds URL fetch helper CSP with https connect-src", () => {
    const src = buildUrlFetchHelperScriptSrc([]);
    assert.equal(src, "'self'");
    const csp = buildUrlFetchHelperContentSecurityPolicy(src);
    assert.match(csp, /connect-src[^;]*https:/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.doesNotMatch(csp, /accounts\.google\.com/);
  });

  it("builds Mermaid sandbox CSP with blob modules and no CDN scripts", () => {
    const csp = buildMermaidSandboxContentSecurityPolicy(["'sha256-abc'"]);
    assert.match(csp, /(?:^|; )sandbox allow-scripts(?:;|$)/);
    assert.doesNotMatch(csp, /allow-same-origin/);
    assert.match(csp, /script-src blob: 'unsafe-inline'(?:;|$)/);
    assert.doesNotMatch(
      csp.match(/script-src ([^;]+)/)[1],
      /'self'|cdn\.jsdelivr|sha256/,
    );
    assert.match(csp, /default-src 'none'/);
    assert.doesNotMatch(csp, /connect-src/);
    assert.match(csp, /frame-ancestors 'self'/);
  });
});

describe("mermaid-sandbox.mjs", () => {
  it("inlines bootstrap.js with an embedded runtime string", () => {
    const html =
      '<head></head><body><script src="./bootstrap.js"></script></body>';
    const bootstrap =
      'const RUNTIME = "__MERMAID_RUNTIME_PLACEHOLDER__";\nboot();';
    const out = inlineMermaidSandboxBootstrap(
      html,
      bootstrap,
      "const a = '$&';\n",
    );
    assert.match(out, /<script>\nconst RUNTIME = "const a = '\$&';\\n";/);
    assert.doesNotMatch(out, /__MERMAID_RUNTIME_PLACEHOLDER__/);
    assert.equal(extractInlineScripts(out).length, 1);
  });

  it("rejects a missing tag or a script that would close the script", () => {
    assert.throws(() =>
      inlineMermaidSandboxBootstrap(
        "<body></body>",
        'const RUNTIME = "__MERMAID_RUNTIME_PLACEHOLDER__";',
        "x",
      ),
    );
    assert.throws(() =>
      inlineMermaidSandboxBootstrap(
        '<script src="./bootstrap.js"></script>',
        'const RUNTIME = "__MERMAID_RUNTIME_PLACEHOLDER__";',
        "'</script><script>alert(1)'",
      ),
    );
  });
});

describe("cdn-integrity.mjs", () => {
  it("replaces import-map integrity and modulepreload hashes", () => {
    const html = `<!doctype html><script type="importmap">
{
  "imports": { "marked": "https://cdn.jsdelivr.net/npm/marked@1.0.0/x.js" },
  "integrity": { "https://cdn.jsdelivr.net/npm/marked@1.0.0/x.js": "sha384-old" }
}
</script>
<link rel="modulepreload" href="https://cdn.jsdelivr.net/npm/marked@1.0.0/x.js" integrity="sha384-old" crossorigin="anonymous" />
`;
    const integrity = {
      "https://cdn.jsdelivr.net/npm/marked@1.0.0/x.js": "sha384-new",
      "https://cdn.jsdelivr.net/npm/extra@1.0.0/y.js": "sha384-extra",
    };
    const out = applyCdnIntegrity(html, integrity);
    const map = JSON.parse(
      out.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1],
    );
    assert.deepEqual(map.integrity, integrity);
    assert.match(out, /integrity="sha384-new"/);
    assert.doesNotMatch(out, /sha384-old/);
    // Injected import map must be compact JSON (no pretty-print whitespace).
    const mapBody = out.match(
      /<script type="importmap">([\s\S]*?)<\/script>/,
    )[1];
    assert.equal(mapBody, JSON.stringify(map));
  });
});

/**
 * @param {Record<string, Response>} [initial]
 */
function memoryCache(initial = {}) {
  const store = new Map(Object.entries(initial));
  /** @type {string[]} */
  const puts = [];
  return {
    puts,
    caches: {
      async match(key) {
        const id = typeof key === "string" ? key : key.url;
        return store.get(id) ?? null;
      },
      async open() {
        return {
          async put(key, value) {
            const id = typeof key === "string" ? key : key.url;
            puts.push(id);
            store.set(id, value);
          },
        };
      },
    },
  };
}

describe("pwa.mjs", () => {
  it("pins CDN precache URLs and icon names", () => {
    assert.ok(CDN_PRECACHE.length >= 6);
    assert.ok(
      CDN_PRECACHE.every((u) => {
        const url = new URL(u);
        return url.protocol === "https:" && url.hostname === "cdn.jsdelivr.net";
      }),
    );
    assert.deepEqual(ICON_FILES, [
      "assets/icon-192.png",
      "assets/icon-512.png",
    ]);
  });

  it("builds a standalone manifest with file handlers", () => {
    const m = JSON.parse(buildManifest());
    assert.equal(m.display, "standalone");
    assert.deepEqual(m.display_override, ["window-controls-overlay"]);
    assert.equal(m.start_url, "./?source=pwa");
    assert.equal(m.launch_handler.client_mode, "focus-existing");
    assert.ok(m.file_handlers[0].accept["text/markdown"].includes(".md"));
  });

  it("emits Biome-compatible compact arrays in the manifest text", () => {
    const text = buildManifest();
    // JSON.stringify(…, null, 2) expands these; Biome keeps them on one line.
    assert.match(text, /"display_override": \["window-controls-overlay"\],/);
    assert.match(
      text,
      /"text\/markdown": \["\.md", "\.markdown", "\.mdown", "\.mkd"\],/,
    );
    assert.match(text, /"text\/plain": \["\.txt"\],/);
    assert.match(text, /"text\/html": \["\.html", "\.htm"\]/);
    assert.doesNotMatch(text, /"display_override": \[\s*\n/);
  });

  it("embeds precache URLs and SKIP_WAITING in the SW template", () => {
    const sw = buildServiceWorker({
      precacheUrls: ["./", "./index.html"],
      version: "test123",
    });
    assert.match(sw, /md-editor-test123/);
    assert.match(sw, /SKIP_WAITING/);
    assert.match(sw, /\.\/index\.html/);
    assert.match(sw, /isMutableShell/);
    assert.match(sw, /cache: "no-cache"/);
  });

  it("treats only unhashed shell paths as mutable", () => {
    assert.equal(isMutableShellPath("/index.html"), true);
    // Auth helper directory is network-only (not a mutable SW shell).
    assert.equal(isMutableShellPath("/drive-helper/"), false);
    assert.equal(isMutableShellPath("/drive-helper/index.html"), false);
    assert.equal(isMutableShellPath("/url-fetch-helper/"), false);
    assert.equal(isMutableShellPath("/url-fetch-helper/index.html"), false);
    assert.equal(isMutableShellPath("/google-drive-config.json"), true);
    assert.equal(isMutableShellPath("/github-gist-config.json"), true);
    assert.equal(isMutableShellPath("/"), true);
    assert.equal(isMutableShellPath("/manifest.webmanifest"), true);
    assert.equal(isMutableShellPath("/sw.js"), true);
    assert.equal(isMutableShellPath("/GUIDE.md"), true);
    assert.equal(isMutableShellPath("/sw.abc12345.js"), false);
    assert.equal(isMutableShellPath("/GUIDE.abc12345.md"), false);
    assert.equal(isMutableShellPath("/app.abc12345.js"), false);
  });

  it("bypasses the service worker for drive-helper/", () => {
    const sw = buildServiceWorker({
      precacheUrls: ["./", "./index.html", "./privacy.html"],
      version: "test123",
    });
    assert.match(sw, /function isIsolatedHelperPath/);
    assert.match(sw, /if \(isIsolatedHelperPath\(url\.pathname\)\) return;/);
    assert.match(sw, /url-fetch-helper/);
    assert.ok(!DEV_PRECACHE.includes("./drive-helper.html"));
    assert.ok(!DEV_PRECACHE.includes("./drive-helper/"));
    assert.ok(!DEV_PRECACHE.includes("./url-fetch-helper/"));
    assert.equal(isDriveHelperPath("/drive-helper"), true);
    assert.equal(isDriveHelperPath("/drive-helper/"), true);
    assert.equal(isDriveHelperPath("/drive-helper/index.html"), true);
    assert.equal(isDriveHelperPath("/markdown/drive-helper/"), true);
    assert.equal(isUrlFetchHelperPath("/url-fetch-helper/"), true);
    assert.equal(isUrlFetchHelperPath("/url-fetch-helper/index.html"), true);
    assert.equal(isIsolatedHelperPath("/url-fetch-helper/"), true);
    assert.equal(isDriveHelperPath("/index.html"), false);
    assert.match(sw, /function isMermaidSandboxNavigation/);
    assert.match(sw, /if \(isMermaidSandboxNavigation\(url\.pathname\)\)/);
    assert.match(sw, /respondMermaidNavigation\(request, CACHE\)/);
    assert.match(sw, /\.\/mermaid-sandbox\//);
    assert.ok(DEV_PRECACHE.includes("./mermaid-sandbox/"));
    assert.ok(DEV_PRECACHE.includes("./mermaid-sandbox/index.html"));
    assert.equal(isMermaidSandboxPath("/mermaid-sandbox/"), true);
    assert.equal(isMermaidSandboxPath("/mermaid-sandbox/index.html"), true);
    assert.equal(isIsolatedHelperPath("/markdown/mermaid-sandbox/"), false);
    assert.equal(isMutableShellPath("/mermaid-sandbox/index.html"), true);
    assert.equal(isMermaidSandboxPath("/mermaid-sandbox/runtime.js"), false);
    assert.equal(
      isMermaidSandboxPath("/mermaid-sandbox/index.a1b2c3d4.html"),
      true,
    );
    assert.equal(
      isMermaidSandboxPath("/mermaid-sandbox/index.notahash.html"),
      false,
    );
  });

  it("still finds the sandbox cache when an earlier match throws", async () => {
    const sandbox = new Response("sandbox-doc", { status: 200 });
    const request = new Request("https://app.test/mermaid-sandbox/");
    const { caches } = memoryCache({
      [request.url]: sandbox,
    });
    const match = caches.match.bind(caches);
    caches.match = async (key, options) => {
      if (key !== request.url) throw new TypeError("navigate");
      return match(key, options);
    };
    const response = await respondMermaidNavigation(request, "md-editor-test", {
      onLine: false,
      caches,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(await response.text(), "sandbox-doc");
  });

  it("serves the precached mermaid sandbox when the worker is offline", async () => {
    const sandbox = new Response("sandbox-doc", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const appShell = new Response("app-shell", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const { caches, puts } = memoryCache({
      "https://app.test/mermaid-sandbox/": sandbox,
      "./index.html": appShell,
    });
    let fetches = 0;
    const request = new Request("https://app.test/mermaid-sandbox/");
    const response = await respondMermaidNavigation(request, "md-editor-test", {
      onLine: false,
      caches,
      fetch: async () => {
        fetches += 1;
        throw new Error("offline");
      },
    });
    assert.equal(fetches, 0);
    assert.equal(puts.length, 0);
    assert.equal(await response.text(), "sandbox-doc");
  });

  it("does not store a sandbox navigation on the app shell cache key", async () => {
    const { caches, puts } = memoryCache();
    const request = new Request("https://app.test/mermaid-sandbox/");
    const response = await respondMermaidNavigation(request, "md-editor-test", {
      onLine: true,
      caches,
      fetch: async () =>
        new Response("fresh-sandbox", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    assert.equal(await response.text(), "fresh-sandbox");
    assert.deepEqual(puts, ["https://app.test/mermaid-sandbox/"]);
  });

  it("uses the precached sandbox when the offline fetch stalls", async () => {
    const sandbox = new Response("cached-sandbox", { status: 200 });
    const { caches } = memoryCache({
      "./mermaid-sandbox/": sandbox,
    });
    const request = new Request("https://app.test/mermaid-sandbox/index.html");
    const response = await respondMermaidNavigation(request, "md-editor-test", {
      onLine: true,
      timeoutMs: 20,
      caches,
      // Offline emulation can leave fetch pending and ignore AbortSignal.
      fetch: () => new Promise(() => {}),
    });
    assert.equal(await response.text(), "cached-sandbox");
  });

  it("versions precache lists deterministically", () => {
    assert.equal(precacheVersion(["a", "b"]), precacheVersion(["a", "b"]));
    assert.notEqual(precacheVersion(["a", "b"]), precacheVersion(["b", "a"]));
    assert.equal(precacheVersion(["a"]).length, 8);
  });

  it("builds a stable dev service worker from DEV_PRECACHE", () => {
    assert.ok(DEV_PRECACHE.includes("./app/app.js"));
    assert.ok(
      DEV_PRECACHE.includes("./app/state.js") ||
        DEV_PRECACHE.includes("./app/hooks.js"),
    );
    assert.ok(DEV_PRECACHE.includes("./styles/styles.css"));
    assert.ok(DEV_PRECACHE.includes("./styles/privacy.css"));
    for (const url of CDN_PRECACHE) {
      assert.ok(DEV_PRECACHE.includes(url));
    }
    const a = buildDevServiceWorker();
    const b = buildDevServiceWorker();
    assert.equal(a, b);
    assert.match(a, /md-editor-dev-[0-9a-f]{8}/);
    assert.match(a, /PRECACHE/);
    assert.match(a, /\.\/app\/app\.js/);
    // Must not embed hashed dist asset names.
    assert.doesNotMatch(a, /\.\/app\.[0-9a-f]{8}\.js/);
  });
});

describe("sync-guide.mjs", () => {
  it("points at the repo GUIDE.md", () => {
    assert.ok(guideSourcePath().endsWith("GUIDE.md"));
    assert.ok(path.isAbsolute(guideSourcePath()));
  });

  it("copies the guide with an optional content hash", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "guide-"));
    const plain = await copyGuideTo(tmp, { hash: false });
    assert.equal(plain.name, "GUIDE.md");
    assert.equal(plain.hash, null);
    const hashed = await copyGuideTo(tmp, { hash: true });
    assert.match(hashed.name, /^GUIDE\.[a-f0-9]{8}\.md$/);
    assert.equal(hashed.hash.length, 8);
  });
});

describe("serve-utils", () => {
  it("blocks path traversal and maps / to index.html", () => {
    const root = "/tmp/test-root";
    assert.equal(safeResolve("/", root), path.join(root, "index.html"));
    assert.equal(
      safeResolve("/styles.css", root),
      path.join(root, "styles.css"),
    );
    assert.equal(safeResolve("/../secret", root), null);
    assert.equal(safeResolve("/foo/../../etc/passwd", root), null);
    assert.equal(safeResolve("/%2e%2e/secret", root), null);
    assert.equal(safeResolve("/foo?bar=1", root), path.join(root, "foo"));
    assert.equal(safeResolve("/index.html%00.md", root), null);
    assert.equal(safeResolve("/%00", root), null);
    assert.equal(safeResolve("/app.js%00.html", root), null);
    assert.equal(safeResolve("/%zz", root), null);
    assert.equal(isInsideRoot(path.join(root, "a.css"), root), true);
    assert.equal(isInsideRoot(path.join(root, "..", "secret"), root), false);
  });

  it("sets cache and CORP headers by asset type", () => {
    const html = headersFor("/index.html", null, {
      htmlHeaders: {
        "Cache-Control": "no-cache",
        "X-Frame-Options": "DENY",
        Link: "<./GUIDE.md>;rel=prefetch",
      },
    });
    assert.equal(html["Cache-Control"], "no-cache");
    assert.equal(html["X-Frame-Options"], "DENY");
    assert.equal(html.Link, "<./GUIDE.md>;rel=prefetch");
    assert.equal(html["Content-Encoding"], undefined);

    const br = headersFor("/index.html", "br", {
      htmlHeaders: { "Cache-Control": "no-cache" },
    });
    assert.equal(br["Content-Encoding"], "br");

    assert.equal(headersFor("/sw.js", null)["Cache-Control"], "no-cache");
    assert.equal(
      headersFor("/app.abc12345.js", null)["Cache-Control"],
      "public, max-age=31536000, immutable",
    );
    assert.equal(headersFor("/app.js", null)["Cache-Control"], "no-cache");
    assert.equal(
      headersFor("/markdown-utils.js", null)["Cache-Control"],
      "no-cache",
    );
    assert.equal(headersFor("/styles.css", null)["Cache-Control"], "no-cache");
    assert.equal(
      headersFor("/styles.abc12345.css", null)["Cache-Control"],
      "public, max-age=31536000, immutable",
    );
    assert.equal(
      headersFor("/og-image.abc.png", null)["Cross-Origin-Resource-Policy"],
      "cross-origin",
    );
    assert.equal(
      headersFor("/styles.css", null)["Cross-Origin-Resource-Policy"],
      "same-origin",
    );
  });

  it("prefers brotli then gzip when present", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "comp-"));
    const file = path.join(tmp, "index.html");
    await fs.writeFile(file, "hi");
    await fs.writeFile(`${file}.br`, "br");
    await fs.writeFile(`${file}.gz`, "gz");
    const exists = async (p) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    };
    assert.deepEqual(await resolveWithCompression(file, "br, gzip", exists), {
      path: `${file}.br`,
      encoding: "br",
    });
    assert.deepEqual(await resolveWithCompression(file, "gzip", exists), {
      path: `${file}.gz`,
      encoding: "gzip",
    });
    assert.deepEqual(await resolveWithCompression(file, "", exists), {
      path: file,
      encoding: null,
    });
  });

  it("builds strong ETags and answers conditional GET for 304", () => {
    const body = Buffer.from("service-worker");
    const etag = strongEtag(body);
    const etagBr = strongEtag(body, "br");
    assert.match(etag, /^"[a-f0-9]{16}"$/);
    assert.match(etagBr, /^"[a-f0-9]{16}-br"$/);
    assert.notEqual(etag, etagBr);

    const lastModifiedMs = Date.parse("Wed, 01 Jan 2020 00:00:00 GMT") + 500;
    assert.equal(toHttpDate(lastModifiedMs), "Wed, 01 Jan 2020 00:00:00 GMT");
    assert.equal(
      isNotModified({ "if-none-match": etag }, { etag, lastModifiedMs }),
      true,
    );
    assert.equal(
      isNotModified({ "if-none-match": '"other"' }, { etag, lastModifiedMs }),
      false,
    );
    assert.equal(
      isNotModified(
        { "if-modified-since": "Wed, 01 Jan 2020 00:00:00 GMT" },
        { etag, lastModifiedMs },
      ),
      true,
    );
    assert.equal(
      isNotModified(
        {
          "if-none-match": '"other"',
          "if-modified-since": "Wed, 01 Jan 2020 00:00:00 GMT",
        },
        { etag, lastModifiedMs },
      ),
      false,
    );
  });
});
