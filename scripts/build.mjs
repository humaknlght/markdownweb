import * as esbuild from "esbuild";
import { minify as minifyHtml } from "html-minifier-terser";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { gzip as zopfliGzip } from "@gfx/zopfli";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inlineScriptHashes, buildScriptSrc } from "./csp.mjs";

const zopfliGzipAsync = promisify(zopfliGzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");

const COMPRESS_EXTENSIONS = new Set([".html", ".css", ".js"]);
const SCRIPT_SRC_PLACEHOLDER = "__SCRIPT_SRC__";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function contentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 8);
}

function hashedName(base, ext, hash) {
  return `${base}.${hash}${ext}`;
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function cleanDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

async function optimizeImage() {
  const input = path.join(srcDir, "fancy.jpg");
  const before = await fileSize(input);

  const buffer = await sharp(input)
    .rotate()
    .resize({
      width: 1920,
      height: 1280,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 78,
      mozjpeg: true,
      progressive: true,
    })
    .toBuffer();

  const hash = contentHash(buffer);
  const name = hashedName("fancy", ".jpg", hash);
  await writeFile(path.join(distDir, name), buffer);
  return { before, after: buffer.length, name, hash };
}

async function buildOgImage() {
  const input = path.join(srcDir, "og-image.png");
  const before = await fileSize(input);
  const buffer = await sharp(input)
    .resize({
      width: 1200,
      height: 630,
      fit: "cover",
      position: "centre",
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const hash = contentHash(buffer);
  const name = hashedName("og-image", ".png", hash);
  await writeFile(path.join(distDir, name), buffer);
  return { before, after: buffer.length, name, hash };
}

async function buildCss(fancyFileName) {
  let css = await readFile(path.join(srcDir, "styles.css"), "utf8");
  css = css.replaceAll("url(\"fancy.jpg\")", `url("${fancyFileName}")`);
  css = css.replaceAll("url('fancy.jpg')", `url('${fancyFileName}')`);
  css = css.replaceAll("url(fancy.jpg)", `url(${fancyFileName})`);

  const result = await esbuild.transform(css, {
    loader: "css",
    minify: true,
    target: ["es2020"],
  });

  const buffer = Buffer.from(result.code, "utf8");
  const hash = contentHash(buffer);
  const name = hashedName("styles", ".css", hash);
  await writeFile(path.join(distDir, name), buffer);
  return { bytes: buffer.length, name, hash };
}

async function buildJs() {
  const result = await esbuild.build({
    entryPoints: [path.join(srcDir, "app.js")],
    bundle: true,
    minify: true,
    format: "esm",
    target: ["es2020"],
    write: false,
    legalComments: "none",
    treeShaking: true,
    metafile: true,
    external: ["marked", "dompurify", "highlight.js"],
  });

  const output = result.outputFiles[0];
  const buffer = Buffer.from(output.contents);
  const hash = contentHash(buffer);
  const name = hashedName("app", ".js", hash);
  await writeFile(path.join(distDir, name), buffer);

  const bundledInputs = Object.keys(result.metafile?.inputs || {}).length;
  return { bytes: buffer.length, name, hash, chunks: [], bundledInputs };
}

async function buildHtml({ cssName, jsName, ogImageName }) {
  let html = await readFile(path.join(srcDir, "index.html"), "utf8");
  html = html.replace(/href="styles\.css"/, `href="${cssName}"`);
  html = html.replace(/src="app\.js"/, `src="${jsName}"`);
  html = html.replaceAll("og-image.png", ogImageName);

  const minified = await minifyHtml(html, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    decodeEntities: true,
    minifyCSS: true,
    minifyJS: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: false,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
  });

  const buffer = Buffer.from(minified, "utf8");
  await writeFile(path.join(distDir, "index.html"), buffer);

  const hashes = inlineScriptHashes(minified);
  if (!hashes.length) {
    throw new Error("Expected at least one inline script for CSP hashing");
  }

  return {
    bytes: buffer.length,
    scriptSrc: buildScriptSrc(hashes),
    hashes,
  };
}

async function precompressAssets() {
  const entries = await readdir(distDir);
  const results = [];

  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (!COMPRESS_EXTENSIONS.has(ext)) continue;

    const filePath = path.join(distDir, name);
    const source = await readFile(filePath);

    const gzipped = await zopfliGzipAsync(source, {
      numiterations: 15,
      blocksplitting: true,
    });
    await writeFile(`${filePath}.gz`, gzipped);

    const brotli = brotliCompressSync(source, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    });
    await writeFile(`${filePath}.br`, brotli);

    results.push({
      name,
      raw: source.length,
      gzip: gzipped.length,
      brotli: brotli.length,
    });
  }

  return results;
}

async function writeApacheConfig(scriptSrc) {
  let htaccess = await readFile(path.join(root, "public", ".htaccess"), "utf8");
  if (!htaccess.includes(SCRIPT_SRC_PLACEHOLDER)) {
    throw new Error(`public/.htaccess missing ${SCRIPT_SRC_PLACEHOLDER} placeholder`);
  }
  htaccess = htaccess.replaceAll(SCRIPT_SRC_PLACEHOLDER, scriptSrc);
  await writeFile(path.join(distDir, ".htaccess"), htaccess);
  await writeFile(
    path.join(distDir, "csp.json"),
    JSON.stringify({ scriptSrc }, null, 2) + "\n"
  );
}

async function main() {
  console.log("Building production assets → dist/\n");
  await cleanDist();

  const image = await optimizeImage();
  const ogImage = await buildOgImage();
  const css = await buildCss(image.name);
  const js = await buildJs();
  const html = await buildHtml({
    cssName: css.name,
    jsName: js.name,
    ogImageName: ogImage.name,
  });
  await writeApacheConfig(html.scriptSrc);
  const compressed = await precompressAssets();

  console.log("Assets (content-hashed for cache busting)");
  console.log(`  index.html     ${formatBytes(html.bytes)}`);
  console.log(`  ${css.name.padEnd(22)} ${formatBytes(css.bytes)}`);
  console.log(
    `  ${js.name.padEnd(22)} ${formatBytes(js.bytes)}  (${js.bundledInputs} modules bundled)`
  );
  for (const chunk of js.chunks || []) {
    console.log(`  ${chunk.name.padEnd(22)} ${formatBytes(chunk.bytes)}  (lazy chunk)`);
  }
  console.log(
    `  ${image.name.padEnd(22)} ${formatBytes(image.after)}  (from ${formatBytes(image.before)})`
  );
  console.log(
    `  ${ogImage.name.padEnd(22)} ${formatBytes(ogImage.after)}  (from ${formatBytes(ogImage.before)})`
  );
  console.log(`\nCSP script-src: ${html.scriptSrc}`);
  console.log("\nPrecompressed (zopfli gzip + brotli)");
  for (const item of compressed) {
    console.log(
      `  ${item.name.padEnd(22)} raw ${formatBytes(item.raw)} → gzip ${formatBytes(item.gzip)} / br ${formatBytes(item.brotli)}`
    );
  }
  console.log("  .htaccess              written with script hash");
  console.log("\nDone. Deploy the contents of dist/ to your Apache document root.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
