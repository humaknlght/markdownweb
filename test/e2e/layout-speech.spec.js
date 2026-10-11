import { test, expect } from "playwright/test";
import { openFreshApp, headingText } from "./helpers.js";

test.describe("layout / speech / print", () => {
  test("collapsing the editor leaves the preview visible", async ({ page }) => {
    await openFreshApp(page);
    await page.locator("#editor").fill("# Hi\n\nBody");
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("Hi");

    await page.locator("#collapse-editor").click();
    await expect(page.locator("#panes")).toHaveClass(/editor-collapsed/);
    const box = await page.locator("#preview-pane").boundingBox();
    expect(box?.width || 0).toBeGreaterThan(50);
    expect(box?.height || 0).toBeGreaterThan(50);
  });

  test("toolbar stays on one row at 801px", async ({ page }) => {
    await page.setViewportSize({ width: 801, height: 720 });
    await openFreshApp(page);

    const actions = page.locator("#toolbar-actions");
    const box = await actions.boundingBox();
    expect(box?.height || 999).toBeLessThan(80);
  });

  test("speak button toggles with stubbed speechSynthesis", async ({ page }) => {
    await openFreshApp(page);
    await page.locator("#editor").fill("# Speak\n\nHello world from the preview.");
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("Speak");

    const speak = page.locator("#speak-btn");
    await expect(speak).toBeVisible();
    await speak.click();
    await expect(speak).toHaveAttribute("aria-pressed", "true");
    await speak.click();
    await expect(speak).toHaveAttribute("aria-pressed", "false");
  });

  test("cloud-only voices confirm before read-aloud starts", async ({ page }) => {
    await openFreshApp(page, "/", { cloudOnly: true });
    await page.locator("#editor").fill("# Speak\n\nHello from a cloud voice.");
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("Speak");

    const speak = page.locator("#speak-btn");
    const modal = page.locator("#cloud-speech-modal");
    await speak.click();
    await expect(modal).toBeVisible();
    await expect(speak).toHaveAttribute("aria-pressed", "false");

    await modal.locator('button[value="cancel"]').click();
    await expect(modal).toBeHidden();
    await expect(speak).toHaveAttribute("aria-pressed", "false");

    await speak.click();
    await expect(modal).toBeVisible();
    await modal.locator('button[value="continue"]').click();
    await expect(modal).toBeHidden();
    await expect(speak).toHaveAttribute("aria-pressed", "true");

    await speak.click();
    await expect(speak).toHaveAttribute("aria-pressed", "false");
    await speak.click();
    await expect(modal).toBeHidden();
    await expect(speak).toHaveAttribute("aria-pressed", "true");
  });

  test("print media does not change data-theme", async ({ page }) => {
    await openFreshApp(page);
    await page.locator("#theme-select").selectOption("github-dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "github-dark");

    await page.emulateMedia({ media: "print" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "github-dark");
  });
});
