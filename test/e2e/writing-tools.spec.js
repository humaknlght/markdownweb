import { test, expect } from "playwright/test";
import { openFreshApp } from "./helpers.js";

test.describe("writing tools", () => {
  test("Writing tools stay hidden when Chrome AI APIs are absent", async ({ page }) => {
    await openFreshApp(page);
    await expect(page.locator("#writing-tools-dropdown")).toBeHidden();
    await expect(page.locator("#ai-write-dialog")).toBeHidden();
    await expect(page.locator("#ai-rewrite-dialog")).toBeHidden();
    await expect(page.locator("#ai-proofread-dialog")).toBeHidden();
  });
});
