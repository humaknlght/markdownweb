#!/usr/bin/env node
/**
 * Local static server that mirrors public/.htaccess security headers
 * and serves precompressed .br / .gz assets when available.
 *
 * Uses HTTP/2 over TLS when Node's http2 module and a local self-signed
 * cert are available (browsers require TLS for HTTP/2). Falls back to
 * plain HTTP/1.1 otherwise. HTTP/1.1 clients are still accepted on the
 * TLS server via allowHTTP1.
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

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(process.cwd(), process.argv[2] || "dist");
const port = Number(process.argv[3] || process.env.PORT || 3456);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const CORP = "same-origin";

async function resolveScriptSrc() {
  try {
    const raw = await fs.readFile(path.join(rootDir, "csp.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.scriptSrc) return parsed.scriptSrc;
  } catch {
    /* fall through — compute from index.html (dev / src) */
  }

  const html = await fs.readFile(path.join(rootDir, "index.html"), "utf8");
  const hashes = inlineScriptHashes(html);
  if (!hashes.length) {
    throw new Error(`No inline scripts found in ${path.join(rootDir, "index.html")}`);
  }
  return buildScriptSrc(hashes);
}

const scriptSrc = await resolveScriptSrc();
const contentSecurityPolicy = buildContentSecurityPolicy(scriptSrc);

const HTML_HEADERS = {
  "Cache-Control": "no-cache",
  "Permissions-Policy":
    "accelerometer=(), ambient-light-sensor=(), autoplay=(self), camera=(), display-capture=(), encrypted-media=(), execution-while-not-rendered=(), execution-while-out-of-viewport=(), fullscreen=(self), gamepad=(), geolocation=(), gyroscope=(), hid=(), identity-credentials-get=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), otp-credentials=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), speaker-selection=(), storage-access=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": contentSecurityPolicy,
  "X-Frame-Options": "DENY",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function headersFor(logicalPath, encoding) {
  const ext = path.extname(logicalPath).toLowerCase();
  const base = path.basename(logicalPath);
  const headers = {
    "Cross-Origin-Resource-Policy": CORP,
    "Content-Type": MIME[ext] || "application/octet-stream",
    Vary: "Accept-Encoding",
  };

  if (encoding) {
    headers["Content-Encoding"] = encoding;
  }

  if (
    /^og-image\.[a-f0-9]+\.png$/i.test(base) ||
    /^icon-(192|512|maskable-512)(\.[a-f0-9]+)?\.png$/i.test(base)
  ) {
    headers["Cross-Origin-Resource-Policy"] = "cross-origin";
  }

  if (ext === ".html") {
    Object.assign(headers, HTML_HEADERS);
  } else if (base === "sw.js" || ext === ".webmanifest" || base === "GUIDE.md") {
    headers["Cache-Control"] = "no-cache";
  } else if (/^GUIDE\.[a-f0-9]+\.md$/i.test(base)) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else if (ext === ".css" || ext === ".js" || ext === ".mjs") {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }

  return headers;
}

function safeResolve(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  let rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (rel.endsWith("/")) rel += "index.html";
  const full = path.resolve(rootDir, rel);
  if (!full.startsWith(rootDir + path.sep) && full !== rootDir) {
    return null;
  }
  return full;
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

async function resolveWithCompression(logicalPath, acceptEncoding) {
  const accept = (acceptEncoding || "").toLowerCase();
  const candidates = [];
  if (accept.includes("br")) candidates.push({ path: `${logicalPath}.br`, encoding: "br" });
  if (accept.includes("gzip") || accept.includes("deflate")) {
    candidates.push({ path: `${logicalPath}.gz`, encoding: "gzip" });
  }

  for (const candidate of candidates) {
    if (await exists(candidate.path)) {
      return candidate;
    }
  }

  return { path: logicalPath, encoding: null };
}

/**
 * Browsers only speak HTTP/2 over TLS. Cache a self-signed cert for
 * 127.0.0.1 / localhost in the OS temp dir so restarts stay quiet.
 */
async function ensureLocalTls() {
  const dir = path.join(os.tmpdir(), "markdown-preview-certs");
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");

  if (!(await exists(keyPath)) || !(await exists(certPath))) {
    await fs.mkdir(dir, { recursive: true });
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
  }

  return {
    key: await fs.readFile(keyPath),
    cert: await fs.readFile(certPath),
  };
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
      req.headers["accept-encoding"]
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
        { ...tls, allowHTTP1: true },
        handleRequest
      );
      return { server, protocol: "https", http2: true };
    } catch (err) {
      console.warn(
        `HTTP/2 unavailable (${err.message || err}); falling back to HTTP/1.1`
      );
    }
  }

  return {
    server: http.createServer(handleRequest),
    protocol: "http",
    http2: false,
  };
}

const { server, protocol, http2: usingHttp2 } = await createServer();

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${rootDir}`);
  console.log(`  ${protocol}://127.0.0.1:${port}/`);
  if (usingHttp2) {
    console.log("  HTTP/2 enabled (self-signed TLS; accept the browser warning once)");
  } else {
    console.log("  HTTP/1.1");
  }
  console.log(`  CSP script-src: ${scriptSrc}`);
});
