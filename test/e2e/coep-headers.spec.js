import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import {
  acceptEncodingsFor,
  collectHtmlUrls,
  expectedCoep,
  startDistApache,
} from "./apache-dist-server.js";

const distDir = path.resolve(process.cwd(), "dist");

test.describe("production Apache COEP", () => {
  test("every HTML document sends the embedder policy the app page requires", async () => {
    test.setTimeout(120_000);
    await fs.access(path.join(distDir, ".htaccess"));

    const urls = await collectHtmlUrls(distDir);
    expect(
      urls.length,
      "dist has no HTML documents; run npm run build",
    ).toBeGreaterThan(0);
    expect(urls, "directory index URLs are what iframes request").toContain(
      "/mermaid-sandbox/",
    );

    const server = await startDistApache(distDir);
    /** @type {string[]} */
    const failures = [];
    try {
      for (const urlPath of urls) {
        const encodings = await acceptEncodingsFor(distDir, urlPath);
        for (const encoding of encodings) {
          const response = await fetch(`${server.origin}${urlPath}`, {
            headers: { "Accept-Encoding": encoding },
            redirect: "manual",
          });
          const coep = response.headers.get("cross-origin-embedder-policy");
          const expected = expectedCoep(urlPath);
          if (response.status !== 200 || coep !== expected) {
            failures.push(
              `${urlPath} [${encoding}] status=${response.status} coep=${coep ?? "(missing)"} expected=${expected}`,
            );
          }
        }
      }
    } finally {
      await server.stop();
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });
});
