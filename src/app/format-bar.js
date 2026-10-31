import { hooks } from "./hooks.js";
import {
  state,
  editor,
  panes,
  formatBar,
  headingMenuBtn,
  headingMenu,
  imageMenuBtn,
  imageMenu,
  formatImageInput,
  formatMoreBtn,
  formatMoreMenu
} from "./state.js";
import {
  HISTORY_DEBOUNCE_MS,
  IMAGE_MIME_RE,
  IMAGE_PASTE_MAX_BYTES
} from "./constants.js";
import {
  formatEmbedMarkdown,
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertTable,
  prefixLines,
  wrapInline
} from "./vendor-deps.js";


export function onEditorInput() {
  if (state.suppressEditorInput) return;
  hooks.syncCollapsedDataUris();
  const source = hooks.getMarkdownSource();
  // Hold draft/history until Accept so Reject can fully discard untrusted content.
  if (!state.contentIsExternal) {
    hooks.persistDraftFireAndForget(source);
  }
  hooks.scheduleEditorHighlight();
  hooks.invalidateScrollAnchors();
  hooks.scheduleRender();
  hooks.updateSaveButton();
  window.clearTimeout(state.historyTimer);
  state.historyTimer = window.setTimeout(() => void hooks.pushHistory(source), HISTORY_DEBOUNCE_MS);
}

/** Insert text at the caret (replacing any selection). Prefer execCommand so Undo works. */
export function insertAtCursor(text) {
  hooks.replaceEditorRange(editor.selectionStart, editor.selectionEnd, text);
}

/**
 * Apply a format-bar edit (range replace + selection) via the undo-safe path.
 * @param {{ from: number, to: number, text: string, selectionStart: number, selectionEnd: number }} edit
 */
export function applyFormatEdit(edit) {
  hooks.replaceEditorRange(edit.from, edit.to, edit.text);
  const max = editor.value.length;
  const selStart = Math.max(0, Math.min(edit.selectionStart, max));
  const selEnd = Math.max(0, Math.min(edit.selectionEnd, max));
  editor.setSelectionRange(selStart, selEnd);
}

/** @param {string} action @param {{ level?: number }} [opts] */
export function runFormatAction(action, opts = {}) {
  if (!hooks.isAuthoringView() || panes.classList.contains("editor-collapsed")) return;
  const value = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  let edit = null;
  switch (action) {
    case "bold":
      edit = wrapInline(value, start, end, "**");
      break;
    case "italic":
      edit = wrapInline(value, start, end, "_");
      break;
    case "code":
      edit = wrapInline(value, start, end, "`");
      break;
    case "link":
      edit = insertLink(value, start, end);
      break;
    case "quote":
      edit = prefixLines(value, start, end, "quote");
      break;
    case "bullet":
      edit = prefixLines(value, start, end, "bullet");
      break;
    case "ordered":
      edit = prefixLines(value, start, end, "ordered");
      break;
    case "heading":
      edit = prefixLines(value, start, end, "heading", { level: opts.level || 2 });
      break;
    case "image":
    case "image-url":
      edit = insertImage(value, start, end);
      break;
    case "image-file":
      hooks.pickImageFromDisk();
      return;
    case "code-block":
      edit = insertCodeBlock(value, start, end);
      break;
    case "table":
      edit = insertTable(value, start, end);
      break;
    case "hr":
      edit = insertHorizontalRule(value, start, end);
      break;
    default:
      return;
  }
  if (edit) applyFormatEdit(edit);
}

hooks.onEditorInput = onEditorInput;
hooks.insertAtCursor = insertAtCursor;
hooks.applyFormatEdit = applyFormatEdit;
hooks.runFormatAction = runFormatAction;
