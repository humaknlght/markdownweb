import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "playwright/test";
import { openFreshApp, headingText } from "./helpers.js";

const mermaidFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../mermaid_file.md"),
  "utf8",
);

test.describe("editor + render", () => {
  test("live-renders GFM headings and lists", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#editor").fill("# Hello\n\n- one\n- two");
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("Hello");
    await expect(page.locator("#preview li")).toHaveCount(2);
  });

  test("open file button is keyboard-focusable", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#files-toggle-btn").click();
    const openFile = page.locator("#files-open-file-btn");
    await expect(openFile).toBeVisible();
    await openFile.focus();
    await expect(openFile).toBeFocused();
  });

  test("first visit loads the GUIDE into the editor", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      // Headless Chromium lacks File System Access; stub so save-btn dirty styling runs.
      if (typeof window.showDirectoryPicker !== "function") {
        window.showDirectoryPicker = async () => {
          throw new Error("stub");
        };
      }
    });
    await page.goto("/");
    await page.waitForFunction(() => !document.documentElement.classList.contains("is-booting"));
    await expect
      .poll(async () => page.locator("#editor").inputValue(), { timeout: 10_000 })
      .toMatch(/Markdown|# /);
    // GUIDE is starter content — not an unsaved user document.
    await expect(page.locator("#save-btn")).not.toHaveClass(/is-dirty/);
  });

  test("help button reloads the GUIDE", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await openFreshApp(page);

    await page.locator("#editor").fill("# Draft\n\nNot the guide.");
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("Draft");

    await page.locator("#help-btn").click();
    await expect
      .poll(async () => page.locator("#editor").inputValue(), { timeout: 10_000 })
      .toMatch(/How to use Markdown Editor/);
    await expect(page.locator("#save-btn")).not.toHaveClass(/is-dirty/);
  });

  test("help link opens a reader preview of the GUIDE", async ({ page, context }) => {
    await openFreshApp(page);

    await page.locator("#editor").fill("# Keep working\n\nDo not clobber me.");
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("Keep working");

    const href = await page.locator("#help-btn").getAttribute("href");
    expect(href).toMatch(/guide=1/);
    expect(href).toMatch(/view=reader/);

    const helpPage = await context.newPage();
    await helpPage.goto(new URL(href, page.url()).toString());
    await helpPage.waitForFunction(() => !document.documentElement.classList.contains("is-booting"));
    await expect(helpPage.locator("body")).toHaveAttribute("data-view", "reader");
    await expect
      .poll(async () => headingText(helpPage.locator("#preview h1")), { timeout: 10_000 })
      .toMatch(/How to use Markdown Editor/);

    // Original tab draft is unchanged.
    await expect(page.locator("#editor")).toHaveValue(/Keep working/);
  });

  test("unsaved edits swap the favicon to a badged data URL", async ({ page }) => {
    await openFreshApp(page);
    page.on("dialog", (dialog) => dialog.accept());

    // Establish a clean baseline (empty untitled can be dirty vs a prior GUIDE snapshot).
    await page.locator("#help-btn").click();
    await expect
      .poll(async () => page.locator("#editor").inputValue(), { timeout: 10_000 })
      .toMatch(/How to use Markdown Editor/);
    await expect
      .poll(async () => page.locator('link[rel="icon"]').first().getAttribute("href"))
      .not.toMatch(/^data:/);

    await page.locator("#editor").fill("# Draft\n\nUnsaved.");
    await expect
      .poll(async () => page.locator('link[rel="icon"]').first().getAttribute("href"), {
        timeout: 5_000,
      })
      .toMatch(/^data:image\/png/);

    await page.locator("#help-btn").click();
    await expect
      .poll(async () => page.locator("#editor").inputValue(), { timeout: 10_000 })
      .toMatch(/How to use Markdown Editor/);
    await expect
      .poll(async () => page.locator('link[rel="icon"]').first().getAttribute("href"))
      .not.toMatch(/^data:/);
  });

  test("unsaved edits set the PWA app badge and request notification permission on macOS", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () =>
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const realMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        if (query === "(display-mode: standalone)") {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return false;
            },
          };
        }
        return realMatchMedia(query);
      };
      window.__badgeCalls = [];
      window.__permissionRequests = 0;
      navigator.setAppBadge = async (n) => {
        window.__badgeCalls.push(n ?? "flag");
      };
      navigator.clearAppBadge = async () => {
        window.__badgeCalls.push("clear");
      };
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission: "default",
          async requestPermission() {
            window.__permissionRequests += 1;
            this.permission = "granted";
            return "granted";
          },
        },
      });
    });

    await openFreshApp(page);
    page.on("dialog", (dialog) => dialog.accept());

    await page.locator("#help-btn").click();
    await expect
      .poll(async () => page.locator("#editor").inputValue(), { timeout: 10_000 })
      .toMatch(/How to use Markdown Editor/);

    await page.locator("#editor").fill("# Draft\n\nUnsaved.");
    await expect
      .poll(async () => page.evaluate(() => window.__badgeCalls.includes("flag")))
      .toBe(true);
    await expect
      .poll(async () => page.evaluate(() => window.__permissionRequests))
      .toBeGreaterThan(0);

    await page.locator("#help-btn").click();
    await expect
      .poll(async () => page.locator("#editor").inputValue(), { timeout: 10_000 })
      .toMatch(/How to use Markdown Editor/);
    await expect
      .poll(async () => page.evaluate(() => window.__badgeCalls.at(-1) === "clear"))
      .toBe(true);
  });

  test("document without diagrams does not request Mermaid after load", async ({ page }) => {
    // Run before Mermaid-loading tests. Drop any SW (it precaches mermaid.esm)
    // and ignore in-flight CDN work from earlier navigations before measuring.
    await openFreshApp(page);
    await page.evaluate(async () => {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      if (regs?.length) await Promise.all(regs.map((r) => r.unregister()));
    });
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => performance.clearResourceTimings());

    const mermaidRequests = [];
    const onReq = (req) => {
      // Nested ESM chunks mean loadMermaid() evaluated the library. The SW may
      // precache the entry URL even when the doc has no diagrams — ignore that.
      if (req.url().includes("chunks/mermaid")) mermaidRequests.push(req.url());
    };
    page.on("request", onReq);
    try {
      await page.locator("#editor").fill("# No diagrams\n\nJust text.");
      await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("No diagrams");
      await expect(page.locator("#preview .mermaid")).toHaveCount(0);
      await page.waitForTimeout(400);

      expect(mermaidRequests, mermaidRequests.join("\n")).toEqual([]);
    } finally {
      page.off("request", onReq);
    }
  });

  test("mermaid fence renders an SVG", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#editor").fill("```mermaid\nflowchart LR\n  A-->B\n```");
    // Direct child only — zoom-button icons are nested SVGs inside .mermaid.
    await expect(page.locator("#preview .mermaid > svg")).toBeVisible({ timeout: 20_000 });
  });

  test("mermaid zoom enlarges only the diagram", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#editor").fill(
      "# Before\n\n```mermaid\nflowchart LR\n  A-->B\n```\n\n# After",
    );
    const diagram = page.locator("#preview .mermaid").first();
    await expect(diagram.locator("> svg")).toBeVisible({ timeout: 20_000 });
    await expect(diagram.locator(".mermaid-zoom-btn")).toBeVisible();

    const previewHeading = page.locator("#preview h1", { hasText: "Before" });
    await expect(previewHeading).toBeVisible();

    await diagram.locator(".mermaid-zoom-btn").click();
    const zoomDialog = page.locator("#mermaid-zoom-dialog");
    await expect(zoomDialog).toBeVisible();
    await expect(zoomDialog.locator(".mermaid-zoom-stage svg")).toBeVisible();

    // Preview content stays put; only the dialog shows the enlarged diagram.
    await expect(previewHeading).toBeVisible();
    await expect(page.locator("#preview h1", { hasText: "After" })).toBeVisible();

    const beforeIn = await zoomDialog.locator("#mermaid-zoom-level").textContent();
    await zoomDialog.locator("#mermaid-zoom-in").click();
    await expect
      .poll(async () => zoomDialog.locator("#mermaid-zoom-level").textContent())
      .not.toBe(beforeIn);

    await zoomDialog.locator("#mermaid-zoom-close").click();
    await expect(zoomDialog).toBeHidden();
  });

  test("gantt chart relayouts at full preview width without CSS zoom", async ({ page }) => {
    await openFreshApp(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    // Wide preview so readable (52rem) and full differ clearly.
    await page.locator("#collapse-editor").click();
    await expect(page.locator("#panes")).toHaveClass(/editor-collapsed/);

    const gantt = [
      "```mermaid",
      "gantt",
      "  dateFormat YYYY-MM-DD",
      "  title Width relayout",
      "  section A",
      "  Task :a1, 2014-01-01, 30d",
      "```",
    ].join("\n");

    await page.locator("#width-select").selectOption("readable");
    await page.locator("#editor").fill(gantt);
    const diagram = page.locator("#preview .mermaid").first();
    await expect(diagram.locator("> svg")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => {
        return diagram.evaluate((host) => {
          const el = host.querySelector(":scope > svg");
          if (!el) return Number.POSITIVE_INFINITY;
          return Math.abs(host.clientWidth - el.clientWidth);
        });
      }, { timeout: 20_000 })
      .toBeLessThan(4);

    const readable = await diagram.evaluate((host) => {
      const el = host.querySelector(":scope > svg");
      const vb = el?.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? [];
      return {
        svg: el?.clientWidth ?? 0,
        host: host.clientWidth,
        viewBoxW: vb[2] ?? 0,
      };
    });
    expect(readable.host).toBeGreaterThan(100);
    expect(readable.viewBoxW).toBeGreaterThan(100);

    await page.locator("#width-select").selectOption("full");
    await expect(page.locator("#preview")).toHaveAttribute("data-width", "full");

    // Mermaid must re-run so viewBox width tracks the host (not a CSS zoom of the old viewBox).
    await expect
      .poll(async () => {
        return diagram.evaluate((host, prevViewBoxW) => {
          const el = host.querySelector(":scope > svg");
          if (!el || host.hasAttribute("data-pending")) return false;
          const vb = el.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? [];
          const viewBoxW = vb[2] ?? 0;
          const gap = Math.abs(host.clientWidth - el.clientWidth);
          return (
            host.clientWidth > 0 &&
            gap < 4 &&
            viewBoxW > prevViewBoxW + 80 &&
            Math.abs(viewBoxW - host.clientWidth) < 20
          );
        }, readable.viewBoxW);
      }, { timeout: 20_000 })
      .toBe(true);
  });

  test("fancy theme Mermaid edge labels meet WCAG AA contrast", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#theme-select").selectOption("fancy");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "fancy");

    await page.locator("#editor").fill(
      "```mermaid\ngraph TD\n  A[Start] --> B{OK?}\n  B -->|Yes| C[Done]\n  B -->|No| A\n```",
    );
    await expect(page.locator("#preview .mermaid > svg")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#preview .mermaid .edgeLabel p")).toHaveCount(2, {
      timeout: 20_000,
    });

    const labels = await page.locator("#preview .mermaid .edgeLabel p").evaluateAll((nodes) => {
      function parseColor(str) {
        if (!str || str === "transparent" || str === "rgba(0, 0, 0, 0)" || str === "none") {
          return null;
        }
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) return null;
        return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
      }
      function srgbToLinear(c) {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }
      function relL({ r, g, b }) {
        return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
      }
      function contrast(a, b) {
        const L1 = relL(a);
        const L2 = relL(b);
        return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      }
      function blend(fg, bg) {
        const a = fg.a ?? 1;
        if (a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
        return {
          r: Math.round(fg.r * a + bg.r * (1 - a)),
          g: Math.round(fg.g * a + bg.g * (1 - a)),
          b: Math.round(fg.b * a + bg.b * (1 - a)),
          a: 1,
        };
      }

      return nodes.map((p) => {
        const cs = getComputedStyle(p);
        const span = p.closest("span.edgeLabel");
        const labelBkg = p.closest(".labelBkg");
        const fg = parseColor(cs.color);
        // Measure the <p> chip itself — Mermaid paints yellow there even when
        // parent .labelBkg / span.edgeLabel are already themed.
        let bg = parseColor(cs.backgroundColor);
        if (!bg || bg.a === 0) bg = parseColor(getComputedStyle(span || p).backgroundColor);
        if (!bg || bg.a === 0) bg = parseColor(getComputedStyle(labelBkg || p).backgroundColor);
        const mermaidBg =
          parseColor(getComputedStyle(p.closest(".mermaid")).backgroundColor) || {
            r: 6,
            g: 36,
            b: 54,
            a: 1,
          };
        if (bg && bg.a < 1) bg = blend(bg, mermaidBg);
        const ratio = fg && bg ? contrast(fg, bg) : 0;
        return {
          text: (p.textContent || "").trim(),
          bg: bg ? `rgb(${bg.r},${bg.g},${bg.b})` : null,
          pBg: cs.backgroundColor,
          color: cs.color,
          ratio: Math.round(ratio * 100) / 100,
        };
      });
    });

    expect(labels.map((l) => l.text).sort()).toEqual(["No", "Yes"]);
    for (const label of labels) {
      expect(
        label.ratio,
        `${label.text}: ${label.color} on ${label.bg} (p bg ${label.pBg})`,
      ).toBeGreaterThanOrEqual(4.5);
      // Regression: default Mermaid yellow label chip must not remain on <p>.
      expect(label.pBg).not.toMatch(/255,\s*255,\s*222/);
      expect(label.bg).not.toBe("rgb(255,255,222)");
    }
  });

  test("editor highlight tracks textarea scroll after a find-style jump", async ({ page }) => {
    await openFreshApp(page);

    // Long wrapped lines so the editor scrolls far past the first screen.
    const line = `${"word ".repeat(40)}UNIQUE_FIND_TOKEN_${"x".repeat(20)}\n`;
    await page.locator("#editor").fill(`${"# Title\n\n"}${line.repeat(80)}`);
    await expect
      .poll(async () => page.locator("#editor").evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(2000);

    // Simulate browser Find: select a late match and jump the textarea there.
    await page.locator("#editor").evaluate((editor) => {
      const needle = "UNIQUE_FIND_TOKEN_";
      const idx = editor.value.indexOf(needle);
      editor.focus();
      editor.setSelectionRange(idx, idx + needle.length);
      const max = editor.scrollHeight - editor.clientHeight;
      editor.scrollTop = Math.min(max, Math.floor(max * 0.7));
      editor.dispatchEvent(new Event("scroll"));
      editor.dispatchEvent(new Event("select"));
    });

    const readSync = () =>
      page.evaluate(() => {
        const editor = document.getElementById("editor");
        const transform = document.querySelector("#editor-highlight code")?.style.transform || "";
        const match = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(transform);
        return {
          editor: editor.scrollTop,
          translateY: match ? Number(match[2]) : null,
          highlightScrollTop: document.getElementById("editor-highlight").scrollTop,
        };
      });

    const afterFind = await readSync();
    expect(afterFind.editor).toBeGreaterThan(500);
    expect(afterFind.translateY).toBe(-afterFind.editor);
    // Highlight layer must not be an independent scrollport.
    expect(afterFind.highlightScrollTop).toBe(0);

    await page.locator("#editor").evaluate((editor) => {
      editor.scrollTop += 160;
      editor.dispatchEvent(new Event("scroll"));
    });
    const afterManual = await readSync();
    expect(afterManual.editor).toBe(afterFind.editor + 160);
    expect(afterManual.translateY).toBe(-afterManual.editor);
    expect(afterManual.highlightScrollTop).toBe(0);
  });

  test("sync scroll stays stable while typing at the end of a Mermaid-heavy doc", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openFreshApp(page);
    await page.setViewportSize({ width: 1400, height: 900 });

    await page.locator("#editor").fill(`${mermaidFixture.replace(/\s+$/, "")}\n\n`);
    // Diagram SVGs use id="mermaid-…"; zoom-button icons do not. Some fences in
    // the fixture can fail to paint, so do not require hostCount === svgCount.
    const diagramSvg = page.locator('#preview .mermaid svg[id^="mermaid-"]');
    await expect
      .poll(async () => diagramSvg.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(10);
    await expect
      .poll(
        async () => page.locator("#preview .mermaid[data-pending]").count(),
        { timeout: 90_000 },
      )
      .toBe(0);

    const svgCountBefore = await diagramSvg.count();

    await page.locator("#sync-scroll-btn").click();
    await expect(page.locator("#sync-scroll-btn")).toHaveAttribute("aria-pressed", "true");

    await page.locator("#editor").evaluate((editor) => {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
      editor.scrollTop = editor.scrollHeight;
    });

    const marker = "BOTTOM_MARKER_TEXT";
    const samples = [];
    for (const ch of marker) {
      await page.keyboard.type(ch);
      await page.waitForTimeout(200);
      samples.push(
        await page.evaluate(() => {
          const editor = document.getElementById("editor");
          const preview = document.getElementById("preview-pane");
          return {
            editor: editor.scrollTop,
            preview: preview.scrollTop,
            eMax: editor.scrollHeight - editor.clientHeight,
            pH: preview.scrollHeight,
            pending: document.querySelectorAll("#preview .mermaid[data-pending]").length,
            svgs: document.querySelectorAll('#preview .mermaid svg[id^="mermaid-"]').length,
          };
        }),
      );
    }

    // Unchanged diagrams must be reused — not wiped on each keystroke.
    // Count may rise if a late success lands; it must not fall (wipe/re-render).
    expect(Math.max(...samples.map((s) => s.pending))).toBe(0);
    expect(Math.min(...samples.map((s) => s.svgs))).toBeGreaterThanOrEqual(svgCountBefore);

    const editorRange = Math.max(...samples.map((s) => s.editor)) - Math.min(...samples.map((s) => s.editor));
    const previewRange =
      Math.max(...samples.map((s) => s.preview)) - Math.min(...samples.map((s) => s.preview));
    const heightRange = Math.max(...samples.map((s) => s.pH)) - Math.min(...samples.map((s) => s.pH));
    let editorFlips = 0;
    let previewFlips = 0;
    for (let i = 2; i < samples.length; i++) {
      const de1 = samples[i - 1].editor - samples[i - 2].editor;
      const de2 = samples[i].editor - samples[i - 1].editor;
      if (Math.abs(de1) > 20 && Math.abs(de2) > 20 && Math.sign(de1) !== Math.sign(de2)) {
        editorFlips += 1;
      }
      const dp1 = samples[i - 1].preview - samples[i - 2].preview;
      const dp2 = samples[i].preview - samples[i - 1].preview;
      if (Math.abs(dp1) > 20 && Math.abs(dp2) > 20 && Math.sign(dp1) !== Math.sign(dp2)) {
        previewFlips += 1;
      }
    }

    // Editor must stay pinned near the bottom — no reverse-sync yank.
    for (const sample of samples) {
      expect(sample.eMax - sample.editor).toBeLessThan(80);
    }
    expect(editorRange).toBeLessThan(40);
    expect(editorFlips).toBe(0);
    expect(previewFlips).toBe(0);
    expect(heightRange).toBeLessThan(400);
    expect(previewRange).toBeLessThan(400);

    // Newly added text must remain in the preview viewport after paints settle.
    await expect
      .poll(async () => page.locator("#preview").innerText(), { timeout: 10_000 })
      .toContain(marker);
    const markerVisible = await page.evaluate((text) => {
      const pane = document.getElementById("preview-pane");
      const walker = document.createTreeWalker(document.getElementById("preview"), NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if ((node.nodeValue || "").includes(text)) {
          const range = document.createRange();
          range.selectNodeContents(node.parentElement || node);
          const rect = range.getBoundingClientRect();
          const paneRect = pane.getBoundingClientRect();
          return rect.bottom > paneRect.top && rect.top < paneRect.bottom;
        }
        node = walker.nextNode();
      }
      return false;
    }, marker);
    expect(markerVisible).toBe(true);
  });
});
