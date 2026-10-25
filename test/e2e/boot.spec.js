import { test, expect } from "playwright/test";
import { preparePage, waitForAppReady } from "./helpers.js";

test.describe("boot", () => {
  test("leaves is-booting with editor ready", async ({ page }) => {
    await preparePage(page);
    await page.goto("/");
    await waitForAppReady(page);
    await expect(page.locator("html")).not.toHaveClass(/is-booting/);
  });
});
