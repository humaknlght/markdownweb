import { expect, test } from "playwright/test";
import {
  fillEditor,
  headingText,
  openFreshApp,
  openSettings,
  previewLocator,
} from "./helpers.js";

test.describe("layout / speech / print", () => {
  test("collapsing the editor leaves the preview visible", async ({ page }) => {
    await openFreshApp(page);
    await page.locator("#editor").fill("# Hi\n\nBody");
    await expect
      .poll(async () => headingText(previewLocator(page, "h1")))
      .toBe("Hi");

    await page.locator("#collapse-editor").click();
    await expect(page.locator("#panes")).toHaveClass(/editor-collapsed/);
    const box = await page.locator("#preview-pane").boundingBox();
    expect(box?.width || 0).toBeGreaterThan(50);
    expect(box?.height || 0).toBeGreaterThan(50);
  });

  test("toolbar stays on one row at 801px", async ({ page }) => {
    await page.setViewportSize({ width: 801, height: 720 });
    await openFreshApp(page);

    const bar = page.locator("#toolbar-bar");
    const box = await bar.boundingBox();
    expect(box?.height || 999).toBeLessThan(80);
  });

  test("speak button toggles with stubbed speechSynthesis", async ({
    page,
  }) => {
    await openFreshApp(page);
    await page
      .locator("#editor")
      .fill("# Speak\n\nHello world from the preview.");
    await expect
      .poll(async () => headingText(previewLocator(page, "h1")))
      .toBe("Speak");

    const speak = page.locator("#speak-btn");
    await expect(speak).toBeVisible();
    await speak.click();
    await expect(speak).toHaveAttribute("aria-pressed", "true");
    await speak.click();
    await expect(speak).toHaveAttribute("aria-pressed", "false");
  });

  test("cloud-only voices confirm before read-aloud starts", async ({
    page,
  }) => {
    await openFreshApp(page, "/", { cloudOnly: true });
    await page.locator("#editor").fill("# Speak\n\nHello from a cloud voice.");
    await expect
      .poll(async () => headingText(previewLocator(page, "h1")))
      .toBe("Speak");

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
    await openSettings(page);
    await page.locator("#theme-select").selectOption("github-dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "github-dark",
    );

    await page.emulateMedia({ media: "print" });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "github-dark",
    );
  });

  test("print media hides chrome and keeps preview for every theme", async ({
    page,
  }) => {
    const themes = [
      "github-light",
      "github-dark",
      "sepia",
      "terminal",
      "salesforce",
      "fancy",
      "zen",
    ];
    await openFreshApp(page);
    await fillEditor(
      page,
      ["# Print", "", "```js", "const x = 1;", "```", ""].join("\n"),
    );
    await expect
      .poll(async () => headingText(previewLocator(page, "h1")))
      .toBe("Print");
    await expect(previewLocator(page, ".line-num").first()).toBeVisible();

    for (const theme of themes) {
      await openSettings(page);
      await page.locator("#theme-select").selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      // Zen stylesheet is lazy; wait until the frame mirrors the theme.
      await expect
        .poll(async () =>
          page.locator("#preview-frame").evaluate((frame) => {
            const doc = /** @type {HTMLIFrameElement} */ (frame).contentDocument;
            return doc?.documentElement?.getAttribute("data-theme") || "";
          }),
        )
        .toBe(theme);

      await page.emulateMedia({ media: "print" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".toolbar")).toBeHidden();
      await expect(page.locator(".editor-pane")).toBeHidden();
      await expect(page.locator(".preview-pane")).toBeVisible();
      await expect
        .poll(async () =>
          page.locator(".preview-pane").evaluate((el) => {
            const cs = getComputedStyle(el);
            return {
              display: cs.display,
              overflow: cs.overflow,
              backgroundColor: cs.backgroundColor,
              boxShadow: cs.boxShadow,
            };
          }),
        )
        .toEqual({
          display: "block",
          overflow: "visible",
          backgroundColor: "rgb(255, 255, 255)",
          boxShadow: "none",
        });
      await expect
        .poll(async () =>
          page.locator("html").evaluate((el) => getComputedStyle(el).backgroundImage),
        )
        .toBe("none");
      await expect
        .poll(async () =>
          page.locator("body").evaluate((el) => getComputedStyle(el).backgroundImage),
        )
        .toBe("none");
      await expect
        .poll(async () =>
          page.locator("body").evaluate((el) => getComputedStyle(el).color),
        )
        .toBe("rgb(31, 35, 40)");

      await expect
        .poll(async () =>
          page.locator("#preview-frame").evaluate((frame) => {
            const doc = /** @type {HTMLIFrameElement} */ (frame)
              .contentDocument;
            const link = doc?.getElementById("print-css");
            return Boolean(link?.sheet || (link?.href && link.media === "print"));
          }),
        )
        .toBe(true);

      // print.css is mirrored into the preview frame (media=print) and forces
      // light github-like --syntax-comment (#6a737d) for every theme.
      await expect
        .poll(
          async () => {
            const color = await previewLocator(page, ".line-num")
              .first()
              .evaluate((el) => getComputedStyle(el).color);
            return color;
          },
          { timeout: 10000 },
        )
        .toBe("rgb(106, 115, 125)");

      await page.emulateMedia({ media: "screen" });
    }
  });

  test("print media shows preview even when preview pane is collapsed", async ({
    page,
  }) => {
    await openFreshApp(page);
    await fillEditor(page, "# Collapsed print\n\nBody stays printable.");
    await expect
      .poll(async () => headingText(previewLocator(page, "h1")))
      .toBe("Collapsed print");

    await page.locator("#collapse-preview").click();
    await expect(page.locator("#panes")).toHaveClass(/preview-collapsed/);

    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".preview-pane")).toBeVisible();
    await expect
      .poll(async () =>
        page.locator("#panes").evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            editor: cs.getPropertyValue("--editor-track").trim(),
            preview: cs.getPropertyValue("--preview-track").trim(),
            splitter: cs.getPropertyValue("--splitter-track").trim(),
          };
        }),
      )
      .toEqual({
        editor: "0%",
        preview: "100%",
        splitter: "0px",
      });
    await expect(previewLocator(page, "h1")).toBeVisible();
  });

  test("print media reveals folded section bodies", async ({ page }) => {
    await openFreshApp(page);
    await fillEditor(
      page,
      ["# Title", "", "Hidden body for print.", "", "# Next", "", "Visible."].join(
        "\n",
      ),
    );
    await expect
      .poll(async () => headingText(previewLocator(page, "h1").first()))
      .toBe("Title");

    const title = previewLocator(page, "h1").filter({
      has: page.locator(":scope > .md-section-label", { hasText: "Title" }),
    });
    await title.locator(":scope > .md-section-toggle").click();
    await expect(
      previewLocator(page, ".md-section-folded").filter({
        hasText: "Hidden body for print.",
      }),
    ).toBeHidden();

    await page.emulateMedia({ media: "print" });
    await expect(
      previewLocator(page, ".md-section-folded").filter({
        hasText: "Hidden body for print.",
      }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        previewLocator(page, ".md-section-folded")
          .filter({ hasText: "Hidden body for print." })
          .evaluate((el) => getComputedStyle(el).display),
      )
      .not.toBe("none");
  });

  test("desktop kebab opens theme and print controls", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    await openFreshApp(page);

    await expect(page.locator("#overflow-btn")).toBeVisible();
    await expect(page.locator("#toolbar-actions")).toBeHidden();
    await expect(page.locator("#print-btn")).toBeHidden();
    await expect(page.locator("#toolbar-bar")).toBeVisible();
    await page.locator("#overflow-btn").click();
    await expect(page.locator("#toolbar-actions")).toBeVisible();
    await expect(page.locator("#print-btn")).toBeVisible();
    await page.locator("#theme-select").selectOption("sepia");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  });
});
