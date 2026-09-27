/**
 * Shared Playwright helpers for Markdown Preview e2e tests.
 * @param {import('playwright/test').Page} page
 */
export async function preparePage(page) {
  await stubSpeechSynthesis(page);
  await page.addInitScript(() => {
    if (navigator.serviceWorker?.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister();
      });
    }
  });
}

/**
 * Clear draft / history so each test starts clean. Call after the first navigation
 * (not via addInitScript) so later in-test navigations keep the draft.
 * @param {import('playwright/test').Page} page
 */
export async function clearAppStorage(page) {
  await page.evaluate(async () => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    await Promise.all(
      ["md-preview-history", "md-preview-fs"].map(
        (name) =>
          new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          }),
      ),
    );
  });
}

/**
 * Stub speechSynthesis so read-aloud tests are hermetic.
 * @param {import('playwright/test').Page} page
 */
export async function stubSpeechSynthesis(page) {
  await page.addInitScript(() => {
    const voices = [
      {
        name: "Samantha",
        lang: "en-US",
        localService: true,
        voiceURI: "test-samantha",
        default: true,
      },
    ];
    /** @type {any} */
    let currentUtterance = null;
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => voices,
      speak(utterance) {
        currentUtterance = utterance;
        this.speaking = true;
        this.paused = false;
        queueMicrotask(() => utterance.onstart?.(new Event("start")));
        queueMicrotask(() => {
          utterance.onboundary?.(
            Object.assign(new Event("boundary"), {
              name: "word",
              charIndex: 0,
              charLength: 4,
            }),
          );
        });
        // Stay "speaking" until cancel — matches a long utterance for aria-pressed checks.
      },
      cancel() {
        this.speaking = false;
        this.paused = false;
        if (currentUtterance?.onend) currentUtterance.onend(new Event("end"));
        currentUtterance = null;
      },
      pause() {
        this.paused = true;
      },
      resume() {
        this.paused = false;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: synth,
    });
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
      this.text = text;
      this.voice = null;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
      this.onboundary = null;
    };
  });
}

/**
 * Open a fresh app with empty storage (no GUIDE seed).
 * @param {import('playwright/test').Page} page
 * @param {string} [path]
 */
export async function openFreshApp(page, path = "/") {
  await preparePage(page);
  await page.goto(path);
  await waitForAppReady(page);
  await clearAppStorage(page);
  await page.goto(path);
  await waitForAppReady(page);
  // Empty draft so GUIDE is not re-fetched (null → GUIDE; "" stays empty).
  // A savedSnapshot from an earlier seed may remain; that is fine and avoids a GUIDE fetch.
  await page.evaluate(() => {
    localStorage.setItem(
      "md-preview:draft",
      JSON.stringify({ v: 1, docKey: "untitled", content: "" }),
    );
  });
  await page.goto(path);
  await waitForAppReady(page);
  await page.locator("#editor").fill("");
}

/**
 * Wait until the app has left the boot state.
 * @param {import('playwright/test').Page} page
 */
export async function waitForAppReady(page) {
  await page.waitForFunction(() => !document.documentElement.classList.contains("is-booting"));
  await page.locator("#editor").waitFor({ state: "attached" });
}

/**
 * Accept the external-content dialog if it is open.
 * @param {import('playwright/test').Page} page
 */
export async function acceptExternalIfShown(page) {
  const dialog = page.locator("#external-modal");
  if (await dialog.isVisible().catch(() => false)) {
    await page.locator(".external-modal-accept").click();
    await dialog.waitFor({ state: "hidden" });
  }
}

/**
 * Heading text without the fold-toggle glyph.
 * @param {import('playwright/test').Locator} locator
 */
export async function headingText(locator) {
  return locator.evaluate((el) => {
    const clone = el.cloneNode(true);
    for (const t of clone.querySelectorAll(".md-section-toggle")) t.remove();
    return (clone.textContent || "").trim();
  });
}
