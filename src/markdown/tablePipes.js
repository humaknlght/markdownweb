/**
 * marked does not honor GFM's rule that `|` inside inline code spans is not a
 * table cell delimiter. Escape those pipes before lexing so splitCells keeps
 * the cell intact; marked then strips the escapes when building cell text.
 */

const FENCE_OPEN = /^ {0,3}([`~]{3,})(.*)$/;

function isTableDelimiter(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = inner.split("|");
  return (
    cells.length > 0 &&
    cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell) && cell.includes("-"))
  );
}

function isTableBodyRow(line) {
  if (!line.trim()) return false;
  if (/^ {0,3}(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(line)) return false;
  return line.includes("|");
}

/** Escape unescaped `|` characters in `content`. */
function escapePipes(content) {
  let out = "";
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "|") {
      let bs = 0;
      while (i - 1 - bs >= 0 && content[i - 1 - bs] === "\\") bs++;
      if (bs % 2 === 0) out += "\\";
    }
    out += content[i];
  }
  return out;
}

/** Escape `|` inside inline code spans on a single line. */
function escapeCodeSpanPipes(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      out += line[i];
      i++;
      continue;
    }

    let j = i;
    while (j < line.length && line[j] === "`") j++;
    const ticks = line.slice(i, j);
    const close = line.indexOf(ticks, j);
    if (close === -1) {
      out += line[i];
      i++;
      continue;
    }

    const content = line.slice(j, close);
    out += ticks + escapePipes(content) + ticks;
    i = close + ticks.length;
  }
  return out;
}

function sameFenceCloser(line, openTicks) {
  const match = line.match(/^ {0,3}([`~]{3,})\s*$/);
  if (!match) return false;
  const closer = match[1];
  return closer[0] === openTicks[0] && closer.length >= openTicks.length;
}

/** Escape `|` inside code spans that sit in GFM table rows. */
export function escapePipesInTableCodeSpans(src) {
  const lines = src.split("\n");
  const out = [];
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence) {
      out.push(line);
      if (sameFenceCloser(line, fence)) fence = null;
      continue;
    }

    const fenceMatch = line.match(FENCE_OPEN);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const info = fenceMatch[2];
      // Opening fence must not contain the fence char in the info string for `.
      if (marker[0] !== "`" || !info.includes("`")) {
        fence = marker;
      }
      out.push(line);
      continue;
    }

    if (
      i + 1 < lines.length &&
      line.includes("|") &&
      isTableDelimiter(lines[i + 1])
    ) {
      out.push(escapeCodeSpanPipes(line));
      i += 1;
      out.push(lines[i]);
      while (i + 1 < lines.length && isTableBodyRow(lines[i + 1])) {
        i += 1;
        out.push(escapeCodeSpanPipes(lines[i]));
      }
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

/** marked extension: keep `|` inside table code spans from splitting cells */
export function tablePipesExtension() {
  return {
    hooks: {
      preprocess(src) {
        return escapePipesInTableCodeSpans(src);
      },
    },
  };
}
