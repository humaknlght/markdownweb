import { test, expect } from "playwright/test";
import { openFreshApp } from "./helpers.js";

test.describe("writing tools", () => {
  test("Writing tools stay hidden when Chrome AI APIs are absent", async ({ page }) => {
    // Playwright Chromium may ship LanguageModel / Writer globals; strip them
    // so this case stays hermetic for “unsupported browser”.
    await page.addInitScript(() => {
      for (const key of ["Writer", "Rewriter", "Proofreader", "LanguageModel"]) {
        try {
          delete globalThis[key];
        } catch {
          /* ignore */
        }
        try {
          Object.defineProperty(globalThis, key, {
            configurable: true,
            get() {
              return undefined;
            },
          });
        } catch {
          /* ignore */
        }
      }
    });
    await openFreshApp(page);
    await expect(page.locator("#writing-tools-dropdown")).toBeHidden();
    await expect(page.locator("#ai-write-dialog")).toBeHidden();
    await expect(page.locator("#ai-rewrite-dialog")).toBeHidden();
    await expect(page.locator("#ai-proofread-dialog")).toBeHidden();
  });
});
