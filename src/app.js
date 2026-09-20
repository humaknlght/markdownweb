import { alertExtension } from "./alert.js";
import { emojiExtension } from "./emoji.js";
import {
  buildDocxBlob,
  buildHtmlDocument,
  buildMarkdownFile,
  buildRtfDocument,
  cleanPreviewHtml,
  downloadBlob,
  exportBasename,
  printPreviewAsPdf,
} from "./export.js";
import {
  clearStoredDirectory,
  createFile,
  createFolder,
  ensureEditableExtension,
  ensureHandlePermission,
  isEditableFileName,
  isFsAccessSupported,
  listDirectory,
  openDirectory,
  readTextFile,
  removeEntry,
  renameEntry,
  restoreDirectory,
  loadStoredCurrentFileHandle,
  resolveFilePath,
  saveWithPicker,
  storeCurrentFileHandle,
  suggestedUntitledName,
  writeTextFile,
} from "./fs.js";
import { marked, Renderer } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";

const STORAGE_KEYS = {
  draft: "md-preview:draft",
  theme: "md-preview:theme",
  editorCollapsed: "md-preview:editor-collapsed",
  previewCollapsed: "md-preview:preview-collapsed",
  history: "md-preview:history",
  split: "md-preview:split",
  width: "md-preview:width",
  voice: "md-preview:voice",
  syncScroll: "md-preview:sync-scroll",
  filesDrawer: "md-preview:filesDrawer",
  currentFile: "md-preview:currentFile",
  currentFilePath: "md-preview:currentFilePath",
  savedSnapshot: "md-preview:savedSnapshot",
};

const HISTORY_LIMIT = 20;
const HISTORY_MAX_CHARS = 200_000;
const RENDER_DEBOUNCE_MS = 80;
const HISTORY_DEBOUNCE_MS = 1000;
const SPLIT_MIN = 15;
const SPLIT_MAX = 85;
const AUTO_HIGHLIGHT_MAX = 8_000;
const EDITOR_HIGHLIGHT_MAX = 100_000;
const NARROW_MQ = "(max-width: 800px)";
const TEXT_FILE_RE = /\.(md|markdown|mdown|mkd|txt|html|htm)$/i;
const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
/** Raw clipboard image size cap before base64 (keeps drafts / history workable). */
const IMAGE_PASTE_MAX_BYTES = 2 * 1024 * 1024;
/** Collapse data-URI images longer than this into a one-line editor token. */
const DATA_URI_COLLAPSE_MIN = 64;
const DATA_URI_IMG_RE =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/gi;
/** Truncated editor form: `![alt](data:image/png;base64,iVBORw0KGgo…#3)` */
const EMBED_IMG_RE =
  /!\[([^\]]*)\]\(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]*…#(\d+)\)/g;
const THEMES = ["github-light", "github-dark", "sepia", "terminal", "salesforce", "fancy"];
const WIDTHS = ["readable", "full"];
const VIEWS = ["edit", "reader", "present"];

const editor = document.getElementById("editor");
const editorHighlight = document.getElementById("editor-highlight");
const editorHighlightCode = editorHighlight.querySelector("code");
/** @type {Map<number, string>} */
const imageEmbeds = new Map();
let nextEmbedId = 1;
const preview = document.getElementById("preview");
const panes = document.getElementById("panes");
const splitter = document.getElementById("splitter");
const themeSelect = document.getElementById("theme-select");
const widthSelect = document.getElementById("width-select");
const fileInput = document.getElementById("file-input");
const shareDropdown = document.getElementById("share-dropdown");
const shareBtn = document.getElementById("share-btn");
const shareMenu = document.getElementById("share-menu");
const shareReaderBtn = document.getElementById("share-reader-btn");
const sharePresentBtn = document.getElementById("share-present-btn");
const exportDropdown = document.getElementById("export-dropdown");
const exportBtn = document.getElementById("export-btn");
const exportMenu = document.getElementById("export-menu");
const speakDropdown = document.getElementById("speak-dropdown");
const speakBtn = document.getElementById("speak-btn");
const speakPauseBtn = document.getElementById("speak-pause-btn");
const voiceMenuBtn = document.getElementById("voice-menu-btn");
const voiceMenu = document.getElementById("voice-menu");
const collapseEditorBtn = document.getElementById("collapse-editor");
const collapsePreviewBtn = document.getElementById("collapse-preview");
const syncScrollBtn = document.getElementById("sync-scroll-btn");
const previewPane = document.getElementById("preview-pane");
const historyBtn = document.getElementById("history-btn");
const historyMenu = document.getElementById("history-menu");
const historyDropdown = document.getElementById("history-dropdown");
const toolbarMenu = document.getElementById("toolbar-menu");
const toolbarActions = document.getElementById("toolbar-actions");
const overflowBtn = document.getElementById("overflow-btn");
const toastEl = document.getElementById("toast");
const dropOverlay = document.getElementById("drop-overlay");
const photoCredit = document.getElementById("photo-credit");
const editViewBtn = document.getElementById("edit-view-btn");
const presentViewBtn = document.getElementById("present-view-btn");
const printBtn = document.getElementById("print-btn");
const presentChrome = document.getElementById("present-chrome");
const presentPrevBtn = document.getElementById("present-prev-btn");
const presentNextBtn = document.getElementById("present-next-btn");
const presentExitBtn = document.getElementById("present-exit-btn");
const presentProgress = document.getElementById("present-progress");
const externalModal = document.getElementById("external-modal");
const installBtn = document.getElementById("install-btn");
const updateToast = document.getElementById("update-toast");
const updateReloadBtn = document.getElementById("update-reload-btn");
const filesToggleBtn = document.getElementById("files-toggle-btn");
const saveBtn = document.getElementById("save-btn");
const filesDrawer = document.getElementById("files-drawer");
const filesBackdrop = document.getElementById("files-backdrop");
const filesDrawerTitle = document.getElementById("files-drawer-title");
const filesOpenFolderBtn = document.getElementById("files-open-folder-btn");
const filesNewFileBtn = document.getElementById("files-new-file-btn");
const filesNewFolderBtn = document.getElementById("files-new-folder-btn");
const filesRefreshBtn = document.getElementById("files-refresh-btn");
const filesEmpty = document.getElementById("files-empty");
const filesEmptyOpenBtn = document.getElementById("files-empty-open-btn");
const filesPermission = document.getElementById("files-permission");
const filesRegrantBtn = document.getElementById("files-regrant-btn");
const filesReopenBtn = document.getElementById("files-reopen-btn");
const filesTree = document.getElementById("files-tree");
const filesContextMenu = document.getElementById("files-context-menu");
const currentFileNameEl = document.getElementById("current-file-name");
const outlineEmpty = document.getElementById("outline-empty");
const outlineList = document.getElementById("outline-list");

const speechSupported = typeof window.SpeechSynthesisUtterance !== "undefined";
const fsAccessSupported = isFsAccessSupported();

/** @type {FileSystemDirectoryHandle|null} */
let rootDirHandle = null;
/** @type {FileSystemDirectoryHandle|null} */
let selectedDirHandle = null;
/** @type {string} */
let selectedPath = "";
/** @type {FileSystemFileHandle|null} */
let currentFileHandle = null;
/** @type {string} */
let currentFileName = "";
/** @type {string} Relative path under the open folder, when known. */
let currentFilePath = "";
/** @type {string} */
let savedSnapshot = "";
/** @type {Map<string, { kind: "file"|"directory", handle: FileSystemHandle, parent: FileSystemDirectoryHandle|null, path: string }>} */
const fsEntries = new Map();
/** @type {Set<string>} */
const expandedPaths = new Set();
/** @type {{ path: string, kind: "file"|"directory" }|null} */
let contextTarget = null;
let filesDrawerOpen = false;
let awaitingFsPermission = false;

function isStandaloneDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

// Capture beforeinstallprompt as early as possible. ES modules often run after
// `load`, and Chrome may fire BIP before init() wires listeners.
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installBtn && !isStandaloneDisplay()) {
    installBtn.hidden = false;
  }
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installBtn) installBtn.hidden = true;
  showToast("App installed");
});

marked.setOptions({
  gfm: true,
  breaks: false,
});

marked.use(emojiExtension());
marked.use(alertExtension());

// Open all markdown links in a new tab; noopener/noreferrer blocks window.opener abuse.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if ("target" in node) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

let editorHighlightRaf = 0;

function updateEditorHighlight() {
  const value = editor.value;
  let html = "";
  if (value) {
    if (value.length > EDITOR_HIGHLIGHT_MAX) {
      html = escapeHtml(value);
    } else {
      try {
        html = hljs.highlight(value, { language: "markdown", ignoreIllegals: true }).value;
      } catch {
        html = escapeHtml(value);
      }
    }
  }
  // Trailing newline keeps the highlight layer height aligned with the textarea.
  editorHighlightCode.innerHTML = `${decorateEmbedTokens(html)}\n`;
  syncEditorHighlightScroll();
}

/** Mark collapsed data-URI tokens so they read as a single truncated chip. */
function decorateEmbedTokens(html) {
  return html.replace(
    /(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]*…#\d+)/g,
    '<span class="md-data-uri">$1</span>',
  );
}

function scheduleEditorHighlight() {
  if (editorHighlightRaf) return;
  editorHighlightRaf = requestAnimationFrame(() => {
    editorHighlightRaf = 0;
    updateEditorHighlight();
  });
}

function syncEditorHighlightScroll() {
  // Match the textarea content box so wrapping stays aligned when a scrollbar
  // occupies space (non-overlay scrollbars on Windows/Linux).
  const dx = editor.offsetWidth - editor.clientWidth;
  const dy = editor.offsetHeight - editor.clientHeight;
  editorHighlight.style.inset = `0 ${dx}px ${dy}px 0`;
  editorHighlight.scrollTop = editor.scrollTop;
  editorHighlight.scrollLeft = editor.scrollLeft;
}

function setEditorValue(text) {
  editor.value = collapseDataUris(text ?? "");
  updateEditorHighlight();
}

/** Full Markdown with data-URI images expanded (for preview, draft, share, copy). */
function getMarkdownSource() {
  return expandEmbeds(editor.value);
}

function rememberEmbed(dataUrl) {
  for (const [id, url] of imageEmbeds) {
    if (url === dataUrl) return id;
  }
  const id = nextEmbedId++;
  imageEmbeds.set(id, dataUrl);
  return id;
}

function formatEmbedMarkdown(alt, dataUrl) {
  const compact = String(dataUrl || "").replace(/\s+/g, "");
  const match = compact.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match || compact.length < DATA_URI_COLLAPSE_MIN) {
    return `![${alt}](${compact})`;
  }
  const mime = match[1];
  const head = match[2].slice(0, 12);
  const id = rememberEmbed(compact);
  return `![${alt}](data:${mime};base64,${head}…#${id})`;
}

function expandEmbeds(text) {
  return String(text || "").replace(EMBED_IMG_RE, (full, alt, idStr) => {
    const dataUrl = imageEmbeds.get(Number(idStr));
    if (!dataUrl) return full;
    return `![${alt}](${dataUrl})`;
  });
}

function collapseDataUris(text) {
  return String(text || "").replace(DATA_URI_IMG_RE, (_, alt, dataUrl) =>
    formatEmbedMarkdown(alt, dataUrl),
  );
}

function collapseDataUrisPreservingSelection(text, selStart, selEnd) {
  let out = "";
  let last = 0;
  let caretStart = selStart;
  let caretEnd = selEnd;
  const src = String(text || "");

  for (const match of src.matchAll(DATA_URI_IMG_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    out += src.slice(last, start);
    const replacement = formatEmbedMarkdown(match[1], match[2]);
    const delta = replacement.length - match[0].length;

    if (selStart >= end) caretStart += delta;
    else if (selStart > start) caretStart = out.length + replacement.length;

    if (selEnd >= end) caretEnd += delta;
    else if (selEnd > start) caretEnd = out.length + replacement.length;

    out += replacement;
    last = end;
  }
  out += src.slice(last);
  return { text: out, caretStart, caretEnd };
}

function syncCollapsedDataUris() {
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

function onEditorCopyOrCut(e) {
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

/** Collapsed `![alt](data:…#id)` tokens; uri* covers `(data:…#id)`. */
function findCollapsedEmbeds(text) {
  const embeds = [];
  for (const match of String(text || "").matchAll(EMBED_IMG_RE)) {
    const fullStart = match.index ?? 0;
    const fullEnd = fullStart + match[0].length;
    const paren = match[0].indexOf("](");
    if (paren < 0) continue;
    const uriStart = fullStart + paren + 1; // '('
    const uriEnd = fullEnd; // after ')'
    embeds.push({ fullStart, fullEnd, uriStart, uriEnd });
  }
  return embeds;
}

function collapsedEmbedUriTouched(emb, selStart, selEnd, inputType) {
  if (selStart < emb.uriEnd && selEnd > emb.uriStart) return true;
  if (selStart !== selEnd) return false;
  if (inputType === "deleteContentBackward" && selStart === emb.uriEnd) return true;
  if (inputType === "deleteContentForward" && selStart === emb.uriStart) return true;
  return false;
}

/**
 * Replace a textarea range via execCommand when possible so Ctrl+Z / Undo works.
 * Falls back to setRangeText (not undoable) when execCommand is unavailable.
 */
let suppressEditorInput = false;

function replaceEditorRange(start, end, text, { notify = true } = {}) {
  editor.focus();
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  const before = editor.value;
  editor.setSelectionRange(from, to);

  suppressEditorInput = true;
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
  suppressEditorInput = false;

  if (!ok) {
    if (typeof editor.setRangeText === "function") {
      editor.setRangeText(text, from, to, "end");
    } else {
      editor.value = editor.value.slice(0, from) + text + editor.value.slice(to);
      editor.selectionStart = editor.selectionEnd = from + text.length;
    }
  }

  if (notify) onEditorInput();
  return ok;
}

/** Editing a truncated data URI removes the whole `![…](data:…)` token. */
function onEditorBeforeInput(e) {
  const inputType = e.inputType || "";
  if (inputType === "historyUndo" || inputType === "historyRedo") return;
  if (suppressEditorInput) return;

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

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Assign 1-based source line numbers to top-level block tokens. */
function annotateSourceLines(tokens) {
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

function withSourceLine(html, line, lineEnd) {
  if (line == null || line < 1 || !html) return html;
  const endAttr =
    lineEnd != null && lineEnd > line ? ` data-source-line-end="${lineEnd}"` : "";
  return html.replace(
    /^(\s*<[a-zA-Z][a-zA-Z0-9-]*)/,
    `$1 data-source-line="${line}"${endAttr}`,
  );
}

const rendererProto = Renderer.prototype;

function highlightCode(text, lang) {
  const language = (lang || "").trim().split(/\s+/)[0].toLowerCase();
  try {
    if (language && hljs.getLanguage(language)) {
      return {
        html: hljs.highlight(text, { language, ignoreIllegals: true }).value,
        language,
      };
    }
    if (text.length <= AUTO_HIGHLIGHT_MAX) {
      const result = hljs.highlightAuto(text);
      return {
        html: result.value,
        language: result.language || "",
      };
    }
  } catch {
    /* fall through */
  }
  return { html: escapeHtml(text), language };
}

function wrapHighlightedLines(html) {
  const lines = html.replace(/\n$/, "").split("\n");
  const openTags = [];
  let out = "";

  for (const line of lines) {
    const prefix = openTags.join("");
    const tagRe = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;
    let match = tagRe.exec(line);
    while (match) {
      const [tag, name] = match;
      if (tag.startsWith("</")) {
        openTags.pop();
      } else if (!/\/\s*>$/.test(tag) && name.toLowerCase() !== "br") {
        openTags.push(tag);
      }
      match = tagRe.exec(line);
    }
    const suffix = openTags
      .map((tag) => `</${tag.match(/^<([a-zA-Z][\w:-]*)/)[1]}>`)
      .reverse()
      .join("");
    out += `<span class="code-line"><span class="line-src">${prefix}${line}${suffix}</span></span>`;
  }

  return out || `<span class="code-line"><span class="line-src"></span></span>`;
}

function addCodeLineNumbers(root) {
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
          `<div class="mermaid">${escapeHtml(text.replace(/\n$/, ""))}</div>\n`,
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

let renderTimer = 0;
let historyTimer = 0;
let rafId = 0;
let toastTimer = 0;
let lastHistoryContent = "";
let splitPercent = 50;
let speechActive = false;
let speechPaused = false;
let speechQueue = [];
let speechKeepalive = 0;
let selectedVoiceURI = "";
let speechMap = null;
let currentView = "edit";
let viewBeforePresent = "reader";
let presentSections = [];
let presentIndex = 0;
/** True when Markdown was loaded from a share URL, upload, or OS file launch. */
let contentIsExternal = false;
/** Content awaiting Accept/Reject; kept so Reject can scrub history after edits. */
let pendingExternalContent = null;
let syncScrollEnabled = false;
/** Which pane is driving sync; suppresses echo scroll events. */
let syncScrollDriver = null;
let syncScrollUnlockTimer = 0;
let scrollAnchors = null;
let lineMirror = null;
let caretRevealRaf = 0;
const SPEECH_CHUNK_MAX = 180;
const SPEECH_HIGHLIGHT = "speech-word";
const MERMAID_CDN =
  "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js";
const MERMAID_SRI =
  "sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2";

// Map Mermaid SVG paints to CSS custom properties (Kirupa-style). Screen themes
// and @media print then recolor diagrams by redefining the variables — no
// live page theme swap and no baked-in dark fills stuck on paper.
const MERMAID_THEME_CSS = `
  .node rect,.node circle,.node polygon,.node path,.node ellipse {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .cluster rect,.cluster polygon {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }
  .edgePath .path,.flowchart-link,path.flowchart-link,.edge.thickness-normal {
    stroke: var(--mermaid-line) !important;
  }
  .edgeLabel rect,.labelBkg,.edgeLabel .labelBkg {
    fill: var(--mermaid-label-bg) !important;
  }
  .nodeLabel,.edgeLabel,.label,.cluster-label,.cluster span,.node .label,
  .edgeLabel foreignObject div,.nodeLabel foreignObject div {
    color: var(--mermaid-fg) !important;
    fill: var(--mermaid-fg) !important;
  }
  marker path,.marker path,defs marker path {
    fill: var(--mermaid-line) !important;
    stroke: var(--mermaid-line) !important;
  }
  .actor,.actor-man line,.actor-man circle,.actor-man path {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .actor-line,line.actor-line { stroke: var(--mermaid-line) !important; }
  text.actor,.messageText,.labelText,.loopText,.noteText { fill: var(--mermaid-fg) !important; }
  .messageLine0,.messageLine1,.loopLine,.sequenceNumber {
    stroke: var(--mermaid-line) !important;
  }
  .note {
    fill: var(--mermaid-note-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .activation0,.activation1,.activation2,.activation3,.activation4 {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .labelBox {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .statediagram-state rect,.stateGroup rect,.basic.label rect {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .statediagram-cluster rect {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }
  .transition { stroke: var(--mermaid-line) !important; }
  .classGroup rect,.classGroup line {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .classLabel .box { fill: var(--mermaid-label-bg) !important; }
  .classLabel .label,.labelText tspan,.classText { fill: var(--mermaid-fg) !important; }
  .relation { stroke: var(--mermaid-line) !important; }
  .er.entityBox {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .er.attributeBoxOdd,.er.attributeBoxEven {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .er.relationshipLine { stroke: var(--mermaid-line) !important; }
`;

let mermaidModule;
let mermaidGen = 0;

function mermaidConfig() {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      darkMode: false,
      background: "#ffffff",
      primaryColor: "#ECECFF",
      primaryTextColor: "#333333",
      primaryBorderColor: "#9370DB",
      lineColor: "#333333",
      secondaryColor: "#ffffde",
      tertiaryColor: "#f4f4f4",
    },
    themeCSS: MERMAID_THEME_CSS,
  };
}

function initMermaid(mermaid) {
  mermaid.startOnLoad = false;
  mermaid.initialize(mermaidConfig());
  return mermaid;
}

function loadMermaid() {
  mermaidModule ??= new Promise((resolve, reject) => {
    if (window.mermaid) {
      resolve(initMermaid(window.mermaid));
      return;
    }
    const script = document.createElement("script");
    script.src = MERMAID_CDN;
    script.integrity = MERMAID_SRI;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (!window.mermaid) {
        reject(new Error("Mermaid failed to load"));
        return;
      }
      resolve(initMermaid(window.mermaid));
    };
    script.onerror = () => reject(new Error("Mermaid failed to load"));
    document.head.appendChild(script);
  });
  return mermaidModule;
}

async function renderMermaidDiagrams() {
  const nodes = preview.querySelectorAll(".mermaid");
  if (!nodes.length) return;

  const gen = mermaidGen;
  for (const el of nodes) {
    el.setAttribute("data-pending", "");
  }

  try {
    const mermaid = await loadMermaid();
    if (gen !== mermaidGen) return;
    mermaid.initialize(mermaidConfig());
    await mermaid.run({ nodes, suppressErrors: true });
  } catch {
    /* invalid diagrams render into their nodes; import failures are ignored */
  }

  if (gen !== mermaidGen) return;
  for (const el of nodes) {
    el.removeAttribute("data-pending");
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 1800);
}

/** Mark content as external (share/upload/OS launch) so reader/present show a trust modal. */
function setContentExternal(external) {
  contentIsExternal = Boolean(external);
  document.body.dataset.external = contentIsExternal ? "1" : "0";
  if (contentIsExternal) {
    pendingExternalContent = getMarkdownSource();
  } else {
    pendingExternalContent = null;
  }
  syncExternalModal();
}

function isExternalModalOpen() {
  return Boolean(externalModal?.open);
}

function syncExternalModal() {
  if (!externalModal) return;
  const show = contentIsExternal;
  if (show) {
    if (!externalModal.open) {
      externalModal.returnValue = "";
      externalModal.showModal();
    }
  } else if (externalModal.open) {
    externalModal.returnValue = "";
    externalModal.close();
  }
}

/** Strip md / mdz from both the query string and the hash. */
function clearShareMarkdownFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("md");
  url.searchParams.delete("mdz");

  if (url.hash.length > 1) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    hashParams.delete("md");
    hashParams.delete("mdz");
    if (hashParams.get("view") === "reader" || hashParams.get("view") === "present") {
      hashParams.set("view", "edit");
    }
    url.hash = hashParams.toString();
  }

  history.replaceState(null, "", url);
}

function removeHistoryMatching(content) {
  if (!content?.trim()) return;
  const entries = loadHistory().filter((e) => e.content !== content);
  saveHistory(entries);
  if (lastHistoryContent === content) lastHistoryContent = "";
  renderHistoryMenu();
}

function acceptExternalContent() {
  const content = getMarkdownSource();
  localStorage.setItem(STORAGE_KEYS.draft, content);
  setContentExternal(false);
  pushHistory(content);
}

function rejectExternalContent() {
  const rejected = pendingExternalContent || getMarkdownSource();
  removeHistoryMatching(rejected);
  removeHistoryMatching(getMarkdownSource());
  window.clearTimeout(historyTimer);
  setEditorValue("");
  localStorage.setItem(STORAGE_KEYS.draft, "");
  lastHistoryContent = "";
  clearCurrentFileBinding();
  renderMarkdown("");
  markCleanFromEditor();
  clearShareMarkdownFromUrl();
  setContentExternal(false);
  setView("edit", { syncUrl: false });
  showToast("External content rejected");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let waitingForUpdateReload = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (waitingForUpdateReload) window.location.reload();
  });

  const watchRegistration = (registration) => {
    const offerUpdate = (worker) => {
      if (!updateToast || !worker) return;
      updateToast.hidden = false;
      updateReloadBtn.onclick = () => {
        waitingForUpdateReload = true;
        worker.postMessage("SKIP_WAITING");
      };
    };

    if (registration.waiting && navigator.serviceWorker.controller) {
      offerUpdate(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          offerUpdate(worker);
        }
      });
    });
  };

  navigator.serviceWorker
    .register("./sw.js")
    .then((registration) => {
      watchRegistration(registration);
      registration.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      });
    })
    .catch(() => {
      /* SW optional — app still works online without it */
    });
}

function setupPwa() {
  if (installBtn) {
    if (isStandaloneDisplay()) {
      installBtn.hidden = true;
    } else if (deferredInstallPrompt) {
      // BIP may have fired before init finished.
      installBtn.hidden = false;
    }

    installBtn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      installBtn.hidden = true;
      deferredInstallPrompt.prompt();
      try {
        await deferredInstallPrompt.userChoice;
      } catch {
        /* user dismissed or browser cancelled */
      }
      deferredInstallPrompt = null;
    });
  }

  // Register immediately — module scripts often run after `load`.
  registerServiceWorker();
}

const SHARE_URL_WARN_CHARS = 16_384;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlToUtf8(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function pipeThroughCompression(bytes, TransformStreamCtor, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new TransformStreamCtor(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function compressUtf8ToBase64Url(text) {
  const input = new TextEncoder().encode(text);
  const compressed = await pipeThroughCompression(input, CompressionStream, "deflate-raw");
  return bytesToBase64Url(compressed);
}

async function decompressBase64UrlToUtf8(value) {
  const compressed = base64UrlToBytes(value);
  const inflated = await pipeThroughCompression(compressed, DecompressionStream, "deflate-raw");
  return new TextDecoder().decode(inflated);
}

function decodeMdParam(md) {
  if (md == null || md === "") return null;
  try {
    return base64UrlToUtf8(md);
  } catch {
    try {
      return decodeURIComponent(md);
    } catch {
      return md;
    }
  }
}

async function decodeMdzParam(mdz) {
  if (mdz == null || mdz === "") return null;
  try {
    return await decompressBase64UrlToUtf8(mdz);
  } catch {
    return null;
  }
}

async function readShareParams(searchParams) {
  const mdz = searchParams.get("mdz");
  let markdown = mdz ? await decodeMdzParam(mdz) : null;
  if (markdown == null) {
    markdown = decodeMdParam(searchParams.get("md"));
  }
  const themeRaw = searchParams.get("theme");
  const viewRaw = searchParams.get("view");
  return {
    markdown,
    theme: THEMES.includes(themeRaw) ? themeRaw : null,
    view: VIEWS.includes(viewRaw) ? viewRaw : null,
  };
}

async function getShareState() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    const fromHash = await readShareParams(new URLSearchParams(hash));
    if (fromHash.markdown != null || fromHash.theme || fromHash.view) {
      return fromHash;
    }
  }

  return readShareParams(new URLSearchParams(window.location.search));
}

async function buildShareUrl({ markdown, theme, view } = {}) {
  const url = new URL(window.location.href);
  url.search = "";
  const params = new URLSearchParams();
  params.set("mdz", await compressUtf8ToBase64Url(markdown ?? getMarkdownSource()));
  const nextTheme = theme || document.documentElement.dataset.theme || themeSelect.value;
  if (THEMES.includes(nextTheme)) params.set("theme", nextTheme);
  const nextView = view || "reader";
  if (VIEWS.includes(nextView)) params.set("view", nextView);
  url.hash = params.toString();
  return url.toString();
}

function renderMarkdown(source) {
  if (speechActive) stopSpeaking();

  const raw = marked.parse(source || "", { async: false });
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ["data-source-line", "data-source-line-end"],
  });

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    mermaidGen += 1;
    preview.innerHTML = clean;
    addCodeLineNumbers(preview);
    invalidateScrollAnchors();
    rafId = 0;
    updateDocOutline();
    syncPreviewFromEditor();
    revealPreviewForEditorCaret();
    renderMermaidDiagrams().finally(() => {
      invalidateScrollAnchors();
      syncPreviewFromEditor();
      revealPreviewForEditorCaret();
      if (currentView === "present") {
        buildPresentSections();
        showPresentSection(presentIndex);
      }
    });
  });
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderMarkdown(getMarkdownSource());
  }, RENDER_DEBOUNCE_MS);
}

function titleFromMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) return heading[1].trim().slice(0, 80);
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 80);
  }
  return "Untitled";
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
}

function pushHistory(markdown) {
  if (contentIsExternal) return;
  const content = markdown ?? getMarkdownSource();
  if (!content.trim()) return;
  if (content.length > HISTORY_MAX_CHARS) return;
  if (content === lastHistoryContent) return;

  const entries = loadHistory();
  if (entries[0]?.content === content) {
    lastHistoryContent = content;
    return;
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: titleFromMarkdown(content),
    content,
    savedAt: Date.now(),
  };

  saveHistory([entry, ...entries.filter((e) => e.content !== content)]);
  lastHistoryContent = content;
  renderHistoryMenu();
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function renderHistoryMenu() {
  const entries = loadHistory();
  historyMenu.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No history yet";
    historyMenu.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "option");

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = entry.title || "Untitled";

    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = formatRelativeTime(entry.savedAt);

    btn.append(title, meta);
    btn.addEventListener("click", () => {
      if (!confirmDiscardIfDirty()) return;
      setEditorValue(entry.content);
      lastHistoryContent = entry.content;
      localStorage.setItem(STORAGE_KEYS.draft, entry.content);
      renderMarkdown(entry.content);
      clearCurrentFileBinding();
      markCleanFromEditor();
      setContentExternal(false);
      closeHistory();
      showToast("Restored from history");
    });

    li.appendChild(btn);
    historyMenu.appendChild(li);
  }
}

function openHistory() {
  renderHistoryMenu();
  historyMenu.hidden = false;
  historyBtn.setAttribute("aria-expanded", "true");
}

function closeHistory() {
  historyMenu.hidden = true;
  historyBtn.setAttribute("aria-expanded", "false");
}

function toggleHistory() {
  if (historyMenu.hidden) openHistory();
  else closeHistory();
}

function openOverflowMenu() {
  toolbarMenu.classList.add("is-open");
  overflowBtn.setAttribute("aria-expanded", "true");
  overflowBtn.setAttribute("aria-label", "Close menu");
}

function closeOverflowMenu() {
  toolbarMenu.classList.remove("is-open");
  overflowBtn.setAttribute("aria-expanded", "false");
  overflowBtn.setAttribute("aria-label", "Open menu");
  closeHistory();
  closeVoiceMenu();
  closeShareMenu();
  closeExportMenu();
}

function toggleOverflowMenu() {
  if (toolbarMenu.classList.contains("is-open")) closeOverflowMenu();
  else openOverflowMenu();
}

function preferredGithubTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "github-dark"
    : "github-light";
}

function setTheme(theme, { persist = true } = {}) {
  const next = THEMES.includes(theme) ? theme : preferredGithubTheme();
  document.documentElement.dataset.theme = next;
  themeSelect.value = next;
  if (photoCredit) {
    photoCredit.hidden = next !== "fancy";
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next);
    } catch {
      /* storage may be unavailable */
    }
  }
}

function setPreviewWidth(width, { persist = true } = {}) {
  const next = WIDTHS.includes(width) ? width : "readable";
  preview.dataset.width = next;
  widthSelect.value = next;
  invalidateScrollAnchors();
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.width, next);
    } catch {
      /* storage may be unavailable */
    }
  }
}

function applyCollapseState() {
  const editorCollapsed = localStorage.getItem(STORAGE_KEYS.editorCollapsed) === "1";
  const previewCollapsed = localStorage.getItem(STORAGE_KEYS.previewCollapsed) === "1";

  panes.classList.toggle("editor-collapsed", editorCollapsed);
  panes.classList.toggle("preview-collapsed", previewCollapsed);

  collapseEditorBtn.setAttribute("aria-pressed", String(editorCollapsed));
  collapsePreviewBtn.setAttribute("aria-pressed", String(previewCollapsed));
  collapseEditorBtn.title = editorCollapsed ? "Expand editor" : "Collapse editor";
  collapsePreviewBtn.title = previewCollapsed ? "Expand preview" : "Collapse preview";
  splitter.setAttribute("aria-hidden", String(editorCollapsed || previewCollapsed));
  splitter.tabIndex = editorCollapsed || previewCollapsed ? -1 : 0;
  invalidateScrollAnchors();
}

function clampSplit(value) {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
}

function isStackedLayout() {
  return window.matchMedia(NARROW_MQ).matches;
}

function applySplit(percent, { persist = true } = {}) {
  splitPercent = clampSplit(Number(percent) || 50);
  panes.style.setProperty("--split", `${splitPercent}%`);
  splitter.setAttribute("aria-valuenow", String(Math.round(splitPercent)));
  invalidateScrollAnchors();
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.split, String(splitPercent));
    } catch {
      /* storage may be unavailable */
    }
  }
}

function loadSplit() {
  const raw = localStorage.getItem(STORAGE_KEYS.split);
  const value = raw == null ? 50 : Number(raw);
  applySplit(Number.isFinite(value) ? value : 50, { persist: false });
}

function setupSplitter() {
  splitter.setAttribute("aria-valuemin", String(SPLIT_MIN));
  splitter.setAttribute("aria-valuemax", String(SPLIT_MAX));
  loadSplit();

  let dragging = false;
  let activePointerId = null;

  const updateFromPointer = (clientX, clientY) => {
    const rect = panes.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ratio = isStackedLayout()
      ? ((clientY - rect.top) / rect.height) * 100
      : ((clientX - rect.left) / rect.width) * 100;
    applySplit(ratio);
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    activePointerId = null;
    panes.classList.remove("is-resizing");
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
  };

  const onWindowPointerMove = (e) => {
    if (!dragging || e.pointerId !== activePointerId) return;
    updateFromPointer(e.clientX, e.clientY);
  };

  const onWindowPointerUp = (e) => {
    if (e.pointerId !== activePointerId) return;
    stopDragging();
  };

  splitter.addEventListener("pointerdown", (e) => {
    if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
      return;
    }
    dragging = true;
    activePointerId = e.pointerId;
    panes.classList.add("is-resizing");
    try {
      splitter.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    updateFromPointer(e.clientX, e.clientY);
    e.preventDefault();
  });

  splitter.addEventListener("keydown", (e) => {
    if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
      return;
    }
    const step = e.shiftKey ? 5 : 2;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      applySplit(splitPercent - step);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      applySplit(splitPercent + step);
      e.preventDefault();
    } else if (e.key === "Home") {
      applySplit(SPLIT_MIN);
      e.preventDefault();
    } else if (e.key === "End") {
      applySplit(SPLIT_MAX);
      e.preventDefault();
    }
  });

  const syncOrientation = () => {
    splitter.setAttribute(
      "aria-orientation",
      isStackedLayout() ? "horizontal" : "vertical"
    );
  };
  syncOrientation();
  window.matchMedia(NARROW_MQ).addEventListener("change", syncOrientation);
}

function toggleEditorCollapse() {
  const next = !panes.classList.contains("editor-collapsed");
  localStorage.setItem(STORAGE_KEYS.editorCollapsed, next ? "1" : "0");
  applyCollapseState();
}

function togglePreviewCollapse() {
  const next = !panes.classList.contains("preview-collapsed");
  localStorage.setItem(STORAGE_KEYS.previewCollapsed, next ? "1" : "0");
  applyCollapseState();
}

function scrollRatio(el) {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return 0;
  return el.scrollTop / max;
}

function applyScrollRatio(el, ratio) {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) {
    el.scrollTop = 0;
    return;
  }
  el.scrollTop = ratio * max;
}

function invalidateScrollAnchors() {
  scrollAnchors = null;
}

function offsetWithin(el, container) {
  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return elRect.top - containerRect.top + container.scrollTop;
}

function ensureLineMirror() {
  if (lineMirror) return lineMirror;
  lineMirror = document.createElement("div");
  lineMirror.setAttribute("aria-hidden", "true");
  lineMirror.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;height:auto;" +
    "overflow:hidden;white-space:pre-wrap;overflow-wrap:break-word;word-wrap:break-word;" +
    "top:0;left:-99999px;z-index:-1;";
  document.body.appendChild(lineMirror);
  return lineMirror;
}

/** Pixel offset of each source line start inside the editor (handles wrapping). */
function measureEditorLineTops() {
  const mirror = ensureLineMirror();
  const cs = getComputedStyle(editor);
  const copyProps = [
    "boxSizing",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontVariant",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "textIndent",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "tabSize",
  ];
  for (const prop of copyProps) {
    mirror.style[prop] = cs[prop];
  }
  mirror.style.width = `${editor.clientWidth}px`;

  const lines = editor.value.split("\n");
  mirror.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line || " ";
    frag.appendChild(row);
  }
  mirror.appendChild(frag);
  return Array.from(mirror.children, (row) => row.offsetTop);
}

function buildScrollAnchors() {
  const lineTops = measureEditorLineTops();
  const anchors = [{ editor: 0, preview: 0 }];

  for (const el of preview.querySelectorAll("[data-source-line]")) {
    const line = Number(el.getAttribute("data-source-line"));
    if (!Number.isFinite(line) || line < 1 || line > lineTops.length) continue;
    const previewTop = offsetWithin(el, previewPane);
    anchors.push({
      editor: lineTops[line - 1],
      preview: previewTop,
    });

    const endLine = Number(el.getAttribute("data-source-line-end"));
    if (Number.isFinite(endLine) && endLine > line && endLine <= lineTops.length) {
      anchors.push({
        editor: lineTops[endLine - 1],
        preview: previewTop + el.offsetHeight,
      });
    }
  }

  // Use max scrollTop (not scrollHeight) so both panes reach their bottoms
  // together — client heights differ, so scrollHeight end-points desync.
  anchors.push({
    editor: Math.max(0, editor.scrollHeight - editor.clientHeight),
    preview: Math.max(0, previewPane.scrollHeight - previewPane.clientHeight),
  });

  anchors.sort((a, b) => a.editor - b.editor || a.preview - b.preview);

  const deduped = [];
  for (const anchor of anchors) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.editor - anchor.editor) < 0.5) continue;
    if (prev && anchor.preview < prev.preview) {
      deduped.push({ editor: anchor.editor, preview: prev.preview });
    } else {
      deduped.push(anchor);
    }
  }
  return deduped;
}

function getScrollAnchors() {
  if (!scrollAnchors) scrollAnchors = buildScrollAnchors();
  return scrollAnchors;
}

function interpolateAnchor(position, anchors, fromKey, toKey) {
  if (!anchors.length) return 0;
  if (position <= anchors[0][fromKey]) return anchors[0][toKey];
  const last = anchors[anchors.length - 1];
  if (position >= last[fromKey]) return last[toKey];

  let lo = 0;
  let hi = anchors.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid][fromKey] <= position) lo = mid;
    else hi = mid;
  }

  const a = anchors[lo];
  const b = anchors[hi];
  const span = b[fromKey] - a[fromKey];
  if (span <= 0) return a[toKey];
  return a[toKey] + ((position - a[fromKey]) / span) * (b[toKey] - a[toKey]);
}

function clampScrollTop(el, top) {
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  el.scrollTop = Math.min(Math.max(0, top), max);
}

function beginSyncDriver(driver) {
  syncScrollDriver = driver;
  window.clearTimeout(syncScrollUnlockTimer);
  syncScrollUnlockTimer = window.setTimeout(() => {
    syncScrollDriver = null;
  }, 80);
}

function setSyncScroll(enabled, { persist = true } = {}) {
  syncScrollEnabled = Boolean(enabled);
  syncScrollBtn.setAttribute("aria-pressed", String(syncScrollEnabled));
  syncScrollBtn.title = syncScrollEnabled ? "Unsync scroll" : "Sync scroll";
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.syncScroll, syncScrollEnabled ? "1" : "0");
    } catch {
      /* storage may be unavailable */
    }
  }
  if (syncScrollEnabled) {
    invalidateScrollAnchors();
    syncPreviewFromEditor();
    revealPreviewForEditorCaret();
  }
}

function syncPreviewFromEditor() {
  if (!syncScrollEnabled || syncScrollDriver === "preview") return;
  if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
    return;
  }
  beginSyncDriver("editor");
  const anchors = getScrollAnchors();
  if (anchors.length >= 2) {
    clampScrollTop(
      previewPane,
      interpolateAnchor(editor.scrollTop, anchors, "editor", "preview"),
    );
  } else {
    applyScrollRatio(previewPane, scrollRatio(editor));
  }
}

function syncEditorFromPreview() {
  if (!syncScrollEnabled || syncScrollDriver === "editor") return;
  if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
    return;
  }
  beginSyncDriver("preview");
  const anchors = getScrollAnchors();
  if (anchors.length >= 2) {
    clampScrollTop(
      editor,
      interpolateAnchor(previewPane.scrollTop, anchors, "preview", "editor"),
    );
  } else {
    applyScrollRatio(editor, scrollRatio(previewPane));
  }
}

/** 1-based source line of the editor caret (or selection start). */
function editorCaretLine() {
  const text = editor.value.slice(0, editor.selectionStart);
  return (text.match(/\n/g) || []).length + 1;
}

/** Preview block that covers the given 1-based source line. */
function previewElementForLine(line) {
  let match = null;
  let previous = null;
  for (const el of preview.querySelectorAll("[data-source-line]")) {
    const start = Number(el.getAttribute("data-source-line"));
    if (!Number.isFinite(start) || start < 1) continue;
    const endRaw = Number(el.getAttribute("data-source-line-end"));
    const end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : start;
    if (line < start) return match || previous || el;
    previous = el;
    if (line <= end) match = el;
  }
  return match || previous;
}

/**
 * Keep the rendered block for the editor caret in view. Uses nearest so we
 * only scroll when the matching preview content is actually off-screen.
 */
function revealPreviewForEditorCaret() {
  if (!syncScrollEnabled) return;
  if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
    return;
  }
  const el = previewElementForLine(editorCaretLine());
  if (!el) return;

  const paneRect = previewPane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const pad = 8;
  if (elRect.top >= paneRect.top + pad && elRect.bottom <= paneRect.bottom - pad) {
    return;
  }

  beginSyncDriver("editor");
  const top = offsetWithin(el, previewPane);
  if (elRect.bottom > paneRect.bottom - pad) {
    clampScrollTop(previewPane, top + el.offsetHeight - previewPane.clientHeight + pad);
  } else {
    clampScrollTop(previewPane, top - pad);
  }
}

function scheduleRevealPreviewForCaret() {
  scheduleOutlineHighlight();
  if (!syncScrollEnabled || caretRevealRaf) return;
  caretRevealRaf = requestAnimationFrame(() => {
    caretRevealRaf = 0;
    revealPreviewForEditorCaret();
  });
}

let outlineHighlightRaf = 0;
function scheduleOutlineHighlight() {
  if (outlineHighlightRaf) return;
  outlineHighlightRaf = requestAnimationFrame(() => {
    outlineHighlightRaf = 0;
    highlightActiveOutlineItem();
  });
}

function toggleSyncScroll() {
  setSyncScroll(!syncScrollEnabled);
}

function onEditorInput() {
  if (suppressEditorInput) return;
  syncCollapsedDataUris();
  const source = getMarkdownSource();
  // Hold draft/history until Accept so Reject can fully discard untrusted content.
  if (!contentIsExternal) {
    localStorage.setItem(STORAGE_KEYS.draft, source);
  }
  scheduleEditorHighlight();
  invalidateScrollAnchors();
  scheduleRender();
  updateSaveButton();
  window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => pushHistory(source), HISTORY_DEBOUNCE_MS);
}

/** Insert text at the caret (replacing any selection). Prefer execCommand so Undo works. */
function insertAtCursor(text) {
  replaceEditorRange(editor.selectionStart, editor.selectionEnd, text);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function clipboardImageFile(clipboardData) {
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

function imageAltFromSelection(selected, file) {
  const fromSelection = selected.trim();
  if (fromSelection) return fromSelection.replace(/[\[\]]/g, "");
  const name = (file.name || "").replace(/\.[^.]+$/, "").trim();
  if (name && !/^image$/i.test(name)) return name.replace(/[\[\]]/g, "");
  return "image";
}

async function onEditorPaste(e) {
  const file = clipboardImageFile(e.clipboardData);
  if (!file) return;

  e.preventDefault();

  if (file.size > IMAGE_PASTE_MAX_BYTES) {
    showToast("Image too large to paste (max 2 MB)");
    return;
  }

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);

  try {
    const dataUrl = await readFileAsDataURL(file);
    if (!dataUrl.startsWith("data:image/")) {
      showToast("Could not paste image");
      return;
    }
    editor.focus();
    editor.setSelectionRange(start, end);
    insertAtCursor(formatEmbedMarkdown(imageAltFromSelection(selected, file), dataUrl));
    showToast("Image pasted");
  } catch {
    showToast("Could not paste image");
  }
}

function isDirty() {
  return getMarkdownSource() !== savedSnapshot;
}

function confirmDiscardIfDirty() {
  if (!isDirty()) return true;
  return window.confirm("You have unsaved changes. Discard them?");
}

function updateDocumentTitle() {
  const base = "Markdown Preview";
  document.title = currentFileName ? `${currentFileName} · ${base}` : base;
  if (currentFileNameEl) {
    if (currentFileName) {
      currentFileNameEl.textContent = currentFileName;
      currentFileNameEl.hidden = false;
    } else {
      currentFileNameEl.textContent = "";
      currentFileNameEl.hidden = true;
    }
  }
}

function markCleanFromEditor() {
  savedSnapshot = getMarkdownSource();
  try {
    localStorage.setItem(STORAGE_KEYS.savedSnapshot, savedSnapshot);
  } catch {
    /* ignore quota */
  }
  updateSaveButton();
}

function pathForHandle(fileHandle) {
  if (!fileHandle) return "";
  for (const [path, entry] of fsEntries) {
    if (entry.kind === "file" && entry.handle === fileHandle) return path;
  }
  return "";
}

function persistCurrentFileBinding() {
  try {
    if (currentFileName) localStorage.setItem(STORAGE_KEYS.currentFile, currentFileName);
    else localStorage.removeItem(STORAGE_KEYS.currentFile);
    if (currentFilePath) localStorage.setItem(STORAGE_KEYS.currentFilePath, currentFilePath);
    else localStorage.removeItem(STORAGE_KEYS.currentFilePath);
  } catch {
    /* ignore */
  }
  if (fsAccessSupported) {
    void storeCurrentFileHandle(currentFileHandle);
  }
}

function clearCurrentFileBinding() {
  currentFileHandle = null;
  currentFileName = "";
  currentFilePath = "";
  updateDocumentTitle();
  updateSaveButton();
  highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/**
 * @param {FileSystemFileHandle|null} fileHandle
 * @param {string} [name]
 * @param {string} [path]
 */
function bindCurrentFile(fileHandle, name, path = "") {
  currentFileHandle = fileHandle;
  currentFileName = name || fileHandle?.name || "";
  currentFilePath = path || pathForHandle(fileHandle) || "";
  updateDocumentTitle();
  updateSaveButton();
  highlightActiveFileInTree();
  persistCurrentFileBinding();
}

function updateSaveButton() {
  if (!saveBtn || !fsAccessSupported) return;
  const dirty = isDirty();
  saveBtn.classList.toggle("is-dirty", dirty);
  saveBtn.title = dirty
    ? `Save unsaved changes (Ctrl/Cmd+S)`
    : currentFileName
      ? `Save ${currentFileName} (Ctrl/Cmd+S)`
      : "Save (Ctrl/Cmd+S)";
}

function setFilesDrawerOpen(open, { persist = true } = {}) {
  filesDrawerOpen = Boolean(open);
  document.body.classList.toggle("files-drawer-open", filesDrawerOpen);
  if (filesDrawer) {
    filesDrawer.setAttribute("aria-hidden", filesDrawerOpen ? "false" : "true");
    if (filesDrawerOpen) filesDrawer.removeAttribute("inert");
    else filesDrawer.setAttribute("inert", "");
  }
  if (filesBackdrop) {
    filesBackdrop.setAttribute("aria-hidden", filesDrawerOpen ? "false" : "true");
  }
  filesToggleBtn?.setAttribute("aria-pressed", filesDrawerOpen ? "true" : "false");
  if (persist) {
    localStorage.setItem(STORAGE_KEYS.filesDrawer, filesDrawerOpen ? "1" : "0");
  }
}

function toggleFilesDrawer() {
  setFilesDrawerOpen(!filesDrawerOpen);
}

function closeFilesContextMenu() {
  if (!filesContextMenu) return;
  filesContextMenu.hidden = true;
  contextTarget = null;
}

function openFilesContextMenu(x, y, path, kind) {
  if (!filesContextMenu) return;
  contextTarget = { path, kind };
  const newFileItem = filesContextMenu.querySelector('[data-fs-action="new-file"]');
  const newFolderItem = filesContextMenu.querySelector('[data-fs-action="new-folder"]');
  const renameItem = filesContextMenu.querySelector('[data-fs-action="rename"]');
  const deleteItem = filesContextMenu.querySelector('[data-fs-action="delete"]');
  const showCreate = kind === "directory";
  if (newFileItem?.parentElement) newFileItem.parentElement.hidden = !showCreate;
  if (newFolderItem?.parentElement) newFolderItem.parentElement.hidden = !showCreate;
  if (renameItem?.parentElement) renameItem.parentElement.hidden = path === "";
  if (deleteItem?.parentElement) deleteItem.parentElement.hidden = path === "";

  filesContextMenu.hidden = false;
  const rect = filesContextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  filesContextMenu.style.left = `${Math.max(8, left)}px`;
  filesContextMenu.style.top = `${Math.max(8, top)}px`;
}

function updateFilesChrome() {
  const hasRoot = Boolean(rootDirHandle) && !awaitingFsPermission;
  if (filesDrawerTitle) {
    filesDrawerTitle.textContent = rootDirHandle?.name || "Files";
  }
  if (filesEmpty) filesEmpty.hidden = hasRoot || awaitingFsPermission;
  if (filesPermission) filesPermission.hidden = !awaitingFsPermission;
  if (filesTree) filesTree.hidden = !hasRoot;
  if (filesNewFileBtn) filesNewFileBtn.disabled = false;
  if (filesNewFolderBtn) filesNewFolderBtn.disabled = !hasRoot;
  if (filesRefreshBtn) filesRefreshBtn.disabled = !hasRoot;
}

function joinFsPath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name;
}

function parentPathOf(path) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function getTargetDirForCreate(preferredPath = selectedPath) {
  if (!rootDirHandle) return null;
  const entry = preferredPath ? fsEntries.get(preferredPath) : null;
  if (entry?.kind === "directory") return /** @type {FileSystemDirectoryHandle} */ (entry.handle);
  if (entry?.kind === "file" && entry.parent) return entry.parent;
  if (selectedDirHandle) return selectedDirHandle;
  return rootDirHandle;
}

function selectFsPath(path) {
  selectedPath = path || "";
  const entry = selectedPath ? fsEntries.get(selectedPath) : null;
  if (entry?.kind === "directory") {
    selectedDirHandle = /** @type {FileSystemDirectoryHandle} */ (entry.handle);
  } else if (entry?.kind === "file" && entry.parent) {
    selectedDirHandle = entry.parent;
  } else {
    selectedDirHandle = rootDirHandle;
  }
  highlightSelectedInTree();
}

function highlightSelectedInTree() {
  filesTree?.querySelectorAll(".files-tree-row.is-selected").forEach((el) => {
    el.classList.remove("is-selected");
  });
  if (!selectedPath) return;
  const row = filesTree?.querySelector(`.files-tree-row[data-path="${cssEscape(selectedPath)}"]`);
  row?.classList.add("is-selected");
}

function highlightActiveFileInTree() {
  filesTree?.querySelectorAll(".files-tree-row.is-active-file").forEach((el) => {
    el.classList.remove("is-active-file");
  });
  if (!currentFileName) return;
  if (currentFilePath) {
    const row = filesTree?.querySelector(`.files-tree-row[data-path="${cssEscape(currentFilePath)}"]`);
    row?.classList.add("is-active-file");
    return;
  }
  if (!currentFileHandle) return;
  for (const [path, entry] of fsEntries) {
    if (entry.kind === "file" && entry.handle === currentFileHandle) {
      const row = filesTree?.querySelector(`.files-tree-row[data-path="${cssEscape(path)}"]`);
      row?.classList.add("is-active-file");
      return;
    }
  }
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} path
 * @param {HTMLUListElement} listEl
 */
async function renderDirectoryChildren(dirHandle, path, listEl) {
  listEl.replaceChildren();
  const entries = await listDirectory(dirHandle);
  for (const entry of entries) {
    const childPath = joinFsPath(path, entry.name);
    fsEntries.set(childPath, {
      kind: entry.kind,
      handle: entry.handle,
      parent: dirHandle,
      path: childPath,
    });

    const li = document.createElement("li");
    li.className = "files-tree-item";
    li.dataset.path = childPath;
    li.dataset.kind = entry.kind;
    li.setAttribute("role", "treeitem");
    if (entry.kind === "directory") li.setAttribute("aria-expanded", "false");

    const row = document.createElement("button");
    row.type = "button";
    row.className = "files-tree-row";
    row.dataset.path = childPath;
    row.dataset.kind = entry.kind;

    const twistie = document.createElement("span");
    twistie.className = "files-tree-twistie";
    if (entry.kind === "directory") {
      twistie.textContent = expandedPaths.has(childPath) ? "▼" : "▶";
    } else {
      twistie.classList.add("is-spacer");
      twistie.textContent = "•";
    }

    const label = document.createElement("span");
    label.className = "files-tree-label";
    label.textContent = entry.name;

    row.append(twistie, label);
    li.append(row);

    if (entry.kind === "directory") {
      const childList = document.createElement("ul");
      childList.setAttribute("role", "group");
      childList.hidden = !expandedPaths.has(childPath);
      li.append(childList);
      if (expandedPaths.has(childPath)) {
        li.setAttribute("aria-expanded", "true");
        await renderDirectoryChildren(
          /** @type {FileSystemDirectoryHandle} */ (entry.handle),
          childPath,
          childList,
        );
      }
    }

    listEl.append(li);
  }
}

async function renderFilesTree() {
  if (!filesTree || !rootDirHandle) return;
  fsEntries.clear();
  fsEntries.set("", {
    kind: "directory",
    handle: rootDirHandle,
    parent: null,
    path: "",
  });
  await renderDirectoryChildren(rootDirHandle, "", filesTree);
  highlightSelectedInTree();
  highlightActiveFileInTree();
}

async function refreshFilesTree() {
  if (!rootDirHandle) return;
  try {
    await renderFilesTree();
  } catch (err) {
    console.error(err);
    showToast("Could not refresh folder");
  }
}

async function setRootDirectory(handle, { permissionOk = true } = {}) {
  rootDirHandle = handle;
  selectedDirHandle = handle;
  selectedPath = "";
  awaitingFsPermission = Boolean(handle) && !permissionOk;
  updateFilesChrome();
  if (permissionOk && handle) {
    await refreshFilesTree();
  } else if (filesTree) {
    filesTree.replaceChildren();
    fsEntries.clear();
  }
}

async function pickOpenFolder() {
  if (!fsAccessSupported) return;
  try {
    const handle = await openDirectory();
    await setRootDirectory(handle, { permissionOk: true });
    showToast(`Opened ${handle.name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast("Could not open folder");
  }
}

async function regrantFolderPermission() {
  if (!rootDirHandle) return;
  try {
    const permission = await ensureHandlePermission(rootDirHandle, "readwrite");
    if (permission !== "granted") {
      showToast("Permission denied");
      return;
    }
    awaitingFsPermission = false;
    updateFilesChrome();
    await refreshFilesTree();
    if (currentFilePath) {
      for (let p = parentPathOf(currentFilePath); p; p = parentPathOf(p)) {
        expandedPaths.add(p);
      }
      await refreshFilesTree();
      const resolved = await resolveFilePath(rootDirHandle, currentFilePath);
      if (resolved) {
        bindCurrentFile(resolved, resolved.name || currentFileName, currentFilePath);
        selectFsPath(currentFilePath);
      }
    }
    showToast(`Opened ${rootDirHandle.name}`);
  } catch (err) {
    console.error(err);
    showToast("Could not access folder");
  }
}

async function openFsFile(path) {
  const entry = fsEntries.get(path);
  if (!entry || entry.kind !== "file") return;
  if (currentFileHandle === entry.handle && !isDirty()) {
    selectFsPath(path);
    return;
  }
  if (!confirmDiscardIfDirty()) return;
  try {
    const text = await readTextFile(/** @type {FileSystemFileHandle} */ (entry.handle));
    setEditorValue(text);
    localStorage.setItem(STORAGE_KEYS.draft, getMarkdownSource());
    renderMarkdown(getMarkdownSource());
    pushHistory(getMarkdownSource());
    bindCurrentFile(/** @type {FileSystemFileHandle} */ (entry.handle), entry.handle.name, path);
    markCleanFromEditor();
    setContentExternal(false);
    selectFsPath(path);
    showToast(`Loaded ${entry.handle.name}`);
  } catch (err) {
    console.error(err);
    showToast("Could not open file");
  }
}

async function toggleFsDirectory(path) {
  const entry = fsEntries.get(path);
  if (!entry || entry.kind !== "directory") return;
  selectFsPath(path);
  const li = filesTree?.querySelector(`.files-tree-item[data-path="${cssEscape(path)}"]`);
  const childList = li?.querySelector(":scope > ul");
  if (!li || !childList) return;

  if (expandedPaths.has(path)) {
    expandedPaths.delete(path);
    childList.hidden = true;
    childList.replaceChildren();
    li.setAttribute("aria-expanded", "false");
    const twistie = li.querySelector(".files-tree-twistie");
    if (twistie) twistie.textContent = "▶";
    return;
  }

  expandedPaths.add(path);
  li.setAttribute("aria-expanded", "true");
  const twistie = li.querySelector(".files-tree-twistie");
  if (twistie) twistie.textContent = "▼";
  childList.hidden = false;
  try {
    await renderDirectoryChildren(
      /** @type {FileSystemDirectoryHandle} */ (entry.handle),
      path,
      childList,
    );
    highlightSelectedInTree();
    highlightActiveFileInTree();
  } catch (err) {
    expandedPaths.delete(path);
    console.error(err);
    showToast("Could not open folder");
  }
}

async function createUntitledDocument() {
  if (!confirmDiscardIfDirty()) return;
  setEditorValue("");
  localStorage.setItem(STORAGE_KEYS.draft, "");
  renderMarkdown("");
  clearCurrentFileBinding();
  markCleanFromEditor();
  setContentExternal(false);
  showToast("New untitled document");
}

async function promptCreateFile(dirPath = selectedPath) {
  const dir = getTargetDirForCreate(dirPath);
  if (!dir) {
    showToast("Open a folder first");
    return;
  }
  const raw = window.prompt("New file name", "untitled.md");
  if (raw == null) return;
  const name = ensureEditableExtension(raw);
  try {
    const handle = await createFile(dir, name, "");
    const basePath =
      dir === rootDirHandle ? "" : ([...fsEntries.entries()].find(([, e]) => e.handle === dir)?.[0] ?? "");
    if (basePath) expandedPaths.add(basePath);
    await refreshFilesTree();
    const createdPath = joinFsPath(basePath, name);
    setEditorValue("");
    localStorage.setItem(STORAGE_KEYS.draft, "");
    renderMarkdown("");
    bindCurrentFile(handle, name, createdPath);
    markCleanFromEditor();
    setContentExternal(false);
    selectFsPath(createdPath);
    showToast(`Created ${name}`);
  } catch (err) {
    console.error(err);
    showToast("Could not create file");
  }
}

async function promptCreateFolder(dirPath = selectedPath) {
  const dir = getTargetDirForCreate(dirPath);
  if (!dir) {
    showToast("Open a folder first");
    return;
  }
  const raw = window.prompt("New folder name");
  if (raw == null) return;
  const name = String(raw).trim();
  if (!name) return;
  try {
    await createFolder(dir, name);
    const basePath = dir === rootDirHandle ? "" : ([...fsEntries.entries()].find(([, e]) => e.handle === dir)?.[0] ?? "");
    if (basePath) expandedPaths.add(basePath);
    await refreshFilesTree();
    showToast(`Created folder ${name}`);
  } catch (err) {
    console.error(err);
    showToast("Could not create folder");
  }
}

async function promptRenameEntry(path) {
  const entry = fsEntries.get(path);
  if (!entry || !entry.parent) return;
  const next = window.prompt("Rename to", entry.handle.name);
  if (next == null) return;
  const newName = String(next).trim();
  if (!newName || newName === entry.handle.name) return;
  if (entry.kind === "file" && !isEditableFileName(ensureEditableExtension(newName))) {
    showToast("Use a .md, .txt, or .html name");
    return;
  }
  const finalName = entry.kind === "file" ? ensureEditableExtension(newName) : newName;
  try {
    const wasCurrent = currentFileHandle === entry.handle;
    const renamed = await renameEntry(entry.parent, entry.handle, finalName);
    if (path && expandedPaths.has(path)) {
      expandedPaths.delete(path);
      expandedPaths.add(joinFsPath(parentPathOf(path), finalName));
    }
    await refreshFilesTree();
    if (wasCurrent) {
      const renamedPath = joinFsPath(parentPathOf(path), finalName);
      bindCurrentFile(/** @type {FileSystemFileHandle} */ (renamed), finalName, renamedPath);
    }
    showToast(`Renamed to ${finalName}`);
  } catch (err) {
    console.error(err);
    showToast("Could not rename");
  }
}

async function promptDeleteEntry(path) {
  const entry = fsEntries.get(path);
  if (!entry || !entry.parent) return;
  const label = entry.kind === "directory" ? `folder "${entry.handle.name}"` : `"${entry.handle.name}"`;
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
  try {
    const currentPath =
      currentFilePath || [...fsEntries.entries()].find(([, e]) => e.handle === currentFileHandle)?.[0];
    const affectsCurrent =
      Boolean(currentPath) && (currentPath === path || currentPath.startsWith(`${path}/`));
    await removeEntry(entry.parent, entry.handle.name, true);
    expandedPaths.delete(path);
    for (const p of [...expandedPaths]) {
      if (p.startsWith(`${path}/`)) expandedPaths.delete(p);
    }
    await refreshFilesTree();
    if (affectsCurrent) {
      clearCurrentFileBinding();
    }
    if (selectedPath === path || selectedPath.startsWith(`${path}/`)) {
      selectFsPath("");
    }
    showToast("Deleted");
  } catch (err) {
    console.error(err);
    showToast("Could not delete");
  }
}

async function saveCurrentDocument() {
  if (!fsAccessSupported) return;
  const text = getMarkdownSource();
  const suggestedName = suggestedUntitledName(text);
  try {
    if (currentFileHandle) {
      await writeTextFile(currentFileHandle, text);
      markCleanFromEditor();
      showToast(`Saved ${currentFileName || currentFileHandle.name}`);
      return;
    }

    const dir = getTargetDirForCreate();
    if (dir) {
      const raw = window.prompt("Save as file name", suggestedName);
      if (raw == null) return;
      const name = ensureEditableExtension(raw, text);
      const handle = await createFile(dir, name, text);
      const basePath = dir === rootDirHandle ? "" : ([...fsEntries.entries()].find(([, e]) => e.handle === dir)?.[0] ?? "");
      if (basePath) expandedPaths.add(basePath);
      await refreshFilesTree();
      const createdPath = joinFsPath(basePath, name);
      bindCurrentFile(handle, name, createdPath);
      markCleanFromEditor();
      selectFsPath(createdPath);
      showToast(`Saved ${name}`);
      return;
    }

    const handle = await saveWithPicker(suggestedName, text);
    if (!handle) {
      showToast("Open a folder to save, or use a supported browser");
      return;
    }
    bindCurrentFile(handle, handle.name, "");
    markCleanFromEditor();
    showToast(`Saved ${handle.name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast("Could not save");
  }
}

function updateDocOutline() {
  if (!outlineList || !outlineEmpty) return;

  const headings = [...preview.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  outlineList.replaceChildren();

  if (!headings.length) {
    outlineEmpty.hidden = false;
    outlineList.hidden = true;
    return;
  }

  outlineEmpty.hidden = true;
  outlineList.hidden = false;

  const frag = document.createDocumentFragment();
  headings.forEach((heading, index) => {
    const level = Number(heading.tagName.slice(1));
    const line = Number(heading.getAttribute("data-source-line")) || 0;
    const li = document.createElement("li");
    li.className = "outline-item";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "outline-row";
    btn.dataset.level = String(level);
    btn.dataset.index = String(index);
    if (line > 0) btn.dataset.sourceLine = String(line);
    btn.textContent = heading.textContent?.trim() || `Heading ${level}`;
    btn.title = btn.textContent;
    li.appendChild(btn);
    frag.appendChild(li);
  });
  outlineList.appendChild(frag);
  highlightActiveOutlineItem();
}

function offsetOfSourceLine(line) {
  if (line < 1) return 0;
  const text = editor.value;
  let pos = 0;
  let current = 1;
  while (current < line && pos < text.length) {
    const next = text.indexOf("\n", pos);
    if (next === -1) return text.length;
    pos = next + 1;
    current += 1;
  }
  return pos;
}

function goToSourceLine(line) {
  if (!Number.isFinite(line) || line < 1) return;
  const pos = offsetOfSourceLine(line);
  editor.focus();
  editor.setSelectionRange(pos, pos);

  const lineTops = measureEditorLineTops();
  const top = lineTops[line - 1] ?? 0;
  beginSyncDriver("editor");
  clampScrollTop(editor, top - Math.min(48, editor.clientHeight * 0.2));
  syncPreviewFromEditor();
  revealPreviewForEditorCaret();
  highlightActiveOutlineItem();
}

function highlightActiveOutlineItem() {
  if (!outlineList) return;
  const line = editorCaretLine();
  const rows = [...outlineList.querySelectorAll(".outline-row")];
  let active = null;
  for (const row of rows) {
    const rowLine = Number(row.dataset.sourceLine);
    if (!Number.isFinite(rowLine) || rowLine < 1) continue;
    if (rowLine <= line) active = row;
    else break;
  }
  rows.forEach((row) => row.classList.toggle("is-active", row === active));
}

function setupDocOutline() {
  outlineList?.addEventListener("click", (e) => {
    const row = e.target.closest(".outline-row");
    if (!row || !outlineList.contains(row)) return;
    const line = Number(row.dataset.sourceLine);
    if (Number.isFinite(line) && line > 0) {
      goToSourceLine(line);
      return;
    }
    const index = Number(row.dataset.index);
    const heading = preview.querySelectorAll("h1, h2, h3, h4, h5, h6")[index];
    if (!heading) return;
    beginSyncDriver("preview");
    clampScrollTop(previewPane, offsetWithin(heading, previewPane) - 8);
    syncEditorFromPreview();
  });
}

function setupFilesDrawer() {
  if (!fsAccessSupported) return;

  document.querySelectorAll(".fs-only").forEach((el) => {
    el.hidden = false;
  });
  if (filesDrawer) filesDrawer.hidden = false;
  if (filesBackdrop) filesBackdrop.hidden = false;

  filesToggleBtn?.addEventListener("click", () => toggleFilesDrawer());
  filesBackdrop?.addEventListener("click", () => setFilesDrawerOpen(false));
  filesOpenFolderBtn?.addEventListener("click", () => void pickOpenFolder());
  filesEmptyOpenBtn?.addEventListener("click", () => void pickOpenFolder());
  filesReopenBtn?.addEventListener("click", () => void pickOpenFolder());
  filesRegrantBtn?.addEventListener("click", () => void regrantFolderPermission());
  filesRefreshBtn?.addEventListener("click", () => void refreshFilesTree());
  filesNewFileBtn?.addEventListener("click", () => void createUntitledDocument());
  filesNewFolderBtn?.addEventListener("click", () => void promptCreateFolder());
  saveBtn?.addEventListener("click", () => void saveCurrentDocument());

  filesTree?.addEventListener("click", (e) => {
    const row = e.target.closest(".files-tree-row");
    if (!row) return;
    const path = row.getAttribute("data-path") || "";
    const kind = row.getAttribute("data-kind");
    if (kind === "directory") void toggleFsDirectory(path);
    else void openFsFile(path);
  });

  filesTree?.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".files-tree-row");
    if (!row || !filesTree.contains(row)) return;
    e.preventDefault();
    const path = row.getAttribute("data-path") || "";
    const kind = /** @type {"file"|"directory"} */ (row.getAttribute("data-kind") || "file");
    selectFsPath(path);
    openFilesContextMenu(e.clientX, e.clientY, path, kind);
  });

  filesDrawer?.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".files-tree-row")) return;
    if (!rootDirHandle || awaitingFsPermission) return;
    e.preventDefault();
    selectFsPath("");
    openFilesContextMenu(e.clientX, e.clientY, "", "directory");
  });

  filesContextMenu?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-fs-action]");
    if (!item) return;
    const action = item.getAttribute("data-fs-action");
    const target = contextTarget;
    closeFilesContextMenu();
    if (!target) return;
    if (action === "new-file") void promptCreateFile(target.path);
    else if (action === "new-folder") void promptCreateFolder(target.path);
    else if (action === "rename") void promptRenameEntry(target.path);
    else if (action === "delete") void promptDeleteEntry(target.path);
  });

  // Start collapsed per plan; ignore stale open preference for first paint safety —
  // still restore if user previously left it open.
  const savedOpen = localStorage.getItem(STORAGE_KEYS.filesDrawer) === "1";
  setFilesDrawerOpen(savedOpen, { persist: false });
  updateFilesChrome();
  updateSaveButton();
}

async function restoreFilesDirectoryOnLoad() {
  if (!fsAccessSupported) return;
  try {
    const { handle, permission } = await restoreDirectory();
    if (!handle) return;
    if (permission === "granted") {
      await setRootDirectory(handle, { permissionOk: true });
    } else {
      await setRootDirectory(handle, { permissionOk: false });
      setFilesDrawerOpen(true, { persist: false });
    }
  } catch (err) {
    console.error(err);
    await clearStoredDirectory();
  }
}

/**
 * Restore the previously open file name / handle after a reload.
 * Keeps the draft in the editor; only re-binds identity for title + Save.
 */
async function restoreCurrentFileBindingOnLoad() {
  let savedName = "";
  let savedPath = "";
  try {
    savedName = localStorage.getItem(STORAGE_KEYS.currentFile) || "";
    savedPath = localStorage.getItem(STORAGE_KEYS.currentFilePath) || "";
  } catch {
    /* ignore */
  }

  if (fsAccessSupported && rootDirHandle && !awaitingFsPermission && savedPath) {
    for (let p = parentPathOf(savedPath); p; p = parentPathOf(p)) {
      expandedPaths.add(p);
    }
    try {
      await refreshFilesTree();
      const resolved = await resolveFilePath(rootDirHandle, savedPath);
      if (resolved) {
        bindCurrentFile(resolved, resolved.name || savedName, savedPath);
        selectFsPath(savedPath);
        return;
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (fsAccessSupported) {
    try {
      const handle = await loadStoredCurrentFileHandle();
      if (handle) {
        bindCurrentFile(handle, handle.name || savedName, savedPath);
        return;
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (savedName) {
    bindCurrentFile(null, savedName, savedPath);
  }
}

function handleFile(file) {
  if (!file) return;
  if (!TEXT_FILE_RE.test(file.name) && !file.type.startsWith("text/") && file.type !== "text/html") {
    showToast("Only Markdown, text, or HTML files are supported");
    return;
  }
  if (!confirmDiscardIfDirty()) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result ?? "");
    setEditorValue(text);
    renderMarkdown(getMarkdownSource());
    bindCurrentFile(null, file.name || "", "");
    selectFsPath("");
    setContentExternal(true);
    markCleanFromEditor();
    showToast(`Loaded ${file.name}`);
  };
  reader.onerror = () => showToast("Could not read file");
  reader.readAsText(file);
}

/**
 * Open a file launched via the OS / PWA File Handling API (FileSystemFileHandle).
 * @param {FileSystemFileHandle} fileHandle
 */
async function openLaunchedFile(fileHandle) {
  if (!fileHandle || fileHandle.kind !== "file") return;
  const name = fileHandle.name || "";
  if (!TEXT_FILE_RE.test(name)) {
    showToast("Only Markdown, text, or HTML files are supported");
    return;
  }
  if (!confirmDiscardIfDirty()) return;
  try {
    const text = await readTextFile(fileHandle);
    setEditorValue(text);
    renderMarkdown(getMarkdownSource());
    bindCurrentFile(fileHandle, name);
    selectFsPath("");
    markCleanFromEditor();
    setContentExternal(true);
    if (currentView !== "edit") setView("edit", { syncUrl: false });
    showToast(`Loaded ${name}`);
  } catch (err) {
    console.error(err);
    showToast("Could not open file");
  }
}

/** Register as consumer for OS “Open with” / default-app launches (installed PWA). */
function setupFileHandling() {
  if (!("launchQueue" in window)) return;
  window.launchQueue.setConsumer((launchParams) => {
    const files = launchParams?.files;
    if (!files?.length) return;
    void openLaunchedFile(/** @type {FileSystemFileHandle} */ (files[0]));
  });
}

function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

function setupDragAndDrop() {
  // dragenter/dragleave also fire when crossing child elements, so count depth
  // instead of hiding the overlay on the first dragleave.
  let depth = 0;

  const reset = () => {
    depth = 0;
    dropOverlay.hidden = true;
  };

  window.addEventListener("dragenter", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth += 1;
    dropOverlay.hidden = false;
  });

  window.addEventListener("dragover", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (e) => {
    if (!isFileDrag(e)) return;
    depth -= 1;
    if (depth <= 0) reset();
  });

  window.addEventListener("drop", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    reset();
    handleFile(e.dataTransfer.files?.[0]);
  });
}

async function copyText(url, toastMessage) {
  try {
    await navigator.clipboard.writeText(url);
    showToast(toastMessage);
  } catch {
    window.prompt(toastMessage.replace(/copied\.?$/i, "").trim() + ":", url);
  }
}

async function copyShareUrl(view = "reader") {
  const url = await buildShareUrl({
    markdown: getMarkdownSource(),
    theme: document.documentElement.dataset.theme,
    view,
  });
  const tooLong = url.length > SHARE_URL_WARN_CHARS;
  const label = tooLong
    ? "Link copied — may be too long for some apps"
    : view === "present"
      ? "Present link copied"
      : "Reader link copied";
  await copyText(url, label);
  closeShareMenu();
}

function openShareMenu() {
  if (!shareMenu) return;
  shareMenu.hidden = false;
  shareBtn.setAttribute("aria-expanded", "true");
}

function closeShareMenu() {
  if (!shareMenu || !shareBtn) return;
  shareMenu.hidden = true;
  shareBtn.setAttribute("aria-expanded", "false");
}

function toggleShareMenu() {
  if (!shareMenu) return;
  if (shareMenu.hidden) {
    closeHistory();
    closeVoiceMenu();
    closeExportMenu();
    openShareMenu();
  } else {
    closeShareMenu();
  }
}

function openExportMenu() {
  if (!exportMenu) return;
  exportMenu.hidden = false;
  exportBtn.setAttribute("aria-expanded", "true");
}

function closeExportMenu() {
  if (!exportMenu || !exportBtn) return;
  exportMenu.hidden = true;
  exportBtn.setAttribute("aria-expanded", "false");
}

function toggleExportMenu() {
  if (!exportMenu) return;
  if (exportMenu.hidden) {
    closeHistory();
    closeVoiceMenu();
    closeShareMenu();
    openExportMenu();
  } else {
    closeExportMenu();
  }
}

async function exportDocument(format) {
  const markdown = getMarkdownSource();
  if (!markdown.trim()) {
    showToast("Nothing to export");
    closeExportMenu();
    return;
  }

  // Ensure Mermaid diagrams are finished before HTML/DOCX/RTF/PDF capture.
  await renderMermaidDiagrams();

  const title = titleFromMarkdown(markdown);
  const base = exportBasename(title);

  try {
    if (format === "markdown") {
      downloadBlob(buildMarkdownFile(markdown, title), `${base}.md`, "text/markdown;charset=utf-8");
      showToast("Markdown downloaded");
    } else if (format === "html") {
      const html = buildHtmlDocument(cleanPreviewHtml(preview), title);
      downloadBlob(html, `${base}.html`, "text/html;charset=utf-8");
      showToast("HTML downloaded");
    } else if (format === "pdf") {
      showToast("Choose Save as PDF in the print dialog");
      await printPreviewAsPdf(preview, title);
    } else if (format === "docx") {
      downloadBlob(buildDocxBlob(preview, title), `${base}.docx`);
      showToast("DOCX downloaded");
    } else if (format === "rtf") {
      downloadBlob(buildRtfDocument(preview, title), `${base}.rtf`, "application/rtf;charset=utf-8");
      showToast("RTF downloaded");
    }
  } catch {
    showToast("Export failed");
  }

  closeExportMenu();
}

async function syncHashForView(view) {
  const state = await getShareState();
  const markdown = getMarkdownSource() || state.markdown || "";
  if (!markdown.trim() && view !== "edit") return;
  const url = new URL(window.location.href);
  url.search = "";
  if (!markdown.trim()) {
    url.hash = "";
    history.replaceState(null, "", url);
    return;
  }
  const params = new URLSearchParams();
  params.set("mdz", await compressUtf8ToBase64Url(markdown));
  const theme = document.documentElement.dataset.theme;
  if (THEMES.includes(theme)) params.set("theme", theme);
  params.set("view", view);
  url.hash = params.toString();
  history.replaceState(null, "", url);
}

function buildPresentSections() {
  const children = [...preview.children];
  if (!children.length) {
    presentSections = [];
    return;
  }

  const sections = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    sections.push(current);
    current = [];
  };

  for (const child of children) {
    const tag = child.tagName;
    if ((tag === "H1" || tag === "H2") && current.length) flush();
    current.push(child);
  }
  flush();
  presentSections = sections;
}

function updatePresentProgress() {
  if (!presentProgress) return;
  if (!presentSections.length) {
    presentProgress.textContent = "0 / 0";
    return;
  }
  presentProgress.textContent = `${presentIndex + 1} / ${presentSections.length}`;
}

function showPresentSection(index) {
  if (!presentSections.length) {
    buildPresentSections();
  }
  if (!presentSections.length) {
    presentIndex = 0;
    updatePresentProgress();
    return;
  }

  presentIndex = Math.max(0, Math.min(index, presentSections.length - 1));
  const active = presentSections[presentIndex];
  for (const child of preview.children) {
    child.hidden = !active.includes(child);
  }
  updatePresentProgress();
  preview.scrollTop = 0;
  const pane = document.getElementById("preview-pane");
  if (pane) pane.scrollTop = 0;
}

function clearPresentSectionFilter() {
  for (const child of preview.children) {
    child.hidden = false;
  }
}

function setView(view, { syncUrl = true } = {}) {
  const next = VIEWS.includes(view) ? view : "edit";
  if (currentView === "present" && next !== "present") {
    clearPresentSectionFilter();
  }
  if (next === "present" && currentView !== "present") {
    viewBeforePresent = currentView === "edit" ? "edit" : "reader";
  }

  currentView = next;
  document.body.dataset.view = next;
  syncExternalModal();

  if (presentChrome) {
    presentChrome.hidden = next !== "present";
  }

  if (next === "present") {
    buildPresentSections();
    showPresentSection(0);
  }

  if (syncUrl) {
    if (editor.value.trim()) {
      void syncHashForView(next);
    } else {
      void getShareState().then((state) => {
        if (state.markdown) void syncHashForView(next);
      });
    }
  }

  closeShareMenu();
  closeExportMenu();
  closeHistory();
  closeVoiceMenu();
  closeOverflowMenu();
}

function enterPresentMode() {
  setView("present");
}

function exitPresentMode() {
  setView(viewBeforePresent === "edit" ? "edit" : "reader");
}

function presentNext() {
  if (currentView !== "present") return;
  showPresentSection(presentIndex + 1);
}

function presentPrev() {
  if (currentView !== "present") return;
  showPresentSection(presentIndex - 1);
}

function buildPreviewSpeechMap() {
  const nodes = [];
  let text = "";
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script, style, .mermaid, .line-num")) return NodeFilter.FILTER_REJECT;
      if (!node.data) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    nodes.push({
      node,
      start: text.length,
      end: text.length + node.data.length,
    });
    text += node.data;
    node = walker.nextNode();
  }

  return { text, nodes };
}

function getSpeakableText() {
  speechMap = buildPreviewSpeechMap();
  if (speechMap.text?.trim()) return speechMap.text;
  speechMap = null;
  return (getMarkdownSource() || "").trim();
}

function chunkSpeechText(text) {
  const chunks = [];
  let i = 0;

  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;

    let end = Math.min(i + SPEECH_CHUNK_MAX, text.length);
    if (end < text.length) {
      const window = text.slice(i, end);
      let breakAt = -1;
      for (let k = window.length - 1; k > Math.floor(window.length * 0.4); k -= 1) {
        if (/[.!?…]/.test(window[k])) {
          breakAt = k + 1;
          break;
        }
        if (/\s/.test(window[k])) breakAt = k;
      }
      if (breakAt > 0) end = i + breakAt;
    }

    while (end > i && /\s/.test(text[end - 1])) end -= 1;
    if (end > i) chunks.push({ text: text.slice(i, end), start: i });
    i = Math.max(end, i + 1);
  }

  return chunks;
}

function wordEndOffset(text, start, charLength) {
  if (charLength > 0) return Math.min(text.length, start + charLength);
  let end = start;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return end;
}

function rangeFromSpeechOffsets(map, start, end) {
  if (!map?.nodes?.length || end <= start) return null;

  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;

  for (const entry of map.nodes) {
    if (!startNode && start >= entry.start && start < entry.end) {
      startNode = entry.node;
      startOffset = start - entry.start;
    }
    if (end > entry.start && end <= entry.end) {
      endNode = entry.node;
      endOffset = end - entry.start;
      break;
    }
    if (end > entry.end && start < entry.end) {
      endNode = entry.node;
      endOffset = entry.end - entry.start;
    }
  }

  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(startOffset, startNode.data.length));
    range.setEnd(endNode, Math.min(endOffset, endNode.data.length));
    return range;
  } catch {
    return null;
  }
}

function clearSpeechHighlight() {
  if (typeof CSS !== "undefined" && CSS.highlights) {
    CSS.highlights.delete(SPEECH_HIGHLIGHT);
  }
  for (const mark of preview.querySelectorAll("mark.speech-word")) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function highlightSpeechOffsets(start, end) {
  if (!speechMap) return;
  const range = rangeFromSpeechOffsets(speechMap, start, end);
  if (!range) return;

  // CSS Custom Highlight does not mutate the DOM, so speechMap offsets stay valid.
  if (typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined") {
    CSS.highlights.set(SPEECH_HIGHLIGHT, new Highlight(range));
  } else {
    clearSpeechHighlight();
    try {
      const mark = document.createElement("mark");
      mark.className = "speech-word";
      range.surroundContents(mark);
      // Remap after DOM mutation so later words still resolve.
      const text = speechMap.text;
      speechMap = buildPreviewSpeechMap();
      speechMap.text = text;
    } catch {
      return;
    }
  }

  const anchor =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
  if (anchor && typeof anchor.scrollIntoView === "function") {
    anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function voiceKey(voice) {
  return voice.voiceURI || `${voice.name}::${voice.lang}`;
}

function voiceName(voice) {
  return voice.name || "";
}

function isEnglishVoice(voice) {
  return (voice.lang || "").toLowerCase().startsWith("en");
}

/** Heuristic quality score for browser/OS voices (higher is better). */
function voiceQualityScore(voice) {
  const name = voiceName(voice).toLowerCase();
  let score = 0;

  // Strong premium / neural signals
  if (/\bsiri\b/.test(name)) score += 100;
  if (/\bgoogle\b/.test(name)) score += 90;
  if (/\b(neural|natural|online|wavenet|studio|superstar)\b/.test(name)) score += 85;
  if (/\b(enhanced|premium|mature)\b/.test(name)) score += 75;

  // Common high-quality system defaults (Apple / Microsoft)
  if (
    /\b(samantha|ava|zoe|allison|nicky|susan|tom|daniel|moira|tessa|karen|lee|fiona|veena|rishi|martha|gordon|aria|guy|jenny|ryan)\b/.test(
      name
    )
  ) {
    score += 55;
  }

  // Known low-quality, compact, or novelty engines
  if (
    /\b(fred|junior|kathy|princess|ralph|albert|zarvox|trinoids|boing|bells|cellos|pipe organ|bad news|good news|whisper|bubbles|deranged|hysterical|bahh|buzko)\b/.test(
      name
    )
  ) {
    score -= 120;
  }
  if (/\b(compact|eloquence|novelty)\b/.test(name)) score -= 60;

  // Remote/network voices are usually neural TTS when not novelty.
  if (!voice.localService && score >= 0) score += 15;

  return score;
}

function isHighQualityVoice(voice) {
  return isEnglishVoice(voice) && voiceQualityScore(voice) >= 50;
}

function listVoices() {
  const seen = new Map();

  for (const voice of window.speechSynthesis.getVoices()) {
    if (!isHighQualityVoice(voice)) continue;

    // Chrome/macOS often lists the same voice more than once with different URIs.
    const dedupeKey = `${voiceName(voice).toLowerCase()}::${(voice.lang || "").toLowerCase()}`;
    const existing = seen.get(dedupeKey);
    if (!existing) {
      seen.set(dedupeKey, voice);
      continue;
    }
    // Prefer an on-device copy when both exist.
    if (!existing.localService && voice.localService) {
      seen.set(dedupeKey, voice);
    }
  }

  return [...seen.values()].sort((a, b) => {
    const scoreCmp = voiceQualityScore(b) - voiceQualityScore(a);
    if (scoreCmp) return scoreCmp;
    const langCmp = a.lang.localeCompare(b.lang, undefined, { sensitivity: "base" });
    if (langCmp) return langCmp;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function preferredVoice() {
  const voices = listVoices();
  const allVoices = window.speechSynthesis.getVoices();
  if (!voices.length && !allVoices.length) return null;

  const saved = selectedVoiceURI || localStorage.getItem(STORAGE_KEYS.voice) || "";
  if (saved) {
    const match =
      voices.find((v) => voiceKey(v) === saved) ||
      allVoices.find((v) => voiceKey(v) === saved);
    if (match) return match;
  }

  // Highest scored English voice (Siri/Google/neural rise to the top).
  return voices[0] || null;
}

function setVoice(voiceURI, { persist = true, restart = false } = {}) {
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find((v) => voiceKey(v) === voiceURI);
  if (!match) return;

  selectedVoiceURI = voiceKey(match);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.voice, selectedVoiceURI);
    } catch {
      /* storage may be unavailable */
    }
  }
  renderVoiceMenu();
  if (restart && speechActive) startSpeaking();
}

function renderVoiceMenu() {
  if (!voiceMenu || !speechSupported) return;

  const voices = listVoices();
  const active = preferredVoice();
  if (active) selectedVoiceURI = voiceKey(active);

  voiceMenu.replaceChildren();

  if (!voices.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No high-quality English voices found";
    voiceMenu.appendChild(empty);
    return;
  }

  for (const voice of voices) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "option");
    const selected = active && voiceKey(voice) === voiceKey(active);
    btn.setAttribute("aria-selected", String(selected));
    if (selected) btn.classList.add("is-selected");

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = voice.name;

    const meta = document.createElement("span");
    meta.className = "item-meta";
    const score = voiceQualityScore(voice);
    const tier = score >= 90 ? "premium" : score >= 70 ? "enhanced" : "quality";
    meta.textContent = `${voice.lang} · ${tier}${voice.localService ? " · local" : " · cloud"}`;

    btn.append(title, meta);
    btn.addEventListener("click", () => {
      setVoice(voiceKey(voice), { persist: true, restart: speechActive });
      closeVoiceMenu();
    });

    li.appendChild(btn);
    voiceMenu.appendChild(li);
  }
}

function openVoiceMenu() {
  renderVoiceMenu();
  voiceMenu.hidden = false;
  voiceMenuBtn.setAttribute("aria-expanded", "true");
}

function closeVoiceMenu() {
  if (!voiceMenu || !voiceMenuBtn) return;
  voiceMenu.hidden = true;
  voiceMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleVoiceMenu() {
  if (voiceMenu.hidden) openVoiceMenu();
  else closeVoiceMenu();
}

function updateSpeakButton() {
  if (!speakBtn || !speechSupported) return;
  speakBtn.setAttribute("aria-pressed", String(speechActive));
  speakBtn.title = speechActive ? "Stop reading" : "Read aloud";
  speakBtn.setAttribute("aria-label", speechActive ? "Stop reading" : "Read aloud");

  if (!speakPauseBtn) return;
  speakPauseBtn.disabled = !speechActive;
  speakPauseBtn.setAttribute("aria-pressed", String(speechPaused));
  speakPauseBtn.title = speechPaused ? "Resume" : "Pause";
  speakPauseBtn.setAttribute("aria-label", speechPaused ? "Resume" : "Pause");
  speakPauseBtn.classList.toggle("is-paused", speechPaused);
}

function clearSpeechKeepalive() {
  if (!speechKeepalive) return;
  window.clearInterval(speechKeepalive);
  speechKeepalive = 0;
}

function startSpeechKeepalive() {
  clearSpeechKeepalive();
  speechKeepalive = window.setInterval(() => {
    if (!speechActive) {
      clearSpeechKeepalive();
      return;
    }
    // Chrome often auto-pauses after ~15s; don't fight an intentional pause.
    if (!speechPaused && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }, 5_000);
}

function stopSpeaking() {
  speechActive = false;
  speechPaused = false;
  speechQueue = [];
  speechMap = null;
  clearSpeechKeepalive();
  clearSpeechHighlight();
  if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending || window.speechSynthesis?.paused) {
    window.speechSynthesis.cancel();
  }
  updateSpeakButton();
}

function pauseSpeaking() {
  if (!speechActive || speechPaused) return;
  speechPaused = true;
  window.speechSynthesis.pause();
  updateSpeakButton();
}

function resumeSpeaking() {
  if (!speechActive || !speechPaused) return;
  speechPaused = false;
  window.speechSynthesis.resume();
  updateSpeakButton();
}

function togglePauseSpeaking() {
  if (!speechActive) return;
  if (speechPaused) resumeSpeaking();
  else pauseSpeaking();
}

function speakNextChunk() {
  if (!speechActive) return;
  if (!speechQueue.length) {
    speechActive = false;
    speechPaused = false;
    clearSpeechKeepalive();
    clearSpeechHighlight();
    updateSpeakButton();
    return;
  }

  const chunk = speechQueue.shift();
  const utterance = new SpeechSynthesisUtterance(chunk.text);
  const voice = preferredVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || document.documentElement.lang || "en-US";
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  // Only highlight when the engine fires word boundary events (many
  // Google/network voices do not support this in Chrome).
  utterance.addEventListener("boundary", (event) => {
    if (!speechActive || event.name !== "word") return;
    const absoluteStart = chunk.start + event.charIndex;
    const absoluteEnd = wordEndOffset(
      speechMap?.text || chunk.text,
      absoluteStart,
      event.charLength || 0
    );
    highlightSpeechOffsets(absoluteStart, absoluteEnd);
  });

  utterance.onend = () => speakNextChunk();
  utterance.onerror = (event) => {
    if (event.error === "interrupted" || event.error === "canceled") return;
    speechActive = false;
    speechPaused = false;
    speechQueue = [];
    clearSpeechKeepalive();
    clearSpeechHighlight();
    updateSpeakButton();
    showToast("Could not read aloud");
  };

  window.speechSynthesis.speak(utterance);
  if (speechPaused) window.speechSynthesis.pause();
}

function startSpeaking() {
  const text = getSpeakableText();
  if (!text) {
    showToast("Nothing to read");
    return;
  }

  const chunks = chunkSpeechText(text);
  if (!chunks.length) {
    showToast("Nothing to read");
    return;
  }

  const wasSpeaking =
    window.speechSynthesis.speaking ||
    window.speechSynthesis.pending ||
    window.speechSynthesis.paused;
  const map = speechMap;
  const queue = chunks;
  stopSpeaking();
  speechMap = map;
  speechActive = true;
  speechPaused = false;
  speechQueue = queue;
  updateSpeakButton();
  startSpeechKeepalive();
  closeVoiceMenu();

  const kickoff = () => {
    if (!speechActive) return;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    speakNextChunk();
  };

  // After cancel(), Chrome needs a tick before the next speak() works.
  if (wasSpeaking) window.setTimeout(kickoff, 50);
  else kickoff();
}

function toggleSpeaking() {
  if (speechActive) stopSpeaking();
  else startSpeaking();
}

function setupSpeech() {
  if (!speakBtn || !speakDropdown || !speechSupported || !window.speechSynthesis) return;
  speakDropdown.hidden = false;
  selectedVoiceURI = localStorage.getItem(STORAGE_KEYS.voice) || "";
  updateSpeakButton();

  // Chrome often returns [] until voiceschanged; refresh when the list arrives.
  const refreshVoices = () => {
    window.speechSynthesis.getVoices();
    renderVoiceMenu();
  };
  refreshVoices();
  window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);

  speakBtn.addEventListener("click", toggleSpeaking);
  speakPauseBtn?.addEventListener("click", togglePauseSpeaking);
  voiceMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeHistory();
    closeShareMenu();
    closeExportMenu();
    toggleVoiceMenu();
  });
  window.addEventListener("pagehide", stopSpeaking);
}

async function init() {
  const shareState = await getShareState();
  const fromUrl = shareState.markdown;

  if (shareState.theme) {
    setTheme(shareState.theme, { persist: false });
  } else {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
    if (savedTheme && THEMES.includes(savedTheme)) {
      setTheme(savedTheme);
    } else {
      setTheme(preferredGithubTheme(), { persist: false });
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onSchemeChange = () => {
        if (!localStorage.getItem(STORAGE_KEYS.theme)) {
          setTheme(preferredGithubTheme(), { persist: false });
          renderMarkdown(getMarkdownSource());
        }
      };
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", onSchemeChange);
      } else if (typeof media.addListener === "function") {
        media.addListener(onSchemeChange);
      }
    }
  }

  const savedWidth = localStorage.getItem(STORAGE_KEYS.width);
  setPreviewWidth(WIDTHS.includes(savedWidth) ? savedWidth : "readable", { persist: false });
  applyCollapseState();
  setupSplitter();
  setupDragAndDrop();
  setupSpeech();
  setupPwa();
  setupFilesDrawer();
  setupDocOutline();
  await restoreFilesDirectoryOnLoad();
  await restoreCurrentFileBindingOnLoad();

  const savedSyncScroll = localStorage.getItem(STORAGE_KEYS.syncScroll) === "1";
  setSyncScroll(savedSyncScroll, { persist: false });

  if (fromUrl != null) {
    setEditorValue(fromUrl);
    lastHistoryContent = "";
    setContentExternal(true);
    clearCurrentFileBinding();
  } else {
    const draft = localStorage.getItem(STORAGE_KEYS.draft) || "";
    setEditorValue(draft);
    lastHistoryContent = draft;
    setContentExternal(false);
  }

  // Prefer the last clean snapshot when a file binding was restored, so
  // unsaved edits still show as dirty after reload.
  try {
    const storedSnapshot = localStorage.getItem(STORAGE_KEYS.savedSnapshot);
    if (storedSnapshot != null && currentFileName) {
      savedSnapshot = storedSnapshot;
      updateSaveButton();
    } else {
      markCleanFromEditor();
    }
  } catch {
    markCleanFromEditor();
  }

  renderMarkdown(getMarkdownSource());
  renderHistoryMenu();

  const initialView =
    shareState.view ||
    (fromUrl != null ? "reader" : "edit");
  setView(initialView, { syncUrl: fromUrl != null });

  // After draft/URL load so a launched file overwrites the restored editor.
  setupFileHandling();

  // Commit the restored layout before revealing the panes, so the stored
  // position is the first one shown and later collapses still animate.
  void getComputedStyle(panes).gridTemplateColumns;
  document.documentElement.classList.remove("is-booting");

  editor.addEventListener("input", onEditorInput);
  editor.addEventListener("beforeinput", onEditorBeforeInput);
  editor.addEventListener("paste", onEditorPaste);
  editor.addEventListener("copy", onEditorCopyOrCut);
  editor.addEventListener("cut", onEditorCopyOrCut);

  themeSelect.addEventListener("change", () => {
    setTheme(themeSelect.value, { persist: currentView === "edit" });
    // Mermaid colors follow --mermaid-* CSS variables, so no re-render is needed.
    if (currentView !== "edit" && editor.value.trim()) {
      void syncHashForView(currentView);
    }
  });

  widthSelect.addEventListener("change", () => {
    setPreviewWidth(widthSelect.value, { persist: true });
    closeOverflowMenu();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    handleFile(file);
    fileInput.value = "";
    closeOverflowMenu();
  });

  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleShareMenu();
  });
  shareReaderBtn?.addEventListener("click", () => copyShareUrl("reader"));
  sharePresentBtn?.addEventListener("click", () => copyShareUrl("present"));

  exportBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleExportMenu();
  });
  exportMenu?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-export]");
    if (!item) return;
    void exportDocument(item.getAttribute("data-export"));
  });

  editViewBtn?.addEventListener("click", () => setView("edit"));
  presentViewBtn?.addEventListener("click", enterPresentMode);
  printBtn?.addEventListener("click", () => window.print());
  presentPrevBtn?.addEventListener("click", presentPrev);
  presentNextBtn?.addEventListener("click", presentNext);
  presentExitBtn?.addEventListener("click", exitPresentMode);
  // Escape must not dismiss — only Accept / Reject (method=dialog) close the modal.
  externalModal?.addEventListener("cancel", (e) => e.preventDefault());
  externalModal?.addEventListener("close", () => {
    if (externalModal.returnValue === "accept") acceptExternalContent();
    else if (externalModal.returnValue === "reject") rejectExternalContent();
  });

  collapseEditorBtn.addEventListener("click", toggleEditorCollapse);
  collapsePreviewBtn.addEventListener("click", togglePreviewCollapse);
  syncScrollBtn.addEventListener("click", toggleSyncScroll);
  editor.addEventListener(
    "scroll",
    () => {
      syncEditorHighlightScroll();
      syncPreviewFromEditor();
    },
    { passive: true },
  );
  previewPane.addEventListener("scroll", syncEditorFromPreview, { passive: true });
  editor.addEventListener("click", scheduleRevealPreviewForCaret);
  editor.addEventListener("keyup", (e) => {
    if (
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "Home" ||
      e.key === "End" ||
      e.key === "PageUp" ||
      e.key === "PageDown" ||
      e.key === "Enter"
    ) {
      scheduleRevealPreviewForCaret();
    }
  });
  editor.addEventListener("select", scheduleRevealPreviewForCaret);
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      syncEditorHighlightScroll();
      invalidateScrollAnchors();
      if (syncScrollEnabled) {
        syncPreviewFromEditor();
        scheduleRevealPreviewForCaret();
      }
    });
    ro.observe(editor);
    ro.observe(previewPane);
  }
  historyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeVoiceMenu();
    closeShareMenu();
    closeExportMenu();
    toggleHistory();
  });

  overflowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleOverflowMenu();
  });

  // Dismiss the mobile overflow panel after choosing an action. Nested dropdown
  // toggles (share/export/history/voice) call stopPropagation so they stay open.
  toolbarActions?.addEventListener("click", (e) => {
    if (!toolbarMenu.classList.contains("is-open")) return;
    if (e.target.closest("select, .select-label")) return;
    closeOverflowMenu();
  });

  document.addEventListener("click", (e) => {
    if (!historyDropdown.contains(e.target)) closeHistory();
    if (speakDropdown && !speakDropdown.contains(e.target)) closeVoiceMenu();
    if (shareDropdown && !shareDropdown.contains(e.target)) closeShareMenu();
    if (exportDropdown && !exportDropdown.contains(e.target)) closeExportMenu();
    if (!toolbarMenu.contains(e.target)) closeOverflowMenu();
    if (filesContextMenu && !filesContextMenu.contains(e.target)) closeFilesContextMenu();
  });

  document.addEventListener("keydown", (e) => {
    // Native <dialog showModal()> traps focus; still block app shortcuts while open.
    if (isExternalModalOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      if (fsAccessSupported && currentView === "edit") {
        e.preventDefault();
        void saveCurrentDocument();
      }
      return;
    }

    if (currentView === "present") {
      if (e.key === "Escape") {
        exitPresentMode();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") {
        presentNext();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        presentPrev();
        e.preventDefault();
        return;
      }
      if (e.key === "Home") {
        showPresentSection(0);
        e.preventDefault();
        return;
      }
      if (e.key === "End") {
        showPresentSection(presentSections.length - 1);
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Escape") {
      closeHistory();
      closeVoiceMenu();
      closeShareMenu();
      closeExportMenu();
      closeOverflowMenu();
      closeFilesContextMenu();
      if (filesDrawerOpen && window.matchMedia(NARROW_MQ).matches) {
        setFilesDrawerOpen(false);
      }
      if (speechActive) stopSpeaking();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  window.matchMedia(NARROW_MQ).addEventListener("change", (e) => {
    if (!e.matches) closeOverflowMenu();
  });
}

init();
