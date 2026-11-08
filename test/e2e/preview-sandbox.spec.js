import { expect, test } from "playwright/test";
import { buildPreviewFrameCsp } from "../../src/app/constants.js";
import {
  headingText,
  openFreshApp,
  openSettings,
  previewLocator,
} from "./helpers.js";

test.describe("preview sandbox isolation", () => {
  test("preview frame is sandboxed without allow-scripts and carries a blocking CSP", async ({
    page,
  }) => {
    await openFreshApp(page);

    const meta = await page.evaluate(() => {
      const frame = document.getElementById("preview-frame");
      const sandbox = frame?.getAttribute("sandbox") || "";
      const csp =
        frame?.contentDocument
          ?.querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute("content") || "";
      return { sandbox, csp, origin: location.origin };
    });

    expect(meta.sandbox.split(/\s+/).sort().join(" ")).toBe(
      "allow-popups allow-same-origin",
    );
    expect(meta.sandbox).not.toMatch(/\ballow-scripts\b/);
    // Parent origin is listed explicitly so Firefox about:blank 'self' still
    // allows same-origin stylesheets (styles.*.css).
    expect(meta.csp).toBe(buildPreviewFrameCsp(meta.origin));
    expect(meta.csp).toContain(meta.origin);
  });

  test("preview iframe loads the parent stylesheet so theme tokens apply", async ({
    page,
  }) => {
    await openFreshApp(page);

    const sheets = await page.evaluate(() => {
      const parentMain = [
        ...document.querySelectorAll('link[rel="stylesheet"]'),
      ].find(
        (link) =>
          link.id !== "zen-theme-css" &&
          link.media !== "print" &&
          !/print/i.test(link.getAttribute("href") || ""),
      );
      const frame = document.getElementById("preview-frame");
      const frameMain = frame?.contentDocument?.querySelector(
        'link[rel="stylesheet"]:not(#zen-theme-css)',
      );
      return {
        parentHref: parentMain?.href || "",
        frameHref: frameMain?.href || "",
        ruleCount: frameMain?.sheet?.cssRules?.length || 0,
      };
    });

    expect(sheets.parentHref).toBeTruthy();
    expect(sheets.frameHref).toBe(sheets.parentHref);
    expect(sheets.ruleCount).toBeGreaterThan(0);

    await openSettings(page);
    await page.locator("#theme-select").selectOption("terminal");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "terminal",
    );

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const frame = document.getElementById("preview-frame");
          const idoc = frame?.contentDocument;
          const pane = document.getElementById("preview-pane");
          if (!idoc?.documentElement || !pane) return null;
          const rootCs = getComputedStyle(idoc.documentElement);
          const bodyCs = getComputedStyle(idoc.body);
          const paneCs = getComputedStyle(pane);
          return {
            theme: idoc.documentElement.dataset.theme,
            bg: rootCs.getPropertyValue("--preview-bg").trim(),
            fg: rootCs.getPropertyValue("--preview-fg").trim(),
            // Pane owns the fill; framed html/body stay transparent.
            paneBg: paneCs.backgroundColor,
            frameBodyBg: bodyCs.backgroundColor,
            frameHtmlBg: rootCs.backgroundColor,
          };
        }),
      )
      .toEqual({
        theme: "terminal",
        bg: "#0c0f0c",
        fg: "#b6f2b0",
        paneBg: "rgb(12, 15, 12)",
        frameBodyBg: "rgba(0, 0, 0, 0)",
        frameHtmlBg: "rgba(0, 0, 0, 0)",
      });
  });

  test("remote https images do not load from accepted Markdown", async ({
    page,
  }) => {
    await openFreshApp(page);

    /** @type {string[]} */
    const remoteHits = [];
    page.on("request", (req) => {
      if (req.url().includes("example.invalid")) remoteHits.push(req.url());
    });

    const remote = "https://example.invalid/beacon.png";
    await page.locator("#editor").fill(`# Remote\n\n![x](${remote})\n`);
    await expect
      .poll(async () => headingText(previewLocator(page, "h1")))
      .toBe("Remote");

    // Give the browser a moment to attempt a subresource fetch if any path leaked.
    await page.waitForTimeout(500);

    const imgState = await page.evaluate(() => {
      const img = document
        .getElementById("preview-frame")
        ?.contentDocument?.querySelector("#preview img");
      return {
        src: img?.getAttribute("src"),
        blockedClass:
          img?.classList.contains("md-remote-media-blocked") ?? false,
      };
    });

    expect(imgState.blockedClass).toBe(true);
    expect(imgState.src == null || imgState.src === "").toBe(true);
    expect(remoteHits).toEqual([]);
  });
});
