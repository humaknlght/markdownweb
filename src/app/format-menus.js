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

export function closeHeadingMenu() {
  if (!headingMenu || !headingMenuBtn) return;
  headingMenu.hidden = true;
  headingMenuBtn.setAttribute("aria-expanded", "false");
}

export function openHeadingMenu() {
  if (!headingMenu || !headingMenuBtn) return;
  headingMenu.hidden = false;
  headingMenuBtn.setAttribute("aria-expanded", "true");
}

export function toggleHeadingMenu() {
  if (!headingMenu) return;
  if (headingMenu.hidden) {
    closeImageMenu();
    closeFormatMoreMenu();
    hooks.closeHistory();
    hooks.closeVoiceMenu();
    hooks.closeShareMenu();
    hooks.closeExportMenu();
    hooks.closeWritingToolsMenu();
    hooks.closeViewModeMenu();
    openHeadingMenu();
  } else {
    closeHeadingMenu();
  }
}

export function closeImageMenu() {
  if (!imageMenu || !imageMenuBtn) return;
  imageMenu.hidden = true;
  imageMenuBtn.setAttribute("aria-expanded", "false");
}

export function openImageMenu() {
  if (!imageMenu || !imageMenuBtn) return;
  imageMenu.hidden = false;
  imageMenuBtn.setAttribute("aria-expanded", "true");
}

export function toggleImageMenu() {
  if (!imageMenu) return;
  if (imageMenu.hidden) {
    closeHeadingMenu();
    closeFormatMoreMenu();
    hooks.closeHistory();
    hooks.closeVoiceMenu();
    hooks.closeShareMenu();
    hooks.closeExportMenu();
    hooks.closeWritingToolsMenu();
    hooks.closeViewModeMenu();
    openImageMenu();
  } else {
    closeImageMenu();
  }
}

export function closeFormatMoreMenu() {
  if (!formatMoreMenu || !formatMoreBtn) return;
  formatMoreMenu.hidden = true;
  formatMoreBtn.setAttribute("aria-expanded", "false");
}

export function openFormatMoreMenu() {
  if (!formatMoreMenu || !formatMoreBtn) return;
  formatMoreMenu.hidden = false;
  formatMoreBtn.setAttribute("aria-expanded", "true");
}

export function toggleFormatMoreMenu() {
  if (!formatMoreMenu) return;
  if (formatMoreMenu.hidden) {
    closeHeadingMenu();
    closeImageMenu();
    hooks.closeHistory();
    hooks.closeVoiceMenu();
    hooks.closeShareMenu();
    hooks.closeExportMenu();
    hooks.closeWritingToolsMenu();
    hooks.closeViewModeMenu();
    openFormatMoreMenu();
  } else {
    closeFormatMoreMenu();
  }
}

export function pickImageFromDisk() {
  if (!formatImageInput) return;
  state.pendingFormatImageRange = {
    start: editor.selectionStart,
    end: editor.selectionEnd,
  };
  formatImageInput.click();
}

/**
 * Embed an image file at a textarea range as a Markdown data-URI (same path as paste).
 * @param {File} file
 * @param {{ start?: number, end?: number, toast?: string }} [opts]
 */
export async function insertImageFromFile(file, opts = {}) {
  if (!file || !IMAGE_MIME_RE.test(file.type)) {
    hooks.showToast("Not an image file");
    return;
  }
  if (file.size > IMAGE_PASTE_MAX_BYTES) {
    hooks.showToast("Image too large (max 2 MB)");
    return;
  }
  const start = opts.start ?? editor.selectionStart;
  const end = opts.end ?? editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  try {
    const dataUrl = await readFileAsDataURL(file);
    if (!dataUrl.startsWith("data:image/")) {
      hooks.showToast("Could not insert image");
      return;
    }
    editor.focus();
    editor.setSelectionRange(start, end);
    hooks.insertAtCursor(formatEmbedMarkdown(imageAltFromSelection(selected, file), dataUrl));
    hooks.showToast(opts.toast || "Image inserted");
  } catch {
    hooks.showToast("Could not insert image");
  }
}

/**
 * When the editor pane (or viewport) is too narrow for every format control,
 * fold Image / Code block / Table / HR into the kebab. Driven by the bar’s
 * own width so splitter resizes are covered — not just viewport media queries.
 */
const FORMAT_BAR_COMPACT_MAX = 580;

export function syncFormatBarCompact() {
  if (!formatBar) return;
  const width = formatBar.getBoundingClientRect().width;
  if (width <= 0) return;
  const compact = width < FORMAT_BAR_COMPACT_MAX;
  const wasCompact = formatBar.classList.contains("is-compact");
  if (compact === wasCompact) return;
  formatBar.classList.toggle("is-compact", compact);
  if (compact) closeImageMenu();
  else closeFormatMoreMenu();
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function clipboardImageFile(clipboardData) {
  if (!clipboardData) return null;
  const items = clipboardData.items;
  if (items) {
    for (const item of items) {
      if (item.kind === "file" && IMAGE_MIME_RE.test(item.type)) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  const files = clipboardData.files;
  if (files?.length) {
    for (const file of files) {
      if (IMAGE_MIME_RE.test(file.type)) return file;
    }
  }
  return null;
}

export function imageAltFromSelection(selected, file) {
  const fromSelection = selected.trim();
  if (fromSelection) return fromSelection.replace(/[\[\]]/g, "");
  const name = (file.name || "").replace(/\.[^.]+$/, "").trim();
  if (name && !/^image$/i.test(name)) return name.replace(/[\[\]]/g, "");
  return "image";
}

export async function onEditorPaste(e) {
  const file = clipboardImageFile(e.clipboardData);
  if (!file) return;

  e.preventDefault();
  await insertImageFromFile(file, {
    start: editor.selectionStart,
    end: editor.selectionEnd,
    toast: "Image pasted",
  });
}

hooks.closeHeadingMenu = closeHeadingMenu;
hooks.openHeadingMenu = openHeadingMenu;
hooks.toggleHeadingMenu = toggleHeadingMenu;
hooks.closeImageMenu = closeImageMenu;
hooks.openImageMenu = openImageMenu;
hooks.toggleImageMenu = toggleImageMenu;
hooks.closeFormatMoreMenu = closeFormatMoreMenu;
hooks.openFormatMoreMenu = openFormatMoreMenu;
hooks.toggleFormatMoreMenu = toggleFormatMoreMenu;
hooks.pickImageFromDisk = pickImageFromDisk;
hooks.insertImageFromFile = insertImageFromFile;
hooks.syncFormatBarCompact = syncFormatBarCompact;
hooks.readFileAsDataURL = readFileAsDataURL;
hooks.clipboardImageFile = clipboardImageFile;
hooks.imageAltFromSelection = imageAltFromSelection;
hooks.onEditorPaste = onEditorPaste;
