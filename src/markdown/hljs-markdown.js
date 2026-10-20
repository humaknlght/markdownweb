/**
 * Patch highlight.js Markdown so editor highlighting matches CommonMark / GFM
 * preview (marked) for emphasis delimiters:
 *
 * 1. Backslash escapes — upstream does not consume `\*` / `\_` before italic/bold
 *    rules, which leaves false `hljs-emphasis` spans.
 * 2. Intraword underscores — `_` inside identifiers (`eric_perret*.zip`,
 *    `snake_case`) must not open/close emphasis; asterisks still may.
 * 3. Asterisk flanking + same-line closer — bare `*.zip` / `x*y` must not open
 *    runaway italic when preview leaves them literal.
 *
 * @see https://github.com/highlightjs/highlight.js/pull/3888
 * @see https://github.com/highlightjs/highlight.js/pull/4342
 * @see https://github.com/highlightjs/highlight.js/issues/4279
 * @see https://spec.commonmark.org/0.31.2/#backslash-escapes
 * @see https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis
 *
 * @param {(hljs: import("highlight.js").HLJSApi) => object} factory
 *   CDN / package `markdown` language factory.
 * @returns {(hljs: import("highlight.js").HLJSApi) => object}
 */
export function withMarkdownEscapes(factory) {
  // Backslash + any ASCII punctuation (CommonMark escapable set).
  const ESCAPE = {
    begin: /\\[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/,
    relevance: 0,
  };

  // ASCII punct for flanking (covers filenames / paths). Omit `*` (0x2a) and
  // `_` (0x5f) from "preceded by punct" so `***text***` can open inner italic
  // on the 3rd star, while `**/*.go` does not.
  const P = String.raw`\x21-\x29\x2b-\x2f\x3a-\x40\x5b-\x5e\x60\x7b-\x7e`;
  // Full ASCII punct including `*` / `_` — used for "followed by punct" checks.
  const P_FOLLOW = String.raw`\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e`;

  // Underscore: GFM/CommonMark — no intraword `_` emphasis (upstream PR #4342).
  // Same-line closer so an unmatched opener cannot paint through EOF.
  const ITALIC_UNDERSCORE = {
    begin: new RegExp(
      String.raw`(?<![a-zA-Z0-9])_(?![_\s])(?=[^\n]*_(?![a-zA-Z0-9]))`,
    ),
    end: /_(?![a-zA-Z0-9])/,
  };
  const BOLD_UNDERSCORE = {
    begin: new RegExp(
      String.raw`(?<![a-zA-Z0-9])_{2}(?!\s)(?=[^\n]*_{2}(?![a-zA-Z0-9]))`,
    ),
    end: /_{2}(?![a-zA-Z0-9])/,
  };

  // Asterisk: left-flanking opener + same-line closer (CommonMark §6.2).
  // - After BOL/ws/non-star punct: may open unless followed by ws.
  // - Otherwise: may open only if followed by non-ws non-punct (intraword `a*b*`).
  // Lookahead requires a closer on the same line so `*.zip` / `x*y` stay plain.
  const ITALIC_ASTERISK = {
    begin: new RegExp(
      String.raw`(?:(?<=^|[\s${P}])\*(?![*\s])|\*(?=[^\s${P_FOLLOW}*]))(?=[^\n]*\*)`,
    ),
    end: /\*/,
  };
  const BOLD_ASTERISK = {
    begin: new RegExp(
      String.raw`(?:(?<=^|[\s${P}])\*{2}(?!\s)|\*{2}(?=[^\s${P_FOLLOW}]))(?=[^\n]*\*{2})`,
    ),
    end: /\*{2}/,
  };

  return (hljs) => {
    const lang = factory(hljs);
    const seen = new Set();

    /**
     * @param {object | null | undefined} mode
     */
    function patch(mode) {
      if (!mode || typeof mode !== "object" || seen.has(mode)) return;
      seen.add(mode);

      if (Array.isArray(mode.variants)) {
        for (const variant of mode.variants) {
          if (!(variant.begin instanceof RegExp)) continue;
          switch (variant.begin.source) {
            case "_(?![_\\s])":
              variant.begin = ITALIC_UNDERSCORE.begin;
              variant.end = ITALIC_UNDERSCORE.end;
              break;
            case "_{2}(?!\\s)":
              variant.begin = BOLD_UNDERSCORE.begin;
              variant.end = BOLD_UNDERSCORE.end;
              break;
            case "\\*(?![*\\s])":
              variant.begin = ITALIC_ASTERISK.begin;
              variant.end = ITALIC_ASTERISK.end;
              break;
            case "\\*{2}(?!\\s)":
              variant.begin = BOLD_ASTERISK.begin;
              variant.end = BOLD_ASTERISK.end;
              break;
            default:
              break;
          }
        }
      }

      if (Array.isArray(mode.contains)) {
        if (!mode.contains.includes(ESCAPE)) mode.contains.unshift(ESCAPE);
        for (const child of mode.contains) patch(child);
      }
      if (Array.isArray(mode.variants)) {
        for (const variant of mode.variants) patch(variant);
      }
    }

    patch(lang);
    return lang;
  };
}
