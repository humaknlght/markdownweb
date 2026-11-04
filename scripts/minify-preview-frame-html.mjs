/**
 * Minify the `doc.write(\`…\`)` HTML shell in preview-frame.js for production
 * bundles. Dev still serves the readable source template.
 */
import { minify as minifyHtml } from "html-minifier-terser";

const DOC_WRITE_RE = /doc\.write\(`([\s\S]*?)`\);/;

/** Placeholders that survive html-minifier attribute / text processing. */
function exprToken(i) {
  return `PREVIEW_FRAME_EXPR_${i}`;
}

const HTML_MINIFY_OPTIONS = {
  collapseBooleanAttributes: true,
  collapseWhitespace: true,
  conservativeCollapse: false,
  decodeEntities: true,
  minifyCSS: true,
  minifyJS: false,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: false,
  removeStyleLinkTypeAttributes: true,
  useShortDoctype: true,
};

/**
 * Replace the preview iframe document template with a minified copy, keeping
 * `${…}` interpolations intact for the JS runtime.
 * @param {string} source
 * @returns {Promise<string>}
 */
export async function minifyPreviewFrameDocWrite(source) {
  const match = source.match(DOC_WRITE_RE);
  if (!match || match.index === undefined) {
    throw new Error("preview-frame.js: expected doc.write(`...`) HTML template");
  }

  /** @type {string[]} */
  const exprs = [];
  const protectedHtml = match[1].replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const token = exprToken(exprs.length);
    exprs.push(expr);
    return token;
  });

  const minified = await minifyHtml(protectedHtml, HTML_MINIFY_OPTIONS);

  let restored = minified;
  for (let i = 0; i < exprs.length; i++) {
    const token = exprToken(i);
    if (!restored.includes(token)) {
      throw new Error(
        `preview-frame HTML minify lost interpolation placeholder ${token}`,
      );
    }
    restored = restored.split(token).join(`\${${exprs[i]}}`);
  }

  return (
    source.slice(0, match.index) +
    `doc.write(\`${restored}\`);` +
    source.slice(match.index + match[0].length)
  );
}
