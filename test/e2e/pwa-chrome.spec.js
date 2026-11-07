import { test, expect } from "playwright/test";
import { preparePage, waitForAppReady, clearAppStorage } from "./helpers.js";

/**
 * Simulate an installed PWA before app modules read display-mode / WCO.
 * @param {import('playwright/test').Page} page
 * @param {{ standalone?: boolean, wcoVisible?: boolean }} mode
 */
async function mockInstalledPwa(page, { standalone = true, wcoVisible = false } = {}) {
  await page.addInitScript(
    ({ standalone: isStandalone, wcoVisible: overlayOn }) => {
      const realMatchMedia = window.matchMedia.bind(window);
      const stub = (query, matches) => ({
        matches,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      });
      window.matchMedia = (query) => {
        // Title-bar PWA → standalone. Overlay on → window-controls-overlay.
        if (query === "(display-mode: standalone)") {
          return stub(query, isStandalone && !overlayOn);
        }
        if (query === "(display-mode: window-controls-overlay)") {
          return stub(query, overlayOn);
        }
        return realMatchMedia(query);
      };
      Object.defineProperty(navigator, "windowControlsOverlay", {
        configurable: true,
        value: {
          visible: overlayOn,
          getTitlebarAreaRect() {
            return {
              x: 72,
              y: 0,
              width: 900,
              height: 36,
              top: 0,
              left: 72,
              bottom: 36,
              right: 972,
            };
          },
          addEventListener() {},
          removeEventListener() {},
        },
      });
    },
    { standalone, wcoVisible },
  );
}

/**
 * @param {import('playwright/test').Page} page
 */
async function toolbarBorderWidths(page) {
  return page.locator(".toolbar").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      top: s.borderTopWidth,
      bottom: s.borderBottomWidth,
      hasPwa: document.documentElement.hasAttribute("data-pwa"),
      hasWco: document.documentElement.hasAttribute("data-wco"),
    };
  });
}

test.describe("PWA toolbar chrome", () => {
  test("browser tab keeps the default bottom border only", async ({ page }) => {
    await preparePage(page);
    await page.goto("/");
    await waitForAppReady(page);
    await clearAppStorage(page);
    await page.goto("/");
    await waitForAppReady(page);

    const border = await toolbarBorderWidths(page);
    expect(border.hasPwa).toBe(false);
    expect(border.hasWco).toBe(false);
    expect(border.bottom).not.toBe("0px");
    // Base .toolbar has no border-top; computed may be 0px.
    expect(border.top).toBe("0px");
  });

  test("installed PWA with system title bar gets top and bottom borders", async ({ page }) => {
    await mockInstalledPwa(page, { standalone: true, wcoVisible: false });
    await preparePage(page);
    await page.goto("/");
    await waitForAppReady(page);

    const border = await toolbarBorderWidths(page);
    expect(border.hasPwa).toBe(true);
    expect(border.hasWco).toBe(false);
    expect(border.top).not.toBe("0px");
    expect(border.bottom).not.toBe("0px");
  });

  test("installed PWA with Window Controls Overlay removes top and bottom borders", async ({
    page,
  }) => {
    await mockInstalledPwa(page, { standalone: true, wcoVisible: true });
    await preparePage(page);
    await page.goto("/");
    await waitForAppReady(page);

    const border = await toolbarBorderWidths(page);
    expect(border.hasPwa).toBe(true);
    expect(border.hasWco).toBe(true);
    expect(border.top).toBe("0px");
    expect(border.bottom).toBe("0px");
  });
});
