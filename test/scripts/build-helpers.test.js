import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildContentSecurityPolicy,
  buildScriptSrc,
  extractInlineScripts,
  inlineScriptHashes,
  sha256Base64,
} from "../../scripts/csp.mjs";
import {
  CDN_PRECACHE,
  ICON_FILES,
  buildManifest,
  buildServiceWorker,
  hashServiceWorkerName,
  isMutableShellPath,
  precacheVersion,
} from "../../scripts/pwa.mjs";
import { applyCdnIntegrity } from "../../scripts/cdn-integrity.mjs";
import { copyGuideTo, guideSourcePath } from "../../scripts/sync-guide.mjs";
import {
  headersFor,
  resolveWithCompression,
  safeResolve,
} from "../../scripts/serve-utils.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("csp.mjs", () => {
  it("extracts inline scripts and ignores src scripts", () => {
    assert.deepEqual(extractInlineScripts('<script>alert(1)</script>'), ["alert(1)"]);
    assert.deepEqual(extractInlineScripts('<script src="a.js"></script>'), []);
    assert.deepEqual(extractInlineScripts('<script type="module">x</script>'), ["x"]);
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
    assert.ok(CDN_PRECACHE.every((u) => u.startsWith("https://cdn.jsdelivr.net")));
    assert.deepEqual(ICON_FILES, ["icon-192.png", "icon-512.png"]);
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
    assert.match(sw, /md-preview-test123/);
    assert.match(sw, /SKIP_WAITING/);
    assert.match(sw, /\.\/index\.html/);
    assert.match(sw, /isMutableShell/);
    assert.match(sw, /cache: "no-cache"/);
    assert.equal(hashServiceWorkerName(sw), hashServiceWorkerName(sw));
    assert.match(hashServiceWorkerName(sw), /^sw\.[a-f0-9]{8}\.js$/);
  });

  it("treats only unhashed shell paths as mutable", () => {
    assert.equal(isMutableShellPath("/index.html"), true);
    assert.equal(isMutableShellPath("/"), true);
    assert.equal(isMutableShellPath("/manifest.webmanifest"), true);
    assert.equal(isMutableShellPath("/sw.js"), true);
    assert.equal(isMutableShellPath("/GUIDE.md"), true);
    assert.equal(isMutableShellPath("/sw.abc12345.js"), false);
    assert.equal(isMutableShellPath("/GUIDE.abc12345.md"), false);
    assert.equal(isMutableShellPath("/app.abc12345.js"), false);
  });

  it("versions precache lists deterministically", () => {
    assert.equal(precacheVersion(["a", "b"]), precacheVersion(["a", "b"]));
    assert.notEqual(precacheVersion(["a", "b"]), precacheVersion(["b", "a"]));
    assert.equal(precacheVersion(["a"]).length, 8);
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
    assert.equal(safeResolve("/foo?bar=1", root), path.join(root, "foo"));
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
      headersFor("/sw.abc12345.js", null)["Cache-Control"],
      "public, max-age=31536000, immutable",
    );
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
});
