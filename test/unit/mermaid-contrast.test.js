import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Main + lazy Zen theme CSS (zen Mermaid tokens live in src/styles/zen.css). */
async function readThemeCss() {
  const [styles, zen] = await Promise.all([
    fs.readFile(path.join(root, "src/styles/styles.css"), "utf8"),
    fs.readFile(path.join(root, "src/styles/zen.css"), "utf8"),
  ]);
  return `${styles}\n${zen}`;
}

const THEMES = [
  "github-light",
  "github-dark",
  "sepia",
  "terminal",
  "salesforce",
  "fancy",
  "zen",
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
  "--mermaid-series-1",
  "--mermaid-series-2",
  "--mermaid-series-3",
  "--mermaid-series-4",
  "--mermaid-series-fg",
  "--mermaid-exclude",
  "--mermaid-gantt-0",
  "--mermaid-gantt-1",
  "--mermaid-gantt-2",
  "--mermaid-gantt-3",
  "--mermaid-gantt-section-opacity",
];

/** Fancy mid-pop categorical palette (WCAG AA with series-fg). */
const FANCY_SERIES = {
  "--mermaid-series-1": "#1588a8",
  "--mermaid-series-2": "#9a6fe0",
  "--mermaid-series-3": "#d45080",
  "--mermaid-series-4": "#d4a040",
  "--mermaid-series-fg": "#1a1208",
};

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

/** Alpha-composite `fg` over `bg` (0–1). @param {string} fg @param {string} bg @param {number} a */
function blendOver(fg, bg, a) {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const hex = (n) => n.toString(16).padStart(2, "0");
  return `#${hex(Math.round(a * f.r + (1 - a) * b.r))}${hex(
    Math.round(a * f.g + (1 - a) * b.g),
  )}${hex(Math.round(a * f.b + (1 - a) * b.b))}`;
}

/** RGB Euclidean distance. @param {string} a @param {string} b */
function rgbDistance(a, b) {
  const x = parseColor(a);
  const y = parseColor(b);
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
}

/**
 * Resolve `var(--token)` chains against a token map to a concrete color.
 * @param {Record<string, string>} tokens
 * @param {string} value
 */
function resolveColor(tokens, value) {
  let v = value.trim();
  const seen = new Set();
  while (/^var\(/.test(v)) {
    const m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    assert.ok(m, `expected var(--token), got ${value}`);
    assert.ok(!seen.has(m[1]), `cyclic var in ${value}`);
    seen.add(m[1]);
    assert.ok(tokens[m[1]], `unresolved ${m[1]} from ${value}`);
    v = tokens[m[1]].trim();
  }
  return v;
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
  it("forces tspan / note-fg / series overrides in MERMAID_THEME_CSS", async () => {
    const app = await fs.readFile(path.join(root, "src/app/app.js"), "utf8");
    assert.match(app, /text tspan/);
    assert.match(app, /\.noteText tspan/);
    assert.match(app, /var\(--mermaid-note-fg\)/);
    assert.match(app, /var\(--mermaid-series-1\)/);
    assert.match(app, /var\(--mermaid-series-fg\)/);
    assert.match(app, /\.exclude-range/);
    assert.match(app, /var\(--mermaid-exclude\)/);
    assert.match(app, /rect\.section/);
    assert.match(app, /var\(--mermaid-gantt-0\)/);
    assert.match(app, /var\(--mermaid-gantt-section-opacity\)/);
    assert.match(app, /\.sectionTitle/);
    assert.match(app, /\.pieTitleText/);
    assert.match(app, /\.commit-label/);
    assert.match(app, /\.titleText/);
    assert.match(app, /rect\.section-type-0/);
    assert.match(app, /\.activeText0/);
    assert.match(app, /\.doneText0\.taskTextOutsideRight/);
    assert.match(app, /path\.pieCircle:nth-of-type/);
    assert.match(app, /\.quadrant:nth-child\(4\)/);
    assert.match(app, /stroke:\s*var\(--mermaid-note-fg\)/);
    assert.match(app, /rect\.actor/);
    assert.match(app, /circle:not\(\[class\]\)/);
    // foreignObject edge labels use CSS background on labelBkg AND inner <p>
    assert.match(app, /\.edgeLabel p/);
    assert.match(app, /background-color:\s*var\(--mermaid-label-bg\)/);
  });

  it("binds Excalidraw/handDrawn paints to theme tokens for WCAG contrast", async () => {
    const app = await fs.readFile(path.join(root, "src/app/app.js"), "utf8");
    const css = await fs.readFile(path.join(root, "src/styles/styles.css"), "utf8");
    assert.match(app, /function mermaidThemeVariablesFromCss/);
    assert.match(app, /function normalizeMermaidHandDrawnColors/);
    assert.match(app, /function mermaidTextInkVarForFill/);
    assert.match(app, /function fitMermaidSvgViewBox/);
    assert.match(app, /fitMermaidSvgViewBox\(sketched,\s*\{\s*tighten:\s*true\s*\}\)/);
    assert.match(app, /themeVariables:\s*mermaidThemeVariablesFromCss\(\)/);
    assert.match(app, /fillStyle:\s*["']solid["']/);
    assert.match(app, /look:\s*["']classic["']/);
    assert.match(app, /MERMAID_HAND_FONT/);
    assert.match(app, /Excalifont/);
    assert.match(app, /surfaceToInk/);
    assert.match(app, /var\(--mermaid-node-border\)/);
    assert.match(app, /path\.edge-thickness-normal/);
    assert.match(app, /setProperty\(attr,\s*value,\s*["']important["']\)/);
    assert.match(css, /font-family:\s*"Excalifont"/);
    assert.match(css, /excalifont@1\.0\.0/);
    assert.match(css, /data-mermaid-look="handDrawn"/);
  });

  it("meets text (≥4.5:1) and UI (≥3:1) contrast for every theme", async () => {
    const css = await readThemeCss();

    for (const theme of THEMES) {
      const t = parseMermaidTokens(css, theme);
      const c = (name) => resolveColor(t, t[name]);
      const textPairs = [
        ["fg/bg", c("--mermaid-fg"), c("--mermaid-bg"), 4.5],
        ["fg/node", c("--mermaid-fg"), c("--mermaid-node-bg"), 4.5],
        ["fg/cluster", c("--mermaid-fg"), c("--mermaid-cluster-bg"), 4.5],
        ["fg/label", c("--mermaid-fg"), c("--mermaid-label-bg"), 4.5],
        ["note-fg/note", c("--mermaid-note-fg"), c("--mermaid-note-bg"), 4.5],
        ["series-fg/s1", c("--mermaid-series-fg"), c("--mermaid-series-1"), 4.5],
        ["series-fg/s2", c("--mermaid-series-fg"), c("--mermaid-series-2"), 4.5],
        ["series-fg/s3", c("--mermaid-series-fg"), c("--mermaid-series-3"), 4.5],
        ["series-fg/s4", c("--mermaid-series-fg"), c("--mermaid-series-4"), 4.5],
        // Outside gantt labels sit on exclude/weekend bands.
        ["fg/exclude", c("--mermaid-fg"), c("--mermaid-exclude"), 4.5],
      ];
      // Borders define the box outline (WCAG 1.4.11); fill-vs-bg may stay subtle.
      // Note stroke uses note-fg (AA vs note-bg), not node-border.
      const uiPairs = [
        ["border/node", c("--mermaid-node-border"), c("--mermaid-node-bg"), 3],
        ["border/cluster", c("--mermaid-cluster-border"), c("--mermaid-cluster-bg"), 3],
        ["border/bg", c("--mermaid-node-border"), c("--mermaid-bg"), 3],
        ["line/bg", c("--mermaid-line"), c("--mermaid-bg"), 3],
        ["note-stroke/note", c("--mermaid-note-fg"), c("--mermaid-note-bg"), 3],
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

  it("locks fancy series mid-pop hexes", async () => {
    const css = await readThemeCss();
    const fancy = parseMermaidTokens(css, "fancy");
    for (const [name, hex] of Object.entries(FANCY_SERIES)) {
      assert.equal(fancy[name].toLowerCase(), hex, `fancy ${name}`);
    }
    const series = [
      fancy["--mermaid-series-1"],
      fancy["--mermaid-series-2"],
      fancy["--mermaid-series-3"],
      fancy["--mermaid-series-4"],
    ];
    assert.equal(new Set(series).size, 4, "fancy series fills must be distinct");
    assert.equal(fancy["--mermaid-gantt-0"], "var(--mermaid-series-1)");
    assert.equal(fancy["--mermaid-gantt-section-opacity"], "0.22");
  });

  it("keeps gantt section bands distinct and label-readable when blended", async () => {
    const css = await readThemeCss();
    for (const theme of THEMES) {
      const t = parseMermaidTokens(css, theme);
      const c = (name) => resolveColor(t, t[name]);
      const op = Number.parseFloat(t["--mermaid-gantt-section-opacity"]);
      assert.ok(op > 0 && op <= 1, `${theme} gantt opacity`);
      const bands = [0, 1, 2, 3].map((i) => c(`--mermaid-gantt-${i}`));
      assert.equal(new Set(bands).size, 4, `${theme} gantt fills must be distinct`);
      const bg = c("--mermaid-bg");
      const fg = c("--mermaid-fg");
      const blends = bands.map((fill) => blendOver(fill, bg, op));
      for (let i = 0; i < blends.length; i++) {
        const ratio = contrastRatio(fg, blends[i]);
        assert.ok(
          ratio >= 4.5,
          `${theme} fg on gantt-${i} blend ${blends[i]} is ${ratio.toFixed(2)}:1`,
        );
      }
      for (let i = 0; i < 3; i++) {
        const d = rgbDistance(blends[i], blends[i + 1]);
        assert.ok(
          d >= 18,
          `${theme} gantt-${i}/gantt-${i + 1} blend ΔRGB ${d.toFixed(1)} (need ≥18)`,
        );
      }
    }
  });

  it("keeps print/export Mermaid tokens in sync with github-light", async () => {
    const css = await fs.readFile(path.join(root, "src/styles/styles.css"), "utf8");
    const light = parseMermaidTokens(css, "github-light");
    const print = await fs.readFile(path.join(root, "src/styles/print.css"), "utf8");
    const exp = await fs.readFile(path.join(root, "src/lib/export.js"), "utf8");
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
