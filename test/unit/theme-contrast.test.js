import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const THEMES = [
  "github-light",
  "github-dark",
  "sepia",
  "terminal",
  "salesforce",
  "fancy",
];

/** Text pairs that must meet WCAG 2.2 AA normal-text contrast (≥4.5:1). */
const TEXT_PAIRS = [
  ["--chrome-text", "--chrome-surface"],
  ["--chrome-muted", "--chrome-surface"],
  ["--chrome-on-focus", "--chrome-focus"],
  ["--editor-text", "--editor-bg"],
  ["--preview-fg", "--preview-bg"],
  ["--preview-muted", "--preview-bg"],
  ["--preview-link", "--preview-bg"],
  ["--preview-link-hover", "--preview-bg"],
  ["--preview-fg", "--preview-code-bg"],
  ["--toast-fg", "--toast-bg"],
  ["--alert-note", "--preview-bg"],
  ["--alert-tip", "--preview-bg"],
  ["--alert-important", "--preview-bg"],
  ["--alert-warning", "--preview-bg"],
  ["--alert-caution", "--preview-bg"],
  ["--syntax-comment", "--preview-pre-bg"],
  ["--syntax-keyword", "--preview-pre-bg"],
  ["--syntax-string", "--preview-pre-bg"],
  ["--syntax-number", "--preview-pre-bg"],
  ["--syntax-literal", "--preview-pre-bg"],
  ["--syntax-built-in", "--preview-pre-bg"],
  ["--syntax-type", "--preview-pre-bg"],
  ["--syntax-attr", "--preview-pre-bg"],
  ["--syntax-title", "--preview-pre-bg"],
  ["--syntax-meta", "--preview-pre-bg"],
  ["--syntax-deletion", "--preview-pre-bg"],
  ["--syntax-addition", "--preview-pre-bg"],
  ["--install-fg", "--install-fill"],
];

const SYNTAX_VARS = [
  "--syntax-comment",
  "--syntax-keyword",
  "--syntax-string",
  "--syntax-number",
  "--syntax-literal",
  "--syntax-built-in",
  "--syntax-type",
  "--syntax-attr",
  "--syntax-title",
  "--syntax-meta",
  "--syntax-deletion",
  "--syntax-addition",
];

/** @param {string} hex */
function parseColor(hex) {
  let h = hex.trim().toLowerCase();
  if (h.startsWith("rgba(") || h.startsWith("rgb(")) {
    const m = h.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
    assert.ok(m, `expected rgb(a) color, got ${hex}`);
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  assert.match(h, /^#[0-9a-f]{3,8}$/, `expected hex color, got ${hex}`);
  h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  let a = 1;
  if (h.length === 8) {
    a = parseInt(h.slice(6, 8), 16) / 255;
    h = h.slice(0, 6);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a,
  };
}

/** @param {{ r: number, g: number, b: number }} c */
function relativeLuminance(c) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** @param {{ r: number, g: number, b: number, a?: number }} fg @param {{ r: number, g: number, b: number, a?: number }} bg */
function contrastRatio(fg, bg) {
  const a = fg.a ?? 1;
  const blended =
    a >= 1
      ? fg
      : {
          r: Math.round(fg.r * a + bg.r * (1 - a)),
          g: Math.round(fg.g * a + bg.g * (1 - a)),
          b: Math.round(fg.b * a + bg.b * (1 - a)),
        };
  const L1 = relativeLuminance(blended);
  const L2 = relativeLuminance(bg);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * @param {string} css
 * @param {string} theme
 */
function parseThemeBlock(css, theme) {
  const patterns =
    theme === "github-light"
      ? [
          /:root\s*,\s*html\[data-theme="github-light"\]\s*\{([\s\S]*?)\n\}/,
          /html\[data-theme="github-light"\]\s*\{([\s\S]*?)\n\}/,
        ]
      : [new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`)];

  for (const re of patterns) {
    const m = css.match(re);
    if (m) return m[1];
  }
  assert.fail(`missing theme block for ${theme}`);
}

/**
 * Resolve var() references one level against the token map.
 * @param {Record<string, string>} tokens
 * @param {string} value
 */
function resolveValue(tokens, value) {
  let v = value.trim();
  const m = v.match(/^var\((--[a-z0-9-]+)(?:,\s*([^)]+))?\)$/i);
  if (!m) return v;
  if (tokens[m[1]] != null) return resolveValue(tokens, tokens[m[1]]);
  if (m[2] != null) return resolveValue(tokens, m[2]);
  return v;
}

/**
 * @param {string} css
 * @param {string} theme
 */
function parseThemeTokens(css, theme) {
  /** @type {Record<string, string>} */
  const tokens = {};
  // :root tokens are the inherited baseline for every theme.
  const rootBody = parseThemeBlock(css, "github-light");
  for (const m of rootBody.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[m[1]] = m[2].trim();
  }
  if (theme !== "github-light") {
    const body = parseThemeBlock(css, theme);
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      tokens[m[1]] = m[2].trim();
    }
  }
  return tokens;
}

/** Fancy uses transparent chrome/editor over a fixed photo; blend against that base. */
const FANCY_BASE = { r: 0x06, g: 0x24, b: 0x36, a: 1 };

describe("Theme text contrast (WCAG 2.2 AA)", () => {
  it("meets ≥4.5:1 for chrome, preview, alert, and syntax text tokens", async () => {
    const css = await fs.readFile(path.join(root, "src/styles.css"), "utf8");

    for (const theme of THEMES) {
      const tokens = parseThemeTokens(css, theme);
      for (const [fgVar, bgVar] of TEXT_PAIRS) {
        const fgRaw = tokens[fgVar];
        const bgRaw = tokens[bgVar];
        assert.ok(fgRaw, `${theme} missing ${fgVar}`);
        assert.ok(bgRaw, `${theme} missing ${bgVar}`);

        const fgVal = resolveValue(tokens, fgRaw);
        const bgVal = resolveValue(tokens, bgRaw);

        // Transparent surfaces (Fancy glass) are checked over the page base color.
        if (bgVal === "transparent") {
          if (theme === "fancy") {
            const fg = parseColor(fgVal);
            const ratio = contrastRatio(fg, FANCY_BASE);
            assert.ok(
              ratio >= 4.5,
              `${theme} ${fgVar} on fancy base: ${fgVal} is ${ratio.toFixed(2)}:1 (need ≥4.5:1)`,
            );
            continue;
          }
          continue;
        }

        const fg = parseColor(fgVal);
        let bg = parseColor(bgVal);
        if ((bg.a ?? 1) < 1) {
          const base = theme === "fancy" ? FANCY_BASE : { r: 255, g: 255, b: 255, a: 1 };
          const a = bg.a;
          bg = {
            r: Math.round(bg.r * a + base.r * (1 - a)),
            g: Math.round(bg.g * a + base.g * (1 - a)),
            b: Math.round(bg.b * a + base.b * (1 - a)),
            a: 1,
          };
        }

        const ratio = contrastRatio(fg, bg);
        assert.ok(
          ratio >= 4.5,
          `${theme} ${fgVar} on ${bgVar}: ${fgVal} on ${bgVal} is ${ratio.toFixed(2)}:1 (need ≥4.5:1)`,
        );
      }
    }
  });

  it("keeps Salesforce brand text ≥4.5:1 on chrome background", async () => {
    const css = await fs.readFile(path.join(root, "src/styles.css"), "utf8");
    const brand = css.match(
      /html\[data-theme="salesforce"\]\s*\.brand\s*\{\s*color:\s*([^;]+);/,
    );
    assert.ok(brand, "missing salesforce .brand color");
    const tokens = parseThemeTokens(css, "salesforce");
    const bg = parseColor(resolveValue(tokens, tokens["--chrome-bg"]));
    const fg = parseColor(brand[1].trim());
    const ratio = contrastRatio(fg, bg);
    assert.ok(
      ratio >= 4.5,
      `salesforce .brand ${brand[1].trim()} on ${tokens["--chrome-bg"]} is ${ratio.toFixed(2)}:1`,
    );
  });

  it("meets ≥4.5:1 for syntax tokens on the editor background", async () => {
    const css = await fs.readFile(path.join(root, "src/styles.css"), "utf8");

    for (const theme of THEMES) {
      const tokens = parseThemeTokens(css, theme);
      // Salesforce keeps dark preview syntax but overrides the editor overlay.
      if (theme === "salesforce") {
        const m = css.match(
          /html\[data-theme="salesforce"\]\s*\.editor-highlight\s*\{([\s\S]*?)\n\}/,
        );
        assert.ok(m, "salesforce missing .editor-highlight syntax overrides");
        for (const sm of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
          tokens[sm[1]] = sm[2].trim();
        }
      }

      const bgRaw = resolveValue(tokens, tokens["--editor-bg"]);
      let bg;
      if (bgRaw === "transparent") {
        if (theme !== "fancy") continue;
        bg = FANCY_BASE;
      } else {
        bg = parseColor(bgRaw);
        if ((bg.a ?? 1) < 1) {
          const base = theme === "fancy" ? FANCY_BASE : { r: 255, g: 255, b: 255, a: 1 };
          const a = bg.a;
          bg = {
            r: Math.round(bg.r * a + base.r * (1 - a)),
            g: Math.round(bg.g * a + base.g * (1 - a)),
            b: Math.round(bg.b * a + base.b * (1 - a)),
            a: 1,
          };
        }
      }

      for (const name of SYNTAX_VARS) {
        const fgVal = resolveValue(tokens, tokens[name]);
        const ratio = contrastRatio(parseColor(fgVal), bg);
        assert.ok(
          ratio >= 4.5,
          `${theme} ${name} on editor: ${fgVal} is ${ratio.toFixed(2)}:1 (need ≥4.5:1)`,
        );
      }
    }
  });

  it("keeps blockquote markers ≥3:1 (WCAG 1.4.11)", async () => {
    const css = await fs.readFile(path.join(root, "src/styles.css"), "utf8");
    for (const theme of THEMES) {
      const tokens = parseThemeTokens(css, theme);
      const fgVal = resolveValue(tokens, tokens["--preview-quote"]);
      const bgRaw = resolveValue(tokens, tokens["--preview-bg"]);
      let bg;
      if (bgRaw === "transparent") {
        bg = FANCY_BASE;
      } else {
        bg = parseColor(bgRaw);
        if ((bg.a ?? 1) < 1) {
          const base = theme === "fancy" ? FANCY_BASE : { r: 255, g: 255, b: 255, a: 1 };
          const a = bg.a;
          bg = {
            r: Math.round(bg.r * a + base.r * (1 - a)),
            g: Math.round(bg.g * a + base.g * (1 - a)),
            b: Math.round(bg.b * a + base.b * (1 - a)),
            a: 1,
          };
        }
      }
      const ratio = contrastRatio(parseColor(fgVal), bg);
      assert.ok(
        ratio >= 3,
        `${theme} --preview-quote on --preview-bg: ${fgVal} is ${ratio.toFixed(2)}:1 (need ≥3:1)`,
      );
    }
  });

  it("keeps Fancy editor placeholder ≥4.5:1 on the page base", async () => {
    const css = await fs.readFile(path.join(root, "src/styles.css"), "utf8");
    const m = css.match(
      /html\[data-theme="fancy"\]\s*#editor::placeholder\s*\{[\s\S]*?color:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/,
    );
    assert.ok(m, "fancy placeholder color missing");
    const fg = {
      r: +m[1],
      g: +m[2],
      b: +m[3],
      a: +m[4],
    };
    const ratio = contrastRatio(fg, FANCY_BASE);
    assert.ok(
      ratio >= 4.5,
      `fancy placeholder rgba(${m[1]},${m[2]},${m[3]},${m[4]}) is ${ratio.toFixed(2)}:1`,
    );
  });
});
