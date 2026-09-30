import { test, expect } from "playwright/test";
import { openFreshApp, headingText } from "./helpers.js";

/** Click a section twistie and wait until the fold animation has fully settled. */
async function toggleSectionSettled(page, heading) {
  await heading.locator(":scope > .md-section-toggle").click();
  await expect(page.locator("#preview .md-section-anim")).toHaveCount(0);
}

/** Preview heading by visible label text. */
function previewHeading(page, tag, label) {
  return page.locator(`#preview ${tag}`).filter({ hasText: label });
}

/**
 * Watch every animation frame while expand/collapse runs.
 * Also probes appendChild so a full-height expand insert is caught synchronously.
 */
async function watchFoldAnimation(page, { siblingLabels, collapsedBodyMarkers }) {
  await page.evaluate(
    ({ siblingLabels: labels, collapsedBodyMarkers: markers }) => {
      window.__foldWatch = {
        done: false,
        siblingVanish: false,
        bodyUnhide: false,
        expandInsertLeak: false,
        insertMaxHeight: 0,
        frames: 0,
        samples: [],
      };

      const origAppend = Element.prototype.appendChild;
      window.__restoreAppendChild = () => {
        Element.prototype.appendChild = origAppend;
      };
      Element.prototype.appendChild = function appendChild(child) {
        if (this.classList?.contains("md-section-anim-inner")) {
          const wrap = this.parentElement;
          if (
            wrap?.classList.contains("md-section-anim") &&
            !wrap.classList.contains("is-collapsed") &&
            child instanceof Element &&
            !child.classList.contains("md-section-folded")
          ) {
            window.__foldWatch.expandInsertLeak = true;
            window.__foldWatch.insertMaxHeight = Math.max(
              window.__foldWatch.insertMaxHeight,
              wrap.getBoundingClientRect().height,
            );
          }
        }
        return origAppend.call(this, child);
      };

      const headingByLabel = (label) =>
        [...document.querySelectorAll("#preview h1, #preview h2, #preview h3")].find((h) =>
          (h.querySelector(".md-section-label")?.textContent || "").includes(label),
        );

      const tick = () => {
        const w = window.__foldWatch;
        if (!w || w.done) return;
        w.frames += 1;

        for (const label of labels) {
          const h = headingByLabel(label);
          if (!h || !document.contains(h)) {
            w.siblingVanish = true;
            continue;
          }
          const r = h.getBoundingClientRect();
          const cs = getComputedStyle(h);
          if (cs.display === "none" || cs.visibility === "hidden" || r.height < 1) {
            w.siblingVanish = true;
            if (w.samples.length < 6) {
              w.samples.push({
                kind: "heading",
                label,
                display: cs.display,
                height: r.height,
                top: r.top,
              });
            }
          }
        }

        for (const marker of markers) {
          const el = [...document.querySelectorAll("#preview p, #preview ul, #preview ol")].find(
            (node) => (node.textContent || "").includes(marker),
          );
          if (!el) continue;
          if (getComputedStyle(el).display !== "none") {
            w.bodyUnhide = true;
            if (w.samples.length < 6) {
              w.samples.push({
                kind: "body",
                marker,
                folded: el.classList.contains("md-section-folded"),
                display: getComputedStyle(el).display,
              });
            }
          }
        }

        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { siblingLabels, collapsedBodyMarkers },
  );
}

async function stopFoldWatch(page) {
  return page.evaluate(() => {
    if (window.__foldWatch) window.__foldWatch.done = true;
    window.__restoreAppendChild?.();
    return window.__foldWatch;
  });
}

test.describe("section fold", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openFreshApp(page);
  });

  test("collapse hides section body and expand shows it again", async ({ page }) => {
    await page.locator("#editor").fill("## Section\n\nVisible body paragraph.\n\n## Next\n\nNext body.");
    await expect.poll(async () => headingText(page.locator("#preview h2").first())).toBe("Section");

    const section = previewHeading(page, "h2", "Section");
    const body = page.locator("#preview p", { hasText: "Visible body paragraph" });

    await expect(body).toBeVisible();
    await expect(section).not.toHaveClass(/is-collapsed/);

    await toggleSectionSettled(page, section);
    await expect(section).toHaveClass(/is-collapsed/);
    await expect(body).toHaveClass(/md-section-folded/);
    await expect(body).toBeHidden();

    await toggleSectionSettled(page, section);
    await expect(section).not.toHaveClass(/is-collapsed/);
    await expect(body).not.toHaveClass(/md-section-folded/);
    await expect(body).toBeVisible();
  });

  test("expanding a parent keeps nested collapsed bodies hidden during the animation", async ({
    page,
  }) => {
    await page.locator("#editor").fill(
      [
        "# Parent",
        "",
        "Parent intro.",
        "",
        "## Nested",
        "",
        "NESTED_SECRET_BODY",
        "",
        "## Sibling",
        "",
        "Sibling body.",
      ].join("\n"),
    );
    await expect.poll(async () => headingText(page.locator("#preview h1"))).toBe("Parent");

    const parent = previewHeading(page, "h1", "Parent");
    const nested = previewHeading(page, "h2", "Nested");
    const nestedBody = page.locator("#preview p", { hasText: "NESTED_SECRET_BODY" });

    await toggleSectionSettled(page, nested);
    await expect(nested).toHaveClass(/is-collapsed/);
    await expect(nestedBody).toBeHidden();

    await toggleSectionSettled(page, parent);
    await expect(parent).toHaveClass(/is-collapsed/);

    await watchFoldAnimation(page, {
      siblingLabels: ["Nested", "Sibling"],
      collapsedBodyMarkers: ["NESTED_SECRET_BODY"],
    });

    await toggleSectionSettled(page, parent);
    await expect(parent).not.toHaveClass(/is-collapsed/);

    const watch = await stopFoldWatch(page);
    expect(watch.bodyUnhide, `nested body became visible: ${JSON.stringify(watch.samples)}`).toBe(
      false,
    );

    await expect(nested).toBeVisible();
    await expect(nested).toHaveClass(/is-collapsed/);
    await expect(nestedBody).toBeHidden();
  });

  test("expanding a section keeps later sibling headings present through the animation", async ({
    page,
  }) => {
    // Mirrors help-doc repro: collapse Getting started / Supported / Mermaid, then expand
    // Getting started. Later titles must stay in the DOM with real geometry every frame.
    const tallBody = Array.from({ length: 40 }, (_, i) => `Line ${i} of the tall section.`).join(
      "\n\n",
    );
    await page.locator("#editor").fill(
      [
        "## Getting started",
        "",
        tallBody,
        "",
        "## Supported Markdown",
        "",
        "SUPPORTED_BODY_MARKER",
        "",
        "## Mermaid diagrams",
        "",
        "MERMAID_BODY_MARKER",
        "",
        "## YAML front matter",
        "",
        "YAML body.",
      ].join("\n"),
    );
    await expect
      .poll(async () => headingText(page.locator("#preview h2").first()))
      .toBe("Getting started");

    const gettingStarted = previewHeading(page, "h2", "Getting started");
    const supported = previewHeading(page, "h2", "Supported Markdown");
    const mermaid = previewHeading(page, "h2", "Mermaid diagrams");
    const yaml = previewHeading(page, "h2", "YAML front matter");
    const supportedBody = page.locator("#preview p", { hasText: "SUPPORTED_BODY_MARKER" });
    const mermaidBody = page.locator("#preview p", { hasText: "MERMAID_BODY_MARKER" });

    await toggleSectionSettled(page, gettingStarted);
    await toggleSectionSettled(page, supported);
    await toggleSectionSettled(page, mermaid);
    await expect(gettingStarted).toHaveClass(/is-collapsed/);
    await expect(supported).toHaveClass(/is-collapsed/);
    await expect(mermaid).toHaveClass(/is-collapsed/);
    await expect(supportedBody).toBeHidden();
    await expect(mermaidBody).toBeHidden();

    // Sibling titles should be on-screen before expand.
    await expect(supported).toBeInViewport();
    await expect(mermaid).toBeInViewport();
    await expect(yaml).toBeInViewport();

    await watchFoldAnimation(page, {
      siblingLabels: ["Supported Markdown", "Mermaid diagrams", "YAML front matter"],
      collapsedBodyMarkers: ["SUPPORTED_BODY_MARKER", "MERMAID_BODY_MARKER"],
    });

    await toggleSectionSettled(page, gettingStarted);
    await expect(gettingStarted).not.toHaveClass(/is-collapsed/);

    const watch = await stopFoldWatch(page);
    expect(
      watch.siblingVanish,
      `sibling heading vanished mid-animation: ${JSON.stringify(watch.samples)}`,
    ).toBe(false);
    expect(
      watch.bodyUnhide,
      `collapsed sibling body unhid mid-animation: ${JSON.stringify(watch.samples)}`,
    ).toBe(false);
    expect(
      watch.expandInsertLeak,
      `expand inserted unfolded body before 0fr lock (height ${watch.insertMaxHeight})`,
    ).toBe(false);
    expect(watch.insertMaxHeight).toBe(0);
    expect(watch.frames).toBeGreaterThan(5);

    await expect(supported).toBeVisible();
    await expect(supported).toHaveClass(/is-collapsed/);
    await expect(mermaid).toBeVisible();
    await expect(mermaid).toHaveClass(/is-collapsed/);
    await expect(yaml).toBeVisible();
    await expect(supportedBody).toBeHidden();
    await expect(mermaidBody).toBeHidden();
  });

  test("interrupted parent fold settles without visible folded bodies", async ({ page }) => {
    await openFreshApp(page);
    await page.locator("#editor").fill(
      [
        "# Parent",
        "",
        "PARENT_INTRO",
        "",
        "## Child A",
        "",
        "CHILD_A_BODY",
        "",
        "## Child B",
        "",
        "CHILD_B_BODY",
      ].join("\n"),
    );
    await expect.poll(async () => headingText(page.locator("#preview h1").first())).toBe("Parent");

    const parent = previewHeading(page, "h1", "Parent");
    const childA = previewHeading(page, "h2", "Child A");
    const childB = previewHeading(page, "h2", "Child B");
    const intro = page.locator("#preview p", { hasText: "PARENT_INTRO" });
    const bodyA = page.locator("#preview p", { hasText: "CHILD_A_BODY" });
    const bodyB = page.locator("#preview p", { hasText: "CHILD_B_BODY" });

    // Rapid: collapse parent, then child, without waiting — reproduces the
    // is-collapsed / visible-body desync from interrupted fold animations.
    await parent.locator(":scope > .md-section-toggle").click();
    await childA.locator(":scope > .md-section-toggle").click();
    await expect(page.locator("#preview .md-section-anim")).toHaveCount(0);

    // Parent collapsed wins: its body (including child headings) must be hidden.
    await expect(parent).toHaveClass(/is-collapsed/);
    await expect(intro).toBeHidden();
    await expect(childA).toBeHidden();
    await expect(childB).toBeHidden();
    await expect(bodyA).toBeHidden();
    await expect(bodyB).toBeHidden();
    await expect(page.locator("#preview .md-section-anim")).toHaveCount(0);

    // Expand parent again; child A should still be collapsed with only its body hidden.
    await toggleSectionSettled(page, parent);
    await expect(parent).not.toHaveClass(/is-collapsed/);
    await expect(intro).toBeVisible();
    await expect(childA).toBeVisible();
    await expect(childA).toHaveClass(/is-collapsed/);
    await expect(bodyA).toBeHidden();
    await expect(childB).toBeVisible();
    await expect(bodyB).toBeVisible();
  });
});
