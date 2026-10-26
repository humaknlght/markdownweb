import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildContentSecurityPolicy,
  buildDriveHelperContentSecurityPolicy,
  buildDriveHelperScriptSrc,
  buildScriptSrc,
  extractInlineScripts,
  inlineScriptHashes,
  sha256Base64,
} from "../../scripts/csp.mjs";
import {
  CDN_PRECACHE,
  DEV_PRECACHE,
  ICON_FILES,
  buildDevServiceWorker,
  buildManifest,
  buildServiceWorker,
  isDriveHelperPath,
  isMutableShellPath,
  precacheVersion,
} from "../../scripts/pwa.mjs";
import { applyCdnIntegrity } from "../../scripts/cdn-integrity.mjs";
import { copyGuideTo, guideSourcePath } from "../../scripts/sync-guide.mjs";
import {
  headersFor,
  isInsideRoot,
  isNotModified,
  resolveWithCompression,
  safeResolve,
  strongEtag,
  toHttpDate,
} from "../../scripts/serve-utils.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("csp.mjs", () => {
  it("extracts inline scripts and ignores src scripts", () => {
    assert.deepEqual(extractInlineScripts('<script>alert(1)</script>'), ["alert(1)"]);
    assert.deepEqual(extractInlineScripts('<script src="a.js"></script>'), []);
    assert.deepEqual(extractInlineScripts('<script type="module">x</script>'), ["x"]);
    // HTML5-tolerated end tags (whitespace / junk before `>`).
    assert.deepEqual(extractInlineScripts("<script>y</script >"), ["y"]);
    assert.deepEqual(extractInlineScripts('<script>z</script foo="bar">'), ["z"]);
  });

  it("hashes SHA-256 in base64", () => {
    assert.equal(sha256Base64(""), "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
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
    const mapBody = out.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
    assert.equal(mapBody, JSON.stringify(map));
  });
});

describe("pwa.mjs", () => {
  it("pins CDN precache URLs and icon names", () => {
    assert.ok(CDN_PRECACHE.length >= 6);
    assert.ok(
      CDN_PRECACHE.every((u) => {
        const url = new URL(u);
        return url.protocol === "https:" && url.hostname === "cdn.jsdelivr.net";
      }),
    );
    assert.deepEqual(ICON_FILES, ["assets/icon-192.png", "assets/icon-512.png"]);
  });

  it("builds a standalone manifest with file handlers", () => {
    const m = JSON.parse(buildManifest());
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, "./?source=pwa");
    assert.equal(m.launch_handler.client_mode, "focus-existing");
    assert.ok(m.file_handlers[0].accept["text/markdown"].includes(".md"));
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
    assert.match(sw, /function isDriveHelperPath/);
    assert.match(sw, /if \(isDriveHelperPath\(url\.pathname\)\) return;/);
    assert.match(sw, /parts\.indexOf\("drive-helper"\)/);
    assert.ok(!DEV_PRECACHE.includes("./drive-helper.html"));
    assert.ok(!DEV_PRECACHE.includes("./drive-helper/"));
    assert.equal(isDriveHelperPath("/drive-helper"), true);
    assert.equal(isDriveHelperPath("/drive-helper/"), true);
    assert.equal(isDriveHelperPath("/drive-helper/index.html"), true);
    assert.equal(isDriveHelperPath("/markdown/drive-helper/"), true);
    assert.equal(isDriveHelperPath("/index.html"), false);
  });

  it("versions precache lists deterministically", () => {
    assert.equal(precacheVersion(["a", "b"]), precacheVersion(["a", "b"]));
    assert.notEqual(precacheVersion(["a", "b"]), precacheVersion(["b", "a"]));
    assert.equal(precacheVersion(["a"]).length, 8);
  });

  it("builds a stable dev service worker from DEV_PRECACHE", () => {
    assert.ok(DEV_PRECACHE.includes("./app/app.js"));
    assert.ok(DEV_PRECACHE.includes("./styles/styles.css"));
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
    assert.equal(safeResolve("/styles.css", root), path.join(root, "styles.css"));
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

    const br = headersFor("/index.html", "br", { htmlHeaders: { "Cache-Control": "no-cache" } });
    assert.equal(br["Content-Encoding"], "br");

    assert.equal(headersFor("/sw.js", null)["Cache-Control"], "no-cache");
    assert.equal(
      headersFor("/app.abc12345.js", null)["Cache-Control"],
      "public, max-age=31536000, immutable",
    );
    assert.equal(headersFor("/app.js", null)["Cache-Control"], "no-cache");
    assert.equal(headersFor("/markdown-utils.js", null)["Cache-Control"], "no-cache");
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
