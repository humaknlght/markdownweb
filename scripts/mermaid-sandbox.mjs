import { readFile } from "node:fs/promises";
import path from "node:path";

export const MERMAID_SANDBOX_DIR = "mermaid-sandbox";

const BOOTSTRAP_TAG_RE = /<script src="\.\/bootstrap\.js"><\/script>/;
const RUNTIME_PLACEHOLDER = '"__MERMAID_RUNTIME_PLACEHOLDER__"';

/**
 * Inline bootstrap.js as a classic script, embedding runtime.js as a string
 * constant so the opaque frame can install it as a blob: module after the
 * parent-fed import map is registered (import maps must precede any module).
 * @param {string} html
 * @param {string} bootstrap
 * @param {string} runtime
 */
export function inlineMermaidSandboxBootstrap(html, bootstrap, runtime) {
  if (!BOOTSTRAP_TAG_RE.test(html)) {
    throw new Error(
      "mermaid-sandbox/index.html is missing the bootstrap.js script tag",
    );
  }
  if (!bootstrap.includes(RUNTIME_PLACEHOLDER)) {
    throw new Error(
      "mermaid-sandbox/bootstrap.js is missing the runtime placeholder",
    );
  }
  if (/<\/script/i.test(bootstrap) || /<\/script/i.test(runtime)) {
    throw new Error(
      "mermaid-sandbox scripts must not contain a </script sequence",
    );
  }
  const boot = bootstrap.replaceAll(RUNTIME_PLACEHOLDER, () =>
    JSON.stringify(runtime),
  );
  return html.replace(BOOTSTRAP_TAG_RE, () => `<script>\n${boot}</script>`);
}

/**
 * Sandbox page with bootstrap + embedded runtime inlined for CSP hashing.
 * @param {string} srcDir
 * @param {Record<string, string>} [_integrity] unused (modules are parent-fed)
 */
export async function renderMermaidSandboxHtml(srcDir, _integrity) {
  const dir = path.join(srcDir, MERMAID_SANDBOX_DIR);
  const [html, bootstrap, runtime] = await Promise.all([
    readFile(path.join(dir, "index.html"), "utf8"),
    readFile(path.join(dir, "bootstrap.js"), "utf8"),
    readFile(path.join(dir, "runtime.js"), "utf8"),
  ]);
  return inlineMermaidSandboxBootstrap(html, bootstrap, runtime);
}
