/**
 * marked extension: Pandoc / Markdown Extra heading IDs.
 *
 * ### My Great Heading {#custom-id}
 */

const HEADING_ID_RE = /\s+\{#([A-Za-z][\w:-]*)\}\s*$/;

/**
 * Strip a trailing `{#id}` from a heading token and store `token.customId`.
 * @param {{ type?: string, text?: string, tokens?: { type?: string, text?: string, raw?: string }[] }} token
 */
export function applyHeadingId(token) {
  if (token.type !== "heading" || typeof token.text !== "string") return false;
  const match = HEADING_ID_RE.exec(token.text);
  if (!match) return false;

  token.customId = match[1];
  token.text = token.text.slice(0, match.index);

  const inline = token.tokens;
  if (!Array.isArray(inline) || inline.length === 0) return true;

  // Prefer stripping from the final text-bearing token.
  for (let i = inline.length - 1; i >= 0; i--) {
    const child = inline[i];
    if (typeof child?.text !== "string") continue;
    const childMatch = HEADING_ID_RE.exec(child.text);
    if (!childMatch) continue;
    child.text = child.text.slice(0, childMatch.index);
    if (typeof child.raw === "string") {
      const rawMatch = HEADING_ID_RE.exec(child.raw);
      if (rawMatch) child.raw = child.raw.slice(0, rawMatch.index);
    }
    if (child.text === "" && child.raw === "") {
      inline.splice(i, 1);
    }
    break;
  }

  return true;
}

/** marked extension: `{#custom-id}` on headings → `id="custom-id"` */
export function headingIdExtension() {
  return {
    walkTokens(token) {
      applyHeadingId(token);
    },
  };
}
