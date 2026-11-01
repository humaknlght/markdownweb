import { hooks } from "./hooks.js";
import {
  state,
  editor,
  editorHighlight,
  editorHighlightCode,
  collapsedSections
} from "./state.js";
import {
  EDITOR_HIGHLIGHT_MAX
} from "./constants.js";
import {
  collapseDataUris,
  collapseDataUrisPreservingSelection,
  collapsedEmbedUriTouched,
  expandEmbeds,
  findCollapsedEmbeds,
  escapeHtml,
  highlightEditorMarkdown,
  DOMPurify,
  hljs
} from "./vendor-deps.js";

export function updateEditorHighlight() {
  const value = editor.value;
  let html = "";
  if (value) {
    // Untrusted external content: plain escaped text only — no highlighter.
    if (state.contentIsExternal || value.length > EDITOR_HIGHLIGHT_MAX) {
      html = escapeHtml(value);
    } else {
      try {
        html = highlightEditorMarkdown(value, hljs);
      } catch {
        html = escapeHtml(value);
      }
    }
  }
  // Trailing newline keeps the highlight layer height aligned with the textarea.
  // Sanitize before innerHTML so textarea value cannot be reinterpreted as markup
  // (CodeQL js/xss-through-dom). Highlight output is span/class only.
  editorHighlightCode.innerHTML = DOMPurify.sanitize(
    `${decorateEmbedTokens(html)}\n`,
    { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"] },
  );
  syncEditorHighlightScroll();
}

/** Mark collapsed data-URI tokens so they read as a single truncated chip. */
export function decorateEmbedTokens(html) {
  return html.replace(
    /(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]*…#\d+)/g,
    '<span class="md-data-uri">$1</span>',
  );
}

export function scheduleEditorHighlight() {
  if (state.editorHighlightRaf) return;
  state.editorHighlightRaf = requestAnimationFrame(() => {
    state.editorHighlightRaf = 0;
    updateEditorHighlight();
  });
}

export function syncEditorHighlightScroll() {
  // Match the textarea content box so wrapping stays aligned when a scrollbar
  // occupies space (non-overlay scrollbars on Windows/Linux).
  const dx = editor.offsetWidth - editor.clientWidth;
  const dy = editor.offsetHeight - editor.clientHeight;
  editorHighlight.style.inset = `0 ${dx}px ${dy}px 0`;
  // Translate the highlight content instead of scrolling the layer — keeps
  // browser Find from moving a second scrollport out of sync with #editor.
  editorHighlightCode.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
}

export function setEditorValue(text) {
  editor.value = collapseDataUris(text ?? "");
  collapsedSections.clear();
  scheduleEditorHighlight();
}

/** Full Markdown with data-URI images expanded (for preview, draft, share, copy). */
export function getMarkdownSource() {
  return expandEmbeds(editor.value);
}

export function syncCollapsedDataUris() {
  const before = editor.value;
  const { text, caretStart, caretEnd } = collapseDataUrisPreservingSelection(
    before,
    editor.selectionStart,
    editor.selectionEnd,
  );
  if (text === before) return;

  // Prefer execCommand so collapsing a pasted data URI stays on the Undo stack.
  if (!replaceEditorRange(0, before.length, text, { notify: false })) {
    editor.value = text;
  }
  editor.setSelectionRange(caretStart, caretEnd);
}

export function onEditorCopyOrCut(e) {
  let start = editor.selectionStart;
  let end = editor.selectionEnd;
  if (start === end) return;

  // Partial selection through a truncated data URI takes the whole image token.
  for (const emb of findCollapsedEmbeds(editor.value)) {
    if (start < emb.uriEnd && end > emb.uriStart) {
      start = Math.min(start, emb.fullStart);
      end = Math.max(end, emb.fullEnd);
    }
  }

  const selected = editor.value.slice(start, end);
  const expanded = expandEmbeds(selected);
  const rangeChanged = start !== editor.selectionStart || end !== editor.selectionEnd;
  if (expanded === selected && !rangeChanged) return;

  e.clipboardData.setData("text/plain", expanded);
  e.preventDefault();

  if (e.type === "cut") {
    replaceEditorRange(start, end, "");
  }
}

/**
 * Replace a textarea range via execCommand when possible so Ctrl+Z / Undo works.
 * Falls back to setRangeText (not undoable) when execCommand is unavailable.
 */

export function replaceEditorRange(start, end, text, { notify = true } = {}) {
  editor.focus();
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  const before = editor.value;
  editor.setSelectionRange(from, to);

  state.suppressEditorInput = true;
  let ok = false;
  try {
    if (text === "") {
      ok = from < to ? document.execCommand("delete") : true;
    } else {
      ok = document.execCommand("insertText", false, text);
    }
  } catch {
    ok = false;
  }
  // Some browsers report success even when nothing changed (or the reverse).
  if (from < to || text !== "") {
    ok = editor.value !== before;
  }
  state.suppressEditorInput = false;

  if (!ok) {
    if (typeof editor.setRangeText === "function") {
      editor.setRangeText(text, from, to, "end");
    } else {
      editor.value = editor.value.slice(0, from) + text + editor.value.slice(to);
      editor.selectionStart = editor.selectionEnd = from + text.length;
    }
  }

  if (notify) hooks.onEditorInput();
  return ok;
}

/** Editing a truncated data URI removes the whole `![…](data:…)` token. */
export function onEditorBeforeInput(e) {
  const inputType = e.inputType || "";
  if (inputType === "historyUndo" || inputType === "historyRedo") return;
  if (state.suppressEditorInput) return;

  const embeds = findCollapsedEmbeds(editor.value);
  if (!embeds.length) return;

  const selStart = editor.selectionStart;
  const selEnd = editor.selectionEnd;
  const touched = embeds.filter((emb) =>
    collapsedEmbedUriTouched(emb, selStart, selEnd, inputType),
  );
  if (!touched.length) return;

  e.preventDefault();

  const delStart = Math.min(selStart, ...touched.map((emb) => emb.fullStart));
  const delEnd = Math.max(selEnd, ...touched.map((emb) => emb.fullEnd));

  let insert = "";
  if (
    inputType.startsWith("insert") ||
    inputType === "insertText" ||
    inputType === "insertFromPaste" ||
    inputType === "insertFromDrop" ||
    inputType === "insertCompositionText" ||
    inputType === "insertReplacementText"
  ) {
    insert = e.data ?? "";
  }

  replaceEditorRange(delStart, delEnd, insert);
}

hooks.updateEditorHighlight = updateEditorHighlight;
hooks.decorateEmbedTokens = decorateEmbedTokens;
hooks.scheduleEditorHighlight = scheduleEditorHighlight;
hooks.syncEditorHighlightScroll = syncEditorHighlightScroll;
hooks.setEditorValue = setEditorValue;
hooks.getMarkdownSource = getMarkdownSource;
hooks.syncCollapsedDataUris = syncCollapsedDataUris;
hooks.onEditorCopyOrCut = onEditorCopyOrCut;
hooks.replaceEditorRange = replaceEditorRange;
hooks.onEditorBeforeInput = onEditorBeforeInput;
