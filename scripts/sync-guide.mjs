/**
 * Copy root GUIDE.md into a build/serve directory so the app can fetch it.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

export function guideSourcePath() {
  return path.join(root, "GUIDE.md");
}

function contentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 8);
}

/**
 * Copy GUIDE.md into `destDir`.
 * @param {string} destDir
 * @param {{ hash?: boolean }} [options] When hash is true, write GUIDE.<hash>.md
 */
export async function copyGuideTo(destDir, { hash = false } = {}) {
  const buffer = await readFile(guideSourcePath());
  const digest = hash ? contentHash(buffer) : null;
  const name = digest ? `GUIDE.${digest}.md` : "GUIDE.md";
  const outPath = path.join(destDir, name);
  await writeFile(outPath, buffer);
  return {
    bytes: buffer.length,
    name,
    hash: digest,
    outPath,
    url: `./${name}`,
  };
}

const isCli =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  const dest = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(root, "dist");
  const result = await copyGuideTo(dest, { hash: process.argv.includes("--hash") });
  console.log(`Copied GUIDE.md → ${path.relative(root, result.outPath)} (${result.bytes} bytes)`);
}
