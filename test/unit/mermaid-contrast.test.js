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

const MERMAID_VARS = [
  "--mermaid-bg",
  "--mermaid-fg",
  "--mermaid-node-bg",
  "--mermaid-node-border",
  "--mermaid-cluster-bg",
  "--mermaid-cluster-border",
  "--mermaid-line",
  "--mermaid-label-bg",
  "--mermaid-note-bg",
  "--mermaid-note-fg",
];

/** @param {string} hex */
function parseColor(hex) {
  let h = hex.trim().toLowerCase();
  if (h.startsWith("rgba(") || h.startsWith("rgb(")) {
    const m = h.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    assert.ok(m, `expected rgb(a) color, got ${hex}`);
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  assert.match(h, /^#[0-9a-f]{3,8}$/, `expected hex color, got ${hex}`);
  h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
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

/** @param {string} a @param {string} b */
function contrastRatio(a, b) {
  const L1 = relativeLuminance(parseColor(a));
  const L2 = relativeLuminance(parseColor(b));
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pull `--mermaid-*` declarations from a theme block in styles.css.
 * github-light is defined on `:root, html[data-theme="github-light"]`.
 * @param {string} css
 * @param {string} theme
 */
function parseMermaidTokens(css, theme) {
  const patterns =
    theme === "github-light"
      ? [
          /:root\s*,\s*html\[data-theme="github-light"\]\s*\{([\s\S]*?)\n\}/,
          /html\[data-theme="github-light"\]\s*\{([\s\S]*?)\n\}/,
        ]
      : [new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`)];

  let body = null;
  for (const re of patterns) {
    const m = css.match(re);
    if (m) {
      body = m[1];
      break;
    }
  }
  assert.ok(body, `missing theme block for ${theme}`);

  /** @type {Record<string, string>} */
  const tokens = {};
  for (const name of MERMAID_VARS) {
    const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`);
    const m = body.match(re);
    assert.ok(m, `${theme} missing ${name}`);
    tokens[name] = m[1].trim();
  }
  return tokens;
}

describe("Mermaid theme contrast (WCAG 2.2 AA)", () => {
  it("forces tspan / note-fg overrides in MERMAID_THEME_CSS", async () => {
    const app = await fs.readFile(path.join(root, "src/app.js"), "utf8");
    assert.match(app, /text tspan/);
    assert.match(app, /\.noteText tspan/);
    assert.match(app, /var\(--mermaid-note-fg\)/);
    assert.match(app, /rect\.actor/);
    assert.match(app, /circle:not\(\[class\]\)/);
    // foreignObject edge labels use CSS background on labelBkg AND inner <p>
    assert.match(app, /\.edgeLabel p/);
    assert.match(app, /background-color:\s*var\(--mermaid-label-bg\)/);
  });

  it("meets text (≥4.5:1) and UI (≥3:1) contrast for every theme", async () => {
    const css = await fs.readFile(path.join(root, "src/styles.css"), "utf8");

    for (const theme of THEMES) {
      const t = parseMermaidTokens(css, theme);
      const textPairs = [
        ["fg/node", t["--mermaid-fg"], t["--mermaid-node-bg"], 4.5],
        ["fg/cluster", t["--mermaid-fg"], t["--mermaid-cluster-bg"], 4.5],
        ["fg/label", t["--mermaid-fg"], t["--mermaid-label-bg"], 4.5],
        ["note-fg/note", t["--mermaid-note-fg"], t["--mermaid-note-bg"], 4.5],
      ];
      // Borders define the box outline (WCAG 1.4.11); fill-vs-bg may stay subtle.
      const uiPairs = [
        ["border/node", t["--mermaid-node-border"], t["--mermaid-node-bg"], 3],
        ["border/cluster", t["--mermaid-cluster-border"], t["--mermaid-cluster-bg"], 3],
        ["border/bg", t["--mermaid-node-border"], t["--mermaid-bg"], 3],
        ["line/bg", t["--mermaid-line"], t["--mermaid-bg"], 3],
      ];

      for (const [name, fg, bg, need] of [...textPairs, ...uiPairs]) {
        const ratio = contrastRatio(fg, bg);
        assert.ok(
          ratio >= need,
          `${theme} ${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1 (need ≥${need}:1)`,
        );
      }
    }
  });

  it("keeps print/export Mermaid tokens in sync with github-light", async () => {
    const css = await fs.readFile(path.join(root, "src/styles.css"), "utf8");
    const light = parseMermaidTokens(css, "github-light");
    const print = await fs.readFile(path.join(root, "src/print.css"), "utf8");
    const exp = await fs.readFile(path.join(root, "src/export.js"), "utf8");
    for (const name of MERMAID_VARS) {
      const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`);
      const p = print.match(re);
      const e = exp.match(re);
      assert.ok(p, `print.css missing ${name}`);
      assert.ok(e, `export.js missing ${name}`);
      assert.equal(p[1].trim(), light[name], `print.css ${name}`);
      assert.equal(e[1].trim(), light[name], `export.js ${name}`);
    }
  });
});
