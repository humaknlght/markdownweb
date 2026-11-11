import { buildPreviewFrameCsp, PREVIEW_FRAME_CSP } from "./constants.js";
import { hooks } from "./hooks.js";
import { measurePreviewFrameContentHeight } from "./preview-frame-height.js";
import {
  preview,
  previewFrame,
  previewPane,
  setPreviewElement,
  state,
} from "./state.js";

export { buildPreviewFrameCsp, PREVIEW_FRAME_CSP };
export { measurePreviewFrameContentHeight };

const PREVIEW_FRAME_SANDBOX = "allow-same-origin allow-popups";

/** @type {number} */
let heightRaf = 0;
/** @type {ResizeObserver | null} */
let previewResizeObserver = null;

/**
 * Prefer the parent document's already-rewritten stylesheet URL so production
 * hashed names (e.g. `styles.abc123.css`) work; fall back for plain src serving.
 * @returns {string}
 */
export function resolvePreviewStylesheetHref() {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
  const main = links.find((link) => {
    if (link.id === "zen-theme-css") return false;
    if (link.media === "print") return false;
    const href = link.getAttribute("href") || "";
    if (/print/i.test(href)) return false;
    return Boolean(link.href);
  });
  if (main?.href) return main.href;
  return new URL("styles/styles.css", document.baseURI).href;
}

/**
 * Mirror the lazy Zen stylesheet into the sandboxed preview document.
 * Theme tokens for `data-theme="zen"` live only in zen.css.
 */
function syncPreviewFrameZenCss() {
  const doc = previewFrame?.contentDocument;
  if (!doc?.head) return;
  const parentZen = document.getElementById("zen-theme-css");
  let frameZen = doc.getElementById("zen-theme-css");
  if (parentZen?.href) {
    if (!frameZen) {
      frameZen = doc.createElement("link");
      frameZen.id = "zen-theme-css";
      frameZen.rel = "stylesheet";
      doc.head.appendChild(frameZen);
      frameZen.addEventListener("load", () => schedulePreviewFrameHeight());
      frameZen.addEventListener("error", () => schedulePreviewFrameHeight());
    }
    if (frameZen.href !== parentZen.href) {
      frameZen.href = parentZen.href;
    }
  } else if (frameZen) {
    frameZen.remove();
  }
}

/**
 * Mirror the parent print stylesheet into the preview frame.
 * Parent print.css cannot style iframe content across the frame boundary.
 */
function syncPreviewFramePrintCss() {
  const doc = previewFrame?.contentDocument;
  if (!doc?.head) return;
  const parentPrint = [
    ...document.querySelectorAll('link[rel="stylesheet"]'),
  ].find((link) => {
    if (link.media === "print") return true;
    return /print/i.test(link.getAttribute("href") || "");
  });
  let framePrint = doc.getElementById("print-css");
  if (parentPrint?.href) {
    if (!framePrint) {
      framePrint = doc.createElement("link");
      framePrint.id = "print-css";
      framePrint.rel = "stylesheet";
      framePrint.media = "print";
      doc.head.appendChild(framePrint);
    }
    if (framePrint.href !== parentPrint.href) {
      framePrint.href = parentPrint.href;
    }
    if (framePrint.media !== "print") framePrint.media = "print";
    // Keep print last among stylesheets for cascade against theme overrides.
    if (framePrint.nextSibling) doc.head.appendChild(framePrint);
  } else if (framePrint) {
    framePrint.remove();
  }
}

/**
 * Copy parent chrome attrs that preview CSS selectors depend on.
 */
export function syncPreviewFrameChrome() {
  const doc = previewFrame?.contentDocument;
  if (!doc?.documentElement) return;
  const src = document.documentElement;
  const dst = doc.documentElement;
  dst.classList.add("md-preview-frame");
  for (const key of ["theme", "view", "mermaidLook", "lineWrap"]) {
    const value = src.dataset[key];
    if (value == null || value === "") delete dst.dataset[key];
    else dst.dataset[key] = value;
  }
  syncPreviewFrameZenCss();
  // Print must come after zen.css so equal-specificity print rules win in
  // @media print (zen tokens are not print-wrapped).
  syncPreviewFramePrintCss();
  // Pane background lives on parent `.preview-pane` (and fancy/zen glass).
  // Keep the framed document transparent so app `body` / fancy page rules
  // from the shared stylesheet cannot repaint chrome or photo inside it.
  if (doc.body) {
    doc.body.style.background = "transparent";
    doc.body.style.backgroundImage = "none";
  }
  dst.style.background = "transparent";
  dst.style.backgroundImage = "none";
}

/**
 * Size the iframe to its content so #preview-pane remains the scroll container.
 */
export function syncPreviewFrameHeight() {
  const frame = previewFrame;
  const doc = frame?.contentDocument;
  if (!frame || !doc?.documentElement) return;
  const height = measurePreviewFrameContentHeight(doc);
  const prevWidth = Number(frame.dataset.mdFrameWidth || 0);
  const nextWidth = frame.getBoundingClientRect().width;
  const nextHeight = `${height}px`;
  if (frame.style.height !== nextHeight) frame.style.height = nextHeight;
  frame.dataset.mdFrameWidth = String(nextWidth);
  // Width recovery (narrow → readable) must retry Mermaid hosts left pending.
  if (
    Math.abs(nextWidth - prevWidth) >= 8 &&
    preview?.querySelector?.(".mermaid[data-pending]")
  ) {
    hooks.schedulePendingMermaidRender?.();
  }
}

/**
 * After iframe content height changes (images decode, Mermaid SVG layout),
 * re-run caret reveal so editor-driven sync is not stuck on pre-settle
 * offsets. Skip while the preview pane is the active sync driver.
 */
function maybeRevealPreviewAfterHeightSettle() {
  if (!state.syncScrollEnabled) return;
  if (state.syncScrollDriver === "preview") return;
  // Reveal now with settled height. Cancel any caret RAF queued before layout
  // finished (image decode / Mermaid) so it cannot run against stale offsets.
  if (state.caretRevealRaf) {
    cancelAnimationFrame(state.caretRevealRaf);
    state.caretRevealRaf = 0;
  }
  // Refresh the editor driver lock: image decode can outlast the usual 80ms
  // unlock window, and reverse sync must not fight this post-settle reveal.
  // Drop stale anchors measured before the image/Mermaid height change.
  hooks.invalidateScrollAnchors?.();
  hooks.beginSyncDriver?.("editor");
  // Bypass same-line skip so settle still re-reveals after geometry changes.
  state.lastCaretRevealLine = 0;
  hooks.revealPreviewForEditorCaret?.();
}

export function schedulePreviewFrameHeight() {
  if (heightRaf) cancelAnimationFrame(heightRaf);
  heightRaf = requestAnimationFrame(() => {
    heightRaf = 0;
    syncPreviewFrameHeight();
    // Stylesheets / Mermaid SVGs often settle one frame later.
    requestAnimationFrame(() => {
      syncPreviewFrameHeight();
      maybeRevealPreviewAfterHeightSettle();
    });
  });
}

/**
 * New images (src changed, or a rebuilt block) still decode asynchronously.
 * Bind load/error/decode so height (and caret reveal) re-settle after the
 * large base64 image (and any others) finish decoding.
 */
export function bindPreviewMediaHeightSettle(root) {
  if (!root) return;
  for (const img of root.querySelectorAll("img")) {
    if (img.dataset.mdHeightBound === "1") continue;
    img.dataset.mdHeightBound = "1";
    const kick = () => schedulePreviewFrameHeight();
    if (img.complete) {
      if (typeof img.decode === "function") {
        img.decode().then(kick, kick);
      } else {
        kick();
      }
      continue;
    }
    img.addEventListener("load", kick, { once: true });
    img.addEventListener("error", kick, { once: true });
  }
}

/**
 * Create the sandboxed preview document and bind `preview` to the inner article.
 * Must run before any code that reads or writes `preview`.
 */
export function initPreviewFrame() {
  const frame = previewFrame;
  if (!frame) {
    throw new Error("Missing #preview-frame");
  }

  frame.setAttribute("sandbox", PREVIEW_FRAME_SANDBOX);
  frame.setAttribute(
    "title",
    frame.getAttribute("title") || "Rendered preview",
  );

  const doc = frame.contentDocument;
  if (!doc) {
    throw new Error("Preview frame document unavailable");
  }

  const cssHref = resolvePreviewStylesheetHref()
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  // Include location.origin: Firefox treats this srcless frame as about:blank,
  // so style-src 'self' alone does not allow https://…/styles.*.css.
  const frameCsp = buildPreviewFrameCsp();

  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="en" class="md-preview-frame">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${frameCsp}">
  <link rel="stylesheet" href="${cssHref}">
  <style>
    /*
      Shared styles.css also styles the app shell (body chrome-bg, fancy/zen
      page photo). Neutralize those here so parent .preview-pane owns the
      background — matching the pre-iframe paint model.
    */
    html.md-preview-frame,
    html.md-preview-frame body {
      margin: 0 !important;
      padding: 0 !important;
      height: auto !important;
      min-height: 0 !important;
      display: block !important;
      overflow: hidden !important;
      color: inherit;
      background: transparent !important;
      background-image: none !important;
      background-color: transparent !important;
    }
  </style>
</head>
<body>
  <article class="preview" id="preview"></article>
</body>
</html>`);
  doc.close();

  const article = doc.getElementById("preview");
  if (!article) {
    throw new Error("Preview article missing inside frame");
  }
  setPreviewElement(article);
  syncPreviewFrameChrome();

  if (previewResizeObserver) {
    previewResizeObserver.disconnect();
    previewResizeObserver = null;
  }
  if (typeof ResizeObserver === "function") {
    previewResizeObserver = new ResizeObserver(() => {
      schedulePreviewFrameHeight();
      // Frame width changes (e.g. narrow-host tests / splitter) must retry
      // deferred Mermaid hosts that were skipped while too narrow.
      hooks.scheduleMermaidScale?.();
    });
    previewResizeObserver.observe(article);
    if (doc.body) previewResizeObserver.observe(doc.body);
    previewResizeObserver.observe(frame);
  }

  const link = doc.querySelector('link[rel="stylesheet"]:not(#zen-theme-css)');
  if (link) {
    link.addEventListener("load", () => schedulePreviewFrameHeight());
    link.addEventListener("error", () => schedulePreviewFrameHeight());
  }

  bindPreviewFrameInputBridge(doc);
  schedulePreviewFrameHeight();
}

/**
 * Parent listeners on #preview-pane do not see events inside the iframe.
 * Forward wheel so the pane still scrolls, re-fire present swipe pointers,
 * dismiss chrome menus on click (parent document click never fires here), and
 * route keyboard shortcuts (Cmd/Ctrl+O, etc.) through the parent handler.
 * @param {Document} doc
 */
function bindPreviewFrameInputBridge(doc) {
  if (doc.documentElement.dataset.mdInputBridge === "1") return;
  doc.documentElement.dataset.mdInputBridge = "1";

  // Keys stay in this browsing context while the frame is focused; without this
  // bridge, Cmd/Ctrl+O and other app shortcuts appear to fail "most of the time"
  // after clicking the preview.
  doc.addEventListener("keydown", (e) => {
    hooks.handleAppKeydown?.(e);
  });

  // Toolbar/format dropdowns listen for outside clicks on the parent document;
  // clicks in this frame never reach that listener, so menus would stick open.
  doc.addEventListener("click", () => {
    hooks.closeOverflowMenu?.();
    hooks.closeFilesContextMenu?.();
  });

  doc.addEventListener(
    "wheel",
    (e) => {
      if (!previewPane || e.ctrlKey || e.metaKey) return;
      // Auto-height frame does not scroll itself; keep #preview-pane as scroller.
      previewPane.scrollTop += e.deltaY;
      previewPane.scrollLeft += e.deltaX;
      e.preventDefault();
    },
    { passive: false },
  );

  // Present-mode swipe handlers are registered on #preview-pane; mirror them.
  for (const type of /** @type {const} */ ([
    "pointerdown",
    "pointerup",
    "pointercancel",
  ])) {
    doc.addEventListener(
      type,
      (e) => {
        if (!previewPane) return;
        // Deltas only matter for present swipe; keep the iframe event's client coords.
        previewPane.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: e.pointerId,
            pointerType: e.pointerType,
            clientX: e.clientX,
            clientY: e.clientY,
            button: e.button,
            buttons: e.buttons,
            isPrimary: e.isPrimary,
          }),
        );
      },
      { passive: true },
    );
  }
}

hooks.initPreviewFrame = initPreviewFrame;
hooks.syncPreviewFrameChrome = syncPreviewFrameChrome;
hooks.measurePreviewFrameContentHeight = measurePreviewFrameContentHeight;
hooks.syncPreviewFrameHeight = syncPreviewFrameHeight;
hooks.schedulePreviewFrameHeight = schedulePreviewFrameHeight;
hooks.bindPreviewMediaHeightSettle = bindPreviewMediaHeightSettle;
