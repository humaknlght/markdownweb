import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Binary and the module directory built for that same Apache. */
const HTTPD_PAIRS = [
  ["/usr/sbin/httpd", "/usr/libexec/apache2"],
  ["/usr/sbin/apache2", "/usr/lib/apache2/modules"],
  [
    "/opt/homebrew/opt/httpd/bin/httpd",
    "/opt/homebrew/opt/httpd/lib/httpd/modules",
  ],
  ["/usr/local/opt/httpd/bin/httpd", "/usr/local/opt/httpd/lib/httpd/modules"],
];

const MODULES = [
  ["mpm_prefork_module", "mod_mpm_prefork.so"],
  ["mpm_event_module", "mod_mpm_event.so"],
  ["authn_core_module", "mod_authn_core.so"],
  ["authz_core_module", "mod_authz_core.so"],
  ["authz_host_module", "mod_authz_host.so"],
  ["unixd_module", "mod_unixd.so"],
  ["log_config_module", "mod_log_config.so"],
  ["dir_module", "mod_dir.so"],
  ["mime_module", "mod_mime.so"],
  ["rewrite_module", "mod_rewrite.so"],
  ["headers_module", "mod_headers.so"],
  ["setenvif_module", "mod_setenvif.so"],
  ["alias_module", "mod_alias.so"],
];

/**
 * COEP the production app requires on an HTML document.
 * The Drive helper is a top-level popup and must not use require-corp.
 * Every other HTML file, including ones added later, is embeddable under the
 * app's require-corp page and must send the same policy.
 * @param {string} urlPath
 */
export function expectedCoep(urlPath) {
  const [first] = urlPath.split("/").filter(Boolean);
  if (first === "drive-helper") return "unsafe-none";
  return "require-corp";
}

/**
 * Every HTML document in dist, plus the directory URL for each index.html.
 * Directory URLs are what production iframes request (`/mermaid-sandbox/`).
 * @param {string} distDir
 * @returns {Promise<string[]>}
 */
export async function collectHtmlUrls(distDir) {
  /** @type {Set<string>} */
  const urls = new Set();

  /**
   * @param {string} dir
   * @param {string} rel
   */
  async function walk(dir, rel) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const child = path.join(dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(child, childRel);
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;
      if (entry.name.endsWith(".html.br") || entry.name.endsWith(".html.gz")) {
        continue;
      }
      const fileUrl = `/${childRel.split(path.sep).join("/")}`;
      urls.add(fileUrl);
      if (entry.name === "index.html") {
        const dirRel = rel.split(path.sep).join("/");
        urls.add(dirRel ? `/${dirRel}/` : "/");
      }
    }
  }

  await walk(distDir, "");
  return [...urls].sort();
}

/**
 * @param {string} distDir
 * @param {string} urlPath
 * @returns {Promise<string[]>}
 */
export async function acceptEncodingsFor(distDir, urlPath) {
  const rel = urlPath.endsWith("/")
    ? path.join(urlPath.slice(1), "index.html")
    : urlPath.slice(1);
  const file = path.join(distDir, rel);
  /** @type {string[]} */
  const encodings = ["identity"];
  try {
    await fs.access(`${file}.br`);
    encodings.push("br");
  } catch {
    /* uncompressed only */
  }
  return encodings;
}

/**
 * @param {string} distDir
 */
export async function startDistApache(distDir) {
  distDir = path.resolve(distDir);
  const httpd = await findHttpd();
  const port = await freePort();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "md-apache-"));
  const errorLog = path.join(tmp, "error.log");
  const confPath = path.join(tmp, "httpd.conf");
  const conf = await renderConfig({ distDir, port, tmp, errorLog, httpd });
  await fs.writeFile(confPath, conf);

  const child = spawn(httpd.bin, ["-f", confPath, "-D", "FOREGROUND"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    await waitUntilReady(port, child, errorLog);
  } catch (err) {
    child.kill("SIGTERM");
    const logged = await fs.readFile(errorLog, "utf8").catch(() => "");
    throw new Error(`${err.message}\n${logged}\n${stderr}`, { cause: err });
  }

  return {
    origin: `http://127.0.0.1:${port}`,
    async stop() {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 2000);
      });
      await fs.rm(tmp, { recursive: true, force: true });
    },
  };
}

/**
 * @param {{ distDir: string, port: number, tmp: string, errorLog: string, httpd: { bin: string, moduleDir: string } }} opts
 */
async function renderConfig(opts) {
  const { stdout } = await execFileAsync(opts.httpd.bin, ["-l"]);
  const compiled = new Set(
    [...stdout.matchAll(/(\w+_module)/g)].map((m) => m[1]),
  );
  const moduleDir = opts.httpd.moduleDir;
  const loads = [];
  let mpmLoaded =
    compiled.has("mpm_prefork_module") ||
    compiled.has("mpm_event_module") ||
    compiled.has("mpm_worker_module");
  for (const [name, file] of MODULES) {
    if (compiled.has(name)) continue;
    if (name.startsWith("mpm_")) {
      if (mpmLoaded) continue;
      const so = path.join(moduleDir, file);
      try {
        await fs.access(so);
      } catch {
        continue;
      }
      loads.push(`LoadModule ${name} "${so}"`);
      mpmLoaded = true;
      continue;
    }
    const so = path.join(moduleDir, file);
    try {
      await fs.access(so);
    } catch {
      continue;
    }
    loads.push(`LoadModule ${name} "${so}"`);
  }
  if (!mpmLoaded) {
    throw new Error(
      `No MPM module for ${opts.httpd.bin}. Install Apache (httpd or apache2).`,
    );
  }

  const mime = [
    "/etc/apache2/mime.types",
    "/private/etc/apache2/mime.types",
    "/etc/httpd/mime.types",
  ];
  let typesConfig = "";
  for (const candidate of mime) {
    try {
      await fs.access(candidate);
      typesConfig = `TypesConfig "${candidate}"`;
      break;
    } catch {
      /* try the next location */
    }
  }

  return `ServerName 127.0.0.1
Listen 127.0.0.1:${opts.port}
PidFile "${path.join(opts.tmp, "httpd.pid")}"
ErrorLog "${opts.errorLog}"
LogLevel warn
Mutex file:${opts.tmp}
${typesConfig}

${loads.join("\n")}

ServerRoot "${opts.tmp}"
DocumentRoot "${opts.distDir}"
DirectoryIndex index.html

<Directory "${opts.distDir}">
  AllowOverride All
  Require all granted
  Options FollowSymLinks
</Directory>
`;
}

async function findHttpd() {
  for (const [bin, moduleDir] of HTTPD_PAIRS) {
    try {
      await execFileAsync(bin, ["-v"]);
      await fs.access(path.join(moduleDir, "mod_headers.so"));
      return { bin, moduleDir };
    } catch {
      /* try the next Apache install */
    }
  }
  throw new Error(
    "Apache is required to check production COEP headers. Install httpd (macOS) or apache2 (Ubuntu).",
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * @param {number} port
 * @param {import("node:child_process").ChildProcess} child
 * @param {string} errorLog
 */
async function waitUntilReady(port, child, errorLog) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      const logged = await fs.readFile(errorLog, "utf8").catch(() => "");
      throw new Error(`Apache exited ${child.exitCode}\n${logged}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { "Accept-Encoding": "identity" },
        redirect: "manual",
      });
      if (
        response.status === 200 ||
        response.status === 301 ||
        response.status === 403
      ) {
        return;
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const logged = await fs.readFile(errorLog, "utf8").catch(() => "");
  throw new Error(`Apache did not listen on ${port}\n${logged}`);
}
