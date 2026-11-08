import { expect, test } from "playwright/test";
import { headingText, openFreshApp, previewLocator } from "./helpers.js";

test.describe("views / slides / present", () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page);
    await page
      .locator("#editor")
      .fill("# One\n\nFirst.\n\n## Two\n\nSecond.\n\n## Three\n\nThird.");
    await expect
      .poll(async () => headingText(previewLocator(page, "h1").first()))
      .toBe("One");
  });

  test("slides mode walks H1/H2 sections and keeps index when entering present", async ({
    page,
  }) => {
    await page.locator("#view-mode-main-btn").click();
    await expect(page.locator("html")).toHaveAttribute("data-view", "slides");
    await expect(page.locator("#present-progress")).toContainText("1 /");

    await page.locator("#present-next-btn").click();
    await expect(page.locator("#present-progress")).toContainText("2 /");

    await page.locator("#view-mode-menu-btn").click();
    await page.locator("#present-menu-btn").click();
    await expect(page.locator("html")).toHaveAttribute("data-view", "present");
    await expect(page.locator("#present-progress")).toContainText("2 /");
  });

  test("Escape closes menus before exiting slides", async ({ page }) => {
    await page.locator("#view-mode-main-btn").click();
    await expect(page.locator("html")).toHaveAttribute("data-view", "slides");

    await page.locator("#history-btn").click();
    await expect(page.locator("#history-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#history-menu")).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-view", "slides");

    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-view", "edit");
  });

  test("clicking the preview iframe closes an open toolbar dropdown", async ({
    page,
  }) => {
    await page.locator("#export-btn").click();
    await expect(page.locator("#export-menu")).toBeVisible();

    // Parent document click listeners never see events inside the sandboxed
    // preview frame; the input bridge must dismiss chrome menus.
    await previewLocator(page, "h1").click();
    await expect(page.locator("#export-menu")).toBeHidden();
  });

  test("slide 2+ headings have zero top margin", async ({ page }) => {
    await page.locator("#view-mode-main-btn").click();
    await page.locator("#present-next-btn").click();
    const margin = await previewLocator(page, "h2")
      .first()
      .evaluate((el) => {
        return getComputedStyle(el).marginTop;
      });
    expect(margin).toBe("0px");
  });

  test("arrow keys in the editor do not change slides", async ({ page }) => {
    await page.locator("#view-mode-main-btn").click();
    await expect(page.locator("#present-progress")).toContainText("1 /");
    await page.locator("#editor").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#present-progress")).toContainText("1 /");
  });
});
