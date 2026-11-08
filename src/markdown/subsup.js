/**
 * marked extension: Pandoc-style subscript and superscript.
 *
 * H~2~O   → H<sub>2</sub>O
 * X^2^    → X<sup>2</sup>
 *
 * Single-tilde subscript only matches when the content has no whitespace, so
 * GFM `~~strike~~` and spaced `~strike through~` stay strikethrough. Bare
 * `~word~` (no spaces) becomes subscript — the usual tradeoff vs GFM's
 * single-tilde strikethrough.
 */

/**
 * @param {string} src
 * @param {string} ch
 * @returns {number}
 */
function findWrapped(src, ch) {
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== ch) continue;
    // Leave doubled markers to GFM strikethrough / other syntax.
    if (src[i + 1] === ch) continue;
    const close = src.indexOf(ch, i + 1);
    if (close === -1) continue;
    if (src[close + 1] === ch) continue;
    const inner = src.slice(i + 1, close);
    if (!inner || /[\s]/.test(inner)) continue;
    return i;
  }
  return -1;
}

/**
 * @param {string} src
 * @param {string} ch
 * @param {string} type
 */
function tokenizeWrapped(src, ch, type) {
  if (src[0] !== ch || src[1] === ch) return;
  const close = src.indexOf(ch, 1);
  if (close <= 1) return;
  if (src[close + 1] === ch) return;
  const text = src.slice(1, close);
  if (!text || /[\s]/.test(text)) return;
  return {
    type,
    raw: src.slice(0, close + 1),
    text,
    tokens: this.lexer.inlineTokens(text),
  };
}

/** marked extension: `~sub~` → `<sub>`, `^sup^` → `<sup>` */
export function subSupExtension() {
  return {
    extensions: [
      {
        name: "subscript",
        level: "inline",
        start(src) {
          const index = findWrapped(src, "~");
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          return tokenizeWrapped.call(this, src, "~", "subscript");
        },
        renderer(token) {
          return `<sub>${this.parser.parseInline(token.tokens)}</sub>`;
        },
      },
      {
        name: "superscript",
        level: "inline",
        start(src) {
          const index = findWrapped(src, "^");
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          return tokenizeWrapped.call(this, src, "^", "superscript");
        },
        renderer(token) {
          return `<sup>${this.parser.parseInline(token.tokens)}</sup>`;
        },
      },
    ],
  };
}
