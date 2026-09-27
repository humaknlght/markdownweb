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

  test("mermaid fence renders an SVG", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#editor").fill("```mermaid\nflowchart LR\n  A-->B\n```");
    await expect(page.locator("#preview .mermaid svg")).toBeVisible({ timeout: 20_000 });
  });

  test("document without diagrams does not request Mermaid after load", async ({ page }) => {
    await openFreshApp(page);

    const mermaidRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("mermaid")) mermaidRequests.push(req.url());
    });

    await page.locator("#editor").fill("# No diagrams\n\nJust text.");
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("No diagrams");
    await page.waitForTimeout(400);
    expect(mermaidRequests).toEqual([]);
  });
});
