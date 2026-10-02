import { alertExtension } from "./alert.js";
import { emojiExtension } from "./emoji.js";
import {
  collapseDataUris,
  collapseDataUrisPreservingSelection,
  collapsedEmbedUriTouched,
  expandEmbeds,
  findCollapsedEmbeds,
  formatEmbedMarkdown,
} from "./embeds.js";
import { frontmatterExtension } from "./frontmatter.js";
import { tablePipesExtension } from "./tablePipes.js";
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
import { applyPatch, contentHash, makeRevisionBody } from "./history-diff.js";
import {
  clearHistoryBodies,
  commitHistoryBodies,
  getDraft,
  getHistoryIndex,
  getRev,
  getTip,
  moveDraft,
  probeHistoryIdb,
  requestPersistentStorage,
  setDraft,
  setHistoryIndex,
  setTip,
  storageBudgetOk,
} from "./history-store.js";
import {
  HLJS_LANG_ALIASES,
  SPLIT_MAX,
  SPLIT_MIN,
  canonicalHljsLang,
  clampSplit,
  collectFenceLanguages,
  escapeHtml,
  formatRelativeTime,
  highlightEditorMarkdown,
  joinFsPath,
  parentPathOf,
  parseDraftMirror,
  titleFromMarkdown,
  wrapHighlightedLines,
} from "./markdown-utils.js";
import {
  compressUtf8ToBase64Url,
  readShareParams as readShareParamsFromUrl,
} from "./share.js";
import {
  chunkSpeechText,
  listVoices as listVoicesFromList,
  voiceKey,
  voiceQualityScore,
  wordEndOffset,
} from "./speech-text.js";
import {
  anyWritingAiSupported,
  assertInputFitsQuota,
  availabilityLabel,
  checkAvailability,
  createAiSession,
  destroyAiSession,
  formatAiError,
  isAiSupported,
  renderCorrectedDiffHtml,
  resolveInsertRange,
  resolveTargetRange,
  runProofreadDocument,
  runRewrite,
  runWrite,
} from "./chrome-ai.js";
import { marked, Renderer } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import hljsMarkdown from "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/markdown.min.js";
import hljsXml from "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/xml.min.js";
import hljsMermaid from "./hljs-mermaid.js";

/** Lazy-loaded export helpers — not needed until the user exports/prints. */
let exportModulePromise;
function loadExportModule() {
  exportModulePromise ??= import("./export.js");
  return exportModulePromise;
}

const HLJS_LANG_CDN =
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages";

/** @type {Map<string, Promise<boolean>>} */
const hljsLangLoads = new Map();

// Markdown grammar uses xml as a subLanguage for embedded HTML.
hljs.registerLanguage("xml", hljsXml);
hljs.registerLanguage("html", hljsXml);
hljs.registerLanguage("markdown", hljsMarkdown);
// Mermaid is not on the highlight.js CDN; register locally for editor fences.
hljs.registerLanguage("mermaid", hljsMermaid);

function registerHljsAliases(canonical, grammar) {
  hljs.registerLanguage(canonical, grammar);
  for (const [alias, target] of Object.entries(HLJS_LANG_ALIASES)) {
    if (target === canonical) hljs.registerLanguage(alias, grammar);
  }
}

/**
 * Ensure a highlight.js grammar is registered. Returns true if a network load
 * just completed (caller may want to re-render).
 */
function ensureHljsLanguage(name) {
  const canonical = canonicalHljsLang(name);
  if (!canonical) return Promise.resolve(false);
  if (hljs.getLanguage(canonical)) return Promise.resolve(false);

  let pending = hljsLangLoads.get(canonical);
  if (pending) return pending;

  pending = import(`${HLJS_LANG_CDN}/${canonical}.min.js`)
    .then((mod) => {
      const grammar = mod.default;
      if (typeof grammar !== "function") return false;
      registerHljsAliases(canonical, grammar);
      return true;
    })
    .catch(() => false);

  hljsLangLoads.set(canonical, pending);
  return pending;
}

async function ensureHljsLanguagesForSource(source) {
  const langs = collectFenceLanguages(source);
  if (!langs.length) return false;
  const results = await Promise.all(langs.map((lang) => ensureHljsLanguage(lang)));
  return results.some(Boolean);
}

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

/** Soft max for how many per-doc saved snapshots to keep in localStorage. */
const SAVED_SNAPSHOT_MAX_KEYS = 30;

const HISTORY_LIMIT = 20;
/** Legacy localStorage-only history / emergency mirror cap. */
const HISTORY_MAX_CHARS = 200_000;
/** Soft max for IndexedDB tip / draft bodies. */
const HISTORY_TIP_MAX = 5 * 1024 * 1024;
/** Sync localStorage mirror for draft when under this size (unload safety). */
const EMERGENCY_LS_MAX = 100_000;
const HISTORY_INDEX_VERSION = 3;
const PATCH_MAX_CHARS = 100_000;
const STORAGE_CHANNEL = "md-preview-storage";
const RENDER_DEBOUNCE_MS = 80;
const HISTORY_DEBOUNCE_MS = 15_000;
const EDITOR_HIGHLIGHT_MAX = 100_000;
const NARROW_MQ = "(max-width: 800px)";
const TEXT_FILE_RE = /\.(md|markdown|mdown|mkd|txt|html|htm)$/i;
const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
/** Raw clipboard image size cap before base64 (keeps drafts / history workable). */
const IMAGE_PASTE_MAX_BYTES = 2 * 1024 * 1024;
const THEMES = ["github-light", "github-dark", "sepia", "terminal", "salesforce", "fancy"];
const WIDTHS = ["readable", "full"];
const VIEWS = ["edit", "reader", "present", "slides"];

const editor = document.getElementById("editor");
const editorHighlight = document.getElementById("editor-highlight");
const editorHighlightCode = editorHighlight.querySelector("code");
const preview = document.getElementById("preview");
const panes = document.getElementById("panes");
const splitter = document.getElementById("splitter");
const themeSelect = document.getElementById("theme-select");
const widthSelect = document.getElementById("width-select");
const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const shareDropdown = document.getElementById("share-dropdown");
const shareBtn = document.getElementById("share-btn");
const shareMenu = document.getElementById("share-menu");
const exportDropdown = document.getElementById("export-dropdown");
const exportBtn = document.getElementById("export-btn");
const exportMenu = document.getElementById("export-menu");
const writingToolsDropdown = document.getElementById("writing-tools-dropdown");
const writingToolsBtn = document.getElementById("writing-tools-btn");
const writingToolsMenu = document.getElementById("writing-tools-menu");
const aiWriteMenuBtn = document.getElementById("ai-write-menu-btn");
const aiRewriteMenuBtn = document.getElementById("ai-rewrite-menu-btn");
const aiProofreadMenuBtn = document.getElementById("ai-proofread-menu-btn");
const aiWriteDialog = document.getElementById("ai-write-dialog");
const aiRewriteDialog = document.getElementById("ai-rewrite-dialog");
const aiProofreadDialog = document.getElementById("ai-proofread-dialog");
const aiProofEditorWrap = document.getElementById("ai-proof-editor-wrap");
const aiProofEditor = document.getElementById("ai-proof-editor");
const aiProofHighlight = document.getElementById("ai-proof-highlight");
const aiProofHighlightCode = aiProofHighlight?.querySelector("code") ?? null;
const speakDropdown = document.getElementById("speak-dropdown");
const speakBtn = document.getElementById("speak-btn");
const speakPauseBtn = document.getElementById("speak-pause-btn");
const speakPrevBtn = document.getElementById("speak-prev-btn");
const speakNextBtn = document.getElementById("speak-next-btn");
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
const viewModeDropdown = document.getElementById("view-mode-dropdown");
const viewModeMainBtn = document.getElementById("view-mode-main-btn");
const viewModeMenuBtn = document.getElementById("view-mode-menu-btn");
const viewModeMenu = document.getElementById("view-mode-menu");
const presentMenuBtn = document.getElementById("present-menu-btn");
const presentViewBtn = document.getElementById("present-view-btn");
const printBtn = document.getElementById("print-btn");
const helpBtn = document.getElementById("help-btn");
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
/** @type {string} Last disk- or URL-baseline content for dirty checks. */
let savedSnapshot = "";
/** True while the trust modal holds markdown that arrived via `#md` / `#mdz`. */
let pendingExternalFromUrl = false;
/** True when this tab was opened via `#guide=1` (help preview; do not touch drafts). */
let guideSession = false;
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

marked.use(tablePipesExtension());
marked.use(frontmatterExtension());
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
    // Untrusted external content: plain escaped text only — no highlighter.
    if (contentIsExternal || value.length > EDITOR_HIGHLIGHT_MAX) {
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
  collapsedSections.clear();
  scheduleEditorHighlight();
}

/** Full Markdown with data-URI images expanded (for preview, draft, share, copy). */
function getMarkdownSource() {
  return expandEmbeds(editor.value);
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
let historyIdbReady = false;
let persistRequested = false;
/** @type {BroadcastChannel | null} */
let storageChannel = null;
let applyingRemoteStorage = false;
let splitPercent = 50;
let speechActive = false;
let speechPaused = false;
let speechQueue = [];
let speechKeepalive = 0;
let selectedVoiceURI = "";
let speechMap = null;
/** @type {{ title: string, sectionIndex: number, start: number, end: number, chunks: { text: string, start: number }[] }[]} */
let speechTracks = [];
let speechTrackIndex = 0;
/** Bumped when switching/stopping tracks so stale utterance callbacks are ignored. */
let speechGeneration = 0;
let currentView = "edit";
/** View to restore when leaving present; defaults to slides when none was recorded. */
let viewBeforePresent = "slides";
let presentSections = [];
let presentIndex = 0;
/** Collapsed preview sections keyed by `level:title` (default: all expanded). */
const collapsedSections = new Set();
let presentChromeHideTimer = 0;
const PRESENT_CHROME_IDLE_MS = 5000;
const PRESENT_SWIPE_MIN_DX = 56;
/** @type {{ id: number, x: number, y: number } | null} */
let presentSwipe = null;
const DRAWER_CLOSE_SWIPE_MIN_DX = 56;
/** @type {{ id: number, startX: number, startY: number, width: number, active: boolean } | null} */
let drawerCloseDrag = null;
/** True when Markdown was loaded from a share URL, upload, or OS file launch. */
let contentIsExternal = false;
/** Content awaiting Accept/Reject; kept so Reject can scrub history after edits. */
let pendingExternalContent = null;
/** Snapshot taken before applying untrusted content — restored on Reject. */
let preExternalSnapshot = null;
let syncScrollEnabled = false;
/** Which pane is driving sync; suppresses echo scroll events. */
let syncScrollDriver = null;
let syncScrollUnlockTimer = 0;
let scrollAnchors = null;
let lineMirror = null;
let caretRevealRaf = 0;
const SPEECH_HIGHLIGHT = "speech-word";
const MERMAID_CDN =
  "https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs";

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
  /* Mermaid sequence "gap" backgrounds (pastels) — restyle to theme surfaces. */
  rect.rect {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: none !important;
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
  /* Mermaid bakes fill:#333 on the SVG root; glyphs live in <tspan>, so force them. */
  .nodeLabel tspan,.edgeLabel tspan,.label tspan,.cluster-label tspan,
  .node .label tspan,text tspan {
    color: var(--mermaid-fg) !important;
    fill: var(--mermaid-fg) !important;
  }
  marker path,.marker path,defs marker path {
    fill: var(--mermaid-line) !important;
    stroke: var(--mermaid-line) !important;
  }
  /* Shape-only: do not paint text.actor with node-bg. */
  rect.actor,circle.actor,ellipse.actor,polygon.actor,
  .actor-man line,.actor-man circle,.actor-man path {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .actor-line,line.actor-line { stroke: var(--mermaid-line) !important; }
  text.actor,.messageText,.labelText,.loopText,
  text.actor tspan,.messageText tspan,.labelText tspan,.loopText tspan {
    fill: var(--mermaid-fg) !important;
  }
  .noteText,.noteText tspan {
    fill: var(--mermaid-note-fg) !important;
  }
  .messageLine0,.messageLine1,.loopLine {
    stroke: var(--mermaid-line) !important;
  }
  /* Autonumber discs have no class; recolor so they are not baked #333. */
  circle:not([class]) {
    fill: var(--mermaid-node-border) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .sequenceNumber,.sequenceNumber tspan {
    fill: var(--mermaid-bg) !important;
    stroke: none !important;
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
  .classLabel .label,.labelText tspan,.classText,.classText tspan {
    fill: var(--mermaid-fg) !important;
  }
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
    // Mermaid 12 defaults to ELK; keep dagre so existing diagrams look the same.
    layout: "dagre",
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
  // ESM entry + lazy chunks from jsDelivr (relative imports under dist/chunks/).
  // Nested chunk fetches can't carry SRI; pin the version URL and rely on CSP.
  mermaidModule ??= import(MERMAID_CDN).then((mod) => {
    const mermaid = mod.default;
    if (!mermaid?.initialize || !mermaid?.run) {
      throw new Error("Mermaid failed to load");
    }
    return initMermaid(mermaid);
  });
  return mermaidModule;
}

function mermaidNodeIsVisible(el) {
  return !el.closest("[hidden], .md-section-folded");
}

/**
 * Render Mermaid diagrams that still need it. Skips nodes that are not laid out
 * (`[hidden]` / `.md-section-folded`) unless `force` is set — those get a wrong
 * viewBox if measured while display:none. Call again when a slide/section is shown.
 * @param {{ force?: boolean }} [opts]
 */
async function renderMermaidDiagrams({ force = false } = {}) {
  const all = [...preview.querySelectorAll(".mermaid")];
  if (!all.length) return;

  const gen = mermaidGen;
  for (const el of all) {
    // Don't blank diagrams that already rendered (re-entry from slide change).
    if (!el.querySelector("svg")) el.setAttribute("data-pending", "");
  }

  /** @type {Array<() => void>} */
  const restore = [];
  if (force) {
    for (const el of preview.querySelectorAll("[hidden]")) {
      el.removeAttribute("hidden");
      restore.push(() => el.setAttribute("hidden", ""));
    }
    for (const el of preview.querySelectorAll(".md-section-folded")) {
      el.classList.remove("md-section-folded");
      restore.push(() => el.classList.add("md-section-folded"));
    }
    // Flush layout so Mermaid measures real boxes.
    void preview.offsetWidth;
  }

  const nodes = [...preview.querySelectorAll(".mermaid[data-pending]")].filter(
    (el) => force || mermaidNodeIsVisible(el),
  );

  try {
    if (nodes.length) {
      const mermaid = await loadMermaid();
      if (gen !== mermaidGen) return;
      mermaid.initialize(mermaidConfig());
      await mermaid.run({ nodes, suppressErrors: true });
    }
  } catch {
    /* invalid diagrams render into their nodes; import failures are ignored */
  } finally {
    for (const undo of restore.reverse()) undo();
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
    // Do not parse or syntax-highlight untrusted Markdown until Accept.
    clearUntrustedPreview();
    scheduleEditorHighlight();
  } else {
    pendingExternalContent = null;
  }
  syncExternalModal();
}

/**
 * Stash draft + file binding before overwriting with untrusted content.
 * @param {string} [contentOverride] Prefer stored draft at init (editor may still be empty).
 */
function stashPreExternalState(contentOverride) {
  if (preExternalSnapshot) return;
  preExternalSnapshot = {
    content: contentOverride != null ? String(contentOverride) : getMarkdownSource(),
    fileHandle: currentFileHandle,
    fileName: currentFileName,
    filePath: currentFilePath,
    savedSnapshot,
  };
}

/** Clear preview without running marked / DOMPurify / Mermaid on untrusted source. */
function clearUntrustedPreview() {
  if (speechActive) stopSpeaking();
  window.clearTimeout(renderTimer);
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  mermaidGen += 1;
  preview.innerHTML =
    '<p class="external-preview-placeholder">Preview is paused until you accept this content.</p>';
  invalidateScrollAnchors();
  updateDocOutline();
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
    if (
      hashParams.get("view") === "reader" ||
      hashParams.get("view") === "present" ||
      hashParams.get("view") === "slides"
    ) {
      hashParams.set("view", "edit");
    }
    url.hash = hashParams.toString();
  }

  history.replaceState(null, "", url);
}

/**
 * Stable id for the open document — scopes draft + saved-snapshot slots so
 * tabs bound to different files do not overwrite each other.
 * @returns {string}
 */
function currentDocKey() {
  if (currentFilePath) return `path:${currentFilePath}`;
  if (currentFileName) return `name:${currentFileName}`;
  return "untitled";
}

function readDraftMirror() {
  try {
    return parseDraftMirror(localStorage.getItem(STORAGE_KEYS.draft));
  } catch {
    return null;
  }
}

function mirrorDraftToLocalStorage(content, docKey = currentDocKey()) {
  try {
    const text = String(content ?? "");
    if (text.length <= EMERGENCY_LS_MAX) {
      localStorage.setItem(
        STORAGE_KEYS.draft,
        JSON.stringify({ v: 1, docKey, content: text }),
      );
    } else {
      localStorage.removeItem(STORAGE_KEYS.draft);
    }
  } catch {
    /* quota */
  }
}

/** Persist draft to IndexedDB (primary) + small localStorage mirror, scoped by doc. */
async function persistDraft(content) {
  if (contentIsExternal || guideSession) return;
  const text = String(content ?? getMarkdownSource());
  const docKey = currentDocKey();
  if (historyIdbReady) {
    await setDraft(text, docKey);
    void ensurePersistentStorage();
  }
  mirrorDraftToLocalStorage(text, docKey);
  broadcastStorage();
}

function persistDraftFireAndForget(content) {
  void persistDraft(content);
}

async function ensurePersistentStorage() {
  if (persistRequested || !historyIdbReady) return;
  persistRequested = true;
  await requestPersistentStorage();
}

function broadcastStorage() {
  try {
    storageChannel?.postMessage({ type: "storage", t: Date.now() });
  } catch {
    /* ignore */
  }
}

function setupStorageSync() {
  try {
    storageChannel = new BroadcastChannel(STORAGE_CHANNEL);
    storageChannel.onmessage = (event) => {
      if (event?.data?.type !== "storage") return;
      historyIndexCache = null;
      void hydrateHistoryIndexFromIdb().then(() => {
        void onRemoteStorageChange();
      });
    };
  } catch {
    storageChannel = null;
  }
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEYS.history) {
      historyIndexCache = null;
      void hydrateHistoryIndexFromIdb().then(() => {
        void onRemoteStorageChange();
      });
    } else if (event.key === STORAGE_KEYS.draft) {
      void onRemoteStorageChange(event.newValue ?? undefined);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushStorageBestEffort();
  });
  window.addEventListener("pagehide", flushStorageBestEffort);
}

function flushStorageBestEffort() {
  if (contentIsExternal || applyingRemoteStorage || guideSession) return;
  const source = getMarkdownSource();
  const docKey = currentDocKey();
  mirrorDraftToLocalStorage(source, docKey);
  if (historyIdbReady) void setDraft(source, docKey);
}

async function onRemoteStorageChange(mirrorRaw) {
  if (applyingRemoteStorage) return;
  applyingRemoteStorage = true;
  try {
    renderHistoryMenu();
    if (contentIsExternal || guideSession || isDirty()) return;
    const myKey = currentDocKey();
    let remote = null;
    let remoteKey = null;

    if (typeof mirrorRaw === "string") {
      const parsed = parseDraftMirror(mirrorRaw);
      if (parsed) {
        remote = parsed.content;
        remoteKey = parsed.docKey;
      }
    }

    if (remote == null && historyIdbReady) {
      const draft = await getDraft(myKey);
      if (draft) {
        remote = draft.content;
        remoteKey = draft.docKey;
      }
    }

    if (remote == null) {
      const mirrored = readDraftMirror();
      if (mirrored) {
        remote = mirrored.content;
        remoteKey = mirrored.docKey;
      }
    }

    if (remoteKey != null && remoteKey !== myKey) return;
    if (remote == null || remote === getMarkdownSource()) return;
    setEditorValue(remote);
    lastHistoryContent = remote;
    renderMarkdown(remote);
    updateSaveButton();
  } finally {
    applyingRemoteStorage = false;
  }
}

async function removeHistoryMatching(content) {
  if (!content?.trim()) return;
  const hash = contentHash(content);

  if (!historyIdbReady) {
    const entries = loadHistoryIndexEntries().filter(
      (e) => e.content !== content && e.hash !== hash,
    );
    saveLegacyHistory(entries);
    if (lastHistoryContent === content) lastHistoryContent = "";
    renderHistoryMenu();
    broadcastStorage();
    return;
  }

  const index = loadHistoryIndex();
  // Fast path: nothing with this hash → no rewrite (avoids rematerializing the chain).
  if (!index.entries.some((e) => e.hash === hash)) {
    if (lastHistoryContent === content) lastHistoryContent = "";
    return;
  }

  /** @type {{ meta: object, content: string }[]} */
  const kept = [];
  let removed = false;
  for (let i = 0; i < index.entries.length; i++) {
    const entry = index.entries[i];
    if (entry.hash === hash) {
      removed = true;
      continue;
    }
    const text = await materializeHistoryEntry(i);
    // Abort rather than silently dropping unrebuildable revisions.
    if (text == null) return;
    if (contentHash(text) === hash || text === content) {
      removed = true;
      continue;
    }
    kept.push({ meta: entry, content: text });
  }

  if (lastHistoryContent === content) lastHistoryContent = "";
  if (!removed) return;

  const oldIds = index.entries.map((e) => e.id);
  if (!kept.length) {
    await clearHistoryBodies(oldIds);
    saveHistoryIndex({ generation: index.generation + 1, entries: [] });
    void setHistoryIndex({
      v: HISTORY_INDEX_VERSION,
      generation: index.generation + 1,
      entries: [],
    });
    renderHistoryMenu();
    broadcastStorage();
    return;
  }

  await rewriteHistoryChain(kept, index.generation + 1, oldIds);
  renderHistoryMenu();
  broadcastStorage();
}

/**
 * @param {{ meta: { id?: string, title?: string, savedAt?: number }, content: string }[]} kept
 * @param {number} generation
 * @param {string[]} pruneCandidateIds
 */
async function rewriteHistoryChain(kept, generation, pruneCandidateIds) {
  const tipContent = kept[0].content;
  /** @type {Array<{ id: string, body: { patch?: string, content?: string } }>} */
  const revWrites = [];
  const entries = [
    {
      id: kept[0].meta.id || newHistoryId(),
      title: kept[0].meta.title || titleFromMarkdown(tipContent),
      savedAt: kept[0].meta.savedAt || Date.now(),
      hash: contentHash(tipContent),
      body: "tip",
    },
  ];
  let prev = tipContent;
  for (let i = 1; i < kept.length && entries.length < HISTORY_LIMIT; i++) {
    const c = kept[i].content;
    const id = kept[i].meta.id || newHistoryId();
    const made = makeRevisionBody(prev, c, PATCH_MAX_CHARS);
    revWrites.push({
      id,
      body: made.kind === "patch" ? { patch: made.patch } : { content: made.content },
    });
    entries.push({
      id,
      title: kept[i].meta.title || titleFromMarkdown(c),
      savedAt: kept[i].meta.savedAt || Date.now(),
      hash: contentHash(c),
      body: made.kind === "patch" ? "patch" : "full",
    });
    prev = c;
  }
  const keepRev = new Set(entries.slice(1).map((e) => e.id));
  const pruneIds = pruneCandidateIds.filter((id) => !keepRev.has(id));
  const ok = await commitHistoryBodies({
    generation,
    tipContent,
    revWrites,
    pruneIds,
    indexEntries: entries,
    indexVersion: HISTORY_INDEX_VERSION,
  });
  if (!ok) {
    saveLegacyHistory(
      kept.slice(0, HISTORY_LIMIT).map((k) => ({
        id: k.meta.id || newHistoryId(),
        title: k.meta.title || titleFromMarkdown(k.content),
        content: k.content,
        savedAt: k.meta.savedAt || Date.now(),
        hash: contentHash(k.content),
      })),
    );
    return;
  }
  saveHistoryIndex({ generation, entries });
}

function acceptExternalContent() {
  const content = getMarkdownSource();
  preExternalSnapshot = null;
  setContentExternal(false);
  void persistDraft(content);
  void pushHistory(content);
  clearShareMarkdownFromUrl();
  // URL share is a clean baseline; uploads / other external stay dirty until disk save.
  if (pendingExternalFromUrl) markCleanFromEditor();
  else updateSaveButton();
  pendingExternalFromUrl = false;
  renderMarkdown(content);
  scheduleEditorHighlight();
}

function rejectExternalContent() {
  const rejected = pendingExternalContent || getMarkdownSource();
  const snapshot = preExternalSnapshot;
  preExternalSnapshot = null;
  pendingExternalFromUrl = false;
  window.clearTimeout(historyTimer);
  void removeHistoryMatching(rejected);

  const restored = snapshot?.content ?? "";
  setContentExternal(false);
  setEditorValue(restored);
  lastHistoryContent = restored;

  if (snapshot) {
    currentFileHandle = snapshot.fileHandle;
    currentFileName = snapshot.fileName;
    currentFilePath = snapshot.filePath;
    savedSnapshot = snapshot.savedSnapshot;
    updateDocumentTitle();
    updateSaveButton();
    highlightActiveFileInTree();
    persistCurrentFileBinding();
  } else {
    clearCurrentFileBinding();
    markDirtyBaseline();
  }

  void persistDraft(restored);
  clearShareMarkdownFromUrl();
  renderMarkdown(restored);
  setView("edit", { syncUrl: false });
  showToast("External content rejected");
}

function resolveServiceWorkerUrl() {
  try {
    const configured = window.__MD_SW__;
    if (typeof configured === "string" && configured && configured !== "__SW_URL__") {
      return configured;
    }
  } catch {
    /* ignore */
  }
  return "./sw.js";
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
    .register(resolveServiceWorkerUrl())
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

async function readShareParams(searchParams) {
  return readShareParamsFromUrl(searchParams, { themes: THEMES, views: VIEWS });
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

async function buildShareUrl({ markdown, theme } = {}) {
  const url = new URL(window.location.href);
  url.search = "";
  const params = new URLSearchParams();
  params.set("mdz", await compressUtf8ToBase64Url(markdown ?? getMarkdownSource()));
  const nextTheme = theme || document.documentElement.dataset.theme || themeSelect.value;
  if (THEMES.includes(nextTheme)) params.set("theme", nextTheme);
  // Always edit: recipients need the source pane to identify the doc before Accept.
  params.set("view", "edit");
  url.hash = params.toString();
  return url.toString();
}

function renderMarkdown(source) {
  if (contentIsExternal) {
    clearUntrustedPreview();
    return;
  }
  if (speechActive) stopSpeaking();

  // Load missing fence grammars in the background; re-render once they arrive.
  void ensureHljsLanguagesForSource(source).then((loadedAny) => {
    if (!loadedAny || contentIsExternal) return;
    if (getMarkdownSource() !== source) return;
    paintMarkdown(source);
    scheduleEditorHighlight();
  });

  paintMarkdown(source);
}

function paintMarkdown(source) {
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
    enhanceSectionToggles();
    if (isSlideNavView()) {
      buildPresentSections();
      showPresentSection(presentIndex);
    }
    invalidateScrollAnchors();
    rafId = 0;
    updateDocOutline();
    syncPreviewFromEditor();
    revealPreviewForEditorCaret();
    renderMermaidDiagrams().finally(() => {
      enhanceSectionToggles();
      if (isSlideNavView()) {
        buildPresentSections();
        showPresentSection(presentIndex);
      }
      invalidateScrollAnchors();
      syncPreviewFromEditor();
      revealPreviewForEditorCaret();
    });
  });
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderMarkdown(getMarkdownSource());
  }, RENDER_DEBOUNCE_MS);
}

function newHistoryId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * In-memory history index (mirrored to localStorage; committed with tip in IDB).
 * @type {{ v: number, generation: number, entries: object[] } | null}
 */
let historyIndexCache = null;

function loadHistoryIndexFromLs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history);
    if (!raw) return { v: HISTORY_INDEX_VERSION, generation: 0, entries: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { v: 1, generation: 0, entries: parsed };
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
      return {
        v: Number(parsed.v) || 2,
        generation: Number(parsed.generation) || 0,
        entries: parsed.entries,
      };
    }
  } catch {
    /* ignore */
  }
  return { v: HISTORY_INDEX_VERSION, generation: 0, entries: [] };
}

/**
 * @returns {{ v: number, generation: number, entries: object[] }}
 */
function loadHistoryIndex() {
  if (historyIndexCache) {
    return {
      v: historyIndexCache.v,
      generation: historyIndexCache.generation,
      entries: historyIndexCache.entries.slice(),
    };
  }
  return loadHistoryIndexFromLs();
}

/** Flat entry list for menu / legacy helpers. */
function loadHistoryIndexEntries() {
  return loadHistoryIndex().entries;
}

function saveHistoryIndex(index) {
  const payload = {
    v: HISTORY_INDEX_VERSION,
    generation: index.generation,
    entries: index.entries.slice(0, HISTORY_LIMIT),
  };
  historyIndexCache = payload;
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

/**
 * Prefer IDB index (committed with tip) over localStorage when they diverge.
 * Call after IDB is ready and on cross-tab history updates.
 */
async function hydrateHistoryIndexFromIdb() {
  if (!historyIdbReady) {
    historyIndexCache = loadHistoryIndexFromLs();
    return;
  }
  const tip = await getTip();
  const idbIndex = await getHistoryIndex();
  if (idbIndex && tip && Number(idbIndex.generation) === Number(tip.generation)) {
    saveHistoryIndex(idbIndex);
    return;
  }
  const ls = loadHistoryIndexFromLs();
  if (tip && Number(ls.generation) === Number(tip.generation) && ls.entries.length) {
    historyIndexCache = {
      v: HISTORY_INDEX_VERSION,
      generation: ls.generation,
      entries: ls.entries.slice(0, HISTORY_LIMIT),
    };
    void setHistoryIndex(historyIndexCache);
    return;
  }
  if (tip) {
    // Tip/index mismatch — keep newest tip restorable; older revs may be orphaned.
    saveHistoryIndex({
      generation: tip.generation,
      entries: [
        {
          id: newHistoryId(),
          title: titleFromMarkdown(tip.content),
          savedAt: Date.now(),
          hash: contentHash(tip.content),
          body: "tip",
        },
      ],
    });
    void setHistoryIndex(historyIndexCache);
    return;
  }
  historyIndexCache = ls;
}

function saveLegacyHistory(entries) {
  const mapped = entries.slice(0, HISTORY_LIMIT).map((e) => ({
    id: e.id || newHistoryId(),
    title: e.title || "Untitled",
    content: e.content,
    savedAt: e.savedAt || Date.now(),
    hash: e.hash || contentHash(e.content || ""),
  }));
  historyIndexCache = { v: 1, generation: 0, entries: mapped };
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(mapped));
}

/**
 * @param {number} index
 * @returns {Promise<string | null>}
 */
async function materializeHistoryEntry(index) {
  const hist = loadHistoryIndex();
  if (index < 0 || index >= hist.entries.length) return null;
  const entry = hist.entries[index];

  if (!historyIdbReady || hist.v < HISTORY_INDEX_VERSION || entry.content != null) {
    return typeof entry.content === "string" ? entry.content : null;
  }

  const tip = await getTip();
  if (!tip) return null;
  if (tip.generation !== hist.generation) {
    return index === 0 ? tip.content : null;
  }

  let content = tip.content;
  if (index === 0) return content;

  for (let i = 1; i <= index; i++) {
    const step = hist.entries[i];
    const rev = await getRev(step.id);
    if (!rev) return null;
    if (typeof rev.content === "string") {
      content = rev.content;
    } else if (typeof rev.patch === "string") {
      content = applyPatch(content, rev.patch);
    } else {
      return null;
    }
  }
  return content;
}

async function migrateHistoryIfNeeded() {
  if (!historyIdbReady) return;
  const hist = loadHistoryIndex();
  const legacyBodies = hist.entries.filter((e) => typeof e.content === "string");
  const needsMigrate =
    hist.v < HISTORY_INDEX_VERSION || (legacyBodies.length > 0 && hist.entries.some((e) => !e.body));

  if (!needsMigrate) {
    const tip = await getTip();
    if (tip && tip.generation === hist.generation) return;
    if (!hist.entries.length) return;
    // Index without matching tip — rebuild tip from first legacy body if any.
    if (legacyBodies[0]) {
      await setTip(hist.generation || 1, legacyBodies[0].content);
    }
    return;
  }

  if (!legacyBodies.length) {
    saveHistoryIndex({ generation: hist.generation || 0, entries: hist.entries.filter((e) => e.body) });
    return;
  }

  const kept = legacyBodies.slice(0, HISTORY_LIMIT).map((e) => ({
    meta: e,
    content: e.content,
  }));
  await rewriteHistoryChain(kept, Math.max(1, hist.generation || 0) + 1, []);
}

function pushHistoryLegacy(content) {
  if (content.length > HISTORY_MAX_CHARS) return;
  const entries = loadHistoryIndexEntries().filter((e) => e.content !== content);
  if (entries[0]?.content === content) {
    lastHistoryContent = content;
    return;
  }
  const entry = {
    id: newHistoryId(),
    title: titleFromMarkdown(content),
    content,
    savedAt: Date.now(),
    hash: contentHash(content),
  };
  saveLegacyHistory([entry, ...entries]);
  lastHistoryContent = content;
  renderHistoryMenu();
  broadcastStorage();
}

async function pushHistory(markdown) {
  if (contentIsExternal || guideSession) return;
  const content = markdown ?? getMarkdownSource();
  if (!content.trim()) return;
  if (content === lastHistoryContent) return;

  if (!historyIdbReady) {
    pushHistoryLegacy(content);
    return;
  }

  if (content.length > HISTORY_TIP_MAX) return;

  const hash = contentHash(content);
  const hist = loadHistoryIndex();
  if (hist.entries[0]?.hash === hash) {
    lastHistoryContent = content;
    return;
  }

  const tip = await getTip();
  let oldContent = "";
  if (tip && (tip.generation === hist.generation || !hist.generation)) {
    oldContent = tip.content;
  } else if (tip) {
    oldContent = tip.content;
  } else if (typeof hist.entries[0]?.content === "string") {
    oldContent = hist.entries[0].content;
  }

  const generation = (tip?.generation || hist.generation || 0) + 1;

  // Re-saving a past revision (A→B→C→D then B again) would leave reverse
  // patches pointing at the wrong predecessor if we only dropped the matching
  // middle entry. Rebuild the chain from materialized bodies instead.
  const duplicateIdx = hist.entries.findIndex((e) => e.hash === hash);
  if (duplicateIdx > 0) {
    const kept = [
      {
        meta: { title: titleFromMarkdown(content), savedAt: Date.now() },
        content,
      },
    ];
    for (let i = 0; i < hist.entries.length; i++) {
      if (i === duplicateIdx) continue;
      const body = await materializeHistoryEntry(i);
      if (body == null || contentHash(body) === hash) continue;
      kept.push({ meta: hist.entries[i], content: body });
    }
    await rewriteHistoryChain(
      kept,
      generation,
      hist.entries.map((e) => e.id),
    );
    lastHistoryContent = content;
    void ensurePersistentStorage();
    renderHistoryMenu();
    broadcastStorage();
    return;
  }

  const newId = newHistoryId();

  /** @type {object[]} */
  let entries = [
    {
      id: newId,
      title: titleFromMarkdown(content),
      savedAt: Date.now(),
      hash,
      body: "tip",
    },
  ];
  /** @type {Array<{ id: string, body: { patch?: string, content?: string } }>} */
  const revWrites = [];
  let convertedOldTip = false;

  if (hist.entries[0] && oldContent !== "" && contentHash(oldContent) !== hash) {
    const oldMeta = hist.entries[0];
    const made = makeRevisionBody(content, oldContent, PATCH_MAX_CHARS);
    revWrites.push({
      id: oldMeta.id,
      body: made.kind === "patch" ? { patch: made.patch } : { content: made.content },
    });
    entries.push({
      id: oldMeta.id,
      title: oldMeta.title || titleFromMarkdown(oldContent),
      savedAt: oldMeta.savedAt || Date.now(),
      hash: oldMeta.hash || contentHash(oldContent),
      body: made.kind === "patch" ? "patch" : "full",
    });
    convertedOldTip = true;
  }

  for (const e of hist.entries.slice(convertedOldTip ? 1 : 0)) {
    if (e.hash === hash || e.id === newId) continue;
    if (e.body === "tip") continue;
    entries.push(e);
  }

  // Prefer fewer revisions when the origin is near its storage ceiling.
  const budget = await storageBudgetOk(0.85);
  const maxEntries = budget.ok ? HISTORY_LIMIT : Math.min(HISTORY_LIMIT, 5);
  entries = entries.slice(0, maxEntries);

  const keepRev = new Set(entries.slice(1).map((e) => e.id));
  const pruneIds = hist.entries.map((e) => e.id).filter((id) => id !== newId && !keepRev.has(id));
  // Drop revWrites for pruned ids
  const filteredWrites = revWrites.filter((r) => keepRev.has(r.id));

  const ok = await commitHistoryBodies({
    generation,
    tipContent: content,
    revWrites: filteredWrites,
    pruneIds,
    indexEntries: entries,
    indexVersion: HISTORY_INDEX_VERSION,
  });
  if (!ok) {
    pushHistoryLegacy(content);
    return;
  }

  try {
    saveHistoryIndex({ generation, entries });
  } catch {
    await clearHistoryBodies([...pruneIds, ...filteredWrites.map((r) => r.id)]);
    const tipOnly = [entries[0]];
    const tipOk = await commitHistoryBodies({
      generation,
      tipContent: content,
      revWrites: [],
      pruneIds: [],
      indexEntries: tipOnly,
      indexVersion: HISTORY_INDEX_VERSION,
    });
    if (!tipOk) await setTip(generation, content);
    saveHistoryIndex({ generation, entries: tipOnly });
  }

  lastHistoryContent = content;
  void ensurePersistentStorage();
  renderHistoryMenu();
  broadcastStorage();
}

function renderHistoryMenu() {
  const entries = loadHistoryIndexEntries();
  historyMenu.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No history yet";
    historyMenu.appendChild(empty);
    return;
  }

  entries.forEach((entry, index) => {
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
      void restoreHistoryEntry(index);
    });

    li.appendChild(btn);
    historyMenu.appendChild(li);
  });
}

async function restoreHistoryEntry(index) {
  if (!confirmDiscardIfDirty()) return;
  const content = await materializeHistoryEntry(index);
  if (content == null) {
    showToast("Could not restore history item");
    return;
  }
  setEditorValue(content);
  lastHistoryContent = content;
  await persistDraft(content);
  renderMarkdown(content);
  clearCurrentFileBinding();
  // History is not a disk/URL baseline — stay dirty until save.
  markDirtyBaseline();
  setContentExternal(false);
  closeHistory();
  showToast("Restored from history");
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
  closeWritingToolsMenu();
  closeViewModeMenu();
}

function toggleOverflowMenu() {
  if (toolbarMenu.classList.contains("is-open")) closeOverflowMenu();
  else openOverflowMenu();
}

/** Close the topmost open menu/drawer. Returns true if something was dismissed. */
function dismissOpenOverlay() {
  if (viewModeMenu && !viewModeMenu.hidden) {
    closeViewModeMenu();
    return true;
  }
  if (historyMenu && !historyMenu.hidden) {
    closeHistory();
    return true;
  }
  if (voiceMenu && !voiceMenu.hidden) {
    closeVoiceMenu();
    return true;
  }
  if (shareMenu && !shareMenu.hidden) {
    closeShareMenu();
    return true;
  }
  if (exportMenu && !exportMenu.hidden) {
    closeExportMenu();
    return true;
  }
  if (writingToolsMenu && !writingToolsMenu.hidden) {
    closeWritingToolsMenu();
    return true;
  }
  if (toolbarMenu?.classList.contains("is-open")) {
    closeOverflowMenu();
    return true;
  }
  if (filesContextMenu && !filesContextMenu.hidden) {
    closeFilesContextMenu();
    return true;
  }
  if (filesDrawerOpen && window.matchMedia(NARROW_MQ).matches) {
    setFilesDrawerOpen(false);
    return true;
  }
  return false;
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
  // Collapse is an authoring-layout preference. Reader / present hide the expand
  // control and must always show the preview.
  const previewCollapsedPref = localStorage.getItem(STORAGE_KEYS.previewCollapsed) === "1";
  const previewCollapsed = previewCollapsedPref && isAuthoringView();

  panes.classList.toggle("editor-collapsed", editorCollapsed);
  panes.classList.toggle("preview-collapsed", previewCollapsed);

  collapseEditorBtn.setAttribute("aria-pressed", String(editorCollapsed));
  collapsePreviewBtn.setAttribute("aria-pressed", String(previewCollapsed));
  collapseEditorBtn.title = editorCollapsed ? "Expand editor" : "Collapse editor";
  collapsePreviewBtn.title = previewCollapsed ? "Expand preview" : "Collapse preview";
  collapseEditorBtn.setAttribute("aria-label", collapseEditorBtn.title);
  collapsePreviewBtn.setAttribute("aria-label", collapsePreviewBtn.title);
  splitter.setAttribute("aria-hidden", String(editorCollapsed || previewCollapsed));
  splitter.tabIndex = editorCollapsed || previewCollapsed ? -1 : 0;
  invalidateScrollAnchors();
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
  // Reader / present always show the preview; edit and slides can collapse it.
  if (!isAuthoringView()) return;
  const next = localStorage.getItem(STORAGE_KEYS.previewCollapsed) !== "1";
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

/** True when `el` participates in preview layout (not slide-hidden or section-folded). */
function previewNodeIsLaidOut(el) {
  return Boolean(el) && !el.hidden && !el.closest("[hidden], .md-section-folded");
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
    if (!previewNodeIsLaidOut(el)) continue;
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
  const syncLabel = syncScrollEnabled ? "Unsync scroll" : "Sync scroll";
  syncScrollBtn.title = syncLabel;
  syncScrollBtn.setAttribute("aria-label", syncLabel);
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

function isProofreadPreviewActive() {
  return (
    document.body.dataset.aiProofPreview === "1" &&
    Boolean(aiProofEditor) &&
    Boolean(aiProofEditorWrap) &&
    !aiProofEditorWrap.hidden
  );
}

function syncProofEditorHighlightScroll() {
  if (!aiProofEditor || !aiProofHighlight) return;
  aiProofHighlight.scrollTop = aiProofEditor.scrollTop;
  aiProofHighlight.scrollLeft = aiProofEditor.scrollLeft;
}

function syncPreviewFromEditor() {
  if (!syncScrollEnabled || syncScrollDriver === "preview") return;
  if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
    return;
  }
  // Proofread replaces the rendered preview with a second editor — ratio-sync
  // that pane so Sync scroll still couples left and right.
  if (isProofreadPreviewActive()) {
    beginSyncDriver("editor");
    applyScrollRatio(aiProofEditor, scrollRatio(editor));
    syncProofEditorHighlightScroll();
    return;
  }
  if (currentView === "slides") {
    beginSyncDriver("editor");
    syncSlidesFromEditor({ preferCaret: false });
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
  if (isProofreadPreviewActive()) {
    beginSyncDriver("preview");
    applyScrollRatio(editor, scrollRatio(aiProofEditor));
    syncEditorHighlightScroll();
    return;
  }
  // In slides mode the active slide follows the editor caret/viewport. Reverse
  // sync would scroll the editor and then re-resolve the slide from the
  // viewport top — often jumping back to an earlier slide still on screen.
  if (currentView === "slides") return;
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
 * In slides mode, also switches to the slide that contains the caret line.
 */
function revealPreviewForEditorCaret() {
  if (!syncScrollEnabled) return;
  if (panes.classList.contains("editor-collapsed") || panes.classList.contains("preview-collapsed")) {
    return;
  }
  // Proofread right pane is plain text — caret reveal uses rendered blocks.
  if (isProofreadPreviewActive()) {
    syncPreviewFromEditor();
    return;
  }
  if (currentView === "slides") {
    beginSyncDriver("editor");
    syncSlidesFromEditor({ preferCaret: true });
    return;
  }
  const el = previewElementForLine(editorCaretLine());
  if (!el) return;
  // Expand collapsed ancestors so caret sync measures real geometry.
  ensurePreviewElementExpanded(el);
  if (!previewNodeIsLaidOut(el)) return;

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

/** 1-based source line nearest the top of the editor viewport. */
function editorLineNearViewportTop() {
  const lineTops = measureEditorLineTops();
  if (!lineTops.length) return 1;
  const y = editor.scrollTop + 4;
  let lo = 0;
  let hi = lineTops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineTops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Whether a 1-based editor line intersects the visible editor viewport. */
function isEditorLineVisible(line) {
  const lineTops = measureEditorLineTops();
  if (!lineTops.length || line < 1 || line > lineTops.length) return false;
  const top = lineTops[line - 1];
  const bottom = line < lineTops.length ? lineTops[line] : top + 20;
  const viewTop = editor.scrollTop;
  const viewBottom = viewTop + editor.clientHeight;
  return bottom > viewTop && top < viewBottom;
}

/** Index of the present/slides section that best covers a 1-based source line. */
function presentSectionIndexForLine(line) {
  if (!presentSections.length) buildPresentSections();
  if (!presentSections.length) return 0;

  let best = 0;
  let bestStart = -Infinity;
  for (let i = 0; i < presentSections.length; i++) {
    for (const child of presentSections[i]) {
      const start = Number(child.getAttribute("data-source-line"));
      if (!Number.isFinite(start) || start < 1) continue;
      const endRaw = Number(child.getAttribute("data-source-line-end"));
      const end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : start;
      if (line >= start && line <= end) return i;
      if (start <= line && start >= bestStart) {
        best = i;
        bestStart = start;
      }
    }
  }
  return best;
}

/**
 * Switch to the slide for the editor caret (or viewport top) and scroll the
 * matching preview block into view.
 * @param {{ preferCaret?: boolean }} [opts]
 */
function syncSlidesFromEditor({ preferCaret = true } = {}) {
  if (currentView !== "slides") return;
  if (!presentSections.length) buildPresentSections();
  if (!presentSections.length) return;

  const caretLine = editorCaretLine();
  // While the caret remains on screen, keep its slide even if an earlier
  // slide's heading is still at the top of the editor viewport.
  const line =
    preferCaret || isEditorLineVisible(caretLine)
      ? caretLine
      : editorLineNearViewportTop();
  const idx = presentSectionIndexForLine(line);
  if (idx !== presentIndex) {
    showPresentSection(idx);
    invalidateScrollAnchors();
  }

  const el = previewElementForLine(line);
  if (!previewNodeIsLaidOut(el)) return;

  const paneRect = previewPane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const pad = 8;
  if (elRect.top >= paneRect.top + pad && elRect.bottom <= paneRect.bottom - pad) {
    return;
  }

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

/** Which pane last drove outline position: "editor" | "preview". */
let outlineScrollSource = "editor";

/** 1-based source line of the last heading at or above the preview viewport top. */
function previewLineNearViewportTop() {
  const paneRect = previewPane.getBoundingClientRect();
  if (paneRect.height <= 0) return 0;
  const marker = paneRect.top + Math.min(40, paneRect.height * 0.2);
  let line = 0;
  for (const h of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!previewNodeIsLaidOut(h)) continue;
    const src = Number(h.getAttribute("data-source-line"));
    if (!Number.isFinite(src) || src < 1) continue;
    if (h.getBoundingClientRect().top <= marker) line = src;
    else break;
  }
  return line;
}

/** Source line used to pick the active outline row from scroll/caret position. */
function outlineSourceLine() {
  const previewVisible = !panes.classList.contains("preview-collapsed");
  const editorVisible = !panes.classList.contains("editor-collapsed");

  // Editor caret/click wins while the editor is driving outline position.
  if (editorVisible && outlineScrollSource === "editor") {
    const caret = editorCaretLine();
    if (document.activeElement === editor || isEditorLineVisible(caret)) return caret;
    return editorLineNearViewportTop();
  }

  if (previewVisible) {
    const line = previewLineNearViewportTop();
    if (line > 0) return line;
  }

  if (editorVisible) return editorLineNearViewportTop();
  return editorCaretLine();
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
    persistDraftFireAndForget(source);
  }
  scheduleEditorHighlight();
  invalidateScrollAnchors();
  scheduleRender();
  updateSaveButton();
  window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => void pushHistory(source), HISTORY_DEBOUNCE_MS);
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
  // Clean only after a disk save/load or Accept of URL md/mdz content.
  // IDB auto-save does not clear dirty.
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
  if (speechActive) updateSpeechMediaSession();
}

/**
 * @returns {Record<string, string>}
 */
function loadSavedSnapshotMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.savedSnapshot);
    if (raw == null) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.v === 1 && parsed.byKey && typeof parsed.byKey === "object") {
        /** @type {Record<string, string>} */
        const out = {};
        for (const [key, value] of Object.entries(parsed.byKey)) {
          if (typeof value === "string") out[key] = value;
        }
        return out;
      }
    } catch {
      /* legacy plain markdown snapshot */
    }
    return { untitled: raw };
  } catch {
    return {};
  }
}

/**
 * @param {string} [docKey]
 * @returns {string | null}
 */
function readSavedSnapshot(docKey = currentDocKey()) {
  const map = loadSavedSnapshotMap();
  return Object.prototype.hasOwnProperty.call(map, docKey) ? map[docKey] : null;
}

/**
 * @param {string} docKey
 * @param {string} content
 */
function writeSavedSnapshot(docKey, content) {
  try {
    const map = loadSavedSnapshotMap();
    map[docKey] = content;
    const keys = Object.keys(map);
    if (keys.length > SAVED_SNAPSHOT_MAX_KEYS) {
      const drop = keys.filter((k) => k !== docKey && k !== "untitled");
      while (Object.keys(map).length > SAVED_SNAPSHOT_MAX_KEYS && drop.length) {
        delete map[drop.shift()];
      }
    }
    localStorage.setItem(
      STORAGE_KEYS.savedSnapshot,
      JSON.stringify({ v: 1, byKey: map }),
    );
  } catch {
    /* ignore quota */
  }
}

/**
 * @param {string} fromKey
 * @param {string} toKey
 */
function moveSavedSnapshot(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  try {
    const map = loadSavedSnapshotMap();
    if (Object.prototype.hasOwnProperty.call(map, fromKey)) {
      map[toKey] = map[fromKey];
      delete map[fromKey];
      localStorage.setItem(
        STORAGE_KEYS.savedSnapshot,
        JSON.stringify({ v: 1, byKey: map }),
      );
    }
  } catch {
    /* ignore */
  }
}

function markCleanFromEditor() {
  // Call only after persisting to disk or accepting URL share content.
  savedSnapshot = getMarkdownSource();
  writeSavedSnapshot(currentDocKey(), savedSnapshot);
  updateSaveButton();
}

/** Untitled / draft baseline: any non-matching content counts as dirty. */
function markDirtyBaseline() {
  savedSnapshot = "";
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
  const prevKey = currentDocKey();
  currentFileHandle = fileHandle;
  currentFileName = name || fileHandle?.name || "";
  currentFilePath = path || pathForHandle(fileHandle) || "";
  const nextKey = currentDocKey();
  if (prevKey !== nextKey) {
    const snap = readSavedSnapshot(nextKey);
    if (snap != null) savedSnapshot = snap;
  }
  updateDocumentTitle();
  updateSaveButton();
  highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/** Show a generic OS app-icon flag when there are unsaved edits (installed PWA). */
function updateUnsavedAppBadge(dirty = isDirty()) {
  if (!("setAppBadge" in navigator) || !("clearAppBadge" in navigator)) return;
  try {
    if (dirty) void navigator.setAppBadge().catch(() => {});
    else void navigator.clearAppBadge().catch(() => {});
  } catch {
    /* NotAllowedError / InvalidStateError — ignore */
  }
}

function updateSaveButton() {
  const dirty = isDirty();
  updateUnsavedAppBadge(dirty);
  if (!saveBtn || !fsAccessSupported) return;
  saveBtn.classList.toggle("is-dirty", dirty);
  saveBtn.title = dirty
    ? `Save unsaved changes (Ctrl/Cmd+S)`
    : currentFileName
      ? `Save ${currentFileName} (Ctrl/Cmd+S)`
      : "Save (Ctrl/Cmd+S)";
}

function setFilesDrawerOpen(open, { persist = true, preserveDragWidth = false } = {}) {
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
  if (!filesDrawerOpen) {
    drawerCloseDrag = null;
    document.body.classList.remove("files-drawer-dragging");
    if (!preserveDragWidth) filesDrawer?.style.removeProperty("width");
  }
  if (persist) {
    localStorage.setItem(STORAGE_KEYS.filesDrawer, filesDrawerOpen ? "1" : "0");
  }
}

function toggleFilesDrawer() {
  setFilesDrawerOpen(!filesDrawerOpen);
}

function onDrawerCloseDragPointerDown(e) {
  if (!filesDrawerOpen || !filesDrawer) return;
  // Mouse included so narrow desktop / DevTools can exercise the same gesture.
  if (e.pointerType === "pen") return;
  if (!isStackedLayout()) return;
  // Don't steal the splitter resize gesture.
  if (e.target.closest?.("#splitter")) return;
  drawerCloseDrag = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    width: filesDrawer.getBoundingClientRect().width,
    active: false,
  };
}

function onDrawerCloseDragPointerMove(e) {
  if (!drawerCloseDrag || e.pointerId !== drawerCloseDrag.id || !filesDrawer) return;
  const dx = e.clientX - drawerCloseDrag.startX;
  const dy = e.clientY - drawerCloseDrag.startY;

  if (!drawerCloseDrag.active) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    // Commit only to a clear leftward drag so vertical scrolling still works.
    if (dx >= 0 || Math.abs(dx) <= Math.abs(dy)) {
      drawerCloseDrag = null;
      return;
    }
    drawerCloseDrag.active = true;
    document.body.classList.add("files-drawer-dragging");
    try {
      panes.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  if (drawerCloseDrag.active) e.preventDefault();

  // Shrink the drawer so the panes slide left over it with the finger.
  const next = Math.max(0, Math.min(drawerCloseDrag.width, drawerCloseDrag.width + dx));
  filesDrawer.style.width = `${next}px`;
}

function finishDrawerCloseDrag(e, { cancelled = false } = {}) {
  if (!drawerCloseDrag || e.pointerId !== drawerCloseDrag.id) return;
  const { active, width: startWidth, startX } = drawerCloseDrag;
  const dx = e.clientX - startX;
  const currentWidth = filesDrawer?.getBoundingClientRect().width ?? startWidth;
  drawerCloseDrag = null;

  if (!filesDrawer || !active || cancelled) {
    document.body.classList.remove("files-drawer-dragging");
    filesDrawer?.style.removeProperty("width");
    return;
  }

  const shouldClose =
    currentWidth < startWidth * 0.5 || dx <= -DRAWER_CLOSE_SWIPE_MIN_DX;

  // Re-enable transitions while still at the dragged width, then settle.
  filesDrawer.style.width = `${currentWidth}px`;
  document.body.classList.remove("files-drawer-dragging");
  void filesDrawer.offsetWidth;

  if (shouldClose) {
    setFilesDrawerOpen(false, { preserveDragWidth: true });
    filesDrawer.style.removeProperty("width");
  } else {
    // Snap the drawer back open under the panes.
    filesDrawer.style.removeProperty("width");
  }
}

function onDrawerCloseDragPointerUp(e) {
  finishDrawerCloseDrag(e);
}

function onDrawerCloseDragPointerCancel(e) {
  // If the browser cancelled after we already claimed the gesture, still finish
  // from the last dragged width instead of snapping open and ignoring the drag.
  finishDrawerCloseDrag(e, { cancelled: !drawerCloseDrag?.active });
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
    // Persist the outgoing document under its own key before switching.
    await persistDraft(getMarkdownSource());
    const text = await readTextFile(/** @type {FileSystemFileHandle} */ (entry.handle));
    setEditorValue(text);
    bindCurrentFile(/** @type {FileSystemFileHandle} */ (entry.handle), entry.handle.name, path);
    await persistDraft(getMarkdownSource());
    renderMarkdown(getMarkdownSource());
    await pushHistory(getMarkdownSource());
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
  await persistDraft(getMarkdownSource());
  setEditorValue("");
  clearCurrentFileBinding();
  await persistDraft("");
  renderMarkdown("");
  markDirtyBaseline();
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
    await persistDraft(getMarkdownSource());
    setEditorValue("");
    bindCurrentFile(handle, name, createdPath);
    await persistDraft("");
    renderMarkdown("");
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
      const fromKey = currentDocKey();
      bindCurrentFile(/** @type {FileSystemFileHandle} */ (renamed), finalName, renamedPath);
      const toKey = currentDocKey();
      if (fromKey !== toKey) {
        void moveDraft(fromKey, toKey);
        moveSavedSnapshot(fromKey, toKey);
      }
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
      const fromKey = currentDocKey();
      bindCurrentFile(handle, name, createdPath);
      const toKey = currentDocKey();
      if (fromKey !== toKey) {
        void moveDraft(fromKey, toKey);
        moveSavedSnapshot(fromKey, toKey);
      }
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
    const fromKey = currentDocKey();
    bindCurrentFile(handle, handle.name, "");
    const toKey = currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      moveSavedSnapshot(fromKey, toKey);
    }
    markCleanFromEditor();
    showToast(`Saved ${handle.name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast("Could not save");
  }
}

function headingTitleText(heading) {
  const label = heading.querySelector(":scope > .md-section-label");
  if (label) return label.textContent?.trim() || "";
  const clone = heading.cloneNode(true);
  clone.querySelectorAll(".md-section-toggle").forEach((el) => el.remove());
  return clone.textContent?.trim() || "";
}

function sectionCollapseKey(heading) {
  // Prefer source line so duplicate titles collapse independently across re-renders.
  const line = Number(heading.getAttribute("data-source-line"));
  if (Number.isFinite(line) && line >= 1) return `line:${line}`;
  const all = [...preview.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const idx = all.indexOf(heading);
  return `idx:${idx}:${heading.tagName.slice(1)}:${headingTitleText(heading).toLowerCase()}`;
}

function headingLevel(el) {
  if (!el || !/^H[1-6]$/.test(el.tagName)) return 0;
  return Number(el.tagName.slice(1));
}

/** True when `el` falls under `heading`'s fold range (until next same-or-higher heading). */
function headingCoversElement(heading, el) {
  if (!heading || !el || heading === el) return false;
  const level = headingLevel(heading);
  if (!level) return false;
  let node = heading.nextElementSibling;
  while (node) {
    if (node === el) return true;
    if (headingLevel(node) && headingLevel(node) <= level) return false;
    node = node.nextElementSibling;
  }
  return false;
}

function clearSectionFolds() {
  unwrapSectionAnims();
  preview.querySelectorAll(".md-section-folded").forEach((el) => {
    el.classList.remove("md-section-folded");
  });
}

function unwrapSectionAnims() {
  // Wrappers may sit inside blockquotes/alerts, not only as preview children.
  const anims = [...preview.querySelectorAll(".md-section-anim")].reverse();
  for (const wrap of anims) {
    const parent = wrap.parentNode;
    if (!parent) continue;
    const inner = wrap.querySelector(":scope > .md-section-anim-inner") || wrap;
    while (inner.firstChild) parent.insertBefore(inner.firstChild, wrap);
    wrap.remove();
  }
}

/** Direct siblings that belong to this heading's fold range. */
function sectionBodyElements(heading) {
  const level = headingLevel(heading);
  const els = [];
  let el = heading.nextElementSibling;
  while (el) {
    if (el.classList.contains("md-section-anim")) {
      // Defensive: an interrupted fold can leave a wrapper as a sibling. Unpack
      // its children but still honor the same-or-higher heading boundary —
      // otherwise sibling section titles get absorbed into this heading's body.
      const inner = el.querySelector(":scope > .md-section-anim-inner");
      const kids = inner ? [...inner.children] : [];
      for (const kid of kids) {
        const kidLevel = headingLevel(kid);
        if (kidLevel && kidLevel <= level) return els;
        els.push(kid);
      }
      el = el.nextElementSibling;
      continue;
    }
    const nextLevel = headingLevel(el);
    if (nextLevel && nextLevel <= level) break;
    els.push(el);
    el = el.nextElementSibling;
  }
  return els;
}

function updateSectionToggleUi(heading, collapsed) {
  heading.classList.toggle("is-collapsed", collapsed);
  const toggle = heading.querySelector(":scope > .md-section-toggle");
  if (!toggle) return;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.title = collapsed ? "Expand section" : "Collapse section";
  toggle.setAttribute("aria-label", toggle.title);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True if another collapsed heading (not `except`) currently covers `el`. */
function coveredByOtherCollapsedHeading(el, except) {
  for (const heading of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (heading === except) continue;
    if (!collapsedSections.has(sectionCollapseKey(heading))) continue;
    if (headingCoversElement(heading, el)) return true;
  }
  return false;
}

/**
 * Apply `.md-section-folded` from `collapsedSections` without mermaid/scroll work.
 * Used to re-sync after an interrupted animation unwraps mid-flight.
 */
function applyFoldClassesFromSet() {
  preview.querySelectorAll(".md-section-folded").forEach((el) => {
    el.classList.remove("md-section-folded");
  });
  if (isSlideNavView()) return;

  for (const heading of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const collapsed = collapsedSections.has(sectionCollapseKey(heading));
    updateSectionToggleUi(heading, collapsed);
    if (!collapsed) continue;

    const level = headingLevel(heading);
    let el = heading.nextElementSibling;
    while (el) {
      const nextLevel = headingLevel(el);
      if (nextLevel && nextLevel <= level) break;
      el.classList.add("md-section-folded");
      el = el.nextElementSibling;
    }
  }
}

/**
 * Animate fold/unfold of a section body via a temporary grid wrapper.
 * Resolves when the transition finishes (or immediately if nothing to animate).
 * Caller must ensure no `.md-section-anim` is already in the tree (interrupted
 * toggles settle via applySectionCollapse instead of chaining anims).
 */
function animateSectionFold(heading, collapsing) {
  unwrapSectionAnims();

  const els = sectionBodyElements(heading);
  if (!els.length) return Promise.resolve();

  // Snapshot before moving nodes: headingCoversElement walks siblings, and that
  // chain breaks once nested headings are relocated into the anim wrapper —
  // otherwise nested collapsed bodies briefly lose .md-section-folded.
  const stayFolded = new Set();
  if (!collapsing) {
    for (const node of els) {
      if (coveredByOtherCollapsedHeading(node, heading)) stayFolded.add(node);
    }
    // Expanding under a still-collapsed parent would build an empty
    // `.md-section-anim.is-expanded` (all children stay display:none) that can
    // linger and look like section bodies leaked under collapsed titles.
    if (stayFolded.size === els.length) return Promise.resolve();
  }

  // Tall sections (e.g. Getting started with the paste-image example) animate
  // through thousands of px and shove sibling titles off-screen within a frame.
  // Skip the height animation and let applySectionCollapse settle instantly.
  // On expand, folded nodes report offsetHeight 0 — also use content heuristics
  // so re-expanding a previously collapsed tall section still skips the anim.
  const paneH = previewPane?.clientHeight || window.innerHeight || 0;
  let bodyH = 0;
  let approxChars = 0;
  let revealCount = 0;
  for (const node of els) {
    if (stayFolded.has(node)) continue;
    revealCount += 1;
    approxChars += (node.textContent || "").length;
    if (node.classList.contains("md-section-folded")) continue;
    bodyH += node.offsetHeight || 0;
  }
  if (
    (paneH > 0 && bodyH > paneH * 1.25) ||
    revealCount > 12 ||
    approxChars > 4000
  ) {
    return Promise.resolve();
  }

  const wrap = document.createElement("div");
  wrap.className = "md-section-anim";
  const inner = document.createElement("div");
  inner.className = "md-section-anim-inner";
  wrap.appendChild(inner);
  heading.after(wrap);

  // Set the starting grid size BEFORE moving body nodes in. On expand, revealing
  // a previously folded body into a default 1fr wrapper for even one frame shoves
  // following section headings off-screen (they look like they vanish).
  wrap.classList.add(collapsing ? "is-expanded" : "is-collapsed");

  for (const node of els) {
    if (!collapsing && !stayFolded.has(node)) {
      node.classList.remove("md-section-folded");
    }
    inner.appendChild(node);
  }

  // Force layout so the initial grid row size is committed before toggling.
  void wrap.offsetHeight;

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      wrap.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (e) => {
      if (e.target !== wrap || e.propertyName !== "grid-template-rows") return;
      finish();
    };
    wrap.addEventListener("transitionend", onEnd);
    requestAnimationFrame(() => {
      wrap.classList.toggle("is-expanded", !collapsing);
      wrap.classList.toggle("is-collapsed", collapsing);
    });
    // Fallback if transitionend doesn't fire (display:none mid-flight, etc.).
    window.setTimeout(finish, 280);
  });
}

function applySectionCollapse() {
  clearSectionFolds();
  if (isSlideNavView()) return;

  applyFoldClassesFromSet();
  void renderMermaidDiagrams();
  invalidateScrollAnchors();
}

function enhanceSectionToggles() {
  for (const heading of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (heading.querySelector(":scope > .md-section-toggle")) continue;
    const label = document.createElement("span");
    label.className = "md-section-label";
    while (heading.firstChild) label.appendChild(heading.firstChild);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "md-section-toggle";
    btn.setAttribute("aria-expanded", "true");
    btn.title = "Collapse section";
    btn.setAttribute("aria-label", "Collapse section");
    const twistie = document.createElement("span");
    twistie.className = "md-section-twistie";
    twistie.setAttribute("aria-hidden", "true");
    // SVG (not ▼) so rotate(-90deg) pivots on the triangle's geometric center.
    twistie.innerHTML =
      '<svg viewBox="0 0 12 12" focusable="false"><path fill="currentColor" d="M0 0h12L6 12z"/></svg>';
    btn.appendChild(twistie);
    heading.append(btn, label);
  }
  applySectionCollapse();
}

function setSectionCollapsed(heading, collapsed) {
  const key = sectionCollapseKey(heading);
  if (collapsed) collapsedSections.add(key);
  else collapsedSections.delete(key);
  applySectionCollapse();
  invalidateScrollAnchors();
}

let sectionFoldAnimGen = 0;

function toggleSectionCollapse(heading) {
  const key = sectionCollapseKey(heading);
  const collapsing = !collapsedSections.has(key);
  if (collapsing) collapsedSections.add(key);
  else collapsedSections.delete(key);

  updateSectionToggleUi(heading, collapsing);

  // Always invalidate any in-flight fold animation. Chaining a new height anim on
  // top of an interrupted one left `.md-section-anim.is-expanded` wrappers in the
  // DOM with is-collapsed headings — bodies stayed visible under "collapsed" titles.
  const busy = Boolean(preview.querySelector(".md-section-anim"));
  const gen = ++sectionFoldAnimGen;

  if (busy || isSlideNavView() || prefersReducedMotion()) {
    applySectionCollapse();
    invalidateScrollAnchors();
    return;
  }

  const animPromise = animateSectionFold(heading, collapsing);
  // Tall/empty skips resolve without creating a wrapper. Apply folds synchronously
  // in that case — deferring to a microtask left `is-collapsed` headings with
  // still-visible bodies until the next tick (and raced with rapid re-clicks).
  if (!preview.querySelector(".md-section-anim")) {
    applySectionCollapse();
    invalidateScrollAnchors();
    return;
  }

  animPromise
    .then(() => {
      if (gen !== sectionFoldAnimGen) return;
      applySectionCollapse();
      invalidateScrollAnchors();
    })
    .catch(() => {
      if (gen !== sectionFoldAnimGen) return;
      applySectionCollapse();
      invalidateScrollAnchors();
    });
}

/** Expand any collapsed headings that hide `el` (e.g. outline / sync-scroll jumps). */
function ensurePreviewElementExpanded(el) {
  if (!el || isSlideNavView()) return;
  let changed = false;
  for (const heading of preview.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!heading.classList.contains("is-collapsed")) continue;
    if (!headingCoversElement(heading, el) && heading !== el) continue;
    collapsedSections.delete(sectionCollapseKey(heading));
    changed = true;
  }
  if (changed) applySectionCollapse();
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
    btn.textContent = headingTitleText(heading) || `Heading ${level}`;
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

/** Scroll the preview pane to the heading/block for a 1-based source line. */
function scrollPreviewToSourceLine(line) {
  if (!Number.isFinite(line) || line < 1) return;

  if (isSlideNavView()) {
    if (!presentSections.length) buildPresentSections();
    if (presentSections.length) {
      const idx = presentSectionIndexForLine(line);
      if (idx !== presentIndex) {
        showPresentSection(idx);
        invalidateScrollAnchors();
      }
    }
  }

  const headings = [...preview.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const target =
    headings.find((h) => Number(h.getAttribute("data-source-line")) === line) ||
    previewElementForLine(line);
  if (!target || target.hidden || target.closest("[hidden]")) return;
  ensurePreviewElementExpanded(target);
  if (!previewNodeIsLaidOut(target)) return;

  // Prefer "editor" as driver when the editor is open so preview scroll does not
  // reverse-sync the caret away from the outline target.
  beginSyncDriver(panes.classList.contains("editor-collapsed") ? "preview" : "editor");
  clampScrollTop(previewPane, offsetWithin(target, previewPane) - 8);
}

/**
 * Jump to a source line from the outline. Scrolls the editor when it is open,
 * and the preview (including the matching slide) when the preview is open.
 */
function goToSourceLine(line) {
  if (!Number.isFinite(line) || line < 1) return;

  const editorVisible = !panes.classList.contains("editor-collapsed");
  const previewVisible = !panes.classList.contains("preview-collapsed");
  const pos = offsetOfSourceLine(line);
  editor.setSelectionRange(pos, pos);

  if (editorVisible) {
    editor.focus();
    outlineScrollSource = "editor";
    const lineTops = measureEditorLineTops();
    const top = lineTops[line - 1] ?? 0;
    beginSyncDriver("editor");
    clampScrollTop(editor, top - Math.min(48, editor.clientHeight * 0.2));
    syncEditorHighlightScroll();
  }

  if (previewVisible) {
    outlineScrollSource = "preview";
    scrollPreviewToSourceLine(line);
  }

  highlightActiveOutlineItem();
}

function highlightActiveOutlineItem() {
  if (!outlineList) return;
  const line = outlineSourceLine();
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
  preview?.addEventListener("click", (e) => {
    const toggle = e.target.closest(".md-section-toggle");
    if (!toggle || !preview.contains(toggle)) return;
    e.preventDefault();
    e.stopPropagation();
    const heading = toggle.closest("h1, h2, h3, h4, h5, h6");
    if (heading) toggleSectionCollapse(heading);
  });

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
    const headingLine = Number(heading.getAttribute("data-source-line"));
    if (Number.isFinite(headingLine) && headingLine > 0) {
      goToSourceLine(headingLine);
      return;
    }
    const editorVisible = !panes.classList.contains("editor-collapsed");
    const previewVisible = !panes.classList.contains("preview-collapsed");
    if (previewVisible) {
      if (isSlideNavView()) {
        if (!presentSections.length) buildPresentSections();
        for (let i = 0; i < presentSections.length; i++) {
          if (presentSections[i].some((n) => n === heading || n.contains(heading))) {
            if (i !== presentIndex) {
              showPresentSection(i);
              invalidateScrollAnchors();
            }
            break;
          }
        }
      }
      beginSyncDriver(panes.classList.contains("editor-collapsed") ? "preview" : "editor");
      clampScrollTop(previewPane, offsetWithin(heading, previewPane) - 8);
    }
    if (editorVisible) editor.focus();
  });
}

function setupFilesDrawer() {
  // Drawer + outline are available everywhere; folder browsing needs FS Access.
  if (filesDrawer) {
    filesDrawer.hidden = false;
    filesDrawer.classList.toggle("has-fs", fsAccessSupported);
    filesDrawer.setAttribute("aria-label", fsAccessSupported ? "Files" : "Outline");
  }
  if (filesBackdrop) filesBackdrop.hidden = false;
  if (filesToggleBtn) {
    filesToggleBtn.hidden = false;
    const label = fsAccessSupported ? "Files" : "Outline";
    filesToggleBtn.title = label;
    filesToggleBtn.setAttribute("aria-label", label);
  }

  filesToggleBtn?.addEventListener("click", () => toggleFilesDrawer());
  filesBackdrop?.addEventListener("click", () => setFilesDrawerOpen(false));
  // On narrow layouts, drag the panes left over the drawer to dismiss it.
  panes.addEventListener("pointerdown", onDrawerCloseDragPointerDown, { passive: true });
  // Non-passive so we can preventDefault once the dismiss gesture is claimed.
  panes.addEventListener("pointermove", onDrawerCloseDragPointerMove);
  panes.addEventListener("pointerup", onDrawerCloseDragPointerUp, { passive: true });
  panes.addEventListener("pointercancel", onDrawerCloseDragPointerCancel, { passive: true });

  if (fsAccessSupported) {
    document.querySelectorAll(".fs-only").forEach((el) => {
      el.hidden = false;
    });
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
      // Empty-area "new file/folder" menu is only for the files panel, not the outline.
      if (!e.target.closest(".files-section")) return;
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
  }

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
    stashPreExternalState();
    pendingExternalFromUrl = false;
    setEditorValue(text);
    bindCurrentFile(null, file.name || "", "");
    selectFsPath("");
    setContentExternal(true);
    updateSaveButton();
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
    stashPreExternalState();
    pendingExternalFromUrl = false;
    setEditorValue(text);
    bindCurrentFile(fileHandle, name);
    selectFsPath("");
    // File Handling API opens a real on-disk file — that is the clean baseline.
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

async function copyShareUrl() {
  const url = await buildShareUrl({
    markdown: getMarkdownSource(),
    theme: document.documentElement.dataset.theme,
  });
  const tooLong = url.length > SHARE_URL_WARN_CHARS;
  const label = tooLong
    ? "Link copied — may be too long for some apps"
    : "Share link copied";
  await copyText(url, label);
}

function closeShareMenu() {
  // Share is a single-click action now; kept for call sites that close open menus.
  if (!shareMenu || !shareBtn) return;
  shareMenu.hidden = true;
  shareBtn.setAttribute("aria-expanded", "false");
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

function openWritingToolsMenu() {
  if (!writingToolsMenu || !writingToolsBtn) return;
  writingToolsMenu.hidden = false;
  writingToolsBtn.setAttribute("aria-expanded", "true");
}

function closeWritingToolsMenu() {
  if (!writingToolsMenu || !writingToolsBtn) return;
  writingToolsMenu.hidden = true;
  writingToolsBtn.setAttribute("aria-expanded", "false");
}

function toggleWritingToolsMenu() {
  if (!writingToolsMenu) return;
  if (writingToolsMenu.hidden) {
    closeHistory();
    closeVoiceMenu();
    closeShareMenu();
    closeExportMenu();
    closeViewModeMenu();
    openWritingToolsMenu();
  } else {
    closeWritingToolsMenu();
  }
}

function toggleExportMenu() {
  if (!exportMenu) return;
  if (exportMenu.hidden) {
    closeHistory();
    closeVoiceMenu();
    closeShareMenu();
    closeWritingToolsMenu();
    closeViewModeMenu();
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
  // Force layout for slides/folds so every diagram gets a real size.
  await renderMermaidDiagrams({ force: true });

  const {
    buildDocxBlob,
    buildHtmlDocument,
    buildMarkdownFile,
    buildRtfDocument,
    cleanPreviewHtml,
    downloadBlob,
    exportBasename,
    printPreviewAsPdf,
  } = await loadExportModule();

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

/**
 * Keep the address bar's view (and theme) in sync. Never invent an `mdz` from
 * the editor — share payloads are only created by copyShareUrl / buildShareUrl.
 * If the URL already carries md/mdz (a real share session), preserve it as-is.
 */
function syncHashForView(view) {
  const url = new URL(window.location.href);
  const hashParams =
    url.hash.length > 1 ? new URLSearchParams(url.hash.slice(1)) : new URLSearchParams();
  const searchParams = new URLSearchParams(url.search);
  const existing =
    hashParams.has("mdz") ||
    hashParams.has("md") ||
    hashParams.has("view") ||
    hashParams.has("theme")
      ? hashParams
      : searchParams;

  const params = new URLSearchParams();
  const mdz = existing.get("mdz");
  const md = existing.get("md");
  if (mdz) params.set("mdz", mdz);
  else if (md) params.set("md", md);
  if (guideSession || existing.get("guide") === "1") params.set("guide", "1");

  const theme = document.documentElement.dataset.theme;
  if (THEMES.includes(theme)) params.set("theme", theme);
  else {
    const prevTheme = existing.get("theme");
    if (THEMES.includes(prevTheme)) params.set("theme", prevTheme);
  }

  const nextView = VIEWS.includes(view) ? view : "edit";
  params.set("view", nextView);

  url.search = "";
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
  outlineScrollSource = "preview";
  scheduleOutlineHighlight();
  void renderMermaidDiagrams();
}

/** First 1-based source line covered by a present/slides section. */
function sourceLineForPresentSection(index) {
  const section = presentSections[index];
  if (!section?.length) return null;
  let best = Infinity;
  for (const child of section) {
    const start = Number(child.getAttribute("data-source-line"));
    if (Number.isFinite(start) && start >= 1 && start < best) best = start;
  }
  return Number.isFinite(best) && best !== Infinity ? best : null;
}

/**
 * When sync-scroll is on in slides mode, move the editor caret/scroll to the
 * active slide after an explicit prev/next (or Home/End) navigation.
 */
function syncEditorToPresentSection() {
  if (currentView !== "slides" || !syncScrollEnabled) return;
  const line = sourceLineForPresentSection(presentIndex);
  if (line == null) return;

  const pos = offsetOfSourceLine(line);
  beginSyncDriver("preview");
  editor.setSelectionRange(pos, pos);

  const lineTops = measureEditorLineTops();
  const top = lineTops[line - 1] ?? 0;
  clampScrollTop(editor, top - Math.min(48, editor.clientHeight * 0.2));
  syncEditorHighlightScroll();
  scheduleOutlineHighlight();
}

function clearPresentSectionFilter() {
  for (const child of preview.children) {
    child.hidden = false;
  }
}

function isSlideNavView() {
  return currentView === "present" || currentView === "slides";
}

/**
 * True when slide nav keys (Space/arrows/etc.) should leave the focused control alone.
 * Escape still exits present/slides regardless.
 */
function isSlideNavTypingOrControl(el) {
  if (!el || el === document.body) return false;
  if (el === editor) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(
    el.closest(
      "button, a[href], select, input, textarea, summary, " +
        "[role='button'], [role='menuitem'], [role='option'], " +
        "[role='treeitem'], [role='slider'], [role='combobox'], " +
        "[role='listbox'], [role='textbox'], .splitter",
    ),
  );
}

function isAuthoringView() {
  return currentView === "edit" || currentView === "slides";
}

function updateViewModeMainBtn() {
  if (!viewModeMainBtn) return;
  const viewModeLabel = viewModeMainBtn.querySelector(".btn-text");
  if (currentView === "slides") {
    if (viewModeLabel) viewModeLabel.textContent = "Edit";
    else viewModeMainBtn.textContent = "Edit";
    viewModeMainBtn.title = "Back to full preview";
  } else {
    if (viewModeLabel) viewModeLabel.textContent = "Slides";
    else viewModeMainBtn.textContent = "Slides";
    viewModeMainBtn.title = "Slides preview";
  }
}

function openViewModeMenu() {
  if (!viewModeMenu || !viewModeMenuBtn) return;
  viewModeMenu.hidden = false;
  viewModeMenuBtn.setAttribute("aria-expanded", "true");
}

function closeViewModeMenu() {
  if (!viewModeMenu || !viewModeMenuBtn) return;
  viewModeMenu.hidden = true;
  viewModeMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleViewModeMenu() {
  if (!viewModeMenu) return;
  if (viewModeMenu.hidden) {
    closeHistory();
    closeVoiceMenu();
    closeShareMenu();
    closeExportMenu();
    closeWritingToolsMenu();
    openViewModeMenu();
  } else {
    closeViewModeMenu();
  }
}

function onViewModeMainClick() {
  if (currentView === "slides") setView("edit");
  else enterSlidesMode();
}

function setView(view, { syncUrl = true } = {}) {
  const next = VIEWS.includes(view) ? view : "edit";
  const wasSlideNav = currentView === "present" || currentView === "slides";
  const nextIsSlideNav = next === "present" || next === "slides";
  const leavingPresent = currentView === "present" && next !== "present";
  if (wasSlideNav && !nextIsSlideNav) {
    clearPresentSectionFilter();
    applySectionCollapse();
  }

  currentView = next;
  if (leavingPresent) {
    void leavePresentFullscreen();
  }
  document.body.dataset.view = next;
  syncExternalModal();
  updateViewModeMainBtn();

  if (presentChrome) {
    presentChrome.hidden = !nextIsSlideNav;
  }
  if (presentExitBtn) {
    presentExitBtn.title = next === "slides" ? "Exit slides mode" : "Exit present mode";
  }
  syncPresentChromeAutohide();

  if (nextIsSlideNav) {
    clearSectionFolds();
    buildPresentSections();
    // Keep the current slide when switching slides ↔ present; reset only when
    // entering slide-nav from edit/reader.
    showPresentSection(wasSlideNav ? presentIndex : 0);
    if (next === "slides" && syncScrollEnabled) {
      revealPreviewForEditorCaret();
    }
  }

  if (syncUrl) {
    syncHashForView(next);
  }

  applyCollapseState();

  closeShareMenu();
  closeExportMenu();
  closeWritingToolsMenu();
  closeHistory();
  closeVoiceMenu();
  closeViewModeMenu();
  closeOverflowMenu();
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function enterPresentFullscreen() {
  if (getFullscreenElement()) return;
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) return;
  try {
    await request.call(el);
  } catch {
    // Denied or missing user gesture — present mode still works windowed.
  }
}

async function leavePresentFullscreen() {
  if (!getFullscreenElement()) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit) return;
  try {
    await exit.call(document);
  } catch {
    // ignore
  }
}

function viewAfterPresent() {
  if (viewBeforePresent && viewBeforePresent !== "present" && VIEWS.includes(viewBeforePresent)) {
    return viewBeforePresent;
  }
  return "slides";
}

function clearPresentChromeHideTimer() {
  if (presentChromeHideTimer) {
    clearTimeout(presentChromeHideTimer);
    presentChromeHideTimer = 0;
  }
}

function setPresentChromeActive(active) {
  presentChrome?.classList.toggle("is-active", active);
}

function schedulePresentChromeHide() {
  clearPresentChromeHideTimer();
  presentChromeHideTimer = window.setTimeout(() => {
    presentChromeHideTimer = 0;
    if (currentView === "present") setPresentChromeActive(false);
  }, PRESENT_CHROME_IDLE_MS);
}

function revealPresentChrome() {
  if (currentView !== "present" || !presentChrome || presentChrome.hidden) return;
  setPresentChromeActive(true);
  schedulePresentChromeHide();
}

function syncPresentChromeAutohide() {
  clearPresentChromeHideTimer();
  if (currentView === "present") {
    revealPresentChrome();
  } else {
    setPresentChromeActive(false);
  }
}

function onPresentChromePointerActivity() {
  revealPresentChrome();
}

function onPresentSwipePointerDown(e) {
  if (currentView !== "present") return;
  if (e.pointerType !== "touch") return;
  if (e.target.closest?.("#present-chrome")) return;
  presentSwipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
}

function onPresentSwipePointerUp(e) {
  if (!presentSwipe || e.pointerId !== presentSwipe.id) return;
  const dx = e.clientX - presentSwipe.x;
  const dy = e.clientY - presentSwipe.y;
  presentSwipe = null;
  if (currentView !== "present") return;
  if (Math.abs(dx) < PRESENT_SWIPE_MIN_DX) return;
  if (Math.abs(dx) <= Math.abs(dy)) return;
  if (dx < 0) presentNext();
  else presentPrev();
  revealPresentChrome();
}

function onPresentSwipePointerCancel(e) {
  if (presentSwipe && e.pointerId === presentSwipe.id) presentSwipe = null;
}

function onPresentFullscreenChange() {
  if (currentView !== "present") return;
  if (getFullscreenElement()) return;
  // Browser left fullscreen (e.g. Esc) — leave present mode with it.
  setView(viewAfterPresent());
}

function enterPresentMode() {
  if (currentView !== "present") {
    viewBeforePresent = currentView;
  }
  setView("present");
  void enterPresentFullscreen();
}

function enterSlidesMode() {
  setView("slides");
}

/** Landscape pages when printing a slide deck; clear afterward so edit print stays default. */
function syncPrintPageOrientation() {
  let el = document.getElementById("print-orientation-style");
  if (!el) {
    el = document.createElement("style");
    el.id = "print-orientation-style";
    document.head.appendChild(el);
  }
  const landscape = currentView === "slides" || currentView === "present";
  el.textContent = landscape
    ? "@media print { @page { size: landscape; margin: 0.5in; } }"
    : "";
}

function clearPrintPageOrientation() {
  const el = document.getElementById("print-orientation-style");
  if (el) el.textContent = "";
}

function exitPresentMode() {
  if (currentView === "slides") {
    setView("edit");
    return;
  }
  setView(viewAfterPresent());
}

function presentNext() {
  if (!isSlideNavView()) return;
  showPresentSection(presentIndex + 1);
  syncEditorToPresentSection();
}

function presentPrev() {
  if (!isSlideNavView()) return;
  showPresentSection(presentIndex - 1);
  syncEditorToPresentSection();
}

function buildPreviewSpeechMap() {
  const nodes = [];
  let text = "";
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script, style, .mermaid, .line-num")) return NodeFilter.FILTER_REJECT;
      // Skip fold chrome (▼) and bodies hidden by section collapse.
      if (parent.closest(".md-section-toggle, .md-section-folded")) {
        return NodeFilter.FILTER_REJECT;
      }
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

function speechOffsetsForSection(map, sectionNodes) {
  if (!map?.nodes?.length || !sectionNodes?.length) return null;
  let start = Infinity;
  let end = -1;
  for (const entry of map.nodes) {
    const parent = entry.node.parentElement;
    if (!parent) continue;
    if (!sectionNodes.some((section) => section === parent || section.contains(parent))) {
      continue;
    }
    start = Math.min(start, entry.start);
    end = Math.max(end, entry.end);
  }
  if (!Number.isFinite(start) || end <= start) return null;
  return { start, end };
}

function speechSectionTitle(sectionNodes, index) {
  for (const node of sectionNodes) {
    if (!/^H[1-6]$/.test(node.tagName)) continue;
    const title = headingTitleText(node);
    if (title) return title.slice(0, 120);
  }
  if (index === 0) return currentFileName || "Introduction";
  return `Section ${index + 1}`;
}

function buildSpeechTracks() {
  buildPresentSections();
  speechMap = buildPreviewSpeechMap();

  if (speechMap.text?.trim() && presentSections.length) {
    const tracks = [];
    for (let i = 0; i < presentSections.length; i++) {
      const offsets = speechOffsetsForSection(speechMap, presentSections[i]);
      if (!offsets) continue;
      const text = speechMap.text.slice(offsets.start, offsets.end);
      if (!text.trim()) continue;
      const chunks = chunkSpeechText(text).map((chunk) => ({
        text: chunk.text,
        start: chunk.start + offsets.start,
      }));
      if (!chunks.length) continue;
      tracks.push({
        title: speechSectionTitle(presentSections[i], i),
        sectionIndex: i,
        start: offsets.start,
        end: offsets.end,
        chunks,
      });
    }
    if (tracks.length) return tracks;
  }

  const text = speechMap.text?.trim()
    ? speechMap.text
    : (getMarkdownSource() || "").trim();
  if (!text) {
    speechMap = null;
    return [];
  }
  if (!speechMap.text?.trim()) speechMap = null;

  return [
    {
      title: currentFileName || "Markdown Preview",
      sectionIndex: 0,
      start: 0,
      end: text.length,
      chunks: chunkSpeechText(text),
    },
  ];
}

function listVoices() {
  return listVoicesFromList(window.speechSynthesis.getVoices());
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

  if (speakPauseBtn) {
    speakPauseBtn.disabled = !speechActive;
    speakPauseBtn.setAttribute("aria-pressed", String(speechPaused));
    speakPauseBtn.title = speechPaused ? "Resume" : "Pause";
    speakPauseBtn.setAttribute("aria-label", speechPaused ? "Resume" : "Pause");
    speakPauseBtn.classList.toggle("is-paused", speechPaused);
  }

  const trackCount = speechTracks.length;
  const canSeekTracks = speechActive && trackCount > 0;
  if (speakPrevBtn) {
    speakPrevBtn.hidden = !speechActive;
    speakPrevBtn.disabled = !canSeekTracks;
  }
  if (speakNextBtn) {
    speakNextBtn.hidden = !speechActive;
    speakNextBtn.disabled = !canSeekTracks || speechTrackIndex >= trackCount - 1;
  }

  updateSpeechMediaSession();
}

const mediaSessionSupported =
  typeof navigator !== "undefined" && "mediaSession" in navigator && typeof MediaMetadata !== "undefined";

/** HTMLAudioElement that keeps OS / Chrome media controls alive for TTS. */
let speechSessionAudio = null;
/** @type {string} */
let speechSessionAudioUrl = "";

function buildNearSilentWavBlobUrl(seconds = 8, sampleRate = 8000) {
  const numSamples = seconds * sampleRate;
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  // Tiny alternating samples so UAs don't treat the stream as fully muted.
  for (let i = 0; i < numSamples; i += 1) {
    view.setInt16(44 + i * 2, i % 2 === 0 ? 1 : -1, true);
  }

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function ensureSpeechSessionAudio() {
  if (speechSessionAudio) return speechSessionAudio;
  if (!speechSessionAudioUrl) speechSessionAudioUrl = buildNearSilentWavBlobUrl();
  const audio = new Audio();
  audio.preload = "auto";
  audio.loop = true;
  audio.volume = 0.001;
  audio.src = speechSessionAudioUrl;
  audio.setAttribute("playsinline", "");
  speechSessionAudio = audio;
  return audio;
}

/** Chrome already exposes Now Playing for remote/Google speechSynthesis voices. */
function speechVoiceOwnsBrowserSession(voice = preferredVoice()) {
  return Boolean(voice && !voice.localService);
}

async function startSpeechSessionAudio() {
  // Avoid a second media card alongside Chrome's "Google Network Speech" session.
  if (speechVoiceOwnsBrowserSession()) {
    stopSpeechSessionAudio();
    if (speechActive) updateSpeechMediaSession();
    return;
  }

  const audio = ensureSpeechSessionAudio();
  try {
    if (audio.paused) await audio.play();
    if (speechActive) updateSpeechMediaSession();
  } catch {
    /* play() may still be blocked without a gesture / policy */
  }
}

function pauseSpeechSessionAudio() {
  if (!speechSessionAudio || speechSessionAudio.paused) return;
  speechSessionAudio.pause();
}

function stopSpeechSessionAudio() {
  if (!speechSessionAudio) return;
  speechSessionAudio.pause();
  try {
    speechSessionAudio.currentTime = 0;
  } catch {
    /* ignore seek errors */
  }
}

function speechMediaArtwork() {
  const artwork = [];
  for (const link of document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) {
    const src = link.href;
    if (!src) continue;
    const sizes = link.getAttribute("sizes") || "192x192";
    const type = link.getAttribute("type") || "image/png";
    if (artwork.some((entry) => entry.src === src && entry.sizes === sizes)) continue;
    artwork.push({ src, sizes, type });
  }
  return artwork;
}

function updateSpeechMediaSession() {
  if (!mediaSessionSupported) return;
  try {
    if (!speechActive) {
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.metadata = null;
      return;
    }

    const track = speechTracks[speechTrackIndex];
    const trackCount = speechTracks.length;
    const title = track?.title || currentFileName || "Markdown Preview";
    const artist = currentFileName || "Markdown Preview";
    const album =
      trackCount > 1 ? `${speechTrackIndex + 1} / ${trackCount}` : "Read aloud";

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: speechMediaArtwork(),
    });
    navigator.mediaSession.playbackState = speechPaused ? "paused" : "playing";
  } catch {
    /* Media Session may reject metadata or state on some platforms */
  }
}

function setupSpeechMediaSession() {
  if (!mediaSessionSupported) return;

  const setHandler = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* action not supported in this browser */
    }
  };

  setHandler("play", () => {
    if (!speechActive) startSpeaking();
    else resumeSpeaking();
  });
  setHandler("pause", () => {
    if (speechActive) pauseSpeaking();
  });
  setHandler("stop", () => {
    if (speechActive) stopSpeaking();
  });
  setHandler("previoustrack", () => speakPreviousTrack());
  setHandler("nexttrack", () => speakNextTrack());
  // Some OS controllers only expose seek actions; map them to section skip.
  setHandler("seekbackward", () => speakPreviousTrack());
  setHandler("seekforward", () => speakNextTrack());
}

function speakPreviousTrack() {
  if (!speechActive || !speechTracks.length) return;
  if (speechTrackIndex > 0) speakTrackAt(speechTrackIndex - 1);
  else speakTrackAt(0);
}

function speakNextTrack() {
  if (!speechActive || !speechTracks.length) return;
  if (speechTrackIndex < speechTracks.length - 1) {
    speakTrackAt(speechTrackIndex + 1);
  }
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
  speechTracks = [];
  speechTrackIndex = 0;
  speechGeneration += 1;
  speechMap = null;
  clearSpeechKeepalive();
  clearSpeechHighlight();
  stopSpeechSessionAudio();
  if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending || window.speechSynthesis?.paused) {
    window.speechSynthesis.cancel();
  }
  updateSpeakButton();
}

function pauseSpeaking() {
  if (!speechActive || speechPaused) return;
  speechPaused = true;
  window.speechSynthesis.pause();
  pauseSpeechSessionAudio();
  updateSpeakButton();
}

function resumeSpeaking() {
  if (!speechActive || !speechPaused) return;
  speechPaused = false;
  window.speechSynthesis.resume();
  void startSpeechSessionAudio();
  updateSpeakButton();
}

function togglePauseSpeaking() {
  if (!speechActive) return;
  if (speechPaused) resumeSpeaking();
  else pauseSpeaking();
}

function syncPreviewToSpeechTrack() {
  if (!speechTracks.length) return;
  const track = speechTracks[speechTrackIndex];
  const sectionIndex =
    typeof track?.sectionIndex === "number" ? track.sectionIndex : speechTrackIndex;

  if (isSlideNavView()) {
    if (sectionIndex < 0 || sectionIndex >= presentSections.length) return;
    if (sectionIndex !== presentIndex) {
      showPresentSection(sectionIndex);
      syncEditorToPresentSection();
    }
    return;
  }

  const previewVisible = !panes.classList.contains("preview-collapsed");
  if (!previewVisible) return;

  outlineScrollSource = "preview";
  const line = sourceLineForPresentSection(sectionIndex);
  if (line != null) {
    scrollPreviewToSourceLine(line);
    highlightActiveOutlineItem();
    return;
  }

  const el = presentSections[sectionIndex]?.[0];
  if (!previewNodeIsLaidOut(el)) return;
  beginSyncDriver(panes.classList.contains("editor-collapsed") ? "preview" : "editor");
  clampScrollTop(previewPane, offsetWithin(el, previewPane) - 8);
  highlightActiveOutlineItem();
}

function speakTrackAt(index) {
  if (!speechActive || !speechTracks.length) return;
  if (index < 0 || index >= speechTracks.length) {
    if (index >= speechTracks.length) stopSpeaking();
    return;
  }

  const track = speechTracks[index];
  const generation = ++speechGeneration;
  speechTrackIndex = index;
  speechPaused = false;
  speechQueue = track.chunks.map((chunk) => ({ text: chunk.text, start: chunk.start }));
  clearSpeechHighlight();
  syncPreviewToSpeechTrack();
  void startSpeechSessionAudio();
  updateSpeakButton();

  const wasSpeaking =
    window.speechSynthesis.speaking ||
    window.speechSynthesis.pending ||
    window.speechSynthesis.paused;
  if (wasSpeaking) window.speechSynthesis.cancel();

  const kickoff = () => {
    if (!speechActive || speechGeneration !== generation) return;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    speakNextChunk(generation);
  };

  // After cancel(), Chrome needs a tick before the next speak() works.
  if (wasSpeaking) window.setTimeout(kickoff, 50);
  else kickoff();
}

function speakNextChunk(generation = speechGeneration) {
  if (!speechActive || speechGeneration !== generation) return;
  if (!speechQueue.length) {
    if (speechTrackIndex < speechTracks.length - 1) {
      speakTrackAt(speechTrackIndex + 1);
      return;
    }
    speechActive = false;
    speechPaused = false;
    speechTracks = [];
    speechTrackIndex = 0;
    speechGeneration += 1;
    clearSpeechKeepalive();
    clearSpeechHighlight();
    stopSpeechSessionAudio();
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
    if (!speechActive || speechGeneration !== generation || event.name !== "word") return;
    const absoluteStart = chunk.start + event.charIndex;
    const absoluteEnd = wordEndOffset(
      speechMap?.text || chunk.text,
      absoluteStart,
      event.charLength || 0
    );
    highlightSpeechOffsets(absoluteStart, absoluteEnd);
  });

  utterance.onend = () => speakNextChunk(generation);
  utterance.onerror = (event) => {
    if (event.error === "interrupted" || event.error === "canceled") return;
    if (speechGeneration !== generation) return;
    speechActive = false;
    speechPaused = false;
    speechQueue = [];
    speechTracks = [];
    speechTrackIndex = 0;
    speechGeneration += 1;
    clearSpeechKeepalive();
    clearSpeechHighlight();
    stopSpeechSessionAudio();
    updateSpeakButton();
    showToast("Could not read aloud");
  };

  window.speechSynthesis.speak(utterance);
  if (speechPaused) window.speechSynthesis.pause();
}

function startSpeaking() {
  const tracks = buildSpeechTracks();
  if (!tracks.length) {
    showToast("Nothing to read");
    return;
  }

  const wasSpeaking =
    window.speechSynthesis.speaking ||
    window.speechSynthesis.pending ||
    window.speechSynthesis.paused;
  const map = speechMap;
  let startIndex = 0;
  if (isSlideNavView()) {
    const match = tracks.findIndex((track) => track.sectionIndex === presentIndex);
    startIndex =
      match >= 0 ? match : Math.max(0, Math.min(presentIndex, tracks.length - 1));
  }

  stopSpeaking();
  speechMap = map;
  speechTracks = tracks;
  speechTrackIndex = startIndex;
  speechActive = true;
  speechPaused = false;
  updateSpeakButton();
  startSpeechKeepalive();
  closeVoiceMenu();
  syncPreviewToSpeechTrack();
  // Must start from the user gesture that triggered read-aloud so Chrome/macOS
  // media controllers attach to a real HTMLMediaElement session.
  void startSpeechSessionAudio();

  // speakTrackAt bumps generation and starts the engine.
  const kickoff = () => {
    if (!speechActive) return;
    speakTrackAt(startIndex);
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
  setupSpeechMediaSession();
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
  speakPrevBtn?.addEventListener("click", speakPreviousTrack);
  speakNextBtn?.addEventListener("click", speakNextTrack);
  voiceMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeHistory();
    closeShareMenu();
    closeExportMenu();
    closeWritingToolsMenu();
    closeViewModeMenu();
    toggleVoiceMenu();
  });
  window.addEventListener("pagehide", stopSpeaking);
}

/**
 * Chrome on-device Writer / Rewriter / Proofreader (hidden when unsupported).
 */
function setupChromeAi() {
  if (!writingToolsDropdown || !writingToolsBtn || !writingToolsMenu) return;
  if (!anyWritingAiSupported()) return;

  writingToolsDropdown.hidden = false;

  if (aiWriteMenuBtn) aiWriteMenuBtn.hidden = !isAiSupported("Writer");
  if (aiRewriteMenuBtn) aiRewriteMenuBtn.hidden = !isAiSupported("Rewriter");
  if (aiProofreadMenuBtn) aiProofreadMenuBtn.hidden = !isAiSupported("Proofreader");

  /** @type {AbortController|null} */
  let aiAbort = null;
  /** @type {{ start: number, end: number }|null} */
  let pendingRange = null;
  /** Editor selection to keep visible across toolbar / proofread focus changes. */
  /** @type {{ start: number, end: number }|null} */
  let heldEditorRange = null;
  /** @type {string} */
  let pendingResult = "";
  /** @type {object|null} */
  let activeSession = null;

  function abortAi() {
    try {
      aiAbort?.abort();
    } catch {
      /* ignore */
    }
    aiAbort = null;
    destroyAiSession(activeSession);
    activeSession = null;
  }

  function isAiDialogOpen() {
    return Boolean(
      aiWriteDialog?.open || aiRewriteDialog?.open || aiProofreadDialog?.open,
    );
  }

  function isHoldingEditorSelection() {
    return Boolean(
      heldEditorRange &&
        ((writingToolsMenu && !writingToolsMenu.hidden) || aiProofreadDialog?.open),
    );
  }

  function holdEditorSelection(start, end) {
    heldEditorRange = {
      start: Math.max(0, Math.min(start, end)),
      end: Math.max(start, end),
    };
  }

  function rememberEditorSelection() {
    holdEditorSelection(editor.selectionStart, editor.selectionEnd);
  }

  function clearHeldEditorSelection() {
    heldEditorRange = null;
  }

  function captureTargetRange({ insertAtCaret = false } = {}) {
    const start = heldEditorRange?.start ?? editor.selectionStart;
    const end = heldEditorRange?.end ?? editor.selectionEnd;
    return insertAtCaret
      ? resolveInsertRange(editor.value, start, end)
      : resolveTargetRange(editor.value, start, end);
  }

  /** Re-apply the held range so the editor keeps showing the selection. */
  function restoreHeldEditorSelection() {
    const range = heldEditorRange || pendingRange;
    if (!range) return;
    if (document.activeElement === aiProofEditor) return;
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    const max = editor.value.length;
    const start = Math.max(0, Math.min(range.start, max));
    const end = Math.max(0, Math.min(range.end, max));
    editor.setSelectionRange(start, end);
  }

  function scheduleRestoreHeldEditorSelection() {
    requestAnimationFrame(() => {
      if (!isHoldingEditorSelection() && !aiProofreadDialog?.open) return;
      restoreHeldEditorSelection();
    });
  }

  function setStatus(el, message) {
    if (!el) return;
    const text = el.querySelector(".ai-status-text");
    if (text) text.textContent = message || "";
    else el.textContent = message || "";
  }

  /** Toggle waiting spinner + aria-busy on an AI status line / dialog. */
  function setAiWaiting(statusEl, dialog, busy) {
    if (statusEl) {
      statusEl.dataset.busy = busy ? "1" : "0";
      const spinner = statusEl.querySelector(".ai-spinner");
      if (spinner) spinner.hidden = !busy;
    }
    if (dialog) {
      dialog.setAttribute("aria-busy", busy ? "true" : "false");
    }
  }

  function setBusy(ui, busy) {
    const { runBtn, stopBtn, applyBtn, cancelBtn, status, dialog, hideRunWhenBusy } = ui;
    if (runBtn) {
      runBtn.disabled = busy;
      // Hide while working; callers decide whether to show it again on idle/error.
      if (hideRunWhenBusy && busy) runBtn.hidden = true;
    }
    if (stopBtn) stopBtn.hidden = !busy;
    if (applyBtn && busy) applyBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = false;
    if (status || dialog) setAiWaiting(status, dialog, busy);
  }

  function showPreview(el, text, { html = false } = {}) {
    if (!el) return;
    el.hidden = false;
    if (html) el.innerHTML = text;
    else el.textContent = text;
  }

  async function ensureSession(kind, options, onProgress) {
    destroyAiSession(activeSession);
    activeSession = null;
    const status = await checkAvailability(kind, options);
    if (status === "unavailable") {
      throw new Error(availabilityLabel(status));
    }
    activeSession = await createAiSession(kind, options, {
      signal: aiAbort?.signal,
      onProgress,
    });
    return activeSession;
  }

  function openWriteDialog() {
    // Write inserts at the caret (or replaces a real selection) — never the whole doc.
    const range = captureTargetRange({ insertAtCaret: true });
    closeWritingToolsMenu();
    closeOverflowMenu();
    pendingRange = { start: range.start, end: range.end };
    pendingResult = "";
    clearHeldEditorSelection();
    const promptEl = document.getElementById("ai-write-prompt");
    const contextEl = document.getElementById("ai-write-context");
    const preview = document.getElementById("ai-write-preview");
    const status = document.getElementById("ai-write-status");
    const generateBtn = document.getElementById("ai-write-generate");
    const insertBtn = document.getElementById("ai-write-insert");
    const stopBtn = document.getElementById("ai-write-stop");
    if (promptEl) promptEl.value = "";
    if (contextEl) contextEl.value = "";
    if (preview) {
      preview.hidden = true;
      preview.textContent = "";
    }
    setStatus(status, "");
    if (generateBtn) generateBtn.hidden = false;
    if (insertBtn) {
      insertBtn.hidden = true;
      insertBtn.disabled = true;
    }
    if (stopBtn) stopBtn.hidden = true;
    aiWriteDialog?.showModal();
    promptEl?.focus();
  }

  function openRewriteDialog() {
    const range = captureTargetRange();
    closeWritingToolsMenu();
    closeOverflowMenu();
    if (!range.slice.trim()) {
      showToast("Nothing to rewrite");
      clearHeldEditorSelection();
      return;
    }
    pendingRange = { start: range.start, end: range.end };
    pendingResult = "";
    clearHeldEditorSelection();
    const desc = document.getElementById("ai-rewrite-desc");
    const contextEl = document.getElementById("ai-rewrite-context");
    const preview = document.getElementById("ai-rewrite-preview");
    const status = document.getElementById("ai-rewrite-status");
    const runBtn = document.getElementById("ai-rewrite-run");
    const applyBtn = document.getElementById("ai-rewrite-apply");
    const stopBtn = document.getElementById("ai-rewrite-stop");
    if (desc) {
      desc.textContent = range.isSelection
        ? "Rewrites the current selection."
        : "No selection — will rewrite the whole document. Long docs may exceed the model limit; select a smaller section if needed.";
    }
    if (contextEl) contextEl.value = "";
    if (preview) {
      preview.hidden = true;
      preview.textContent = "";
    }
    setStatus(status, "");
    if (runBtn) runBtn.hidden = false;
    if (applyBtn) {
      applyBtn.hidden = true;
      applyBtn.disabled = true;
    }
    if (stopBtn) stopBtn.hidden = true;
    aiRewriteDialog?.showModal();
  }

  function openProofreadDialog() {
    const range = captureTargetRange();
    closeWritingToolsMenu();
    closeOverflowMenu();
    if (!range.slice.trim()) {
      showToast("Nothing to proofread");
      clearHeldEditorSelection();
      return;
    }
    pendingRange = { start: range.start, end: range.end };
    pendingResult = "";
    holdEditorSelection(range.start, range.end);
    clearProofreadPreview();
    const desc = document.getElementById("ai-proofread-desc");
    const status = document.getElementById("ai-proofread-status");
    const runBtn = document.getElementById("ai-proofread-run");
    const applyBtn = document.getElementById("ai-proofread-apply");
    const stopBtn = document.getElementById("ai-proofread-stop");
    if (desc) {
      desc.textContent = range.isSelection
        ? "Checks the selection. Code fences keep their structure; only Mermaid notes and line comments are proofread, plus surrounding Markdown."
        : "Whole document. Code fences keep their structure; only Mermaid notes and line comments are proofread, plus surrounding Markdown.";
    }
    setStatus(status, "");
    setAiWaiting(status, aiProofreadDialog, false);
    if (runBtn) {
      runBtn.hidden = false;
      runBtn.disabled = false;
    }
    if (applyBtn) {
      applyBtn.hidden = true;
      applyBtn.disabled = true;
    }
    if (stopBtn) stopBtn.hidden = true;
    // Modeless so the main preview stays readable behind the dock.
    aiProofreadDialog?.show();
    requestAnimationFrame(() => syncProofDockClearance());
    scheduleRestoreHeldEditorSelection();
  }

  /** Reserve workspace space so the fixed dock does not cover scrolled text. */
  function syncProofDockClearance() {
    const dialog = aiProofreadDialog;
    if (!dialog?.open) {
      document.documentElement.style.removeProperty("--ai-proof-dock-clearance");
      return;
    }
    const height = Math.ceil(dialog.getBoundingClientRect().height);
    // Match dock `bottom: 1rem` plus a small gap above the dialog.
    const clearance = height + 24;
    document.documentElement.style.setProperty(
      "--ai-proof-dock-clearance",
      `${Math.max(clearance, 96)}px`,
    );
  }

  /** Replace the preview with a second editor showing corrected text + diff marks. */
  function showProofreadPreview(originalSlice, correctedSlice) {
    if (!aiProofEditorWrap || !aiProofEditor || !aiProofHighlightCode) return;
    document.body.dataset.aiProofPreview = "1";
    if (preview) preview.hidden = true;
    aiProofEditorWrap.hidden = false;
    if (previewPane) {
      previewPane.setAttribute("aria-label", "Proofread result");
    }
    aiProofEditor.value = correctedSlice;
    aiProofHighlightCode.innerHTML = `${renderCorrectedDiffHtml(originalSlice, correctedSlice)}\n`;
    syncProofEditorHighlightMetrics();
    if (syncScrollEnabled) {
      syncPreviewFromEditor();
    } else {
      aiProofEditor.scrollTop = 0;
      aiProofHighlight.scrollTop = 0;
    }
    scheduleRestoreHeldEditorSelection();
  }

  function clearProofreadPreview({ restoreMarkdown = true } = {}) {
    const active =
      document.body.dataset.aiProofPreview === "1" ||
      (aiProofEditorWrap && !aiProofEditorWrap.hidden);
    if (!active) {
      // Recover a blank right pane if Apply left #preview hidden.
      if (preview?.hidden) preview.hidden = false;
      return;
    }
    delete document.body.dataset.aiProofPreview;
    if (aiProofEditorWrap) aiProofEditorWrap.hidden = true;
    if (aiProofEditor) aiProofEditor.value = "";
    if (aiProofHighlightCode) aiProofHighlightCode.innerHTML = "";
    if (preview) preview.hidden = false;
    if (previewPane) {
      previewPane.setAttribute("aria-label", "Rendered preview");
    }
    if (restoreMarkdown) renderMarkdown(getMarkdownSource());
  }

  function syncProofEditorHighlightMetrics() {
    if (!aiProofEditor || !aiProofHighlight) return;
    const dx = aiProofEditor.offsetWidth - aiProofEditor.clientWidth;
    const dy = aiProofEditor.offsetHeight - aiProofEditor.clientHeight;
    aiProofHighlight.style.inset = `0 ${dx}px ${dy}px 0`;
    aiProofHighlight.scrollTop = aiProofEditor.scrollTop;
    aiProofHighlight.scrollLeft = aiProofEditor.scrollLeft;
  }

  function onProofEditorScroll() {
    syncProofEditorHighlightScroll();
    // Right-pane scroll drives the left editor when Sync scroll is on.
    if (syncScrollDriver !== "editor") outlineScrollSource = "preview";
    syncEditorFromPreview();
  }

  async function runWriteAction() {
    const promptEl = document.getElementById("ai-write-prompt");
    const contextEl = document.getElementById("ai-write-context");
    const toneEl = document.getElementById("ai-write-tone");
    const lengthEl = document.getElementById("ai-write-length");
    const preview = document.getElementById("ai-write-preview");
    const status = document.getElementById("ai-write-status");
    const generateBtn = document.getElementById("ai-write-generate");
    const insertBtn = document.getElementById("ai-write-insert");
    const stopBtn = document.getElementById("ai-write-stop");
    const cancelBtn = document.getElementById("ai-write-cancel");
    const prompt = promptEl?.value?.trim() || "";
    if (!prompt) {
      setStatus(status, "Enter a prompt.");
      promptEl?.focus();
      return;
    }

    abortAi();
    aiAbort = new AbortController();
    pendingResult = "";
    setBusy(
      {
        runBtn: generateBtn,
        stopBtn,
        applyBtn: insertBtn,
        cancelBtn,
        status,
        dialog: aiWriteDialog,
        hideRunWhenBusy: true,
      },
      true,
    );
    if (insertBtn) insertBtn.hidden = true;
    showPreview(preview, "");
    setStatus(status, "Starting…");

    try {
      const options = {
        tone: toneEl?.value || "neutral",
        length: lengthEl?.value || "short",
        format: "markdown",
        expectedInputLanguages: ["en"],
        expectedContextLanguages: ["en"],
        outputLanguage: "en",
      };
      const session = await ensureSession("Writer", options, (loaded) => {
        setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      setStatus(status, "Writing…");
      const context = contextEl?.value?.trim() || undefined;
      const result = await runWrite(session, prompt, {
        context,
        signal: aiAbort.signal,
        onChunk: (text) => {
          pendingResult = text;
          showPreview(preview, text);
        },
      });
      pendingResult = result;
      showPreview(preview, result);
      setStatus(status, result.trim() ? "Ready to insert." : "No output.");
      if (generateBtn) generateBtn.hidden = true;
      if (insertBtn) {
        insertBtn.hidden = false;
        insertBtn.disabled = !result.trim();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus(status, "Stopped.");
      } else {
        setStatus(status, formatAiError(err, "Write failed."));
        showToast("Write failed");
      }
      if (generateBtn) generateBtn.hidden = false;
    } finally {
      setBusy(
        {
          runBtn: generateBtn,
          stopBtn,
          applyBtn: insertBtn,
          cancelBtn,
          status,
          dialog: aiWriteDialog,
          hideRunWhenBusy: true,
        },
        false,
      );
      destroyAiSession(activeSession);
      activeSession = null;
      aiAbort = null;
    }
  }

  async function runRewriteAction() {
    const contextEl = document.getElementById("ai-rewrite-context");
    const toneEl = document.getElementById("ai-rewrite-tone");
    const lengthEl = document.getElementById("ai-rewrite-length");
    const preview = document.getElementById("ai-rewrite-preview");
    const status = document.getElementById("ai-rewrite-status");
    const runBtn = document.getElementById("ai-rewrite-run");
    const applyBtn = document.getElementById("ai-rewrite-apply");
    const stopBtn = document.getElementById("ai-rewrite-stop");
    const cancelBtn = document.getElementById("ai-rewrite-cancel");
    if (!pendingRange) return;

    // Keep collapsed embeds — expanding data URIs inflates size past model quotas.
    const source = editor.value.slice(pendingRange.start, pendingRange.end);
    if (!source.trim()) {
      setStatus(status, "Nothing to rewrite.");
      return;
    }

    abortAi();
    aiAbort = new AbortController();
    pendingResult = "";
    setBusy(
      {
        runBtn,
        stopBtn,
        applyBtn,
        cancelBtn,
        status,
        dialog: aiRewriteDialog,
        hideRunWhenBusy: true,
      },
      true,
    );
    if (applyBtn) applyBtn.hidden = true;
    showPreview(preview, "");
    setStatus(status, "Starting…");

    try {
      const options = {
        tone: toneEl?.value || "as-is",
        length: lengthEl?.value || "as-is",
        format: "markdown",
        expectedInputLanguages: ["en"],
        expectedContextLanguages: ["en"],
        outputLanguage: "en",
      };
      const session = await ensureSession("Rewriter", options, (loaded) => {
        setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      await assertInputFitsQuota(session, source);
      setStatus(status, "Rewriting…");
      const context = contextEl?.value?.trim() || undefined;
      const result = await runRewrite(session, source, {
        context,
        signal: aiAbort.signal,
        onChunk: (text) => {
          pendingResult = text;
          showPreview(preview, text);
        },
      });
      pendingResult = result;
      showPreview(preview, result);
      setStatus(status, result.trim() ? "Ready to apply." : "No output.");
      if (runBtn) runBtn.hidden = true;
      if (applyBtn) {
        applyBtn.hidden = false;
        applyBtn.disabled = !result.trim();
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus(status, "Stopped.");
      } else {
        setStatus(status, formatAiError(err, "Rewrite failed."));
        showToast("Rewrite failed");
      }
      if (runBtn) runBtn.hidden = false;
    } finally {
      setBusy(
        {
          runBtn,
          stopBtn,
          applyBtn,
          cancelBtn,
          status,
          dialog: aiRewriteDialog,
          hideRunWhenBusy: true,
        },
        false,
      );
      destroyAiSession(activeSession);
      activeSession = null;
      aiAbort = null;
    }
  }

  async function runProofreadAction() {
    const status = document.getElementById("ai-proofread-status");
    const runBtn = document.getElementById("ai-proofread-run");
    const applyBtn = document.getElementById("ai-proofread-apply");
    const stopBtn = document.getElementById("ai-proofread-stop");
    const cancelBtn = document.getElementById("ai-proofread-cancel");
    if (!pendingRange) return;
    if (runBtn?.disabled || aiProofreadDialog?.getAttribute("aria-busy") === "true") {
      return;
    }

    // Keep collapsed embeds — expanding data URIs inflates size past model quotas.
    const source = editor.value.slice(pendingRange.start, pendingRange.end);
    if (!source.trim()) {
      setStatus(status, "Nothing to proofread.");
      return;
    }

    abortAi();
    aiAbort = new AbortController();
    pendingResult = "";
    clearProofreadPreview();
    setBusy(
      {
        runBtn,
        stopBtn,
        applyBtn,
        cancelBtn,
        status,
        dialog: aiProofreadDialog,
        hideRunWhenBusy: true,
      },
      true,
    );
    if (applyBtn) applyBtn.hidden = true;
    setStatus(status, "Starting…");
    syncProofDockClearance();

    try {
      const options = { expectedInputLanguages: ["en"] };
      const session = await ensureSession("Proofreader", options, (loaded) => {
        setStatus(status, `Downloading model… ${Math.round(loaded * 100)}%`);
      });
      setStatus(status, "Proofreading…");
      const result = await runProofreadDocument(session, source, {
        signal: aiAbort.signal,
        onProgress: ({ index, total, label }) => {
          const kind =
            label === "mermaid-notes"
              ? "diagram notes"
              : label === "comments"
                ? "code comments"
                : "text";
          setStatus(
            status,
            total > 1
              ? `Proofreading ${kind}: ${index + 1} of ${total}…`
              : `Proofreading ${kind}…`,
          );
        },
      });
      pendingResult = result.correctedInput;
      const n = result.correctionCount;
      const changed = result.correctedInput !== source;
      if (changed) {
        showProofreadPreview(source, result.correctedInput);
      }
      const sectionNote =
        result.chunkCount > 1 ? ` (${result.chunkCount} sections)` : "";
      setStatus(
        status,
        !changed && !n
          ? `No issues found${sectionNote}.`
          : `${n} correction${n === 1 ? "" : "s"} suggested${sectionNote} — review the highlighted editor, then Apply.`,
      );
      if (runBtn) runBtn.hidden = true;
      if (applyBtn) {
        applyBtn.hidden = false;
        applyBtn.disabled = !changed;
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus(status, "Stopped.");
      } else {
        setStatus(status, formatAiError(err, "Proofread failed."));
        showToast("Proofread failed");
      }
      if (runBtn) runBtn.hidden = false;
    } finally {
      setBusy(
        {
          runBtn,
          stopBtn,
          applyBtn,
          cancelBtn,
          status,
          dialog: aiProofreadDialog,
          hideRunWhenBusy: true,
        },
        false,
      );
      destroyAiSession(activeSession);
      activeSession = null;
      aiAbort = null;
      syncProofDockClearance();
      scheduleRestoreHeldEditorSelection();
    }
  }

  function applyPendingResult(dialog) {
    if (!pendingRange || pendingResult == null) return;
    const isProof = dialog === aiProofreadDialog;
    replaceEditorRange(pendingRange.start, pendingRange.end, pendingResult);
    pendingRange = null;
    pendingResult = "";
    clearHeldEditorSelection();
    if (isProof) {
      // Editor already re-rendered via replaceEditorRange; only restore the pane UI.
      clearProofreadPreview({ restoreMarkdown: false });
    }
    dialog?.close();
    showToast("Applied");
    editor.focus();
  }

  function closeAiDialog(dialog) {
    abortAi();
    if (dialog === aiProofreadDialog) clearProofreadPreview();
    clearHeldEditorSelection();
    dialog?.close();
    if (dialog === aiProofreadDialog) syncProofDockClearance();
  }

  writingToolsBtn.addEventListener("mousedown", (e) => {
    // Keep editor selection when opening the menu (mousedown would blur otherwise).
    e.preventDefault();
    rememberEditorSelection();
  });
  writingToolsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    rememberEditorSelection();
    toggleWritingToolsMenu();
    scheduleRestoreHeldEditorSelection();
  });

  writingToolsDropdown?.addEventListener("mousedown", (e) => {
    // Any click inside the Writing tools control should not clear the selection.
    e.preventDefault();
    if (editor.selectionStart !== editor.selectionEnd) {
      rememberEditorSelection();
    }
  });

  aiProofEditor?.addEventListener("scroll", onProofEditorScroll);

  aiWriteMenuBtn?.addEventListener("click", () => openWriteDialog());
  aiRewriteMenuBtn?.addEventListener("click", () => openRewriteDialog());
  aiProofreadMenuBtn?.addEventListener("click", () => openProofreadDialog());

  document.getElementById("ai-write-cancel")?.addEventListener("click", () => {
    closeAiDialog(aiWriteDialog);
  });
  document.getElementById("ai-write-stop")?.addEventListener("click", () => abortAi());
  document
    .getElementById("ai-write-generate")
    ?.addEventListener("click", () => void runWriteAction());
  document.getElementById("ai-write-insert")?.addEventListener("click", () => {
    if (!pendingRange) {
      pendingRange = {
        start: editor.selectionStart,
        end: editor.selectionEnd,
      };
    }
    applyPendingResult(aiWriteDialog);
  });

  document.getElementById("ai-rewrite-cancel")?.addEventListener("click", () => {
    closeAiDialog(aiRewriteDialog);
  });
  document.getElementById("ai-rewrite-stop")?.addEventListener("click", () => abortAi());
  document
    .getElementById("ai-rewrite-run")
    ?.addEventListener("click", () => void runRewriteAction());
  document.getElementById("ai-rewrite-apply")?.addEventListener("click", () => {
    applyPendingResult(aiRewriteDialog);
  });

  document.getElementById("ai-proofread-cancel")?.addEventListener("click", () => {
    closeAiDialog(aiProofreadDialog);
  });
  document
    .getElementById("ai-proofread-stop")
    ?.addEventListener("click", () => abortAi());
  document
    .getElementById("ai-proofread-run")
    ?.addEventListener("click", () => void runProofreadAction());
  document
    .getElementById("ai-proofread-apply")
    ?.addEventListener("click", () => {
      applyPendingResult(aiProofreadDialog);
    });

  for (const dialog of [aiWriteDialog, aiRewriteDialog, aiProofreadDialog]) {
    dialog?.addEventListener("cancel", () => {
      abortAi();
      if (dialog === aiProofreadDialog) clearProofreadPreview();
      clearHeldEditorSelection();
    });
    dialog?.addEventListener("close", () => {
      abortAi();
      if (dialog === aiProofreadDialog) {
        clearProofreadPreview();
        syncProofDockClearance();
      }
      clearHeldEditorSelection();
    });
  }

  // Keep editor selection while using the modeless proofread dock.
  aiProofreadDialog?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    scheduleRestoreHeldEditorSelection();
  });

  if (aiProofreadDialog && typeof ResizeObserver === "function") {
    const dockRo = new ResizeObserver(() => syncProofDockClearance());
    dockRo.observe(aiProofreadDialog);
  }
  window.addEventListener("resize", () => {
    if (aiProofreadDialog?.open) syncProofDockClearance();
  });

  // If anything steals focus, put the selection back while we are holding it.
  editor.addEventListener("blur", () => {
    if (!isHoldingEditorSelection() && !aiProofreadDialog?.open) return;
    scheduleRestoreHeldEditorSelection();
  });

  // Modeless proofread dock: Escape does not auto-dismiss like showModal().
  aiProofreadDialog?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    closeAiDialog(aiProofreadDialog);
  });

  setupChromeAi.isDialogOpen = isAiDialogOpen;
}

setupChromeAi.isDialogOpen = () => false;

/** Build injects __GUIDE_URL__ (content-hashed). Dev falls back to ./GUIDE.md. */
const GUIDE_URL = typeof __GUIDE_URL__ === "string" ? __GUIDE_URL__ : "./GUIDE.md";

/** App URL that opens GUIDE in a fresh help-preview tab (does not touch drafts). */
function buildHelpGuideUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  const params = new URLSearchParams();
  params.set("guide", "1");
  params.set("view", "reader");
  url.hash = params.toString();
  return url.toString();
}

function hasGuideUrlFlag() {
  try {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      if (hashParams.get("guide") === "1") return true;
    }
    return new URLSearchParams(window.location.search).get("guide") === "1";
  } catch {
    return false;
  }
}

if (helpBtn instanceof HTMLAnchorElement) {
  helpBtn.href = buildHelpGuideUrl();
}

/** Lazily fetched GUIDE.md text (null until first need; then memoized Promise). */
let guidePromise = null;

/** First-visit starter content from GUIDE.md (copied into dist at build time). */
function getDefaultGuide() {
  if (!guidePromise) {
    guidePromise = (async () => {
      try {
        const response = await fetch(GUIDE_URL);
        if (!response.ok) return "";
        return await response.text();
      } catch {
        return "";
      }
    })();
  }
  return guidePromise;
}

/** Load GUIDE.md into the editor as help documentation. */
async function loadHelpGuide() {
  if (!confirmDiscardIfDirty()) return;
  const guide = await getDefaultGuide();
  if (!guide) {
    showToast("Could not load help guide");
    return;
  }
  // Persist the outgoing document under its own key before switching to untitled.
  await persistDraft(getMarkdownSource());
  setEditorValue(guide);
  clearCurrentFileBinding();
  await persistDraft(guide);
  renderMarkdown(guide);
  // Same as first-visit GUIDE seed: reading material, not an unsaved user doc.
  savedSnapshot = guide;
  writeSavedSnapshot(currentDocKey(), guide);
  updateSaveButton();
  setContentExternal(false);
  if (currentView !== "edit") setView("edit", { syncUrl: false });
  editor.scrollTop = 0;
  preview.scrollTop = 0;
  if (previewPane) previewPane.scrollTop = 0;
  closeOverflowMenu();
  showToast("Loaded help guide");
}

/** Read the persisted draft for a document key (IndexedDB, then localStorage). No GUIDE seed. */
async function loadStoredDraftContent(docKey = currentDocKey()) {
  if (historyIdbReady) {
    const idbDraft = await getDraft(docKey);
    if (idbDraft) return idbDraft.content;
  }
  const mirrored = readDraftMirror();
  if (mirrored && mirrored.docKey === docKey) return mirrored.content;
  return null;
}

async function init() {
  guideSession = hasGuideUrlFlag();
  const shareState = await getShareState();
  const fromUrl = shareState.markdown;
  let seededFromGuide = false;

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
  setupPwa();
  setupFilesDrawer();
  setupDocOutline();
  setupStorageSync();
  historyIdbReady = await probeHistoryIdb();
  if (historyIdbReady) {
    await migrateHistoryIfNeeded();
    await hydrateHistoryIndexFromIdb();
  }
  // Sequential: file binding restore reads rootDirHandle set by directory restore.
  await restoreFilesDirectoryOnLoad();
  if (guideSession) {
    // Help-preview tabs must not adopt the other tab's open file.
    clearCurrentFileBinding();
  } else {
    await restoreCurrentFileBindingOnLoad();
  }

  const savedSyncScroll = localStorage.getItem(STORAGE_KEYS.syncScroll) === "1";
  setSyncScroll(savedSyncScroll, { persist: false });

  // URL markdown that matches our own draft/tip is local residue (e.g. an old
  // view-sync that wrote mdz), not untrusted external content.
  let urlIsExternal = fromUrl != null;
  if (fromUrl != null && !guideSession) {
    const storedDraft = await loadStoredDraftContent();
    const tip = historyIdbReady ? await getTip() : null;
    const matchesLocal =
      storedDraft === fromUrl ||
      (storedDraft == null && tip?.content === fromUrl);
    if (matchesLocal) {
      urlIsExternal = false;
      pendingExternalFromUrl = false;
      const content = storedDraft ?? fromUrl;
      await persistDraft(content);
      setEditorValue(content);
      lastHistoryContent = content;
      setContentExternal(false);
      clearShareMarkdownFromUrl();
    } else {
      stashPreExternalState(storedDraft ?? "");
      pendingExternalFromUrl = true;
      setEditorValue(fromUrl);
      lastHistoryContent = "";
      setContentExternal(true);
      clearCurrentFileBinding();
    }
  } else if (guideSession) {
    // Dedicated help tab: load GUIDE as trusted preview; do not touch drafts.
    urlIsExternal = false;
    pendingExternalFromUrl = false;
    const guide = await getDefaultGuide();
    seededFromGuide = Boolean(guide);
    setEditorValue(guide ?? "");
    lastHistoryContent = guide ?? "";
    setContentExternal(false);
  } else {
    pendingExternalFromUrl = false;
    // Prefer IndexedDB draft for this doc; fall back to localStorage mirror; seed GUIDE once.
    let draft = await loadStoredDraftContent();
    if (draft == null && currentDocKey() !== "untitled") {
      // Upgrade from pre-scoped single draft (migrated to "untitled").
      const legacy = await loadStoredDraftContent("untitled");
      if (legacy != null) {
        draft = legacy;
        if (historyIdbReady) await setDraft(legacy, currentDocKey());
      }
    }
    if (draft == null) {
      draft = await getDefaultGuide();
      seededFromGuide = Boolean(draft);
    }
    await persistDraft(draft ?? "");
    setEditorValue(draft ?? "");
    lastHistoryContent = draft ?? "";
    setContentExternal(false);
  }

  // Dirty = editor differs from last disk save or accepted URL baseline.
  // Draft auto-save alone never marks clean.
  try {
    if (guideSession) {
      // Ephemeral help tab — keep clean without writing saved snapshots.
      savedSnapshot = getMarkdownSource();
      updateSaveButton();
    } else if (pendingExternalFromUrl) {
      // Keep prior savedSnapshot from stash path; Accept will mark clean.
      updateSaveButton();
    } else if (currentFileHandle) {
      let storedSnapshot = readSavedSnapshot(currentDocKey());
      if (storedSnapshot == null && currentFileName && currentDocKey() !== "untitled") {
        const legacySnap = readSavedSnapshot("untitled");
        if (legacySnap != null) {
          storedSnapshot = legacySnap;
          writeSavedSnapshot(currentDocKey(), legacySnap);
        }
      }
      if (storedSnapshot != null) {
        savedSnapshot = storedSnapshot;
        updateSaveButton();
      } else {
        // Bound file with no snapshot yet — treat current text as matching disk.
        markCleanFromEditor();
      }
    } else {
      // Untitled: dirty until disk save — except the default GUIDE seed, which is
      // starter reading material, not a document the user needs to write out.
      if (seededFromGuide) {
        savedSnapshot = getMarkdownSource();
        writeSavedSnapshot(currentDocKey(), savedSnapshot);
        updateSaveButton();
      } else {
        const storedSnapshot = readSavedSnapshot(currentDocKey());
        if (storedSnapshot != null) {
          savedSnapshot = storedSnapshot;
          updateSaveButton();
        } else {
          // One-time recognition of a persisted GUIDE draft (no snapshot yet).
          const source = getMarkdownSource();
          if (!source) {
            markDirtyBaseline();
            writeSavedSnapshot(currentDocKey(), "");
          } else {
            const guide = await getDefaultGuide();
            if (guide && source === guide) {
              savedSnapshot = guide;
              writeSavedSnapshot(currentDocKey(), guide);
              updateSaveButton();
            } else {
              markDirtyBaseline();
              // Persist empty baseline so we do not re-fetch GUIDE on every boot.
              writeSavedSnapshot(currentDocKey(), "");
            }
          }
        }
      }
    }
  } catch {
    markDirtyBaseline();
  }

  renderMarkdown(getMarkdownSource());

  const initialView = urlIsExternal
    ? "edit"
    : shareState.view || (guideSession ? "reader" : "edit");
  setView(initialView, { syncUrl: fromUrl != null || guideSession });

  // After draft/URL load so a launched file overwrites the restored editor.
  setupFileHandling();

  // Commit the restored layout before revealing the panes, so the stored
  // position is the first one shown and later collapses still animate.
  void getComputedStyle(panes).gridTemplateColumns;
  document.documentElement.classList.remove("is-booting");

  // Non-critical UI — after first paint (next frame), so speak/history work ASAP.
  requestAnimationFrame(() => {
    setupSpeech();
    setupChromeAi();
    renderHistoryMenu();
  });
  editor.addEventListener("input", onEditorInput);
  editor.addEventListener("beforeinput", onEditorBeforeInput);
  editor.addEventListener("paste", onEditorPaste);
  editor.addEventListener("copy", onEditorCopyOrCut);
  editor.addEventListener("cut", onEditorCopyOrCut);

  themeSelect.addEventListener("change", () => {
    setTheme(themeSelect.value, { persist: isAuthoringView() });
    // Mermaid colors follow --mermaid-* CSS variables, so no re-render is needed.
    if (!isAuthoringView()) {
      syncHashForView(currentView);
    }
  });

  widthSelect.addEventListener("change", () => {
    setPreviewWidth(widthSelect.value, { persist: true });
    closeOverflowMenu();
  });

  uploadBtn?.addEventListener("click", () => {
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    handleFile(file);
    fileInput.value = "";
    closeOverflowMenu();
  });

  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void copyShareUrl();
  });

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
  viewModeMainBtn?.addEventListener("click", onViewModeMainClick);
  viewModeMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeHistory();
    closeVoiceMenu();
    closeShareMenu();
    closeExportMenu();
    closeWritingToolsMenu();
    toggleViewModeMenu();
  });
  presentMenuBtn?.addEventListener("click", () => {
    closeViewModeMenu();
    enterPresentMode();
  });
  presentViewBtn?.addEventListener("click", enterPresentMode);
  printBtn?.addEventListener("click", () => window.print());
  helpBtn?.addEventListener("click", (e) => {
    // Keep modified / middle clicks as real navigation (new tab).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    void loadHelpGuide();
  });
  window.addEventListener("beforeprint", syncPrintPageOrientation);
  window.addEventListener("afterprint", clearPrintPageOrientation);
  presentPrevBtn?.addEventListener("click", presentPrev);
  presentNextBtn?.addEventListener("click", presentNext);
  presentExitBtn?.addEventListener("click", exitPresentMode);
  document.addEventListener("pointermove", onPresentChromePointerActivity, { passive: true });
  previewPane.addEventListener("pointerdown", onPresentSwipePointerDown, { passive: true });
  previewPane.addEventListener("pointerup", onPresentSwipePointerUp, { passive: true });
  previewPane.addEventListener("pointercancel", onPresentSwipePointerCancel, { passive: true });
  document.addEventListener("fullscreenchange", onPresentFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onPresentFullscreenChange);
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
      // Ignore echo scrolls from preview-driven sync so outline stays on the preview section.
      if (syncScrollDriver !== "preview") outlineScrollSource = "editor";
      syncEditorHighlightScroll();
      syncPreviewFromEditor();
      scheduleOutlineHighlight();
    },
    { passive: true },
  );
  previewPane.addEventListener(
    "scroll",
    () => {
      // Ignore echo scrolls from editor-driven sync (e.g. click-to-reveal) so the
      // outline keeps following the editor caret/section the user just entered.
      if (syncScrollDriver !== "editor") outlineScrollSource = "preview";
      syncEditorFromPreview();
      scheduleOutlineHighlight();
    },
    { passive: true },
  );
  editor.addEventListener("click", () => {
    outlineScrollSource = "editor";
    scheduleRevealPreviewForCaret();
  });
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
      outlineScrollSource = "editor";
      scheduleRevealPreviewForCaret();
    }
  });
  editor.addEventListener("select", () => {
    outlineScrollSource = "editor";
    scheduleRevealPreviewForCaret();
  });
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
    if (aiProofEditor) ro.observe(aiProofEditor);
  }
  historyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeVoiceMenu();
    closeShareMenu();
    closeExportMenu();
    closeWritingToolsMenu();
    closeViewModeMenu();
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
    if (writingToolsDropdown && !writingToolsDropdown.contains(e.target)) {
      closeWritingToolsMenu();
    }
    if (viewModeDropdown && !viewModeDropdown.contains(e.target)) closeViewModeMenu();
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
    if (setupChromeAi.isDialogOpen?.()) {
      // Let the dialog handle Escape; skip app-level shortcuts.
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      if (fsAccessSupported && isAuthoringView()) {
        e.preventDefault();
        void saveCurrentDocument();
      }
      return;
    }

    if (isSlideNavView()) {
      if (e.key === "Escape") {
        // Menus first — don't exit slides/present while an overlay is open.
        if (dismissOpenOverlay()) {
          e.preventDefault();
          return;
        }
        exitPresentMode();
        e.preventDefault();
        return;
      }
      // Don't steal Space/arrows from buttons, menus, selects, tree, splitter, etc.
      if (isSlideNavTypingOrControl(document.activeElement)) return;
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
        syncEditorToPresentSection();
        e.preventDefault();
        return;
      }
      if (e.key === "End") {
        showPresentSection(presentSections.length - 1);
        syncEditorToPresentSection();
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Escape") {
      if (dismissOpenOverlay()) {
        e.preventDefault();
        return;
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
