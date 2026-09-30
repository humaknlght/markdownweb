#!/usr/bin/env node
/**
 * Local static server that mirrors public/.htaccess security headers
 * and serves precompressed .br / .gz assets when available.
 *
 * Uses HTTP/2 over TLS when Node's http2 module and a local TLS cert are
 * available (browsers require TLS for HTTP/2). Prefers a mkcert-issued,
 * locally-trusted certificate so service workers and the HTTP cache work;
 * falls back to a self-signed OpenSSL cert, then to plain HTTP/1.1.
 * HTTP/1.1 clients are still accepted on the TLS server via allowHTTP1.
 *
 * Usage:
 *   node scripts/serve.mjs [rootDir] [port]
 *   npm run preview   → dist on 3456
 *   npm run dev       → src on 3456
 */
import http from "node:http";
import http2 from "node:http2";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  inlineScriptHashes,
  buildScriptSrc,
  buildContentSecurityPolicy,
} from "./csp.mjs";
import { guideSourcePath } from "./sync-guide.mjs";
import {
  CORP,
  headersFor as buildHeaders,
  resolveWithCompression,
  safeResolve as resolveSafePath,
} from "./serve-utils.mjs";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(process.cwd(), process.argv[2] || "dist");
const port = Number(process.argv[3] || process.env.PORT || 3456);

async function resolveCspConfig() {
  try {
    const raw = await fs.readFile(path.join(rootDir, "csp.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.scriptSrc) {
      return {
        scriptSrc: parsed.scriptSrc,
        guideUrl: typeof parsed.guideUrl === "string" ? parsed.guideUrl : "./GUIDE.md",
      };
    }
  } catch {
    /* fall through — compute from index.html (dev / src) */
  }

  const html = await fs.readFile(path.join(rootDir, "index.html"), "utf8");
  const hashes = inlineScriptHashes(html);
  if (!hashes.length) {
    throw new Error(`No inline scripts found in ${path.join(rootDir, "index.html")}`);
  }
  return { scriptSrc: buildScriptSrc(hashes), guideUrl: "./GUIDE.md" };
}

const { scriptSrc, guideUrl } = await resolveCspConfig();
const contentSecurityPolicy = buildContentSecurityPolicy(scriptSrc);

const HTML_HEADERS = {
  "Cache-Control": "no-cache",
  "Permissions-Policy":
    "accelerometer=(), ambient-light-sensor=(), autoplay=(self), camera=(), display-capture=(), encrypted-media=(), execution-while-not-rendered=(), execution-while-out-of-viewport=(), fullscreen=(self), gamepad=(), geolocation=(), gyroscope=(), hid=(), identity-credentials-get=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), otp-credentials=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), speaker-selection=(), storage-access=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=(), interest-cohort=(), writer=(self), rewriter=(self), proofreader=(self)",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": contentSecurityPolicy,
  Link: `<${guideUrl}>;rel=prefetch`,
  "X-Frame-Options": "DENY",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function headersFor(logicalPath, encoding) {
  return buildHeaders(logicalPath, encoding, { htmlHeaders: HTML_HEADERS });
}

function safeResolve(urlPath) {
  return resolveSafePath(urlPath, rootDir);
}

/** When serving src/, GUIDE.md lives at the repo root — fall back to it. */
async function resolveGuide(logicalPath) {
  if (path.basename(logicalPath) !== "GUIDE.md") return logicalPath;
  if (await exists(logicalPath)) return logicalPath;
  const rootGuide = guideSourcePath();
  if (await exists(rootGuide)) return rootGuide;
  return logicalPath;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer a mkcert-issued cert (locally trusted → SW + HTTP cache work).
 * Fall back to an OpenSSL self-signed cert when mkcert is unavailable.
 */
async function ensureLocalTls() {
  const dir = path.join(os.tmpdir(), "markdown-preview-certs");
  await fs.mkdir(dir, { recursive: true });

  const mkcertKey = path.join(dir, "localhost-key.pem");
  const mkcertCert = path.join(dir, "localhost.pem");
  const mkcertMarker = path.join(dir, "issuer.txt");

  const mkcertBin = await resolveMkcert();
  if (mkcertBin) {
    const issuer = await readTextIfExists(mkcertMarker);
    const needMkcert =
      issuer !== "mkcert" ||
      !(await exists(mkcertKey)) ||
      !(await exists(mkcertCert));

    if (needMkcert) {
      // Idempotent when the local CA is already installed.
      try {
        await execFileAsync(mkcertBin, ["-install"]);
      } catch (err) {
        console.warn(
          `mkcert -install failed (${err.message || err}); cert may still work if the CA was installed earlier`,
        );
      }
      await execFileAsync(mkcertBin, [
        "-key-file",
        mkcertKey,
        "-cert-file",
        mkcertCert,
        "localhost",
        "127.0.0.1",
        "::1",
      ]);
      await fs.writeFile(mkcertMarker, "mkcert\n");
    }

    return {
      key: await fs.readFile(mkcertKey),
      cert: await fs.readFile(mkcertCert),
      trusted: true,
    };
  }

  // Legacy OpenSSL fallback (browsers will warn; SW registration / HTTP cache suffer).
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  if (!(await exists(keyPath)) || !(await exists(certPath))) {
    await execFileAsync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "3650",
      "-nodes",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ]);
    await fs.writeFile(mkcertMarker, "openssl\n");
  }

  return {
    key: await fs.readFile(keyPath),
    cert: await fs.readFile(certPath),
    trusted: false,
  };
}

async function resolveMkcert() {
  try {
    const { stdout } = await execFileAsync("which", ["mkcert"]);
    const bin = stdout.trim();
    return bin || null;
  } catch {
    return null;
  }
}

async function readTextIfExists(filePath) {
  try {
    return (await fs.readFile(filePath, "utf8")).trim();
  } catch {
    return null;
  }
}

async function handleRequest(req, res) {
  try {
    let logicalPath = safeResolve(req.url || "/");
    if (!logicalPath) {
      res.writeHead(403, { "Cross-Origin-Resource-Policy": CORP });
      res.end("Forbidden");
      return;
    }

    try {
      const st = await fs.stat(logicalPath);
      if (st.isDirectory()) {
        logicalPath = path.join(logicalPath, "index.html");
      }
    } catch (err) {
      if (err.code === "ENOENT") {
        logicalPath = await resolveGuide(logicalPath);
        if (!(await exists(logicalPath))) {
          res.writeHead(404, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cross-Origin-Resource-Policy": CORP,
          });
          res.end("Not Found");
          return;
        }
      } else {
        throw err;
      }
    }

    // Prefer repo-root GUIDE.md when src/ has no copy yet.
    if (path.basename(logicalPath) === "GUIDE.md") {
      logicalPath = await resolveGuide(logicalPath);
    }

    const chosen = await resolveWithCompression(
      logicalPath,
      req.headers["accept-encoding"],
      exists,
    );
    const data = await fs.readFile(chosen.path);
    res.writeHead(200, headersFor(logicalPath, chosen.encoding));
    res.end(data);
  } catch (err) {
    console.error(err);
    res.writeHead(500, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cross-Origin-Resource-Policy": CORP,
    });
    res.end("Internal Server Error");
  }
}

async function createServer() {
  if (typeof http2.createSecureServer === "function") {
    try {
      const tls = await ensureLocalTls();
      const server = http2.createSecureServer(
        { key: tls.key, cert: tls.cert, allowHTTP1: true },
        handleRequest,
      );
      return { server, protocol: "https", http2: true, tlsTrusted: tls.trusted };
    } catch (err) {
      console.warn(
        `HTTP/2 unavailable (${err.message || err}); falling back to HTTP/1.1`,
      );
    }
  }

  return {
    server: http.createServer(handleRequest),
    protocol: "http",
    http2: false,
    tlsTrusted: false,
  };
}

const { server, protocol, http2: usingHttp2, tlsTrusted } = await createServer();

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${rootDir}`);
  console.log(`  ${protocol}://127.0.0.1:${port}/`);
  if (usingHttp2) {
    if (tlsTrusted) {
      console.log("  HTTP/2 + locally-trusted TLS (mkcert)");
    } else {
      console.log(
        "  HTTP/2 + self-signed TLS (install mkcert for a trusted cert: brew install mkcert && mkcert -install)",
      );
    }
  } else {
    console.log("  HTTP/1.1");
  }
  console.log(`  CSP script-src: ${scriptSrc}`);
});
