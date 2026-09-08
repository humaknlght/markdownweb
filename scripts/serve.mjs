#!/usr/bin/env node
/**
 * Local static server that mirrors public/.htaccess security headers
 * and serves precompressed .br / .gz assets when available.
 *
 * Usage:
 *   node scripts/serve.mjs [rootDir] [port]
 *   npm run preview   → dist on 3456
 *   npm run dev       → src on 3456
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inlineScriptHashes,
  buildScriptSrc,
  buildContentSecurityPolicy,
} from "./csp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(process.cwd(), process.argv[2] || "dist");
const port = Number(process.argv[3] || process.env.PORT || 3456);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
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
    "accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), execution-while-not-rendered=(), execution-while-out-of-viewport=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), identity-credentials-get=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), otp-credentials=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), speaker-selection=(), storage-access=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": contentSecurityPolicy,
  "X-Frame-Options": "DENY",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function headersFor(logicalPath, encoding) {
  const ext = path.extname(logicalPath).toLowerCase();
  const headers = {
    "Cross-Origin-Resource-Policy": CORP,
    "Content-Type": MIME[ext] || "application/octet-stream",
    Vary: "Accept-Encoding",
  };

  if (encoding) {
    headers["Content-Encoding"] = encoding;
  }

  if (ext === ".html") {
    Object.assign(headers, HTML_HEADERS);
  } else if (ext === ".css" || ext === ".js" || ext === ".mjs") {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else if (ext === ".jpg" || ext === ".jpeg") {
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

const server = http.createServer(async (req, res) => {
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
        res.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cross-Origin-Resource-Policy": CORP,
        });
        res.end("Not Found");
        return;
      }
      throw err;
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
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${rootDir}`);
  console.log(`  http://127.0.0.1:${port}/`);
  console.log(`  CSP script-src: ${scriptSrc}`);
});
