import { test, expect } from "playwright/test";
import {
  openFreshApp,
  waitForAppReady,
  preparePage,
  headingText,
} from "./helpers.js";

async function compressToMdz(text) {
  const input = new TextEncoder().encode(text);
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test.describe("share + trust modal", () => {
  test("mdz share opens edit with blocking dialog and paused preview", async ({ page }) => {
    await preparePage(page);
    const markdown = "# Shared Doc\n\nHello from a share link.";
    const mdz = await compressToMdz(markdown);
    await page.goto(`/#mdz=${mdz}&theme=github-light&view=edit`);
    await waitForAppReady(page);

    await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
    await expect(page.locator("#external-modal")).toBeVisible();
    await expect(page.locator("#preview")).toContainText(
      "Preview is paused until you accept this content.",
    );
    await expect(page.locator("#editor")).toHaveValue(markdown);
  });

  test("Accept persists content and strips mdz from the URL", async ({ page }) => {
    await preparePage(page);
    const markdown = "# Accept Me\n\nBody.";
    const mdz = await compressToMdz(markdown);
    await page.goto(`/#mdz=${mdz}&view=edit`);
    await waitForAppReady(page);

    await page.locator(".external-modal-accept").click();
    await expect(page.locator("#external-modal")).toBeHidden();
    expect(await headingText(page.locator("#preview h1"))).toBe("Accept Me");
    await expect(page).not.toHaveURL(/mdz=/);
  });

  test("Reject restores the previous draft", async ({ page }) => {
    await openFreshApp(page);
    await page.locator("#editor").fill("# My Draft\n\nKeep me.");
    // Ensure draft is mirrored before a full reload (fill already IDB-persists).
    await page.waitForTimeout(200);

    const mdz = await compressToMdz("# External\n\nBad.");
    // Query change forces a full document load; hash-only nav would not re-run init().
    await page.goto(`/?reject=1#mdz=${mdz}&view=edit`);
    await waitForAppReady(page);
    await expect(page.locator("#external-modal")).toBeVisible();

    await page.locator(".external-modal-reject").click();
    await expect(page.locator("#external-modal")).toBeHidden();
    await expect(page.locator("#editor")).toHaveValue(/My Draft/);
    await expect(page).not.toHaveURL(/mdz=/);
  });

  test("share button copies an edit-view mdz link", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openFreshApp(page);

    await page.locator("#editor").fill("# Share Target\n\nHello.");
    await page.locator("#share-btn").click();
    await expect(page.locator("#toast")).toContainText(/copied/i);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/#mdz=/);
    expect(clip).toMatch(/view=edit/);
  });

  test("switching views does not rewrite mdz into the hash", async ({ page }) => {
    await openFreshApp(page);

    await page.locator("#editor").fill("# A\n\n## B\n\nSlide body.");
    await page.locator("#view-mode-main-btn").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "slides");
    expect(page.url()).not.toMatch(/mdz=/);

    await page.locator("#view-mode-main-btn").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
    expect(page.url()).not.toMatch(/mdz=/);
  });
});
