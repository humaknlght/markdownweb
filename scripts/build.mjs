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
import {
  CDN_PRECACHE,
  ICON_FILES,
  buildManifest,
  buildServiceWorker,
  hashServiceWorkerName,
  precacheVersion,
} from "./pwa.mjs";
import { copyGuideTo } from "./sync-guide.mjs";

const zopfliGzipAsync = promisify(zopfliGzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");

const COMPRESS_EXTENSIONS = new Set([".html", ".css", ".js", ".webmanifest", ".md"]);
const SCRIPT_SRC_PLACEHOLDER = "__SCRIPT_SRC__";
const GUIDE_URL_PLACEHOLDER = "__GUIDE_URL__";
const SW_URL_PLACEHOLDER = "__SW_URL__";

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
  const input = path.join(srcDir, "fancy.avif");
  const before = await fileSize(input);
  if (!before) {
    throw new Error("Missing background image: src/fancy.avif");
  }

  const buffer = await readFile(input);
  const hash = contentHash(buffer);
  const name = hashedName("fancy", ".avif", hash);
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

async function buildIcons() {
  const results = [];
  for (const base of ["icon-192", "icon-512"]) {
    const input = path.join(srcDir, `${base}.png`);
    const before = await fileSize(input);
    if (!before) {
      throw new Error(`Missing PWA icon: src/${base}.png`);
    }
    const buffer = await readFile(input);
    const hash = contentHash(buffer);
    const name = hashedName(base, ".png", hash);
    await writeFile(path.join(distDir, name), buffer);
    results.push({
      name,
      base: `${base}.png`,
      bytes: buffer.length,
      before,
      hash,
    });
  }
  return results;
}

async function minifyCssFile(fileName, { rewriteFancy } = {}) {
  let css = await readFile(path.join(srcDir, fileName), "utf8");
  if (rewriteFancy) {
    css = css.replaceAll("url(\"fancy.avif\")", `url("${rewriteFancy}")`);
    css = css.replaceAll("url('fancy.avif')", `url('${rewriteFancy}')`);
    css = css.replaceAll("url(fancy.avif)", `url(${rewriteFancy})`);
  }

  const result = await esbuild.transform(css, {
    loader: "css",
    minify: true,
    target: ["es2020"],
  });

  const buffer = Buffer.from(result.code, "utf8");
  const hash = contentHash(buffer);
  const base = path.basename(fileName, ".css");
  const name = hashedName(base, ".css", hash);
  await writeFile(path.join(distDir, name), buffer);
  return { bytes: buffer.length, name, hash };
}

async function buildCss(fancyFileName) {
  const styles = await minifyCssFile("styles.css", { rewriteFancy: fancyFileName });
  const print = await minifyCssFile("print.css");
  return { styles, print };
}

async function buildJs(guideUrl) {
  const result = await esbuild.build({
    entryPoints: [path.join(srcDir, "app.js")],
    bundle: true,
    minify: true,
    format: "esm",
    splitting: true,
    target: ["es2020"],
    write: false,
    outdir: distDir,
    entryNames: "app",
    chunkNames: "chunk-[hash]",
    legalComments: "none",
    treeShaking: true,
    metafile: true,
    external: ["marked", "dompurify", "highlight.js", "gemoji", "yaml"],
    define: {
      __GUIDE_URL__: JSON.stringify(guideUrl),
    },
  });

  const chunks = [];
  let entry = null;

  for (const output of result.outputFiles) {
    const buffer = Buffer.from(output.contents);
    const base = path.basename(output.path);
    if (base === "app.js") {
      const hash = contentHash(buffer);
      const name = hashedName("app", ".js", hash);
      await writeFile(path.join(distDir, name), buffer);
      entry = { bytes: buffer.length, name, hash };
    } else {
      const name = base;
      await writeFile(path.join(distDir, name), buffer);
      chunks.push({ bytes: buffer.length, name });
    }
  }

  if (!entry) {
    throw new Error("esbuild produced no app.js entry");
  }

  const bundledInputs = Object.keys(result.metafile?.inputs || {}).length;
  return {
    bytes: entry.bytes,
    name: entry.name,
    hash: entry.hash,
    chunks,
    bundledInputs,
  };
}

async function buildHtml({
  cssName,
  printCssName,
  jsName,
  ogImageName,
  icon192Name,
  icon512Name,
  swUrl,
}) {
  let html = await readFile(path.join(srcDir, "index.html"), "utf8");
  html = html.replace(/href="styles\.css"/, `href="${cssName}"`);
  html = html.replace(/href="print\.css"/, `href="${printCssName}"`);
  html = html.replace(/src="app\.js"/, `src="${jsName}"`);
  html = html.replaceAll("og-image.png", ogImageName);
  html = html.replaceAll("icon-192.png", icon192Name);
  html = html.replaceAll("icon-512.png", icon512Name);
  if (!html.includes(SW_URL_PLACEHOLDER)) {
    throw new Error(`src/index.html missing ${SW_URL_PLACEHOLDER} placeholder`);
  }
  html = html.replaceAll(SW_URL_PLACEHOLDER, swUrl);

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

async function buildPwa({ cssName, printCssName, jsName, jsChunks, fancyName, guideName, iconResults }) {
  const icon192 = iconResults.find((icon) => icon.base === "icon-192.png");
  const icon512 = iconResults.find((icon) => icon.base === "icon-512.png");
  const iconNames = {
    icon192: `./${icon192.name}`,
    icon512: `./${icon512.name}`,
  };
  const chunkUrls = (jsChunks || []).map((chunk) => `./${chunk.name}`);
  const localPrecache = [
    "./",
    "./index.html",
    `./${cssName}`,
    `./${printCssName}`,
    `./${jsName}`,
    ...chunkUrls,
    `./${fancyName}`,
    `./${guideName}`,
    "./manifest.webmanifest",
    iconNames.icon192,
    iconNames.icon512,
  ];
  const precacheUrls = [...localPrecache, ...CDN_PRECACHE];
  const version = precacheVersion(precacheUrls);

  const manifest = buildManifest(iconNames);
  await writeFile(path.join(distDir, "manifest.webmanifest"), manifest);
  // Keep src copies in sync for `npm run dev`.
  await writeFile(path.join(srcDir, "manifest.webmanifest"), manifest);

  const sw = buildServiceWorker({ precacheUrls, version });
  const swName = hashServiceWorkerName(sw);
  const swUrl = `./${swName}`;
  await writeFile(path.join(distDir, swName), sw);
  // Dev keeps a stable ./sw.js name (no content hash in the URL).
  await writeFile(
    path.join(srcDir, "sw.js"),
    buildServiceWorker({
      precacheUrls: [
        "./",
        "./index.html",
        "./styles.css",
        "./print.css",
        "./app.js",
        "./fancy.avif",
        "./GUIDE.md",
        "./manifest.webmanifest",
        ...ICON_FILES.map((name) => `./${name}`),
        ...CDN_PRECACHE,
      ],
      version: `dev-${version}`,
    })
  );

  return {
    version,
    precacheCount: precacheUrls.length,
    icons: iconResults,
    swName,
    swUrl,
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

async function writeApacheConfig(scriptSrc, guideUrl) {
  let htaccess = await readFile(path.join(root, "public", ".htaccess"), "utf8");
  if (!htaccess.includes(SCRIPT_SRC_PLACEHOLDER)) {
    throw new Error(`public/.htaccess missing ${SCRIPT_SRC_PLACEHOLDER} placeholder`);
  }
  if (!htaccess.includes(GUIDE_URL_PLACEHOLDER)) {
    throw new Error(`public/.htaccess missing ${GUIDE_URL_PLACEHOLDER} placeholder`);
  }
  htaccess = htaccess.replaceAll(SCRIPT_SRC_PLACEHOLDER, scriptSrc);
  htaccess = htaccess.replaceAll(GUIDE_URL_PLACEHOLDER, guideUrl);
  await writeFile(path.join(distDir, ".htaccess"), htaccess);
  await writeFile(
    path.join(distDir, "csp.json"),
    JSON.stringify({ scriptSrc, guideUrl }, null, 2) + "\n"
  );
}

async function main() {
  console.log("Building production assets → dist/\n");
  await cleanDist();

  const guide = await copyGuideTo(distDir, { hash: true });

  const image = await optimizeImage();
  const ogImage = await buildOgImage();
  const icons = await buildIcons();
  const css = await buildCss(image.name);
  const js = await buildJs(guide.url);
  const icon192 = icons.find((icon) => icon.base === "icon-192.png");
  const icon512 = icons.find((icon) => icon.base === "icon-512.png");
  const pwa = await buildPwa({
    cssName: css.styles.name,
    printCssName: css.print.name,
    jsName: js.name,
    jsChunks: js.chunks,
    fancyName: image.name,
    guideName: guide.name,
    iconResults: icons,
  });
  const html = await buildHtml({
    cssName: css.styles.name,
    printCssName: css.print.name,
    jsName: js.name,
    ogImageName: ogImage.name,
    icon192Name: icon192.name,
    icon512Name: icon512.name,
    swUrl: pwa.swUrl,
  });
  await writeApacheConfig(html.scriptSrc, guide.url);
  const compressed = await precompressAssets();

  console.log("Assets (content-hashed for cache busting)");
  console.log(`  index.html     ${formatBytes(html.bytes)}`);
  console.log(`  ${css.styles.name.padEnd(22)} ${formatBytes(css.styles.bytes)}`);
  console.log(`  ${css.print.name.padEnd(22)} ${formatBytes(css.print.bytes)}`);
  console.log(
    `  ${js.name.padEnd(22)} ${formatBytes(js.bytes)}  (${js.bundledInputs} modules bundled)`
  );
  for (const chunk of js.chunks || []) {
    console.log(`  ${chunk.name.padEnd(22)} ${formatBytes(chunk.bytes)}  (lazy chunk)`);
  }
  console.log(
    `  ${guide.name.padEnd(22)} ${formatBytes(guide.bytes)}`
  );
  console.log(
    `  ${image.name.padEnd(22)} ${formatBytes(image.after)}  (from ${formatBytes(image.before)})`
  );
  console.log(
    `  ${ogImage.name.padEnd(22)} ${formatBytes(ogImage.after)}  (from ${formatBytes(ogImage.before)})`
  );
  for (const icon of icons) {
    console.log(
      `  ${icon.name.padEnd(22)} ${formatBytes(icon.bytes)}  (from ${formatBytes(icon.before)})`
    );
  }
  console.log(`  manifest.webmanifest`);
  console.log(
    `  ${pwa.swName.padEnd(22)} cache ${pwa.version} (${pwa.precacheCount} urls)`
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
