/**
 * marked extension: highlight / mark spans.
 *
 * ==highlighted==  (Pandoc / markdown-it-mark)
 * ::highlighted::  (alternate Markdown Guide form)
 */

/**
 * @param {string} src
 * @param {string} delim
 * @returns {number} index of a valid open delimiter, or -1
 */
function findDelim(src, delim) {
  const d0 = delim[0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== d0) continue;
    if (!src.startsWith(delim, i)) continue;
    // Don't treat a run of 3+ as an opener (`===`, `:::`).
    if (src[i + delim.length] === d0) continue;
    const close = src.indexOf(delim, i + delim.length);
    if (close === -1) continue;
    if (src[close + delim.length] === d0) continue;
    const inner = src.slice(i + delim.length, close);
    if (!inner || /^\s/.test(inner) || /\s$/.test(inner)) continue;
    return i;
  }
  return -1;
}

/**
 * @param {string} src
 * @param {string} delim
 * @param {string} type
 */
function tokenizeDelim(src, delim, type) {
  if (!src.startsWith(delim)) return;
  if (src[delim.length] === delim[0]) return;
  const close = src.indexOf(delim, delim.length);
  if (close === -1) return;
  if (src[close + delim.length] === delim[0]) return;
  const text = src.slice(delim.length, close);
  if (!text || /^\s/.test(text) || /\s$/.test(text)) return;
  return {
    type,
    raw: src.slice(0, close + delim.length),
    text,
    tokens: this.lexer.inlineTokens(text),
  };
}

/** marked extension: `==text==` / `::text::` → `<mark>` */
export function markHighlightExtension() {
  return {
    extensions: [
      {
        name: "markEquals",
        level: "inline",
        start(src) {
          const index = findDelim(src, "==");
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          return tokenizeDelim.call(this, src, "==", "markEquals");
        },
        renderer(token) {
          return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
        },
      },
      {
        name: "markColons",
        level: "inline",
        start(src) {
          const index = findDelim(src, "::");
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          return tokenizeDelim.call(this, src, "::", "markColons");
        },
        renderer(token) {
          return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
        },
      },
    ],
  };
}
