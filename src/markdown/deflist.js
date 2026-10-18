/**
 * marked extension: PHP Markdown Extra–style definition lists
 * https://michelf.ca/projects/php-markdown/extra/#def-list
 *
 * Term
 * : Definition
 */

/** Leading blank lines at the start of remaining source (not part of the list). */
const LEADING_SPACE_RE = /^(?:\r?\n)+/;

/** Definition marker: up to 3 spaces, colon, then one or more spaces/tabs. */
const DD_LINE_RE = /^( {0,3}):[ \t]+(.*)$/;

/**
 * Lines that should not be treated as definition terms (other block starters).
 * @param {string} line
 */
function isOtherBlockLine(line) {
  if (/^ {4,}|\t/.test(line)) return true;
  if (/^ {0,3}(#{1,6}(?:\s|$)|`{3,}|~{3}|>|([-*_])\2{2,}\s*$)/.test(line)) {
    return true;
  }
  if (/^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/.test(line)) return true;
  if (/^ {0,3}\[[^\]]+\]:\s*\S/.test(line)) return true;
  return false;
}

/**
 * @param {string} line
 * @returns {string|null} definition text after the marker, or null if not a dd line
 */
function parseDdLine(line) {
  const match = line.match(DD_LINE_RE);
  return match ? match[2] : null;
}

/**
 * @param {string} line
 */
function isBlank(line) {
  return line.trim() === "";
}

/**
 * @param {string} line
 */
function isTermLine(line) {
  if (isBlank(line)) return false;
  if (parseDdLine(line) !== null) return false;
  if (isOtherBlockLine(line)) return false;
  return true;
}

/**
 * True when `lines[i]` starts a term group that is followed by a definition.
 * @param {string[]} lines
 * @param {number} i
 */
function looksLikeTermGroup(lines, i) {
  if (!isTermLine(lines[i])) return false;
  let j = i + 1;
  while (j < lines.length && isTermLine(lines[j])) j += 1;
  if (j < lines.length && isBlank(lines[j])) j += 1;
  return j < lines.length && parseDdLine(lines[j]) !== null;
}

/**
 * Index in `src` where a definition list may begin, or -1.
 * Used by marked's startBlock hint (called on src.slice(1)).
 * @param {string} src
 */
export function findDefListStart(src) {
  const lines = src.split(/\r?\n/);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (looksLikeTermGroup(lines, i)) return offset;
    offset += lines[i].length;
    if (i < lines.length - 1) {
      // Account for the newline that split removed (prefer \n length; \r was on the line).
      offset += 1;
    }
  }
  return -1;
}

/**
 * Parse one contiguous definition list from the start of `src`.
 * @param {string} src
 * @returns {{ raw: string, items: { terms: string[], definitions: string[] }[] }|null}
 */
export function parseDefList(src) {
  const leading = src.match(LEADING_SPACE_RE)?.[0] ?? "";
  if (leading) return null;

  const lines = src.split(/\r?\n/);
  // If src ends with a newline, split leaves a trailing empty string — keep it for
  // end-of-raw accounting, but never treat it as content.
  const items = [];
  let i = 0;

  while (i < lines.length && looksLikeTermGroup(lines, i)) {
    const terms = [];
    while (i < lines.length && isTermLine(lines[i])) {
      terms.push(lines[i].trimEnd());
      i += 1;
    }

    if (i < lines.length && isBlank(lines[i])) i += 1;

    const definitions = [];
    while (i < lines.length) {
      const ddText = parseDdLine(lines[i]);
      if (ddText === null) break;

      let text = ddText;
      i += 1;

      // Indented continuation lines (Markdown Extra lazy multi-line definitions).
      while (i < lines.length) {
        const line = lines[i];
        if (isBlank(line)) {
          // Blank + indented continuation stays in this definition; blank before
          // another `: ` or the next term group ends this definition.
          if (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1]) && !parseDdLine(lines[i + 1])) {
            text += "\n" + line;
            i += 1;
            continue;
          }
          break;
        }
        if (parseDdLine(line) !== null) break;
        if (looksLikeTermGroup(lines, i)) break;
        if (isOtherBlockLine(line) && !/^[ \t]/.test(line)) break;
        // Prefer indented continuations; also allow lazy (unindented) lines that
        // are not other block starters — common Extra/pandoc style.
        text += "\n" + line.replace(/^[ \t]+/, "");
        i += 1;
      }

      definitions.push(text.trimEnd());

      if (i < lines.length && isBlank(lines[i])) {
        // Skip a blank only when another definition for this term follows.
        if (i + 1 < lines.length && parseDdLine(lines[i + 1]) !== null) {
          i += 1;
          continue;
        }
        break;
      }
    }

    if (definitions.length === 0) break;
    items.push({ terms, definitions });

    if (i < lines.length && isBlank(lines[i])) {
      // Blank separator between term groups inside the same <dl>.
      if (i + 1 < lines.length && looksLikeTermGroup(lines, i + 1)) {
        i += 1;
        continue;
      }
      break;
    }
  }

  if (items.length === 0) return null;

  // Rebuild raw from the original src so newline style is preserved.
  const consumedLines = i;
  let raw;
  if (consumedLines >= lines.length) {
    raw = src;
  } else {
    // Sum lengths of the first `consumedLines` lines plus their trailing newlines.
    let end = 0;
    for (let n = 0; n < consumedLines; n++) {
      const nl = src.indexOf("\n", end);
      end = nl === -1 ? src.length : nl + 1;
    }
    raw = src.slice(0, end);
  }

  // Prefer not to swallow a final blank line after the list — leave it for space tokens.
  if (raw.endsWith("\n\n")) {
    raw = raw.slice(0, -1);
  } else if (raw.endsWith("\r\n\r\n")) {
    raw = raw.slice(0, -2);
  }

  return { raw, items };
}

/**
 * @param {{ terms: string[], definitions: string[] }[]} items
 * @param {{ inlineTokens: (src: string) => unknown[] }} lexer
 */
function attachInlineTokens(items, lexer) {
  return items.map(({ terms, definitions }) => ({
    terms: terms.map((text) => ({
      text,
      tokens: lexer.inlineTokens(text),
    })),
    definitions: definitions.map((text) => ({
      text,
      tokens: lexer.inlineTokens(text),
    })),
  }));
}

/** marked extension: `Term` / `: definition` → `<dl><dt>…</dt><dd>…</dd></dl>` */
export function defListExtension() {
  return {
    extensions: [
      {
        name: "defList",
        level: "block",
        start(src) {
          return findDefListStart(src);
        },
        tokenizer(src) {
          const parsed = parseDefList(src);
          if (!parsed) return;

          return {
            type: "defList",
            raw: parsed.raw,
            items: attachInlineTokens(parsed.items, this.lexer),
          };
        },
        renderer(token) {
          const lineAttr =
            token._sourceLine != null && token._sourceLine >= 1
              ? ` data-source-line="${token._sourceLine}"` +
                (token._sourceLineEnd != null &&
                token._sourceLineEnd > token._sourceLine
                  ? ` data-source-line-end="${token._sourceLineEnd}"`
                  : "")
              : "";

          let body = "";
          for (const item of token.items) {
            for (const term of item.terms) {
              body += `<dt>${this.parser.parseInline(term.tokens)}</dt>\n`;
            }
            for (const def of item.definitions) {
              body += `<dd>${this.parser.parseInline(def.tokens)}</dd>\n`;
            }
          }

          return `<dl${lineAttr}>\n${body}</dl>\n`;
        },
      },
    ],
  };
}
