import { test, expect } from "playwright/test";
import { openFreshApp, headingText } from "./helpers.js";

test.describe("editor + render", () => {
  test("live-renders GFM headings and lists", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#editor").fill("# Hello\n\n- one\n- two");
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("Hello");
    await expect(page.locator("#preview li")).toHaveCount(2);
  });

  test("upload button is keyboard-focusable", async ({ page }) => {
    await openFreshApp(page);

    const upload = page.locator("#upload-btn");
    await expect(upload).toBeVisible();
    await upload.focus();
    await expect(upload).toBeFocused();
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
      .toMatch(/How to use Markdown Preview/);
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
      .toMatch(/How to use Markdown Preview/);

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
      .toMatch(/How to use Markdown Preview/);
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
      .toMatch(/How to use Markdown Preview/);
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
      .toMatch(/How to use Markdown Preview/);

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
      .toMatch(/How to use Markdown Preview/);
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
    await expect(page.locator("#preview .mermaid svg")).toBeVisible({ timeout: 20_000 });
  });

  test("fancy theme Mermaid edge labels meet WCAG AA contrast", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#theme-select").selectOption("fancy");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "fancy");

    await page.locator("#editor").fill(
      "```mermaid\ngraph TD\n  A[Start] --> B{OK?}\n  B -->|Yes| C[Done]\n  B -->|No| A\n```",
    );
    await expect(page.locator("#preview .mermaid svg")).toBeVisible({ timeout: 20_000 });
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
});
