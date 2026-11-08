/**
 * `data-pwa` = installed app window (standalone / WCO display mode).
 * `data-wco` = button bar is painted into the title bar (overlay visible).
 * @param {Element} root
 * @param {{ standalone?: boolean, wcoVisible?: boolean }} [flags]
 */
export function applyPwaDisplayAttrs(
  root,
  { standalone = false, wcoVisible = false } = {},
) {
  root.toggleAttribute("data-pwa", Boolean(standalone));
  root.toggleAttribute("data-wco", Boolean(wcoVisible));
}
