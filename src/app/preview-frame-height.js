/**
 * Content height for the auto-sized preview iframe.
 * Use #preview only: html/body scrollHeight is often at least the iframe
 * viewport, so Math.max with them ratchets tall after Mermaid/images shrink
 * and leaves empty space at the bottom of the pane.
 * @param {Document} doc
 */
export function measurePreviewFrameContentHeight(doc) {
  const article = doc.getElementById("preview");
  return Math.max(article?.scrollHeight || 0, 1);
}
