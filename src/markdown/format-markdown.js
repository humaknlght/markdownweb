/**
 * Pure Markdown formatting edits for the editor format bar.
 * Each helper returns a range replacement plus the desired selection afterward.
 *
 * @typedef {{ from: number, to: number, text: string, selectionStart: number, selectionEnd: number }} FormatEdit
 */

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @returns {{ from: number, to: number }}
 */
export function lineRange(value, start, end) {
  const from = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let focusEnd = end;
  if (end > start && value[end - 1] === "\n") focusEnd = end - 1;
  focusEnd = Math.max(focusEnd, from);
  let to = value.indexOf("\n", focusEnd);
  if (to === -1) to = value.length;
  return { from, to };
}

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @param {string} before
 * @param {string} [after]
 * @returns {FormatEdit}
 */
export function wrapInline(value, start, end, before, after = before) {
  const selected = value.slice(start, end);

  if (start !== end) {
    if (
      selected.startsWith(before) &&
      selected.endsWith(after) &&
      selected.length >= before.length + after.length
    ) {
      const inner = selected.slice(before.length, selected.length - after.length);
      return {
        from: start,
        to: end,
        text: inner,
        selectionStart: start,
        selectionEnd: start + inner.length,
      };
    }
    if (
      start >= before.length &&
      value.slice(start - before.length, start) === before &&
      value.slice(end, end + after.length) === after
    ) {
      return {
        from: start - before.length,
        to: end + after.length,
        text: selected,
        selectionStart: start - before.length,
        selectionEnd: start - before.length + selected.length,
      };
    }
    const text = before + selected + after;
    return {
      from: start,
      to: end,
      text,
      selectionStart: start + before.length,
      selectionEnd: start + before.length + selected.length,
    };
  }

  const text = before + after;
  const caret = start + before.length;
  return {
    from: start,
    to: end,
    text,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/** Strip common block markers so a new prefix can replace them. */
function stripBlockPrefix(line) {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "");
}

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @param {"quote"|"bullet"|"ordered"|"heading"} type
 * @param {{ level?: number }} [options]
 * @returns {FormatEdit}
 */
export function prefixLines(value, start, end, type, options = {}) {
  const { from, to } = lineRange(value, start, end);
  const block = value.slice(from, to);
  const lines = block.split("\n");
  const level = Math.min(6, Math.max(1, options.level || 2));

  const isQuote = (line) => /^>\s?/.test(line);
  const isBullet = (line) => /^[-*+]\s+/.test(line);
  const isOrdered = (line) => /^\d+\.\s+/.test(line);
  const isHeading = (line) => new RegExp(`^#{${level}}\\s+`).test(line);
  const isAnyHeading = (line) => /^#{1,6}\s+/.test(line);

  let allMatch = false;
  if (type === "quote") allMatch = lines.every(isQuote);
  else if (type === "bullet") allMatch = lines.every(isBullet);
  else if (type === "ordered") allMatch = lines.every(isOrdered);
  else if (type === "heading") allMatch = lines.every(isHeading);

  const next = lines.map((line, i) => {
    if (allMatch) {
      if (type === "quote") return line.replace(/^>\s?/, "");
      if (type === "bullet") return line.replace(/^[-*+]\s+/, "");
      if (type === "ordered") return line.replace(/^\d+\.\s+/, "");
      if (type === "heading") return line.replace(/^#{1,6}\s+/, "");
      return line;
    }
    const body = stripBlockPrefix(line);
    if (type === "quote") return `> ${body}`;
    if (type === "bullet") return `- ${body}`;
    if (type === "ordered") return `${i + 1}. ${body}`;
    if (type === "heading") {
      // Blank lines stay blank (don't turn empty rows into lonely hashes).
      if (!body && !isAnyHeading(line) && !line.trim()) return line;
      return `${"#".repeat(level)} ${body}`;
    }
    return line;
  });

  const text = next.join("\n");
  return {
    from,
    to,
    text,
    selectionStart: from,
    selectionEnd: from + text.length,
  };
}

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @param {string} snippet
 * @param {number} [selectOffset] offset into snippet for selection start
 * @param {number} [selectLength]
 * @returns {FormatEdit}
 */
export function insertSnippet(value, start, end, snippet, selectOffset = snippet.length, selectLength = 0) {
  const selStart = start + Math.max(0, Math.min(selectOffset, snippet.length));
  const selEnd = selStart + Math.max(0, selectLength);
  return {
    from: start,
    to: end,
    text: snippet,
    selectionStart: selStart,
    selectionEnd: Math.min(selEnd, start + snippet.length),
  };
}

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @returns {FormatEdit}
 */
export function insertLink(value, start, end) {
  const selected = value.slice(start, end);
  const label = selected || "text";
  const snippet = `[${label}](url)`;
  const urlOffset = 1 + label.length + 2; // [label](
  return insertSnippet(value, start, end, snippet, urlOffset, 3);
}

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @returns {FormatEdit}
 */
export function insertImage(value, start, end) {
  const selected = value.slice(start, end);
  const alt = selected || "alt";
  const snippet = `![${alt}](url)`;
  const urlOffset = 2 + alt.length + 2; // ![alt](
  return insertSnippet(value, start, end, snippet, urlOffset, 3);
}

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @returns {FormatEdit}
 */
export function insertCodeBlock(value, start, end) {
  const selected = value.slice(start, end);
  if (selected) {
    const body = selected.replace(/\n$/, "");
    const snippet = "```\n" + body + "\n```";
    return {
      from: start,
      to: end,
      text: snippet,
      selectionStart: start,
      selectionEnd: start + snippet.length,
    };
  }
  const snippet = "```\n\n```";
  const caret = start + 4; // after ```\n
  return {
    from: start,
    to: end,
    text: snippet,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

export const TABLE_STUB =
  "| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Cell | Cell | Cell |";

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @returns {FormatEdit}
 */
export function insertTable(value, start, end) {
  return insertSnippet(value, start, end, TABLE_STUB, 0, TABLE_STUB.length);
}

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @returns {FormatEdit}
 */
export function insertHorizontalRule(value, start, end) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  let lead = "";
  if (before.length === 0) lead = "";
  else if (/\n\n$/.test(before)) lead = "";
  else if (/\n$/.test(before)) lead = "\n";
  else lead = "\n\n";
  let trail = "";
  if (after.length === 0) trail = "\n";
  else if (/^\n\n/.test(after)) trail = "";
  else if (/^\n/.test(after)) trail = "\n";
  else trail = "\n\n";
  const snippet = `${lead}---${trail}`;
  const caret = start + snippet.length;
  return {
    from: start,
    to: end,
    text: snippet,
    selectionStart: caret,
    selectionEnd: caret,
  };
}
