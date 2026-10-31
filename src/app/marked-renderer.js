import { hooks } from "./hooks.js";
import {
  canonicalHljsLang,
  escapeHtml,
  marked,
  Renderer,
  hljs,
  wrapHighlightedLines,
} from "./vendor-deps.js";

/** Assign 1-based source line numbers to top-level block tokens. */
export function annotateSourceLines(tokens) {
  let line = 1;
  for (const token of tokens) {
    if (token.type !== "space") {
      token._sourceLine = line;
      const newlines = (token.raw.match(/\n/g) || []).length;
      // End line of the block content (inclusive). Trailing blank lines in
      // `raw` still advance `line` below, but the visible block ends earlier.
      token._sourceLineEnd = line + Math.max(newlines - 1, 0);
    }
    line += (token.raw.match(/\n/g) || []).length;
  }
  return tokens;
}

export function withSourceLine(html, line, lineEnd) {
  if (line == null || line < 1 || !html) return html;
  const endAttr =
    lineEnd != null && lineEnd > line ? ` data-source-line-end="${lineEnd}"` : "";
  return html.replace(
    /^(\s*<[a-zA-Z][a-zA-Z0-9-]*)/,
    `$1 data-source-line="${line}"${endAttr}`,
  );
}

const rendererProto = Renderer.prototype;

export function highlightCode(text, lang) {
  const language = canonicalHljsLang(lang);
  try {
    if (language && hljs.getLanguage(language)) {
      return {
        html: hljs.highlight(text, { language, ignoreIllegals: true }).value,
        language,
      };
    }
  } catch {
    /* fall through */
  }
  return { html: escapeHtml(text), language };
}

export function addCodeLineNumbers(root) {
  root.querySelectorAll("pre > code").forEach((code) => {
    const lines = code.querySelectorAll(":scope > .code-line");
    lines.forEach((line, index) => {
      if (line.querySelector(":scope > .line-num")) return;
      const num = document.createElement("span");
      num.className = "line-num";
      num.setAttribute("aria-hidden", "true");
      num.textContent = String(index + 1);
      line.insertBefore(num, line.firstChild);
    });
  });
}

marked.use({
  hooks: {
    processAllTokens(tokens) {
      return annotateSourceLines(tokens);
    },
  },
  renderer: {
    heading(token) {
      return withSourceLine(
        rendererProto.heading.call(this, token),
        token._sourceLine,
        token._sourceLineEnd,
      );
    },
    paragraph(token) {
      return withSourceLine(
        rendererProto.paragraph.call(this, token),
        token._sourceLine,
        token._sourceLineEnd,
      );
    },
    list(token) {
      return withSourceLine(
        rendererProto.list.call(this, token),
        token._sourceLine,
        token._sourceLineEnd,
      );
    },
    blockquote(token) {
      return withSourceLine(
        rendererProto.blockquote.call(this, token),
        token._sourceLine,
        token._sourceLineEnd,
      );
    },
    table(token) {
      return withSourceLine(
        rendererProto.table.call(this, token),
        token._sourceLine,
        token._sourceLineEnd,
      );
    },
    hr(token) {
      return withSourceLine(
        rendererProto.hr.call(this, token),
        token._sourceLine,
        token._sourceLineEnd,
      );
    },
    html(token) {
      return withSourceLine(
        rendererProto.html.call(this, token),
        token._sourceLine,
        token._sourceLineEnd,
      );
    },
    code(token) {
      const { text, lang, _sourceLine, _sourceLineEnd } = token;
      const language = (lang || "").trim().split(/\s+/)[0].toLowerCase();
      if (language === "mermaid") {
        return withSourceLine(
          `<div class="mermaid">${escapeHtml(hooks.normalizeMermaidSource(text))}</div>\n`,
          _sourceLine,
          _sourceLineEnd,
        );
      }
      const code = text.replace(/\n$/, "") + "\n";
      const { html, language: highlighted } = highlightCode(code, lang);
      const classes = ["hljs"];
      if (highlighted) classes.push(`language-${highlighted}`);
      return withSourceLine(
        `<pre><code class="${classes.join(" ")}">${wrapHighlightedLines(html)}</code></pre>\n`,
        _sourceLine,
        _sourceLineEnd,
      );
    },
  },
});

hooks.annotateSourceLines = annotateSourceLines;
hooks.withSourceLine = withSourceLine;
hooks.highlightCode = highlightCode;
hooks.addCodeLineNumbers = addCodeLineNumbers;
