import { expect, test } from "playwright/test";
import {
  headingText,
  openFreshApp,
  preparePage,
  previewLocator,
  waitForAppReady,
} from "./helpers.js";

test.describe("open from URL", () => {
  // Service workers can bypass page.route; block them for reliable fixture fetch.
  test.use({ serviceWorkers: "block" });

  test("Open dialog fetches a routed Markdown URL with Accept", async ({
    page,
  }) => {
    await preparePage(page);
    const body = "# Opened From URL\n\nHello from fetch.";
    await page.route("**/e2e-open-url-fixture.md", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      });
    });

    page.on("dialog", (dialog) => dialog.accept());
    await openFreshApp(page);
    const fixtureUrl = new URL(
      "/e2e-open-url-fixture.md",
      page.url(),
    ).toString();

    await page.keyboard.press("ControlOrMeta+KeyO");
    await expect(page.locator("#open-url-dialog")).toBeVisible();
    await page.locator("#open-url-input").fill(fixtureUrl);
    await page.locator("#open-url-open-btn").click();

    await expect(page.locator("#external-modal")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("#editor")).toHaveValue(body);
    await page.locator("#external-modal .external-modal-accept").click();
    await expect(page.locator("#external-modal")).toBeHidden();
    expect(await headingText(previewLocator(page, "h1"))).toBe(
      "Opened From URL",
    );
  });

  test("enterprise host gets no token and asks for its own", async ({
    page,
  }) => {
    await preparePage(page);
    const host = "git.example.test";
    /** @type {(string | undefined)[]} */
    const authHeaders = [];
    await page.route(`https://${host}/api/v3/**`, async (route) => {
      authHeaders.push(route.request().headers().authorization);
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"message":"Not Found"}',
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });
    await page.goto("/");
    await waitForAppReady(page);

    await page.keyboard.press("ControlOrMeta+KeyO");
    await expect(page.locator("#open-url-dialog")).toBeVisible();
    await page.locator("#open-url-host-input").fill(host);
    await page.locator("#open-url-add-host-btn").click();
    await page
      .locator("#open-url-input")
      .fill(`https://${host}/org/repo/blob/main/README.md`);
    await page.locator("#open-url-open-btn").click();

    await expect(page.locator("#open-url-connect-github-btn")).toHaveText(
      `Connect token for ${host}`,
    );
    await expect(page.locator("#open-url-error")).toContainText(host);
    expect(authHeaders.length).toBeGreaterThan(0);
    expect(authHeaders.every((h) => h === undefined)).toBe(true);
  });

  test("Slack URL opens fallback panel in Open dialog", async ({ page }) => {
    await preparePage(page);
    await page.goto("/");
    await waitForAppReady(page);

    await page.keyboard.press("ControlOrMeta+KeyO");
    await expect(page.locator("#open-url-dialog")).toBeVisible();
    await page
      .locator("#open-url-input")
      .fill("https://files.slack.com/files-pri/T000/F000/download/notes.md");
    await page.locator("#open-url-open-btn").click();
    await expect(page.locator("#open-url-fallback-panel")).toBeVisible();
    await expect(page.locator("#open-url-link-btn")).toBeVisible();
  });
});
