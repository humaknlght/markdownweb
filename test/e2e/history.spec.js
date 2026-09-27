import { test, expect } from "playwright/test";
import { openFreshApp } from "./helpers.js";

/** History restore prompts when the untitled draft is dirty — always accept. */
function acceptDiscardDialogs(page) {
  page.on("dialog", (dialog) => dialog.accept());
}

/**
 * Advance the idle debounce, then wait until IndexedDB + localStorage index
 * reflect a tip whose title matches `titleRe`.
 */
async function pushHistoryNow(page, titleRe) {
  await page.clock.fastForward(16_000);
  await expect
    .poll(
      async () => {
        const title = await page.evaluate(() => {
          try {
            const hist = JSON.parse(localStorage.getItem("md-preview:history") || "{}");
            return hist.entries?.[0]?.title || "";
          } catch {
            return "";
          }
        });
        return title;
      },
      { timeout: 15_000, intervals: [50, 100, 200, 400] },
    )
    .toMatch(titleRe);
}

async function restoreHistoryAt(page, index) {
  await page.keyboard.press("Escape");
  await page.locator("#history-btn").click();
  const item = page.locator("#history-menu li button").nth(index);
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator("#history-menu")).toBeHidden();
}

test.describe("history", () => {
  test("records a history entry after idle debounce and restores it", async ({ page }) => {
    acceptDiscardDialogs(page);
    await page.clock.install();
    await openFreshApp(page);

    await page.locator("#editor").fill("# History One\n\nFirst version.");
    await pushHistoryNow(page, /History One|First/);

    await page.locator("#history-btn").click();
    await expect(page.locator("#history-menu li button").first()).toContainText(/History One|First/);
    await page.keyboard.press("Escape");

    await page.locator("#editor").fill("# History Two\n\nSecond version.");
    await pushHistoryNow(page, /History Two|Second/);

    await restoreHistoryAt(page, 1);
    await expect(page.locator("#editor")).toHaveValue(/History One|First version/);
  });

  test("re-saving an older revision keeps the chain intact", async ({ page }) => {
    acceptDiscardDialogs(page);
    await page.clock.install();
    await openFreshApp(page);

    // Large enough that reverse patches are used (not full bodies).
    const docs = {
      A: `# Alpha\n\n${"alpha line\n".repeat(50)}`,
      B: `# Bravo\n\n${"bravo line\n".repeat(50)}`,
      C: `# Charlie\n\n${"charlie line\n".repeat(50)}`,
      D: `# Delta\n\n${"delta line\n".repeat(50)}`,
    };

    for (const [key, titleRe] of [
      ["A", /Alpha/],
      ["B", /Bravo/],
      ["C", /Charlie/],
      ["D", /Delta/],
    ]) {
      await page.locator("#editor").fill(docs[key]);
      await pushHistoryNow(page, titleRe);
    }

    await page.locator("#editor").fill(docs.B);
    await pushHistoryNow(page, /Bravo/);

    // Let real time flow again for menu / restore interactions.
    await page.clock.resume();

    await page.locator("#history-btn").click();
    const buttons = page.locator("#history-menu li button");
    await expect(buttons.first()).toContainText(/Bravo/);
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(3);
    await page.keyboard.press("Escape");

    await expect(page.locator("#editor")).toHaveValue(/Bravo/);

    for (let i = 0; i < Math.min(count, 4); i++) {
      await restoreHistoryAt(page, i);
      const value = await page.locator("#editor").inputValue();
      const labels = ["Alpha", "Bravo", "Charlie", "Delta"].filter((l) => value.includes(l));
      expect(labels.length, `corrupt history body: ${value.slice(0, 80)}`).toBe(1);
      expect(value.startsWith(`# ${labels[0]}`)).toBe(true);
    }
  });
});
