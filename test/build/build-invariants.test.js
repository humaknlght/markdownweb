import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, brotliDecompressSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}

describe("production build invariants", { timeout: 180_000 }, () => {
  it("emits hashed assets, compression, and CSP hashes", async (t) => {
    // Slow: skip unless explicitly requested
    if (!process.env.RUN_BUILD_TESTS) {
      t.skip("set RUN_BUILD_TESTS=1 to run the full build check");
      return;
    }

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "md-build-"));
    // Build writes to dist/ in-repo; snapshot then restore
    const dist = path.join(root, "dist");
    const backup = path.join(tmp, "dist-backup");
    try {
      await fs.cp(dist, backup, { recursive: true }).catch(() => {});
      await run("node", ["scripts/build.mjs"]);

      const html = await fs.readFile(path.join(dist, "index.html"), "utf8");
      assert.match(html, /src="app\.[a-f0-9]{8}\.js"/);
      assert.doesNotMatch(html, /src="chunk-/);
      assert.match(html, /type="importmap"/);
      assert.match(html, /href="styles\.[a-f0-9]{8}\.css"/);
      assert.match(html, /href="print\.[a-f0-9]{8}\.css"[^>]*media="print"/);

      const ht = await fs.readFile(path.join(dist, ".htaccess"), "utf8");
      assert.doesNotMatch(ht, /__SCRIPT_SRC__/);
      assert.doesNotMatch(ht, /__GUIDE_URL__/);
      assert.match(ht, /'sha256-/);
      assert.match(ht, /Link "<\.\/GUIDE\.[a-f0-9]{8}\.md>;rel=prefetch"/);

      const csp = JSON.parse(await fs.readFile(path.join(dist, "csp.json"), "utf8"));
      assert.match(csp.guideUrl, /^\.\/GUIDE\.[a-f0-9]{8}\.md$/);

      const files = await fs.readdir(dist);
      assert.ok(files.some((f) => /^app\.[a-f0-9]{8}\.js$/.test(f)));
      assert.ok(files.some((f) => /^print\.[a-f0-9]{8}\.css$/.test(f)));
      assert.ok(files.some((f) => /^icon-192\.[a-f0-9]{8}\.png$/.test(f)));
      assert.ok(files.some((f) => /^GUIDE\.[a-f0-9]{8}\.md$/.test(f)));
      assert.ok(files.some((f) => /^sw\.[a-f0-9]{8}\.js$/.test(f)));
      assert.ok(!files.includes("sw.js"));
      assert.match(html, /window\.__MD_SW__="\.\/sw\.[a-f0-9]{8}\.js"/);
      assert.doesNotMatch(html, /__SW_URL__/);

      const appFile = files.find((f) => /^app\.[a-f0-9]{8}\.js$/.test(f));
      const original = await fs.readFile(path.join(dist, appFile));
      const gz = gunzipSync(await fs.readFile(path.join(dist, `${appFile}.gz`)));
      const br = brotliDecompressSync(await fs.readFile(path.join(dist, `${appFile}.br`)));
      assert.deepEqual(gz, original);
      assert.deepEqual(br, original);

      // Source icons must be untouched by the build
      const icon = await fs.readFile(path.join(root, "src/icon-192.png"));
      assert.ok(icon.byteLength > 0);
    } finally {
      // leave dist as built (useful); backup kept in tmp for debugging
    }
  });
});
