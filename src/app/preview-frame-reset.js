/**
 * App-shell rules that must not apply inside the preview iframe. Fancy (and
 * Zen) paint a fixed page background on `html, body`; with the iframe also
 * scrolling, that second scrollbar stacks on the pane's. The written `<style>`
 * is blocked because this about:blank frame inherits `style-src 'self'`.
 */
export const PREVIEW_FRAME_RESET_CSS =
  "html.md-preview-frame,html.md-preview-frame body{" +
  "margin:0!important;padding:0!important;height:auto!important;min-height:0!important;" +
  "display:block!important;overflow:hidden!important;color:inherit;" +
  "background:transparent!important;background-image:none!important;background-color:transparent!important" +
  "}";

/**
 * Apply {@link PREVIEW_FRAME_RESET_CSS} on the preview document.
 * @param {Document} doc
 * @returns {boolean}
 */
export function adoptPreviewFrameReset(doc) {
  const view = doc?.defaultView;
  if (!view || typeof view.CSSStyleSheet !== "function") return false;
  try {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(PREVIEW_FRAME_RESET_CSS);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    return true;
  } catch {
    return false;
  }
}
