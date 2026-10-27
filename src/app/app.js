import { alertExtension } from "../markdown/alert.js";
import { defListExtension } from "../markdown/deflist.js";
import { emojiExtension } from "../markdown/emoji.js";
import {
  collapseDataUris,
  collapseDataUrisPreservingSelection,
  collapsedEmbedUriTouched,
  expandEmbeds,
  findCollapsedEmbeds,
  formatEmbedMarkdown,
} from "../markdown/embeds.js";
import { frontmatterExtension } from "../markdown/frontmatter.js";
import { tablePipesExtension } from "../markdown/tablePipes.js";
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
} from "../lib/fs.js";
import { stripRemoteMediaAttributes } from "../lib/safe-media-uri.js";
import { loadGoogleDriveConfig } from "../drive/google-drive-config.js";
import {
  DRIVE_DEFAULT_FOLDER_NAME,
  clearDriveAccessToken,
  createDriveFileWithToken,
  createDriveFolderWithToken,
  ensureDriveAccessToken,
  ensureDriveAppFolder,
  getDriveAccessToken,
  googleDriveEnabled,
  hasSealedDriveSession,
  isDriveSessionMemoryOnly,
  listDriveFolderChildren,
  readDriveFileText,
  renameDriveItemWithToken,
  saveExistingDriveFile,
  trashDriveItemWithToken,
  tryRestoreDriveAccessToken,
} from "../drive/google-drive.js";
import { purgeLegacyCleartextToken } from "../drive/drive-token-vault.js";
import { loadGithubGistConfig } from "../gist/github-gist-config.js";
import {
  clearGistAccessToken,
  createPrivateGist,
  deleteGist,
  editableGistFiles,
  ensureGistAccessToken,
  githubGistEnabled,
  hasSealedGistSession,
  isGistSessionMemoryOnly,
  listGists,
  prepareGistTokenVault,
  readGistFileText,
  setGistPersonalAccessToken,
  tryRestoreGistAccessToken,
  unlockGistAccessToken,
  updateGistFile,
  verifyGistToken,
} from "../gist/github-gist.js";
import { purgeLegacyCleartextToken as purgeLegacyGistCleartextToken } from "../gist/gist-token-vault.js";
import { applyPatch, contentHash, makeRevisionBody } from "../lib/history-diff.js";
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
} from "../lib/history-store.js";
import {
  HLJS_LANG_ALIASES,
  SPLIT_MAX,
  SPLIT_MIN,
  canonicalHljsLang,
  clampSplit,
  collectEditorLanguages,
  escapeHtml,
  formatRelativeTime,
  highlightEditorMarkdown,
  joinFsPath,
  parentPathOf,
  parseDraftMirror,
  titleFromMarkdown,
  wrapHighlightedLines,
} from "../markdown/markdown-utils.js";
import {
  compressUtf8ToBase64Url,
  readShareParams as readShareParamsFromUrl,
} from "../lib/share.js";
import {
  chunkSpeechText,
  listVoices as listVoicesFromList,
  voiceKey,
  voiceQualityScore,
  wordEndOffset,
} from "../lib/speech-text.js";
import { marked, Renderer } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import hljsMarkdown from "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/markdown.min.js";
import hljsXml from "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages/xml.min.js";
import { withMarkdownEscapes } from "../markdown/hljs-markdown.js";

/** SRI allowlist from the page import map (injected at serve/build). */
function cdnIntegrityUrlSet() {
  try {
    const el = document.querySelector('script[type="importmap"]');
    const map = JSON.parse(el?.textContent || "{}");
    return new Set(Object.keys(map.integrity || {}));
  } catch {
    return new Set();
  }
}
const CDN_INTEGRITY_URLS = cdnIntegrityUrlSet();

/** Lazy-loaded export helpers — not needed until the user exports/prints. */
let exportModulePromise;
function loadExportModule() {
  exportModulePromise ??= import("../lib/export.js");
  return exportModulePromise;
}

/** Lazy-loaded Chrome Writing Assistance helpers — only when APIs exist. */
let chromeAiModulePromise;
function loadChromeAiModule() {
  chromeAiModulePromise ??= import("../lib/chrome-ai.js");
  return chromeAiModulePromise;
}

/** Lazy-loaded WebGL water backdrop for the secret Zen theme. */
let zenModulePromise;
function loadZenModule() {
  zenModulePromise ??= import("../lib/theme-zen.js");
  return zenModulePromise;
}

/** Lazy-loaded Zen stylesheet (not in the main CSS bundle). */
let zenCssPromise;
function loadZenCss() {
  zenCssPromise ??= new Promise((resolve, reject) => {
    if (document.getElementById("zen-theme-css")) {
      resolve();
      return;
    }
    const href =
      typeof __ZEN_CSS_URL__ !== "undefined"
        ? /** @type {string} */ (__ZEN_CSS_URL__)
        : new URL("../styles/zen.css", import.meta.url).href;
    const link = document.createElement("link");
    link.id = "zen-theme-css";
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("Failed to load zen.css"));
    document.head.appendChild(link);
  });
  return zenCssPromise;
}

/** Cheap probe so unsupported browsers never fetch the chrome-ai chunk. */
function anyWritingAiGlobalPresent() {
  return (
    typeof globalThis.Writer !== "undefined" ||
    typeof globalThis.Rewriter !== "undefined" ||
    typeof globalThis.Proofreader !== "undefined" ||
    typeof globalThis.LanguageModel !== "undefined"
  );
}

const HLJS_LANG_CDN =
  "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/languages";

/** @type {Map<string, Promise<boolean>>} */
const hljsLangLoads = new Map();

// Markdown grammar uses xml as a subLanguage for embedded HTML.
// withMarkdownEscapes aligns emphasis with CommonMark escapes + underscore flanks.
hljs.registerLanguage("xml", hljsXml);
hljs.registerLanguage("html", hljsXml);
hljs.registerLanguage("markdown", withMarkdownEscapes(hljsMarkdown));

function registerHljsAliases(canonical, grammar) {
  hljs.registerLanguage(canonical, grammar);
  for (const [alias, target] of Object.entries(HLJS_LANG_ALIASES)) {
    if (target === canonical) hljs.registerLanguage(alias, grammar);
  }
}

/**
 * Ensure a highlight.js grammar is registered. Returns true if a network load
 * just completed (caller may want to re-render).
 * CDN languages require an SRI allowlist entry; mermaid loads from a local chunk.
 */
function ensureHljsLanguage(name) {
  const canonical = canonicalHljsLang(name);
  if (!canonical) return Promise.resolve(false);
  if (hljs.getLanguage(canonical)) return Promise.resolve(false);

  let pending = hljsLangLoads.get(canonical);
  if (pending) return pending;

  if (canonical === "mermaid") {
    // Not on the highlight.js CDN — local grammar, code-split from the app entry.
    pending = import("../markdown/hljs-mermaid.js")
      .then((mod) => {
        const grammar = mod.default;
        if (typeof grammar !== "function") return false;
        hljs.registerLanguage("mermaid", grammar);
        return true;
      })
      .catch(() => false);
    hljsLangLoads.set(canonical, pending);
    return pending;
  }

  const url = `${HLJS_LANG_CDN}/${canonical}.min.js`;
  if (!CDN_INTEGRITY_URLS.has(url)) return Promise.resolve(false);

  pending = import(url)
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
  const langs = collectEditorLanguages(source);
  if (!langs.length) return false;
  const results = await Promise.all(langs.map((lang) => ensureHljsLanguage(lang)));
  return results.some(Boolean);
}

const STORAGE_KEYS = {
  draft: "md-editor:draft",
  theme: "md-editor:theme",
  editorCollapsed: "md-editor:editor-collapsed",
  previewCollapsed: "md-editor:preview-collapsed",
  history: "md-editor:history",
  split: "md-editor:split",
  width: "md-editor:width",
  mermaidLook: "md-editor:mermaidLook",
  voice: "md-editor:voice",
  syncScroll: "md-editor:sync-scroll",
  filesDrawer: "md-editor:filesDrawer",
  filesSource: "md-editor:filesSource",
  currentFile: "md-editor:currentFile",
  currentFilePath: "md-editor:currentFilePath",
  savedSnapshot: "md-editor:savedSnapshot",
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
const STORAGE_CHANNEL = "md-editor-storage";
const RENDER_DEBOUNCE_MS = 80;
/** Delay before the preview loading spinner becomes visible. */
const RENDER_LOADING_DELAY_MS = 700;
/**
 * Docs at or above this size get a paint of the spinner before marked/DOMPurify
 * run. A long sync task would otherwise prevent the 700ms timer from firing.
 */
const RENDER_LOADING_EAGER_CHARS = 16_000;
const HISTORY_DEBOUNCE_MS = 15_000;
const EDITOR_HIGHLIGHT_MAX = 100_000;
const NARROW_MQ = "(max-width: 800px)";
const TEXT_FILE_RE = /\.(md|markdown|mdown|mkd|txt|html|htm)$/i;
const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
/** Raw clipboard image size cap before base64 (keeps drafts / history workable). */
const IMAGE_PASTE_MAX_BYTES = 2 * 1024 * 1024;
const THEMES = [
  "github-light",
  "github-dark",
  "sepia",
  "terminal",
  "salesforce",
  "fancy",
  "zen",
];
const WIDTHS = ["readable", "full"];
/** Mermaid `look` values — handDrawn is the RoughJS / Excalidraw-style sketch. */
const MERMAID_LOOKS = ["classic", "handDrawn"];
/** Hand-drawn diagram face (cdn.jsdelivr.net/npm/excalifont@1.0.0). */
const MERMAID_HAND_FONT = '"Excalifont", "Segoe UI", "Helvetica Neue", sans-serif';
const VIEWS = ["edit", "reader", "present", "slides"];

const editor = document.getElementById("editor");
const editorHighlight = document.getElementById("editor-highlight");
const editorHighlightCode = editorHighlight.querySelector("code");
const preview = document.getElementById("preview");
const panes = document.getElementById("panes");
const splitter = document.getElementById("splitter");
const themeSelect = document.getElementById("theme-select");
const widthSelect = document.getElementById("width-select");
const mermaidLookSelect = document.getElementById("mermaid-look-select");
const fileInput = document.getElementById("file-input");
const filesOpenFileBtn = document.getElementById("files-open-file-btn");
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
const renderLoading = document.getElementById("render-loading");
const historyBtn = document.getElementById("history-btn");
const historyMenu = document.getElementById("history-menu");
const historyDropdown = document.getElementById("history-dropdown");
const toolbarMenu = document.getElementById("toolbar-menu");
const toolbarBar = document.getElementById("toolbar-bar");
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
const presentViewBtn = document.getElementById("present-view-btn");
const printBtn = document.getElementById("print-btn");
const helpBtn = document.getElementById("help-btn");
const presentChrome = document.getElementById("present-chrome");
const presentPrevBtn = document.getElementById("present-prev-btn");
const presentNextBtn = document.getElementById("present-next-btn");
const presentExitBtn = document.getElementById("present-exit-btn");
const presentProgress = document.getElementById("present-progress");
const externalModal = document.getElementById("external-modal");
const cloudSpeechModal = document.getElementById("cloud-speech-modal");
const mermaidZoomDialog = document.getElementById("mermaid-zoom-dialog");
const mermaidZoomStage = document.getElementById("mermaid-zoom-stage");
const mermaidZoomLevel = document.getElementById("mermaid-zoom-level");
const mermaidZoomInBtn = document.getElementById("mermaid-zoom-in");
const mermaidZoomOutBtn = document.getElementById("mermaid-zoom-out");
const mermaidZoomResetBtn = document.getElementById("mermaid-zoom-reset");
const mermaidZoomCloseBtn = document.getElementById("mermaid-zoom-close");
const installBtn = document.getElementById("install-btn");
const updateToast = document.getElementById("update-toast");
const updateReloadBtn = document.getElementById("update-reload-btn");
const filesToggleBtn = document.getElementById("files-toggle-btn");
const saveBtn = document.getElementById("save-btn");
const filesDrawer = document.getElementById("files-drawer");
const filesBackdrop = document.getElementById("files-backdrop");
const filesDrawerTitle = document.getElementById("files-drawer-title");
const filesOpenFolderBtn = document.getElementById("files-open-folder-btn");
const filesSourceToggle = document.getElementById("files-source-toggle");
const filesSourceLocalBtn = document.getElementById("files-source-local-btn");
const filesSourceDriveBtn = document.getElementById("files-source-drive-btn");
const filesSourceGistBtn = document.getElementById("files-source-gist-btn");
const filesConnectDriveBtn = document.getElementById("files-connect-drive-btn");
const filesConnectGistBtn = document.getElementById("files-connect-gist-btn");
const filesDriveOfflineHint = document.getElementById("files-drive-offline-hint");
const filesEmptyConnectBtn = document.getElementById("files-empty-connect-btn");
const filesEmptyConnectGistBtn = document.getElementById("files-empty-connect-gist-btn");
const filesEmptyCopy = document.getElementById("files-empty-copy");
const filesNewFileBtn = document.getElementById("files-new-file-btn");
const filesNewFolderBtn = document.getElementById("files-new-folder-btn");
const filesRefreshBtn = document.getElementById("files-refresh-btn");
const filesEmpty = document.getElementById("files-empty");
const filesEmptyOpenBtn = document.getElementById("files-empty-open-btn");
const filesLoading = document.getElementById("files-loading");
const filesLoadingCopy = document.getElementById("files-loading-copy");
const filesPermission = document.getElementById("files-permission");
const filesRegrantBtn = document.getElementById("files-regrant-btn");
const filesReopenBtn = document.getElementById("files-reopen-btn");
const filesTree = document.getElementById("files-tree");
const filesContextMenu = document.getElementById("files-context-menu");
const gistPatModal = document.getElementById("gist-pat-modal");
const gistPatInput = document.getElementById("gist-pat-input");
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
/** @type {{ id: string, name: string, mimeType?: string } | null} */
let currentDriveFile = null;
/** @type {{ gistId: string, filename: string } | null} */
let currentGistFile = null;
/** @type {string} */
let currentFileName = "";
/** @type {string} Relative path under the open folder, when known. */
let currentFilePath = "";
/** Set after loadGoogleDriveConfig() during boot. */
let driveConfigured = false;
/** Set after loadGithubGistConfig() during boot. */
let gistConfigured = false;
/** @type {"local"|"drive"|"gist"} */
let filesSource = "local";
/** @type {Map<string, { kind: "file"|"directory", id: string, name: string, mimeType?: string }>} */
const driveEntries = new Map();
/** @type {Map<string, { kind: "file", id: string, gistId: string, filename: string, name: string, description: string, isPublic: boolean }>} */
const gistEntries = new Map();
/** UI label for the Drive app root (leading slash marks it as a directory). */
const DRIVE_ROOT_UI_NAME = `/${DRIVE_DEFAULT_FOLDER_NAME}`;
/** @type {{ id: string, name: string }[]} navigation stack; [0] is markdown-editor root */
let driveNavStack = [];
let driveConnected = false;
let gistConnected = false;
/** True while the Drive files tree is fetching from Google. */
let driveFilesLoading = false;
/** True while the Gist files tree is fetching from GitHub. */
let gistFilesLoading = false;

function driveCurrentFolderId() {
  return driveNavStack.length ? driveNavStack[driveNavStack.length - 1].id : "";
}

function drivePathLabel() {
  if (!driveNavStack.length) return DRIVE_ROOT_UI_NAME;
  return driveNavStack.map((p) => p.name).join("/");
}
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
/** @type {{ id: string, kind: "file"|"directory" }|null} */
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
marked.use(defListExtension());

// Open all markdown links in a new tab; noopener/noreferrer blocks window.opener abuse.
// Strip remote media URLs so Accepted Markdown cannot phone home (CSP img-src is the backstop).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if ("target" in node) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  stripRemoteMediaAttributes(/** @type {Element} */ (node));
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
  // Sanitize before innerHTML so textarea value cannot be reinterpreted as markup
  // (CodeQL js/xss-through-dom). Highlight output is span/class only.
  editorHighlightCode.innerHTML = DOMPurify.sanitize(
    `${decorateEmbedTokens(html)}\n`,
    { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"] },
  );
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
  // Translate the highlight content instead of scrolling the layer — keeps
  // browser Find from moving a second scrollport out of sync with #editor.
  editorHighlightCode.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
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
          `<div class="mermaid">${escapeHtml(normalizeMermaidSource(text))}</div>\n`,
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
/** Bumps to cancel in-flight async markdown paints. */
let paintGen = 0;
/** Timer that reveals the preview loading spinner after RENDER_LOADING_DELAY_MS. */
let renderLoadingTimer = 0;
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
/** Session flag: user accepted cloud TTS after the fallback confirmation. */
let cloudSpeechAllowedThisSession = false;
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
  "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs";
/**
 * RoughJS SVG sketcher for the Excalidraw (handDrawn) look.
 * Mermaid's native handDrawn uses dense hachure fills that fail WCAG (fill color
 * becomes stroke ink). We always render classic Mermaid, then sketch with solid fills.
 */
const SVG2ROUGH_CDN = "https://cdn.jsdelivr.net/npm/svg2roughjs@3.2.3/+esm";

/**
 * Mermaid gantt keeps alignment spaces in "Task name    :meta" as part of the
 * label and centers with text-anchor=middle, which shifts the visible text
 * left (worse on narrow/readable widths). Collapse those spaces before render.
 * @param {string} text
 * @returns {string}
 */
function normalizeMermaidSource(text) {
  const body = String(text ?? "").replace(/\n$/, "");
  if (!/^\s*gantt\b/im.test(body)) return body;
  return body
    .split("\n")
    .map((line) => line.replace(/(\S)[ \t]+:/, "$1:").replace(/[ \t]+$/g, ""))
    .join("\n");
}

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
  /* Flowchart edge labels (Yes/No) render in foreignObject HTML — Mermaid's
     default yellow (#ffffde) is a CSS background on .labelBkg, span.edgeLabel,
     AND the inner p, not an SVG fill. Prefer background-color only: Mermaid's
     themeCSS serializer expands the background shorthand into broken longhands. */
  .labelBkg,
  span.edgeLabel,
  .edgeLabel .labelBkg,
  .edgeLabel p,
  .edgeLabel span {
    background-color: var(--mermaid-label-bg) !important;
  }
  .nodeLabel,.edgeLabel,.label,.cluster-label,.cluster span,.node .label,
  .edgeLabel foreignObject div,.nodeLabel foreignObject div,
  .edgeLabel foreignObject p,.edgeLabel foreignObject span {
    color: var(--mermaid-fg) !important;
    fill: var(--mermaid-fg) !important;
  }
  text,tspan,.nodeLabel,.edgeLabel,.label,.cluster-label,
  foreignObject,foreignObject div,foreignObject span,foreignObject p {
    font-family: var(--mermaid-font, inherit) !important;
  }
  /* Zero UA <p> margins — otherwise labels clip inside foreignObject (esp. zoom). */
  foreignObject div,foreignObject span,foreignObject p {
    margin: 0 !important;
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
    /* note-fg is AA vs note-bg; node-border can fail on yellow notes (github-dark). */
    stroke: var(--mermaid-note-fg) !important;
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
  /* Requirement diagrams paint edges via CSS #333 (no stroke attr). */
  path.edge-thickness-normal,path.edge-pattern-solid,path.edge-pattern-dashed,
  path.edge-pattern-dotted,g.edgePath path,line:not([class]) {
    stroke: var(--mermaid-line) !important;
  }

  /*
   * Mermaid bakes #id { fill:#333 } and per-diagram class fills (pie, gantt,
   * gitGraph, journey, quadrant). Those rules omit !important, so themeCSS
   * !important wins — keep noteText / sequenceNumber overrides after this block.
   */
  text,text tspan,.sectionTitle,.pieTitleText,.slice,.legend text,
  .commit-label,.tag-label,.branchLabel,.branch-label,.commit-id,.commit-msg,
  .titleText,.taskText,.taskTextOutsideRight,.taskTextOutsideLeft,
  .taskText0,.taskText1,.taskText2,.taskText3,
  .taskTextOutside0,.taskTextOutside1,.taskTextOutside2,.taskTextOutside3,
  .sectionTitle0,.sectionTitle1,.sectionTitle2,.sectionTitle3,
  .activeText0,.activeText1,.activeText2,.activeText3,
  .doneText0,.doneText1,.doneText2,.doneText3,
  .critText0,.critText1,.critText2,.critText3,
  .activeCritText0,.activeCritText1,.activeCritText2,.activeCritText3,
  .doneCritText0,.doneCritText1,.doneCritText2,.doneCritText3,
  .milestoneText,.grid .tick text,.error-text,
  text.journey-section,text.task,text.legend,
  .journey-section tspan,.task tspan,.legend tspan,
  /* Mermaid uses compound !important selectors for outside labels — match them. */
  .doneText0.taskTextOutsideLeft,.doneText0.taskTextOutsideRight,
  .doneText1.taskTextOutsideLeft,.doneText1.taskTextOutsideRight,
  .doneText2.taskTextOutsideLeft,.doneText2.taskTextOutsideRight,
  .doneText3.taskTextOutsideLeft,.doneText3.taskTextOutsideRight,
  .doneCritText0.taskTextOutsideLeft,.doneCritText0.taskTextOutsideRight,
  .doneCritText1.taskTextOutsideLeft,.doneCritText1.taskTextOutsideRight,
  .doneCritText2.taskTextOutsideLeft,.doneCritText2.taskTextOutsideRight,
  .doneCritText3.taskTextOutsideLeft,.doneCritText3.taskTextOutsideRight,
  .activeText0.taskTextOutsideLeft,.activeText0.taskTextOutsideRight,
  .activeText1.taskTextOutsideLeft,.activeText1.taskTextOutsideRight,
  .activeText2.taskTextOutsideLeft,.activeText2.taskTextOutsideRight,
  .activeText3.taskTextOutsideLeft,.activeText3.taskTextOutsideRight,
  .activeCritText0.taskTextOutsideLeft,.activeCritText0.taskTextOutsideRight,
  .activeCritText1.taskTextOutsideLeft,.activeCritText1.taskTextOutsideRight,
  .activeCritText2.taskTextOutsideLeft,.activeCritText2.taskTextOutsideRight,
  .activeCritText3.taskTextOutsideLeft,.activeCritText3.taskTextOutsideRight,
  .taskText.clickable,.taskTextOutsideLeft.clickable,.taskTextOutsideRight.clickable {
    fill: var(--mermaid-fg) !important;
    color: var(--mermaid-fg) !important;
    stroke: none !important;
  }
  /* foreignObject HTML chips (journey tasks, some labels) */
  foreignObject div,foreignObject span,foreignObject p,
  foreignObject .task,foreignObject .journey-section {
    color: var(--mermaid-fg) !important;
  }
  .noteText,.noteText tspan {
    fill: var(--mermaid-note-fg) !important;
    color: var(--mermaid-note-fg) !important;
  }
  .sequenceNumber,.sequenceNumber tspan {
    fill: var(--mermaid-bg) !important;
    stroke: none !important;
  }

  /* Categorical fills: series tokens (fancy mid-pop; other themes alias node/cluster/label). */
  .pieCircle,.pieOuterCircle {
    stroke: var(--mermaid-node-border) !important;
  }
  path.pieCircle:nth-of-type(3n+1) { fill: var(--mermaid-series-1) !important; }
  path.pieCircle:nth-of-type(3n+2) { fill: var(--mermaid-series-2) !important; }
  path.pieCircle:nth-of-type(3n+3) { fill: var(--mermaid-series-3) !important; }
  g.legend:nth-of-type(3n+1) rect { fill: var(--mermaid-series-1) !important; }
  g.legend:nth-of-type(3n+2) rect { fill: var(--mermaid-series-2) !important; }
  g.legend:nth-of-type(3n+3) rect { fill: var(--mermaid-series-3) !important; }
  /* Slice % sits on series fills — use series-fg. Title/legend on diagram bg keep fg. */
  text.slice,.slice {
    fill: var(--mermaid-series-fg) !important;
    color: var(--mermaid-series-fg) !important;
  }
  .pieTitleText,.legend text {
    fill: var(--mermaid-fg) !important;
    color: var(--mermaid-fg) !important;
  }

  /* gitGraph label chips */
  .commit-label-bkg {
    fill: var(--mermaid-label-bg) !important;
    opacity: 1 !important;
  }
  .tag-label-bkg {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .branchLabelBkg {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }

  /* Journey section/task bars */
  rect.section-type-0,rect.task-type-0 { fill: var(--mermaid-series-1) !important; }
  rect.section-type-1,rect.task-type-1 { fill: var(--mermaid-series-2) !important; }
  rect.section-type-2,rect.task-type-2 { fill: var(--mermaid-series-3) !important; }
  rect.section-type-3,rect.task-type-3 { fill: var(--mermaid-series-4) !important; }
  rect.section-type-4,rect.task-type-4 { fill: var(--mermaid-series-1) !important; }
  rect.section-type-5,rect.task-type-5 { fill: var(--mermaid-series-2) !important; }
  rect.section-type-6,rect.task-type-6 { fill: var(--mermaid-series-3) !important; }
  rect.section-type-7,rect.task-type-7 { fill: var(--mermaid-series-4) !important; }
  text.journey-section,text.task,.journey-section tspan,.task tspan {
    fill: var(--mermaid-series-fg) !important;
    color: var(--mermaid-series-fg) !important;
  }
  foreignObject .task,foreignObject .journey-section {
    color: var(--mermaid-series-fg) !important;
  }

  /* Gantt bars — cycle series; on-bar labels use series-fg; outside labels keep fg */
  /* Section row bands use dedicated tokens (series 1≡4 on non-fancy themes). */
  rect.section {
    opacity: var(--mermaid-gantt-section-opacity) !important;
  }
  .section0 { fill: var(--mermaid-gantt-0) !important; }
  .section1 { fill: var(--mermaid-gantt-1) !important; }
  .section2 { fill: var(--mermaid-gantt-2) !important; }
  .section3 { fill: var(--mermaid-gantt-3) !important; }
  /* Weekend/exclude bands — Mermaid defaults to #eee, which kills light outside labels. */
  .exclude-range { fill: var(--mermaid-exclude) !important; }
  .grid .tick { stroke: var(--mermaid-line) !important; }
  .active0,.activeCrit0,.task0 {
    fill: var(--mermaid-series-1) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .active1,.activeCrit1,.task1,.done0,.doneCrit0 {
    fill: var(--mermaid-series-2) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .active2,.activeCrit2,.task2,.done1,.doneCrit1,.crit0,.crit1 {
    fill: var(--mermaid-series-3) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }
  .active3,.activeCrit3,.task3,.done2,.done3,.doneCrit2,.doneCrit3,.crit2,.crit3 {
    fill: var(--mermaid-series-4) !important;
    stroke: var(--mermaid-line) !important;
  }
  .taskText:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .critText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .critText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .critText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .critText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeCritText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeCritText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeCritText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeCritText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneCritText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneCritText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneCritText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneCritText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight) {
    fill: var(--mermaid-series-fg) !important;
    color: var(--mermaid-series-fg) !important;
  }

  /* Quadrant chart panels + in-panel labels */
  .quadrants .quadrant { stroke: var(--mermaid-line) !important; }
  .quadrant:nth-child(1) rect,.quadrants > .quadrant:nth-child(1) > rect {
    fill: var(--mermaid-series-1) !important;
  }
  .quadrant:nth-child(2) rect,.quadrants > .quadrant:nth-child(2) > rect {
    fill: var(--mermaid-series-2) !important;
  }
  .quadrant:nth-child(3) rect,.quadrants > .quadrant:nth-child(3) > rect {
    fill: var(--mermaid-series-3) !important;
  }
  .quadrant:nth-child(4) rect,.quadrants > .quadrant:nth-child(4) > rect {
    fill: var(--mermaid-series-4) !important;
  }
  .quadrant text,.quadrant tspan {
    fill: var(--mermaid-series-fg) !important;
    color: var(--mermaid-series-fg) !important;
  }
  .border { stroke: var(--mermaid-line) !important; }
`;

let mermaidModule;
let svg2roughModule;
let mermaidGen = 0;
/** @type {"classic" | "handDrawn"} */
let mermaidLook = "classic";

/**
 * Parse `#rgb` / `#rrggbb` / `rgb()` / `rgba()` into sRGB channels.
 * @param {string} raw
 * @returns {{ r: number, g: number, b: number } | null}
 */
function parseCssColorRgb(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "none" || s === "transparent") return null;
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  const hsl = s.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (hsl) {
    // Rough/Mermaid sometimes emit hsl(); convert for matching.
    const h = ((+hsl[1] % 360) + 360) % 360;
    const sat = +hsl[2] / 100;
    const lit = +hsl[3] / 100;
    const a = sat * Math.min(lit, 1 - lit);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return lit - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return {
      r: Math.round(f(0) * 255),
      g: Math.round(f(8) * 255),
      b: Math.round(f(4) * 255),
    };
  }
  if (!s.startsWith("#")) return null;
  let h = s.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** @param {{ r: number, g: number, b: number }} c */
function cssColorKey(c) {
  return `${c.r | 0},${c.g | 0},${c.b | 0}`;
}

/** @param {{ r: number, g: number, b: number }} c */
function relativeLuminanceRgb(c) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/**
 * WCAG 2 contrast ratio between two sRGB colors.
 * @param {{ r: number, g: number, b: number }} a
 * @param {{ r: number, g: number, b: number }} b
 */
function contrastRatioRgb(a, b) {
  const L1 = relativeLuminanceRgb(a);
  const L2 = relativeLuminanceRgb(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read live `--mermaid-*` tokens (theme-aware). */
function readMermaidThemeTokens() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: get("--mermaid-bg", "#ffffff"),
    fg: get("--mermaid-fg", "#333333"),
    nodeBg: get("--mermaid-node-bg", "#ececff"),
    nodeBorder: get("--mermaid-node-border", "#9370db"),
    clusterBg: get("--mermaid-cluster-bg", "#ffffde"),
    clusterBorder: get("--mermaid-cluster-border", "#6b6b22"),
    line: get("--mermaid-line", "#333333"),
    labelBg: get("--mermaid-label-bg", "#e8e8e8"),
    noteBg: get("--mermaid-note-bg", "#fff5ad"),
    noteFg: get("--mermaid-note-fg", "#333333"),
  };
}

/**
 * Mermaid RoughJS paints from themeVariables at render time. Keep them in sync
 * with the page theme so handDrawn output starts from WCAG-safe tokens.
 */
function mermaidThemeVariablesFromCss() {
  const t = readMermaidThemeTokens();
  const bg = parseCssColorRgb(t.bg);
  const darkMode = bg ? relativeLuminanceRgb(bg) < 0.4 : false;
  /** @type {Record<string, string | boolean>} */
  const vars = {
    darkMode,
    background: t.bg,
    primaryColor: t.nodeBg,
    primaryTextColor: t.fg,
    primaryBorderColor: t.nodeBorder,
    lineColor: t.line,
    secondaryColor: t.clusterBg,
    tertiaryColor: t.labelBg,
    noteBkgColor: t.noteBg,
    noteTextColor: t.noteFg,
  };
  if (mermaidLook === "handDrawn") {
    vars.fontFamily = MERMAID_HAND_FONT;
  }
  return vars;
}

/** Load Excalifont before measuring/sketching hand-drawn diagrams. */
function ensureExcalifontLoaded() {
  if (typeof document === "undefined" || !document.fonts?.load) {
    return Promise.resolve();
  }
  // Warm the face; failures (offline) fall back to the sans stack in MERMAID_HAND_FONT.
  return document.fonts.load(`16px ${MERMAID_HAND_FONT}`).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Apply a theme paint, beating Mermaid's baked stylesheet rules when needed.
 * @param {Element} el
 * @param {"stroke" | "fill"} attr
 * @param {string} cssVarName
 */
function setMermaidPaintVar(el, attr, cssVarName) {
  const value = `var(${cssVarName})`;
  el.setAttribute(attr, value);
  // Requirement / edge paths often get stroke from SVG <style>, which wins over
  // presentation attributes — force the theme token.
  if (el instanceof SVGElement) {
    el.style.setProperty(attr, value, "important");
  }
}

/**
 * Pick a WCAG AA text ink CSS variable for a given background fill.
 * Prefers theme fg/bg (works across light and dark); falls back by luminance.
 * @param {{ r: number, g: number, b: number }} fillRgb
 * @param {ReturnType<typeof readMermaidThemeTokens>} tokens
 * @param {Record<string, string>} varByRole
 */
function mermaidTextInkVarForFill(fillRgb, tokens, varByRole) {
  const candidates = [
    ["fg", parseCssColorRgb(tokens.fg)],
    ["bg", parseCssColorRgb(tokens.bg)],
  ];
  let bestRole = "fg";
  let bestRatio = 0;
  for (const [role, rgb] of candidates) {
    if (!rgb) continue;
    const ratio = contrastRatioRgb(rgb, fillRgb);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestRole = role;
    }
  }
  if (bestRatio >= 4.5) return varByRole[bestRole];
  // Mid-tone custom fills (classDef) may beat neither token at 4.5 — use ink by luminance.
  return relativeLuminanceRgb(fillRgb) > 0.179 ? varByRole.fg : varByRole.bg;
}

/**
 * Resolve the painted fill behind a label (node / cluster / note / label chip).
 * @param {Element} el
 * @returns {{ r: number, g: number, b: number } | null}
 */
function mermaidLabelBackgroundRgb(el) {
  const host =
    el.closest?.(
      "g.node, g.cluster, g.note, .edgeLabel, .label, foreignObject",
    ) || el.parentElement;
  if (!host) return null;
  for (const shape of host.querySelectorAll(
    ":scope > path, :scope > rect, :scope > circle, :scope > polygon, :scope > ellipse, path, rect, circle, polygon, ellipse",
  )) {
    if (shape === el || shape.contains?.(el)) continue;
    const tag = shape.tagName.toLowerCase();
    if (tag === "text" || tag === "tspan") continue;
    // Computed fill resolves var(--mermaid-*) after theme remaps.
    const raw = getComputedStyle(shape).fill;
    if (!raw || raw === "none" || raw.startsWith("url(")) continue;
    const rgb = parseCssColorRgb(raw);
    if (rgb) return rgb;
  }
  return null;
}

/**
 * Rewrite baked RoughJS / svg2roughjs paints to CSS variables so:
 * - strokes that used surface fills (pastel hachure) become ink (border/line)
 * - colors follow the active theme (WCAG pairs from --mermaid-* tokens)
 * - label ink contrasts against the actual node/cluster/classDef fill
 * @param {SVGElement} svg
 */
function normalizeMermaidHandDrawnColors(svg) {
  const tokens = readMermaidThemeTokens();
  /** @type {Record<string, string>} */
  const varByRole = {
    bg: "--mermaid-bg",
    fg: "--mermaid-fg",
    nodeBg: "--mermaid-node-bg",
    nodeBorder: "--mermaid-node-border",
    clusterBg: "--mermaid-cluster-bg",
    clusterBorder: "--mermaid-cluster-border",
    line: "--mermaid-line",
    labelBg: "--mermaid-label-bg",
    noteBg: "--mermaid-note-bg",
    noteFg: "--mermaid-note-fg",
  };
  /** Surface fills sketched as strokes must become ink for ≥3:1 UI contrast. */
  const surfaceToInk = {
    bg: "line",
    nodeBg: "nodeBorder",
    clusterBg: "clusterBorder",
    labelBg: "line",
    noteBg: "noteFg",
  };

  /** @type {Map<string, string>} */
  const roleByColor = new Map();
  for (const [role, value] of Object.entries(tokens)) {
    const rgb = parseCssColorRgb(value);
    if (rgb) roleByColor.set(cssColorKey(rgb), role);
  }
  // Classic Mermaid "base" defaults that Rough often bakes before CSS overrides.
  // #333 is Mermaid's default edge stroke — treat as line ink, not text fill.
  for (const [hex, role] of [
    ["#ececff", "nodeBg"],
    ["#9370db", "nodeBorder"],
    ["#ffffde", "clusterBg"],
    ["#f4f4f4", "labelBg"],
    ["#e8e8e8", "labelBg"],
    ["#ffffff", "bg"],
    ["#333333", "line"],
    ["#333", "line"],
    ["#000000", "line"],
    ["#000", "line"],
    ["#fff5ad", "noteBg"],
    ["#6b6b22", "clusterBorder"],
  ]) {
    const rgb = parseCssColorRgb(hex);
    if (rgb) roleByColor.set(cssColorKey(rgb), role);
  }

  const bgRgb = parseCssColorRgb(tokens.bg);
  const nodeBgRgb = parseCssColorRgb(tokens.nodeBg);

  // Pass 1: remap shape paints (keep author classDef fills that are not theme tokens).
  for (const el of svg.querySelectorAll(
    "path, rect, line, circle, polygon, polyline",
  )) {
    const computed = getComputedStyle(el);

    for (const attr of /** @type {const} */ (["stroke", "fill"])) {
      let raw = el.getAttribute(attr);
      if (raw?.startsWith("url(") || raw?.startsWith("var(")) continue;

      // Mermaid edges often omit stroke attrs and paint via SVG CSS (#333).
      if (!raw || raw === "none") {
        const painted = computed[attr];
        if (!painted || painted === "none") continue;
        if (attr === "fill") {
          const hadAttr = el.hasAttribute("fill") && el.getAttribute("fill") !== "none";
          if (!hadAttr || raw === "none") continue;
          raw = painted;
        } else {
          raw = painted;
        }
      }

      const rgb = parseCssColorRgb(raw);
      if (!rgb) continue;

      let role = roleByColor.get(cssColorKey(rgb));
      // Unknown low-contrast strokes against the canvas → theme ink. Do NOT remap
      // unknown fills: classDef pastels (#9f6, #f96) are intentionally light and
      // would otherwise be replaced with node-bg (contrast vs canvas is often <3).
      if (!role && attr === "stroke" && bgRgb && contrastRatioRgb(rgb, bgRgb) < 3) {
        role = "line";
      }
      if (!role) continue;

      if (attr === "stroke" && surfaceToInk[role]) {
        // Stroke-only sketch of a filled surface: restore the fill so ink sits
        // on the intended background (e.g. note-fg on note-bg, not page bg).
        const curFill = el.getAttribute("fill");
        if (!curFill || curFill === "none") {
          setMermaidPaintVar(el, "fill", varByRole[role]);
        }
        role = surfaceToInk[role];
      }
      // Note borders are inked with note-fg; without a fill they sit on the page
      // canvas and fail contrast on dark themes (dark ink on dark bg).
      if (
        attr === "stroke" &&
        role === "noteFg" &&
        (!el.getAttribute("fill") || el.getAttribute("fill") === "none")
      ) {
        setMermaidPaintVar(el, "fill", varByRole.noteBg);
      }
      // Text-ish fills on shapes (arrowheads) that matched fg/line → line ink.
      if (attr === "fill" && (role === "fg" || role === "line")) {
        role = "line";
      }

      const cssVar = varByRole[role];
      if (cssVar) setMermaidPaintVar(el, attr, cssVar);
    }
  }

  // Pass 2: label ink against the (now final) shape fills — including classDef colors.
  for (const el of svg.querySelectorAll("text, tspan")) {
    const note =
      el.classList.contains("noteText") ||
      Boolean(el.closest?.(".noteText, .note"));
    if (note) {
      setMermaidPaintVar(el, "fill", varByRole.noteFg);
      continue;
    }
    const behind = mermaidLabelBackgroundRgb(el) || nodeBgRgb || bgRgb;
    const inkVar = behind
      ? mermaidTextInkVarForFill(behind, tokens, varByRole)
      : varByRole.fg;
    setMermaidPaintVar(el, "fill", inkVar);
  }

  for (const label of svg.querySelectorAll(
    ".nodeLabel, .edgeLabel, .label, .cluster-label, foreignObject div, foreignObject span, foreignObject p",
  )) {
    if (!(label instanceof HTMLElement) && !(label instanceof SVGElement)) continue;
    const note = Boolean(label.closest?.(".noteText, .note"));
    if (note) {
      label.style.setProperty("color", `var(${varByRole.noteFg})`, "important");
      continue;
    }
    const behind = mermaidLabelBackgroundRgb(label) || nodeBgRgb || bgRgb;
    const inkVar = behind
      ? mermaidTextInkVarForFill(behind, tokens, varByRole)
      : varByRole.fg;
    label.style.setProperty("color", `var(${inkVar})`, "important");
  }
}

/**
 * Fit viewBox around sketched content (RoughJS strokes bow outside Mermaid's
 * box). Uses the root SVG bbox — per-element boxes from svg2roughjs can report
 * huge empty extents (pie labels) that inflate the canvas and cause scrollbars.
 *
 * @param {SVGSVGElement | SVGElement} svg
 * @param {{ pad?: number, tighten?: boolean }} [opts]
 *   tighten: crop to content with uniform pad (hand-drawn). Mermaid/svg2roughjs
 *   often leave asymmetric empty viewBox gutters, so the SVG box is centered
 *   but the drawing looks shifted left/right in the preview.
 */
function fitMermaidSvgViewBox(svg, { pad = 8, tighten = false } = {}) {
  if (!(svg instanceof SVGSVGElement)) return;
  const rawVb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const hasVb = rawVb.length === 4 && rawVb.every((n) => Number.isFinite(n));
  const vx = hasVb ? rawVb[0] : 0;
  const vy = hasVb ? rawVb[1] : 0;
  const vw = hasVb ? rawVb[2] : 0;
  const vh = hasVb ? rawVb[3] : 0;

  let bb;
  try {
    bb = svg.getBBox();
  } catch {
    bb = null;
  }

  // Absurd bbox (gantt "today" marker years off-canvas): only pad the original.
  const absurd =
    hasVb &&
    bb &&
    bb.width > 0 &&
    bb.height > 0 &&
    (bb.width > Math.max(vw * 2.5, 1) || bb.height > Math.max(vh * 2.5, 1));

  if (!bb || !(bb.width > 0 && bb.height > 0) || absurd) {
    if (!hasVb || !(vw > 0 && vh > 0)) return;
    svg.setAttribute(
      "viewBox",
      `${vx - pad} ${vy - pad} ${vw + pad * 2} ${vh + pad * 2}`,
    );
    return;
  }

  if (tighten) {
    // Crop to ink with equal pad so content sits in the middle of the SVG.
    const nextW = bb.width + pad * 2;
    const nextH = bb.height + pad * 2;
    if (!(nextW > 0 && nextH > 0)) return;
    svg.setAttribute(
      "viewBox",
      `${bb.x - pad} ${bb.y - pad} ${nextW} ${nextH}`,
    );
    return;
  }

  // Prefer content bbox, but never shrink below the original viewBox (avoids
  // clipping Mermaid chrome) and only expand modestly for rough overflow.
  let minX = bb.x - pad;
  let minY = bb.y - pad;
  let maxX = bb.x + bb.width + pad;
  let maxY = bb.y + bb.height + pad;
  if (hasVb && vw > 0 && vh > 0) {
    minX = Math.min(minX, vx - pad);
    minY = Math.min(minY, vy - pad);
    maxX = Math.max(maxX, vx + vw + pad);
    maxY = Math.max(maxY, vy + vh + pad);
    // Cap expansion so a few wild glyphs can't create empty scrollable gutters.
    const maxW = vw * 1.35;
    const maxH = vh * 1.35;
    if (maxX - minX > maxW) {
      const cx = (minX + maxX) / 2;
      minX = cx - maxW / 2;
      maxX = cx + maxW / 2;
    }
    if (maxY - minY > maxH) {
      const cy = (minY + maxY) / 2;
      minY = cy - maxH / 2;
      maxY = cy + maxH / 2;
    }
  }

  const nextW = maxX - minX;
  const nextH = maxY - minY;
  if (!(nextW > 0 && nextH > 0)) return;
  svg.setAttribute("viewBox", `${minX} ${minY} ${nextW} ${nextH}`);
}

/**
 * Match classic Mermaid content scale after sketching.
 * fitMermaidSvgViewBox pads the viewBox for RoughJS stroke overflow. Keeping the
 * classic CSS width with a wider viewBox shrinks nodes/text (gitGraph looked
 * smaller in hand-drawn). Scale CSS width by newVb/oldVb so content stays the
 * same size; syncMermaidSvgSizes still caps with max-width when the host is narrow.
 * @param {SVGElement} sketched
 * @param {{ cssWidth: number, cssHeight: number, viewBoxWidth: number, hostWidth: number }} sourceSize
 */
function sizeSketchedMermaidSvg(sketched, sourceSize) {
  if (!(sketched instanceof SVGElement)) return;

  const vb = (sketched.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : NaN;
  const srcVbW = sourceSize?.viewBoxWidth;

  // Do not set style.maxWidth = "100%": syncMermaidSvgSizes parseFloat → 100px lock.
  sketched.style.removeProperty("max-width");
  sketched.style.height = "auto";
  delete sketched.dataset.mermaidNatural;
  delete sketched.dataset.mermaidFluid;

  let w = sourceSize?.cssWidth;
  // Preserve classic content scale when viewBox grows (rough pad) or shrinks
  // (tighten crops asymmetric gutters so drawings look centered).
  if (w > 0 && srcVbW > 0 && Number.isFinite(vbW) && vbW !== srcVbW) {
    w *= vbW / srcVbW;
  }
  if (!(w > 0) && Number.isFinite(vbW)) w = vbW;

  const hostW = sourceSize?.hostWidth ?? 0;
  // Use rendered size, not width="100%" — gitGraph sets 100% but stays content-sized
  // via max-width ≈ viewBox; treating % as fluid stretched it to the full panel.
  const filledHost =
    sourceSize?.cssWidth > 0 &&
    hostW > 0 &&
    Math.abs(sourceSize.cssWidth - hostW) < 8;

  if (filledHost) {
    // Fluid diagrams stay at 100% — slight shrink from viewBox pad is preferable
    // to overflowing the preview (the old width=100% vertical-scroll bug).
    sketched.setAttribute("width", "100%");
    sketched.dataset.mermaidFluid = "1";
  } else if (w > 0) {
    const pxW = Math.round(w);
    sketched.setAttribute("width", String(pxW));
    sketched.dataset.mermaidNatural = String(pxW);
    sketched.dataset.mermaidFluid = "0";
  } else {
    sketched.removeAttribute("width");
  }
  // height:auto + viewBox preserves aspect (needed for foreignObject label layout).
  sketched.removeAttribute("height");
}

function mermaidConfig() {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    // Mermaid 12 defaults to ELK; keep dagre so existing diagrams look the same.
    layout: "dagre",
    // Always classic — Excalidraw look is svg2roughjs with solid fills (native
    // Mermaid handDrawn hachure fails WCAG: pastel fills become dense ink strokes).
    look: "classic",
    // Stable sketch so re-renders / reuse do not reshuffle strokes every paint.
    handDrawnSeed: 1,
    theme: "base",
    themeVariables: mermaidThemeVariablesFromCss(),
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
  // Import-map integrity covers the entry and every nested chunk URL.
  if (!CDN_INTEGRITY_URLS.has(MERMAID_CDN)) {
    return Promise.reject(new Error("Mermaid CDN URL missing SRI allowlist entry"));
  }
  mermaidModule ??= import(MERMAID_CDN).then((mod) => {
    const mermaid = mod.default;
    if (!mermaid?.initialize || !mermaid?.run) {
      throw new Error("Mermaid failed to load");
    }
    return initMermaid(mermaid);
  });
  return mermaidModule;
}

function loadSvg2Rough() {
  if (!CDN_INTEGRITY_URLS.has(SVG2ROUGH_CDN)) {
    return Promise.reject(new Error("svg2roughjs CDN URL missing SRI allowlist entry"));
  }
  svg2roughModule ??= import(SVG2ROUGH_CDN).then((mod) => {
    const Svg2Roughjs = mod.Svg2Roughjs;
    if (typeof Svg2Roughjs !== "function") {
      throw new Error("svg2roughjs failed to load");
    }
    return Svg2Roughjs;
  });
  return svg2roughModule;
}

/** True when Excalidraw look is on — every diagram is sketched via svg2roughjs. */
function mermaidNeedsSketch() {
  return mermaidLook === "handDrawn";
}

/**
 * Convert a rendered Mermaid SVG into a RoughJS sketch (Excalidraw-like).
 * SVG must stay in the document so computed theme styles resolve.
 * @param {SVGElement} svg
 * @returns {Promise<SVGElement | null>}
 */
async function sketchMermaidSvg(svg) {
  const Svg2Roughjs = await loadSvg2Rough();
  const scratch = document.createElement("div");
  scratch.hidden = true;
  scratch.setAttribute("aria-hidden", "true");
  // Keep in-DOM for layout/style resolution of the source SVG next to it.
  svg.parentElement?.appendChild(scratch);
  try {
    const converter = new Svg2Roughjs(scratch);
    // Match Mermaid hand-drawn labels (Excalifont). Default Comic Sans is a joke.
    converter.fontFamily = MERMAID_HAND_FONT;
    converter.randomize = false;
    converter.seed = 1;
    converter.roughConfig = {
      roughness: 1.2,
      bowing: 1,
      seed: 1,
      // Solid fills keep node/note backgrounds — hachure reuses fill pastels as
      // strokes, which fail WCAG against the diagram canvas on many themes.
      fillStyle: "solid",
    };
    converter.svg = /** @type {SVGSVGElement} */ (svg);
    await converter.sketch();
    const sketched = scratch.querySelector(":scope > svg");
    if (!(sketched instanceof SVGElement)) return null;
    sketched.dataset.mermaidSketched = "1";
    // Keep class for theming. Size from the classic SVG's rendered CSS box —
    // copying width="100%" would upscale tall viewBoxes and cause vertical scroll.
    const srcClass = svg.getAttribute("class");
    const preBox = svg.getBoundingClientRect();
    const srcVb = (svg.getAttribute("viewBox") || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const sourceSize = {
      cssWidth: preBox.width,
      cssHeight: preBox.height,
      viewBoxWidth: srcVb.length === 4 && srcVb[2] > 0 ? srcVb[2] : 0,
      hostWidth: svg.parentElement?.clientWidth ?? 0,
    };
    if (srcClass && !sketched.getAttribute("class")) {
      sketched.setAttribute("class", srcClass);
    }
    if (!sketched.getAttribute("viewBox") && svg.getAttribute("viewBox")) {
      sketched.setAttribute("viewBox", svg.getAttribute("viewBox"));
    }
    // svg2roughjs drops Mermaid's <style> (themeCSS, p{margin:0}) — copy it back
    // so labels/theme rules still apply after sketch (and in the zoom dialog).
    const srcStyle = svg.querySelector("style");
    if (srcStyle && !sketched.querySelector("style")) {
      sketched.insertBefore(srcStyle.cloneNode(true), sketched.firstChild);
    }
    // Hachure strokes often reuse fill pastels — remap to WCAG theme ink.
    normalizeMermaidHandDrawnColors(sketched);
    svg.replaceWith(sketched);
    // Fit after insert — getBBox() is wrong while the sketch sits in [hidden].
    // tighten: drop asymmetric Mermaid/svg2roughjs gutters so drawings look centered.
    fitMermaidSvgViewBox(sketched, { tighten: true });
    sizeSketchedMermaidSvg(sketched, sourceSize);
    return sketched;
  } finally {
    scratch.remove();
  }
}

function mermaidNodeIsVisible(el) {
  return !el.closest("[hidden], .md-section-folded");
}

/** @type {WeakMap<HTMLElement, string>} */
const mermaidSources = new WeakMap();
/** Last rendered host height per Mermaid source — reserves space across paints. */
const mermaidHeightCache = new Map();
let mermaidScaleRaf = 0;
let mermaidRelayoutTimer = 0;
const MERMAID_ZOOM_MIN = 0.5;
const MERMAID_ZOOM_MAX = 4;
const MERMAID_ZOOM_STEP = 0.25;
/** @type {number} */
let mermaidZoomFactor = 1;
/** @type {number} */
let mermaidZoomBaseW = 0;
/** @type {number} */
let mermaidZoomBaseH = 0;
const MERMAID_ZOOM_BTN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>';

/**
 * Mermaid replaces diagram text with SVG. Keep the source so fluid diagrams
 * (gantt, etc.) can re-run at a new width without CSS-zooming text/bars.
 * @param {HTMLElement} el
 */
function rememberMermaidSource(el) {
  if (!mermaidSources.has(el)) {
    mermaidSources.set(el, el.textContent ?? "");
  }
}

/**
 * Collect rendered Mermaid SVGs before the preview DOM is replaced so unchanged
 * diagrams can be restored without a Mermaid re-run (avoids height/scroll thrash
 * when typing below diagrams).
 * @returns {Map<string, { svg: SVGElement, height: number }[]>}
 */
function mermaidReuseKey(src) {
  return `${mermaidLook}\0${src}`;
}

function takeMermaidRenderReuse() {
  /** @type {Map<string, { svg: SVGElement, height: number }[]>} */
  const bySource = new Map();
  for (const el of preview.querySelectorAll(".mermaid")) {
    // Direct child only — zoom-button icons are nested SVGs.
    const svg = el.querySelector(":scope > svg");
    const src = mermaidSources.get(el);
    if (!svg || !src) continue;
    const height = el.offsetHeight;
    if (height > 0) mermaidHeightCache.set(mermaidReuseKey(src), height);
    const key = mermaidReuseKey(src);
    const list = bySource.get(key) || [];
    list.push({ svg: /** @type {SVGElement} */ (svg.cloneNode(true)), height });
    bySource.set(key, list);
  }
  return bySource;
}

/**
 * Restore unchanged Mermaid SVGs after a preview repaint; reserve height and mark
 * pending only for diagrams whose source is new or changed.
 * @param {Map<string, { svg: SVGElement, height: number }[]>} bySource
 */
function restoreMermaidRenders(bySource) {
  for (const el of preview.querySelectorAll(".mermaid")) {
    // Capture source from the fresh fence text before we swap in an SVG.
    rememberMermaidSource(el);
    const src = mermaidSources.get(el) ?? "";
    const key = mermaidReuseKey(src);
    const list = bySource.get(key);
    const reuse = list?.shift();
    if (reuse) {
      el.replaceChildren(reuse.svg);
      el.style.minHeight = "";
      el.removeAttribute("data-pending");
      continue;
    }
    el.setAttribute("data-pending", "");
    const h = mermaidHeightCache.get(key);
    if (h > 0) el.style.minHeight = `${h}px`;
  }
}

/** True while any Mermaid host is still waiting for (or mid) SVG paint. */
function mermaidPreviewUnsettled() {
  return Boolean(preview.querySelector(".mermaid[data-pending]"));
}

/**
 * Add a zoom control on a rendered Mermaid host (idempotent).
 * @param {HTMLElement} host
 */
function ensureMermaidZoomControls(host) {
  if (!host.querySelector(":scope > svg")) {
    host.querySelector(".mermaid-zoom-btn")?.remove();
    return;
  }
  if (host.querySelector(":scope > .mermaid-zoom-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mermaid-zoom-btn";
  btn.title = "Zoom diagram";
  btn.setAttribute("aria-label", "Zoom diagram");
  btn.innerHTML = MERMAID_ZOOM_BTN_SVG;
  host.appendChild(btn);
}

function clampMermaidZoom(factor) {
  return Math.min(MERMAID_ZOOM_MAX, Math.max(MERMAID_ZOOM_MIN, factor));
}

/**
 * Scale via CSS transform (not SVG width). Mermaid labels live in foreignObject
 * HTML — resizing the SVG with style.width leaves font-size at 16px so text
 * looks like dots inside huge shapes (especially Excalidraw sketches).
 */
function applyMermaidZoom() {
  const scaler = mermaidZoomStage?.querySelector(".mermaid-zoom-scaler");
  const inner = scaler?.querySelector(".mermaid-zoom-scaler-inner");
  if (!(scaler instanceof HTMLElement) || !(inner instanceof HTMLElement)) return;
  if (!(mermaidZoomBaseW > 0)) return;
  mermaidZoomFactor = clampMermaidZoom(mermaidZoomFactor);
  const w = mermaidZoomBaseW * mermaidZoomFactor;
  const h =
    mermaidZoomBaseH > 0
      ? mermaidZoomBaseH * mermaidZoomFactor
      : mermaidZoomBaseW * mermaidZoomFactor;
  scaler.style.width = `${w}px`;
  scaler.style.height = `${h}px`;
  inner.style.width = `${mermaidZoomBaseW}px`;
  inner.style.height = mermaidZoomBaseH > 0 ? `${mermaidZoomBaseH}px` : "auto";
  inner.style.transform = `scale(${mermaidZoomFactor})`;
  if (mermaidZoomLevel) {
    mermaidZoomLevel.textContent = `${Math.round(mermaidZoomFactor * 100)}%`;
  }
}

/** Fit the zoomed SVG to the dialog stage width. */
function fitMermaidZoom() {
  if (!(mermaidZoomBaseW > 0) || !mermaidZoomStage) return;
  const stageW = mermaidZoomStage.clientWidth;
  if (!(stageW > 0)) {
    mermaidZoomFactor = 1;
  } else {
    mermaidZoomFactor = clampMermaidZoom((stageW * 0.92) / mermaidZoomBaseW);
  }
  applyMermaidZoom();
}

/**
 * Open the zoom dialog for a Mermaid host. Scales only that diagram so text
 * stays readable without changing the rest of the preview.
 * @param {HTMLElement} host
 */
function openMermaidZoom(host) {
  if (!mermaidZoomDialog || !mermaidZoomStage) return;
  const srcSvg = host.querySelector(":scope > svg");
  if (!srcSvg) return;

  const pre = srcSvg.getBoundingClientRect();
  mermaidZoomBaseW = pre.width > 0 ? pre.width : 400;
  mermaidZoomBaseH = pre.height > 0 ? pre.height : 0;
  mermaidZoomFactor = 1;

  const clone = /** @type {SVGElement} */ (srcSvg.cloneNode(true));
  // Keep viewBox + width; height:auto preserves aspect for foreignObject labels.
  // Scaling is done on a wrapper via transform (CSS width alone leaves HTML
  // labels at 16px — tiny "dots" inside enlarged shapes).
  clone.style.maxWidth = "none";
  clone.style.width = `${mermaidZoomBaseW}px`;
  clone.style.height = "auto";
  clone.setAttribute("width", String(Math.round(mermaidZoomBaseW)));
  clone.removeAttribute("height");

  const inner = document.createElement("div");
  inner.className = "mermaid-zoom-scaler-inner";
  inner.appendChild(clone);

  const scaler = document.createElement("div");
  scaler.className = "mermaid-zoom-scaler";
  scaler.appendChild(inner);

  mermaidZoomStage.replaceChildren(scaler);
  applyMermaidZoom();
  mermaidZoomDialog.showModal();

  // After layout, remeasure height (height:auto + viewBox) then fit to stage.
  requestAnimationFrame(() => {
    if (!mermaidZoomDialog?.open) return;
    const laidOut = inner.querySelector("svg")?.getBoundingClientRect().height;
    if (laidOut > 0) mermaidZoomBaseH = laidOut;
    fitMermaidZoom();
    mermaidZoomStage.focus({ preventScroll: true });
  });
}

function closeMermaidZoom() {
  if (!mermaidZoomDialog?.open) return;
  mermaidZoomDialog.close();
}

function onMermaidZoomDialogClose() {
  mermaidZoomStage?.replaceChildren();
  mermaidZoomBaseW = 0;
  mermaidZoomBaseH = 0;
  mermaidZoomFactor = 1;
}

function stepMermaidZoom(delta) {
  mermaidZoomFactor = clampMermaidZoom(mermaidZoomFactor + delta);
  applyMermaidZoom();
}

function setupMermaidZoom() {
  preview?.addEventListener("click", (e) => {
    const btn = e.target.closest(".mermaid-zoom-btn");
    if (!btn || !preview.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const host = btn.closest(".mermaid");
    if (host) openMermaidZoom(host);
  });

  mermaidZoomInBtn?.addEventListener("click", () => stepMermaidZoom(MERMAID_ZOOM_STEP));
  mermaidZoomOutBtn?.addEventListener("click", () => stepMermaidZoom(-MERMAID_ZOOM_STEP));
  mermaidZoomResetBtn?.addEventListener("click", () => fitMermaidZoom());
  mermaidZoomCloseBtn?.addEventListener("click", () => closeMermaidZoom());
  mermaidZoomDialog?.addEventListener("close", onMermaidZoomDialogClose);
  mermaidZoomDialog?.addEventListener("click", (e) => {
    // Click on the dialog frame (not toolbar/stage) closes — same as backdrop intent
    // when the dialog is sized under the viewport.
    if (e.target === mermaidZoomDialog) closeMermaidZoom();
  });
  mermaidZoomStage?.addEventListener(
    "wheel",
    (e) => {
      if (!mermaidZoomDialog?.open) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      stepMermaidZoom(e.deltaY < 0 ? MERMAID_ZOOM_STEP : -MERMAID_ZOOM_STEP);
    },
    { passive: false },
  );
  mermaidZoomDialog?.addEventListener("keydown", (e) => {
    if (!mermaidZoomDialog.open) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      stepMermaidZoom(MERMAID_ZOOM_STEP);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      stepMermaidZoom(-MERMAID_ZOOM_STEP);
    } else if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      fitMermaidZoom();
    }
  });
}

/**
 * Tag natural size after Mermaid paints. Fluid = filled the host at render
 * (should re-layout when the preview width changes). Content-sized diagrams
 * only CSS-shrink when the host is narrower.
 */
function syncMermaidSvgSizes() {
  let needsRelayout = false;
  for (const host of preview.querySelectorAll(".mermaid")) {
    const svg = host.querySelector(":scope > svg");
    if (!svg) {
      ensureMermaidZoomControls(host);
      continue;
    }
    ensureMermaidZoomControls(host);
    const hostW = host.clientWidth;
    if (hostW < 1) continue;

    let natural = Number(svg.dataset.mermaidNatural);
    if (!Number.isFinite(natural) || natural <= 0) {
      const rawMax = String(svg.style.maxWidth || "").trim();
      // parseFloat("100%") === 100 — never treat percentages as px naturals.
      const fromStyle = /%$/.test(rawMax) ? NaN : parseFloat(rawMax);
      natural =
        Number.isFinite(fromStyle) && fromStyle > 0
          ? fromStyle
          : svg.getBoundingClientRect().width;
      if (!(natural > 0)) continue;
      svg.dataset.mermaidNatural = String(natural);
      if (svg.dataset.mermaidFluid !== "1") {
        svg.dataset.mermaidFluid = Math.abs(natural - hostW) < 8 ? "1" : "0";
      }
    }

    if (svg.dataset.mermaidFluid === "1") {
      // Do not scale the SVG up — that zooms fonts/bars. Keep the natural
      // size until a debounced Mermaid re-run lays out at the new width.
      if (Math.abs(hostW - natural) >= 16) {
        svg.style.maxWidth = `${Math.min(natural, hostW)}px`;
        needsRelayout = true;
      } else {
        svg.style.maxWidth = `${hostW}px`;
      }
    } else {
      svg.style.maxWidth = `${Math.min(natural, hostW)}px`;
    }
  }
  if (needsRelayout) scheduleMermaidRelayout();
}

function scheduleMermaidScale() {
  if (mermaidScaleRaf) return;
  mermaidScaleRaf = requestAnimationFrame(() => {
    mermaidScaleRaf = 0;
    syncMermaidSvgSizes();
  });
}

/**
 * Re-run Mermaid for fluid diagrams whose host width drifted, so gantt (etc.)
 * get a real wider/narrower layout instead of a CSS zoom. Debounced so splitter
 * drags do not flash on every frame.
 */
function scheduleMermaidRelayout() {
  window.clearTimeout(mermaidRelayoutTimer);
  mermaidRelayoutTimer = window.setTimeout(() => {
    mermaidRelayoutTimer = 0;
    relayoutFluidMermaidDiagrams();
  }, 220);
}

function relayoutFluidMermaidDiagrams() {
  /** @type {HTMLElement[]} */
  const targets = [];
  for (const el of preview.querySelectorAll(".mermaid")) {
    const svg = el.querySelector(":scope > svg");
    if (!svg || svg.dataset.mermaidFluid !== "1") continue;
    if (!mermaidSources.has(el)) continue;
    const natural = Number(svg.dataset.mermaidNatural);
    if (!Number.isFinite(natural)) continue;
    if (Math.abs(el.clientWidth - natural) < 16) continue;
    targets.push(el);
  }
  if (!targets.length) return;

  mermaidGen += 1;
  for (const el of targets) {
    const prevH = el.clientHeight;
    if (prevH > 0) el.style.minHeight = `${prevH}px`;
    el.removeAttribute("data-processed");
    el.textContent = mermaidSources.get(el) ?? "";
    // Source was just written back; keep the WeakMap entry for the next pass.
    el.setAttribute("data-pending", "");
  }
  void renderMermaidDiagrams().finally(() => {
    for (const el of targets) {
      if (preview.contains(el)) el.style.minHeight = "";
    }
  });
}

/**
 * Mermaid sometimes keeps `taskText` + middle anchoring when the label is wider
 * than the bar, but still parks `x` at the bar's right edge. That reads as a
 * large left gap inside the bar (common in readable width). Promote those
 * labels to outside-right placement.
 * @param {SVGElement} svg
 */
function fixMermaidGanttLabels(svg) {
  if (svg.getAttribute("aria-roledescription") !== "gantt") return;
  const bars = [...svg.querySelectorAll("rect")]
    .map((r) => ({
      className: r.getAttribute("class") || "",
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
      h: Number(r.getAttribute("height")),
    }))
    .filter(
      (b) =>
        /\b(task|active|done|crit)\b/i.test(b.className) &&
        Number.isFinite(b.x) &&
        Number.isFinite(b.w) &&
        b.h >= 12 &&
        b.h <= 28 &&
        b.w > 0,
    );

  for (const text of svg.querySelectorAll("text")) {
    const cls = text.getAttribute("class") || "";
    if (!/\btaskText\b|\b(?:active|done|crit)Text\d/.test(cls)) continue;
    if (/\btaskTextOutside(?:Left|Right)\b/.test(cls)) continue;

    const widthMatch = cls.match(/\bwidth-([\d.]+)\b/);
    const textW = widthMatch ? Number(widthMatch[1]) : 0;
    const x = Number(text.getAttribute("x"));
    const y = Number(text.getAttribute("y"));
    if (!(textW > 0) || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    const bar = bars
      .map((b) => ({ ...b, yDist: Math.abs(b.y + b.h / 2 - y) }))
      .sort((a, b) => a.yDist - b.yDist)[0];
    if (!bar || bar.yDist > bar.h || textW <= bar.w + 1) continue;

    const barEnd = bar.x + bar.w;
    const sec = cls.match(/\btaskText(\d)\b/)?.[1];
    text.classList.add("taskTextOutsideRight");
    if (sec != null) text.classList.add(`taskTextOutside${sec}`);
    text.setAttribute("text-anchor", "start");
    // Mermaid's outside-right offset is ~5px past the bar end.
    text.setAttribute("x", String(barEnd + 5));
  }
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
    if (!el.querySelector(":scope > svg")) {
      rememberMermaidSource(el);
      el.setAttribute("data-pending", "");
    }
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
      if (mermaidLook === "handDrawn") await ensureExcalifontLoaded();
      if (gen !== mermaidGen) return;
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
    // Fresh SVG from this run — retag natural/fluid at the current host width.
    let svg = el.querySelector(":scope > svg");
    if (svg) {
      fixMermaidGanttLabels(svg);
      if (mermaidNeedsSketch()) {
        try {
          const sketched = await sketchMermaidSvg(svg);
          if (gen !== mermaidGen) return;
          if (sketched) svg = sketched;
        } catch {
          /* keep the classic Mermaid SVG if the sketcher fails to load */
        }
      }
      // Sketched SVGs already recorded natural size from the classic CSS box —
      // don't wipe it or syncMermaidSvgSizes will treat width=host as "fluid"
      // and stretch them again.
      if (svg.dataset.mermaidSketched !== "1") {
        delete svg.dataset.mermaidNatural;
        delete svg.dataset.mermaidFluid;
      }
    }
    // Release the paint reservation now that the real SVG owns layout.
    el.style.minHeight = "";
    const src = mermaidSources.get(el);
    const h = el.offsetHeight;
    if (src && h > 0) mermaidHeightCache.set(mermaidReuseKey(src), h);
  }
  syncMermaidSvgSizes();
}

/**
 * Re-run every Mermaid host with the current look (classic / handDrawn).
 * Used when the Diagrams toolbar preference changes.
 */
function rerenderAllMermaidDiagrams() {
  const hosts = [...preview.querySelectorAll(".mermaid")];
  if (!hosts.length) return Promise.resolve();

  mermaidGen += 1;
  for (const el of hosts) {
    rememberMermaidSource(el);
    const prevH = el.clientHeight;
    if (prevH > 0) el.style.minHeight = `${prevH}px`;
    el.removeAttribute("data-processed");
    el.textContent = mermaidSources.get(el) ?? "";
    el.setAttribute("data-pending", "");
  }
  return renderMermaidDiagrams().finally(() => {
    for (const el of hosts) {
      if (preview.contains(el)) el.style.minHeight = "";
    }
  });
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
  paintGen += 1;
  endRenderLoading();
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

/** Yield until after the next paint so a loading spinner can appear on screen. */
function yieldToPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Macrotask after the frame so the browser can commit the paint.
        setTimeout(resolve, 0);
      });
    });
  });
}

/** Drop the current preview DOM so a prior document is not shown under the spinner. */
function clearPreviewContent() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  mermaidGen += 1;
  preview.innerHTML = "";
  if (previewPane) previewPane.scrollTop = 0;
  invalidateScrollAnchors();
  updateDocOutline();
}

/**
 * Mount the loading overlay and arm the 700ms reveal timer.
 * @param {{ eager?: boolean }} [opts] eager: show immediately (large docs)
 */
function beginRenderLoading(opts = {}) {
  if (!(renderLoading instanceof HTMLElement)) return;
  window.clearTimeout(renderLoadingTimer);
  const alreadyVisible = renderLoading.classList.contains("is-visible") && !renderLoading.hidden;
  renderLoading.hidden = false;
  previewPane?.setAttribute("aria-busy", "true");
  if (opts.eager || alreadyVisible) {
    revealRenderLoading();
    return;
  }
  renderLoading.classList.remove("is-visible");
  renderLoading.setAttribute("aria-hidden", "true");
  renderLoadingTimer = window.setTimeout(() => {
    renderLoadingTimer = 0;
    revealRenderLoading();
  }, RENDER_LOADING_DELAY_MS);
}

/** Make the armed loading overlay visible (idempotent). */
function revealRenderLoading() {
  if (!(renderLoading instanceof HTMLElement) || renderLoading.hidden) return;
  renderLoading.classList.add("is-visible");
  renderLoading.setAttribute("aria-hidden", "false");
}

function endRenderLoading() {
  window.clearTimeout(renderLoadingTimer);
  renderLoadingTimer = 0;
  if (!(renderLoading instanceof HTMLElement)) return;
  renderLoading.classList.remove("is-visible");
  renderLoading.hidden = true;
  renderLoading.setAttribute("aria-hidden", "true");
  previewPane?.removeAttribute("aria-busy");
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
  if (currentGistFile?.gistId && currentGistFile?.filename) {
    return `gist:${currentGistFile.gistId}:${currentGistFile.filename}`;
  }
  if (currentDriveFile?.id) return `drive:${currentDriveFile.id}`;
  if (currentFilePath) return `path:${currentFilePath}`;
  if (currentFileName) return `name:${currentFileName}`;
  return "untitled";
}

/** @param {string} gistId @param {string} filename */
function gistEntryId(gistId, filename) {
  return `${gistId}\0${filename}`;
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
  const desiredSwUrl = new URL(resolveServiceWorkerUrl(), window.location.href).href;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (waitingForUpdateReload) window.location.reload();
  });

  const activateWaiting = (worker) => {
    if (!worker) return;
    waitingForUpdateReload = true;
    worker.postMessage("SKIP_WAITING");
  };

  const watchRegistration = (registration) => {
    const offerUpdate = (worker) => {
      if (!worker) return;
      const activeUrl = registration.active?.scriptURL || "";
      // Hashed → stable sw.js (or any script-URL change): activate immediately so
      // users are not stuck on a deleted sw.<hash>.js with only a tiny toast.
      if (activeUrl && activeUrl !== desiredSwUrl) {
        activateWaiting(worker);
        return;
      }
      if (!updateToast || !navigator.serviceWorker.controller) return;
      updateToast.hidden = false;
      updateReloadBtn.onclick = () => activateWaiting(worker);
    };

    if (registration.waiting) offerUpdate(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") offerUpdate(worker);
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
    .catch((err) => {
      console.warn("Service worker registration failed:", err);
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

async function renderMarkdown(source) {
  if (contentIsExternal) {
    clearUntrustedPreview();
    return;
  }
  if (speechActive) stopSpeaking();

  const gen = ++paintGen;
  const large = (source || "").length >= RENDER_LOADING_EAGER_CHARS;

  // Editor first: finish highlight and let it paint before any preview spinner.
  if (editorHighlightRaf) {
    cancelAnimationFrame(editorHighlightRaf);
    editorHighlightRaf = 0;
  }
  updateEditorHighlight();
  await yieldToPaint();
  if (gen !== paintGen) return;

  // Large sync preview work blocks timers, so reveal the spinner before parse
  // (after the editor is already on screen). Smaller docs keep the 700ms delay.
  if (large) {
    // Clear the previous document so it is not visible under the spinner.
    clearPreviewContent();
    beginRenderLoading({ eager: true });
    await yieldToPaint();
    if (gen !== paintGen) return;
  } else {
    beginRenderLoading();
  }

  // Load missing fence grammars in the background; re-render once they arrive.
  void ensureHljsLanguagesForSource(source).then((loadedAny) => {
    if (!loadedAny || contentIsExternal) return;
    if (getMarkdownSource() !== source) return;
    void renderMarkdown(source).then(() => scheduleEditorHighlight());
  });

  try {
    paintMarkdown(source, gen);
  } catch (err) {
    if (gen === paintGen) endRenderLoading();
    throw err;
  }
}

/**
 * @param {string} source
 * @param {number} [gen]
 */
function paintMarkdown(source, gen = paintGen) {
  const raw = marked.parse(source || "", { async: false });
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ["data-source-line", "data-source-line-end"],
    // Block phishing chrome (fake login forms) in the preview.
    FORBID_TAGS: [
      "form",
      "input",
      "button",
      "select",
      "textarea",
      "option",
      "optgroup",
      "fieldset",
      "legend",
    ],
  });

  if (gen !== paintGen) return;

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (gen !== paintGen) return;
    // Reuse unchanged Mermaid SVGs so typing below diagrams does not wipe and
    // re-paint them (that collapse was hiding newly added preview text).
    const mermaidReuse = takeMermaidRenderReuse();
    mermaidGen += 1;
    preview.innerHTML = clean;
    restoreMermaidRenders(mermaidReuse);
    addCodeLineNumbers(preview);
    enhanceSectionToggles();
    if (isSlideNavView()) {
      buildPresentSections();
      showPresentSection(presentIndex);
    }
    invalidateScrollAnchors();
    updateDocOutline();
    // Hold the editor as sync driver through any async Mermaid pass so reverse
    // sync cannot yank the textarea while preview height is still settling.
    beginSyncDriver("editor");
    syncPreviewFromEditor();
    revealPreviewForEditorCaret();
    if (gen === paintGen) endRenderLoading();
    renderMermaidDiagrams().finally(() => {
      if (gen !== paintGen) return;
      enhanceSectionToggles();
      if (isSlideNavView()) {
        buildPresentSections();
        showPresentSection(presentIndex);
      }
      invalidateScrollAnchors();
      beginSyncDriver("editor");
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
  overflowBtn.setAttribute("aria-label", "Close more");
}

function closeOverflowMenu() {
  toolbarMenu.classList.remove("is-open");
  overflowBtn.setAttribute("aria-expanded", "false");
  overflowBtn.setAttribute("aria-label", "More");
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

/** Desktop: #toolbar-bar in the header row. Narrow: first child of the overflow panel. */
function syncToolbarBarPlacement() {
  if (!toolbarBar || !toolbarActions || !toolbarMenu) return;
  const narrow = window.matchMedia(NARROW_MQ).matches;
  if (narrow) {
    if (toolbarBar.parentElement !== toolbarActions) {
      toolbarActions.insertBefore(toolbarBar, toolbarActions.firstChild);
    }
  } else if (toolbarBar.parentElement === toolbarActions) {
    toolbarMenu.insertBefore(toolbarBar, toolbarActions);
  }
}

/** Close the topmost open menu/drawer. Returns true if something was dismissed. */
function dismissOpenOverlay() {
  if (mermaidZoomDialog?.open) {
    closeMermaidZoom();
    return true;
  }
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
  syncZenTheme(next === "zen");
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next);
    } catch {
      /* storage may be unavailable */
    }
  }
}

/** Desired Zen backdrop state — guards against theme flips during import. */
let zenThemeWanted = false;
/** @type {null | ((e: Event) => void)} */
let zenTypingListener = null;
let zenTypingLastMs = 0;

function detachZenTypingRipples() {
  if (!zenTypingListener) return;
  editor.removeEventListener("input", zenTypingListener);
  zenTypingListener = null;
}

function attachZenTypingRipples(mod) {
  detachZenTypingRipples();
  if (prefersReducedMotion()) return;
  zenTypingListener = () => {
    const now = performance.now();
    if (now - zenTypingLastMs < 100) return;
    zenTypingLastMs = now;
    const len = Math.max(1, editor.value.length);
    const x = Math.min(1, Math.max(0, editor.selectionStart / len));
    const y = 0.35 + Math.random() * 0.3;
    mod.addZenRipple({ x, y, strength: 0.16 });
  };
  editor.addEventListener("input", zenTypingListener);
}

async function syncZenTheme(active) {
  zenThemeWanted = active;
  if (!active) {
    detachZenTypingRipples();
    if (zenModulePromise) {
      try {
        const mod = await zenModulePromise;
        mod.stopZenBackdrop();
      } catch {
        /* module load failed; nothing to stop */
      }
    }
    return;
  }
  try {
    // Stylesheet + WebGL chunk load only when Zen is unlocked.
    const [, mod] = await Promise.all([loadZenCss(), loadZenModule()]);
    if (!zenThemeWanted) {
      mod.stopZenBackdrop();
      detachZenTypingRipples();
      return;
    }
    mod.startZenBackdrop({ reducedMotion: prefersReducedMotion() });
    attachZenTypingRipples(mod);
  } catch {
    /* CSS / WebGL unavailable — fall back to whatever tokens are present */
  }
}

/** Secret unlock: 7 rapid clicks on the brand title. */
let zenBrandClicks = 0;
let zenBrandClickTimer = 0;

function setupZenBrandUnlock() {
  const brand = document.querySelector(".brand");
  if (!brand) return;
  brand.addEventListener("click", () => {
    if (document.documentElement.dataset.theme === "zen") return;
    window.clearTimeout(zenBrandClickTimer);
    zenBrandClicks += 1;
    zenBrandClickTimer = window.setTimeout(() => {
      zenBrandClicks = 0;
    }, 2000);
    if (zenBrandClicks < 7) return;
    zenBrandClicks = 0;
    setTheme("zen");
    showToast("Zen");
  });
}

function setPreviewWidth(width, { persist = true } = {}) {
  const next = WIDTHS.includes(width) ? width : "readable";
  const changed = preview.dataset.width !== next;
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
  // Fluid Mermaid diagrams (gantt) need a width sync / possible re-layout.
  if (changed) scheduleMermaidScale();
}

/**
 * @param {string} look
 * @param {{ persist?: boolean, rerender?: boolean }} [opts]
 */
function setMermaidLook(look, { persist = true, rerender = true } = {}) {
  const next = MERMAID_LOOKS.includes(look) ? look : "classic";
  const changed = mermaidLook !== next;
  mermaidLook = /** @type {"classic" | "handDrawn"} */ (next);
  document.documentElement.dataset.mermaidLook = next;
  if (mermaidLookSelect) mermaidLookSelect.value = next;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.mermaidLook, next);
    } catch {
      /* storage may be unavailable */
    }
  }
  if (changed && rerender) {
    void (async () => {
      if (next === "handDrawn") await ensureExcalifontLoaded();
      await rerenderAllMermaidDiagrams();
    })();
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
  if (!aiProofEditor || !aiProofHighlight || !aiProofHighlightCode) return;
  aiProofHighlightCode.style.transform = `translate(${-aiProofEditor.scrollLeft}px, ${-aiProofEditor.scrollTop}px)`;
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
  // Preview height is mid-flight while Mermaid paints; mapping back into the
  // editor causes the up/down jitter seen when typing at the end of diagram-heavy docs.
  if (mermaidPreviewUnsettled()) return;
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
 * Whether `el` needs scrolling into `pane` (nearest semantics). Tall Mermaid
 * blocks taller than the pane are treated as in-view when they intersect it —
 * requiring the whole block to fit caused endless top/bottom thrash.
 * @param {Element} el
 * @param {HTMLElement} pane
 */
function previewElementNeedsReveal(el, pane) {
  const paneRect = pane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const pad = 8;
  const viewTop = paneRect.top + pad;
  const viewBottom = paneRect.bottom - pad;
  if (elRect.bottom <= viewTop || elRect.top >= viewBottom) return true;
  // Fully visible.
  if (elRect.top >= viewTop && elRect.bottom <= viewBottom) return false;
  // Oversized but intersecting — leave the current scroll alone.
  if (elRect.height > pane.clientHeight - pad * 2) return false;
  // Partially clipped smaller block — nudge into view.
  return true;
}

/**
 * Scroll `pane` so `el` is visible with nearest-edge alignment.
 * @param {HTMLElement} el
 * @param {HTMLElement} pane
 */
function revealPreviewElement(el, pane) {
  const paneRect = pane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const pad = 8;
  const top = offsetWithin(el, pane);
  if (elRect.bottom > paneRect.bottom - pad) {
    clampScrollTop(pane, top + el.offsetHeight - pane.clientHeight + pad);
  } else {
    clampScrollTop(pane, top - pad);
  }
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
  if (!previewElementNeedsReveal(el, previewPane)) return;

  beginSyncDriver("editor");
  revealPreviewElement(el, previewPane);
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
  if (!previewElementNeedsReveal(el, previewPane)) return;

  revealPreviewElement(el, previewPane);
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
  const base = "Markdown Editor";
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
  currentDriveFile = null;
  currentGistFile = null;
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
  currentDriveFile = null;
  currentGistFile = null;
  currentFileHandle = fileHandle;
  currentFileName = name || fileHandle?.name || "";
  currentFilePath = path || pathForHandle(fileHandle) || "";
  // Do not reload savedSnapshot here — open/create paths set the editor first and
  // markClean afterward. Restoring a stale snap made rapid switches (and disconnect)
  // look dirty via the same confirmDiscardIfDirty() check.
  updateDocumentTitle();
  updateSaveButton();
  highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/**
 * @param {{ id: string, name: string, mimeType?: string }} file
 */
function bindCurrentDriveFile(file) {
  currentFileHandle = null;
  currentFilePath = "";
  currentGistFile = null;
  currentDriveFile = { id: file.id, name: file.name, mimeType: file.mimeType };
  currentFileName = file.name || "";
  updateDocumentTitle();
  updateSaveButton();
  highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/**
 * @param {{ gistId: string, filename: string }} file
 */
function bindCurrentGistFile(file) {
  currentFileHandle = null;
  currentFilePath = "";
  currentDriveFile = null;
  currentGistFile = { gistId: file.gistId, filename: file.filename };
  currentFileName = file.filename || "";
  updateDocumentTitle();
  updateSaveButton();
  highlightActiveFileInTree();
  persistCurrentFileBinding();
}

/** True after we have prompted for notification permission for Dock badging. */
let appBadgePermissionPrompted = false;

/** Apple platforms tie installed-app icon badges to notification permission. */
function appBadgeNeedsNotificationPermission() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

/**
 * On macOS/iOS, setAppBadge succeeds without permission but the Dock / home-screen
 * badge stays hidden. Ask once from the installed PWA when edits become unsaved.
 */
async function ensureAppBadgePermission() {
  if (!appBadgeNeedsNotificationPermission()) return;
  if (!isStandaloneDisplay()) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  if (appBadgePermissionPrompted) return;
  appBadgePermissionPrompted = true;
  try {
    showToast("Allow notifications to badge the app icon when unsaved");
    await Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

/** Show a generic OS app-icon flag when there are unsaved edits (installed PWA). */
function updateUnsavedAppBadge(dirty = isDirty()) {
  if (!("setAppBadge" in navigator) || !("clearAppBadge" in navigator)) return;
  try {
    if (dirty) {
      // Request permission first on Apple platforms (may be a no-op), then flag badge.
      void ensureAppBadgePermission()
        .then(() => navigator.setAppBadge())
        .catch(() => {});
    } else {
      void navigator.clearAppBadge().catch(() => {});
    }
  } catch {
    /* NotAllowedError / InvalidStateError — ignore */
  }
}

/** @type {{ link: HTMLLinkElement, href: string }[] | null} */
let faviconCleanEntries = null;
/** @type {boolean | null} */
let faviconDirtyApplied = null;
/** @type {string | null} */
let faviconDirtyHref = null;
let faviconDirtyGen = 0;

function faviconIconLinks() {
  return [...document.querySelectorAll('link[rel="icon"]')];
}

function captureCleanFavicons() {
  if (faviconCleanEntries) return;
  faviconCleanEntries = faviconIconLinks().map((link) => ({
    link,
    href: link.getAttribute("href") || link.href,
  }));
}

function applyFaviconHref(href) {
  for (const { link } of faviconCleanEntries || []) {
    link.href = href;
  }
}

function restoreCleanFavicons() {
  for (const { link, href } of faviconCleanEntries || []) {
    link.href = href;
  }
}

/** Composite a corner badge onto the tab favicon while the document is unsaved. */
function updateUnsavedFavicon(dirty = isDirty()) {
  if (faviconDirtyApplied === dirty) return;
  faviconDirtyApplied = dirty;
  captureCleanFavicons();
  if (!faviconCleanEntries?.length) return;

  if (!dirty) {
    faviconDirtyGen += 1;
    restoreCleanFavicons();
    return;
  }

  if (faviconDirtyHref) {
    applyFaviconHref(faviconDirtyHref);
    return;
  }

  const gen = ++faviconDirtyGen;
  const sourceHref = faviconCleanEntries[0].href;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    if (gen !== faviconDirtyGen || !faviconDirtyApplied) return;
    try {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const radius = size * 0.18;
      const cx = size - radius - size * 0.06;
      const cy = radius + size * 0.06;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#f85149";
      ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.05);
      ctx.strokeStyle = "#0d1117";
      ctx.stroke();
      faviconDirtyHref = canvas.toDataURL("image/png");
      applyFaviconHref(faviconDirtyHref);
    } catch {
      /* canvas taint / missing 2d — leave clean favicon */
    }
  };
  img.onerror = () => {
    /* keep clean favicon */
  };
  img.src = sourceHref;
}

function canSaveDocument() {
  return (
    fsAccessSupported ||
    Boolean(currentDriveFile) ||
    Boolean(currentGistFile) ||
    driveConfigured ||
    gistConfigured
  );
}

function updateSaveButton() {
  const dirty = isDirty();
  updateUnsavedAppBadge(dirty);
  updateUnsavedFavicon(dirty);
  if (!saveBtn || !canSaveDocument()) return;
  saveBtn.classList.toggle("is-dirty", dirty);
  saveBtn.title = dirty
    ? `Save unsaved changes (Ctrl/Cmd+S)`
    : currentFileName
      ? `Save ${currentFileName} (Ctrl/Cmd+S)`
      : "Save (Ctrl/Cmd+S)";
}

function filesDrawerToggleNoun() {
  return fsAccessSupported || driveConfigured || gistConfigured ? "Files" : "Outline";
}

function syncFilesToggleLabel() {
  if (!filesToggleBtn) return;
  const label = `${filesDrawerOpen ? "Hide" : "Show"} ${filesDrawerToggleNoun()}`;
  filesToggleBtn.title = label;
  filesToggleBtn.setAttribute("aria-label", label);
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
  syncFilesToggleLabel();
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

/**
 * @param {number} x
 * @param {number} y
 * @param {{ id?: string, kind: "file"|"directory" }} target
 */
function openFilesContextMenu(x, y, target) {
  if (!filesContextMenu) return;
  const id = target.id || "";
  contextTarget = { id, kind: target.kind };
  const newFileItem = filesContextMenu.querySelector('[data-fs-action="new-file"]');
  const newFolderItem = filesContextMenu.querySelector('[data-fs-action="new-folder"]');
  const renameItem = filesContextMenu.querySelector('[data-fs-action="rename"]');
  const deleteItem = filesContextMenu.querySelector('[data-fs-action="delete"]');
  const gistMode = isGistFilesSource();
  // Gists are flat: empty-area creates a new private gist; no folders/rename.
  const showCreate = gistMode ? !id : target.kind === "directory";
  const showNewFolder = showCreate && !gistMode;
  const canMutate = Boolean(id);
  const canRename = canMutate && !gistMode;
  if (newFileItem?.parentElement) newFileItem.parentElement.hidden = !showCreate;
  if (newFolderItem?.parentElement) newFolderItem.parentElement.hidden = !showNewFolder;
  if (renameItem?.parentElement) renameItem.parentElement.hidden = !canRename;
  if (deleteItem?.parentElement) deleteItem.parentElement.hidden = !canMutate;

  filesContextMenu.hidden = false;
  const rect = filesContextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  filesContextMenu.style.left = `${Math.max(8, left)}px`;
  filesContextMenu.style.top = `${Math.max(8, top)}px`;
}

function isDriveFilesSource() {
  return driveConfigured && filesSource === "drive";
}

function isGistFilesSource() {
  return gistConfigured && filesSource === "gist";
}

function isCloudFilesSource() {
  return isDriveFilesSource() || isGistFilesSource();
}

/** @returns {Promise<void>} */
async function refreshActiveFilesTree() {
  if (isDriveFilesSource()) await refreshDriveTree();
  else if (isGistFilesSource()) await refreshGistTree();
  else await refreshFilesTree();
}

/**
 * @param {Element} row
 * @returns {string}
 */
function filesEntryIdFromRow(row) {
  return (
    row.getAttribute("data-gist-id") ||
    row.getAttribute("data-drive-id") ||
    row.getAttribute("data-path") ||
    ""
  );
}

/**
 * @param {string} id
 * @returns {{ id: string, name: string, kind: "file"|"directory" } | null}
 */
function getActiveTreeEntry(id) {
  if (!id && isGistFilesSource()) {
    return { id: "", name: "Gists", kind: "directory" };
  }
  if (!id && !isDriveFilesSource()) {
    return rootDirHandle ? { id: "", name: rootDirHandle.name, kind: "directory" } : null;
  }
  if (isGistFilesSource()) {
    const entry = gistEntries.get(id);
    return entry ? { id: entry.id, name: entry.name, kind: "file" } : null;
  }
  if (isDriveFilesSource()) {
    const entry = driveEntries.get(id);
    return entry ? { id: entry.id, name: entry.name, kind: entry.kind } : null;
  }
  const entry = fsEntries.get(id);
  return entry ? { id, name: entry.handle.name, kind: entry.kind } : null;
}

/**
 * Shared tree row DOM for Local, Drive, and Gist listings.
 * @param {{
 *   id: string,
 *   kind: "file"|"directory",
 *   name: string,
 *   idAttr?: "path"|"driveId"|"gistId",
 *   twistieText?: string,
 *   twistieSpacer?: boolean,
 *   rowClass?: string,
 *   action?: string,
 * }} opts
 */
function createFilesTreeItem(opts) {
  const idAttr =
    opts.idAttr ||
    (isGistFilesSource() ? "gistId" : isDriveFilesSource() ? "driveId" : "path");
  const li = document.createElement("li");
  li.className = "files-tree-item";
  li.setAttribute("role", "treeitem");
  li.dataset.kind = opts.kind;
  if (idAttr === "driveId") li.dataset.driveId = opts.id;
  else if (idAttr === "gistId") li.dataset.gistId = opts.id;
  else li.dataset.path = opts.id;

  const row = document.createElement("button");
  row.type = "button";
  row.className = `files-tree-row${opts.rowClass ? ` ${opts.rowClass}` : ""}`;
  row.dataset.kind = opts.kind;
  if (idAttr === "driveId") row.dataset.driveId = opts.id;
  else if (idAttr === "gistId") row.dataset.gistId = opts.id;
  else row.dataset.path = opts.id;
  if (opts.action) row.dataset.driveAction = opts.action;

  const twistie = document.createElement("span");
  twistie.className = "files-tree-twistie";
  if (opts.twistieSpacer) {
    twistie.classList.add("is-spacer");
    twistie.textContent = opts.twistieText || "•";
  } else {
    twistie.textContent = opts.twistieText || (opts.kind === "directory" ? "▶" : "");
  }

  const label = document.createElement("span");
  label.className = "files-tree-label";
  label.textContent = opts.name;

  row.append(twistie, label);
  li.append(row);
  return { li, row, twistie };
}

/**
 * @param {string} rawName
 * @param {"file"|"directory"} kind
 * @returns {string | null} final name, or null if invalid/cancelled upstream
 */
function normalizeEntryName(rawName, kind) {
  const newName = String(rawName).trim();
  if (!newName) return null;
  if (kind === "file") {
    if (!isEditableFileName(ensureEditableExtension(newName))) return null;
    return ensureEditableExtension(newName);
  }
  return newName;
}

function isBrowserOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Log-out (door + arrow) icon for the Drive disconnect control. */
const DRIVE_DISCONNECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></svg>`;

/** Cloud + inbound arrow icon for the Drive connect control. */
const DRIVE_CONNECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5.609 8A6.65 8.05 0 0 1 17.025 10.95h1.7a4.275 5.175 0 1 1 0 10.35H10.65A6.65 8.05 0 0 1 7.759 20.5" /><path d="M2 15h10" /><path d="m9 18 3-3-3-3" /></svg>`;

function updateFilesChrome() {
  const driveMode = isDriveFilesSource();
  const gistMode = isGistFilesSource();
  const cloudMode = driveMode || gistMode;
  const hasLocalRoot = Boolean(rootDirHandle) && !awaitingFsPermission;
  const hasDriveRoot = driveConnected;
  const hasGistRoot = gistConnected;
  const hasRoot = driveMode ? hasDriveRoot : gistMode ? hasGistRoot : hasLocalRoot;
  const online = isBrowserOnline();
  const needsOnlineToConnect =
    (driveConfigured && driveMode && !hasDriveRoot && !online) ||
    (gistConfigured && gistMode && !hasGistRoot && !online);
  const cloudLoading = (driveMode && driveFilesLoading) || (gistMode && gistFilesLoading);

  document.body.classList.toggle("files-source-drive", driveMode);
  document.body.classList.toggle("files-source-gist", gistMode);
  document.body.classList.toggle("files-source-local", !cloudMode);

  if (filesSourceLocalBtn) {
    filesSourceLocalBtn.classList.toggle("is-active", !cloudMode);
    filesSourceLocalBtn.setAttribute("aria-pressed", !cloudMode ? "true" : "false");
  }
  if (filesSourceDriveBtn) {
    filesSourceDriveBtn.classList.toggle("is-active", driveMode);
    filesSourceDriveBtn.setAttribute("aria-pressed", driveMode ? "true" : "false");
  }
  if (filesSourceGistBtn) {
    filesSourceGistBtn.classList.toggle("is-active", gistMode);
    filesSourceGistBtn.setAttribute("aria-pressed", gistMode ? "true" : "false");
  }

  if (filesDrawerTitle) {
    if (gistMode) {
      filesDrawerTitle.textContent = gistConnected ? "Gists" : "GitHub Gist";
      filesDrawerTitle.title = filesDrawerTitle.textContent;
    } else if (driveMode) {
      filesDrawerTitle.textContent = driveConnected ? drivePathLabel() : "Google Drive";
      filesDrawerTitle.title = driveConnected ? drivePathLabel() : "Google Drive";
    } else {
      filesDrawerTitle.textContent = rootDirHandle ? `/${rootDirHandle.name}` : "Files";
      if (rootDirHandle) filesDrawerTitle.title = `/${rootDirHandle.name}`;
      else filesDrawerTitle.removeAttribute("title");
    }
  }

  if (filesEmptyCopy) {
    if (!cloudMode) {
      filesEmptyCopy.textContent = gistConfigured
        ? "Open a folder, or switch to Gist above to connect GitHub."
        : "Open a folder to browse Markdown, text, and HTML files.";
    } else if (gistMode) {
      filesEmptyCopy.textContent = needsOnlineToConnect
        ? "You need to be online to connect GitHub Gist."
        : "Connect with a GitHub personal access token to browse your gists.";
    } else if (needsOnlineToConnect) {
      filesEmptyCopy.textContent = "You need to be online to connect Google Drive.";
    } else {
      filesEmptyCopy.textContent = `Connect Google Drive to browse the ${DRIVE_ROOT_UI_NAME} folder.`;
    }
  }

  if (filesLoadingCopy) {
    filesLoadingCopy.textContent = gistMode ? "Loading Gists…" : "Loading Google Drive…";
  }
  if (filesLoading) {
    filesLoading.hidden = !cloudLoading;
  }
  if (filesEmpty) {
    filesEmpty.hidden =
      cloudLoading ||
      (driveMode
        ? hasDriveRoot
        : gistMode
          ? hasGistRoot
          : hasLocalRoot || awaitingFsPermission);
  }
  if (filesPermission) {
    filesPermission.hidden = cloudMode || !awaitingFsPermission;
  }
  if (filesTree) filesTree.hidden = cloudLoading || !hasRoot;
  if (filesNewFileBtn) filesNewFileBtn.disabled = false;
  if (filesNewFolderBtn) {
    filesNewFolderBtn.disabled = gistMode
      ? true
      : driveMode
        ? !hasDriveRoot
        : !hasLocalRoot;
  }
  if (filesRefreshBtn) {
    filesRefreshBtn.disabled = driveMode
      ? !hasDriveRoot
      : gistMode
        ? !hasGistRoot
        : !hasLocalRoot;
  }
  if (filesConnectDriveBtn) {
    filesConnectDriveBtn.hidden =
      !driveConfigured || !driveMode || (needsOnlineToConnect && driveMode && !hasDriveRoot);
    if (hasDriveRoot) {
      filesConnectDriveBtn.classList.add("svg-btn");
      filesConnectDriveBtn.innerHTML = DRIVE_DISCONNECT_ICON;
      filesConnectDriveBtn.title = "Disconnect Google Drive and\nclear your saved sign-in";
      filesConnectDriveBtn.setAttribute("aria-label", "Disconnect");
    } else if (hasSealedDriveSession()) {
      filesConnectDriveBtn.classList.remove("svg-btn");
      filesConnectDriveBtn.textContent = "Unlock Drive";
      filesConnectDriveBtn.title =
        "Use your passkey to restore\nyour saved Google Drive sign-in";
      filesConnectDriveBtn.setAttribute("aria-label", "Unlock Drive");
    } else {
      filesConnectDriveBtn.classList.add("svg-btn");
      filesConnectDriveBtn.innerHTML = DRIVE_CONNECT_ICON;
      filesConnectDriveBtn.title = "Connect Google Drive";
      filesConnectDriveBtn.setAttribute("aria-label", "Connect Drive");
    }
  }
  if (filesConnectGistBtn) {
    const gistOfflineBlock = gistMode && !hasGistRoot && !online;
    filesConnectGistBtn.hidden = !gistConfigured || !gistMode || gistOfflineBlock;
    if (hasGistRoot) {
      filesConnectGistBtn.classList.add("svg-btn");
      filesConnectGistBtn.innerHTML = DRIVE_DISCONNECT_ICON;
      filesConnectGistBtn.title = "Disconnect GitHub Gist and\nclear your saved token";
      filesConnectGistBtn.setAttribute("aria-label", "Disconnect Gist");
    } else if (hasSealedGistSession()) {
      filesConnectGistBtn.classList.remove("svg-btn");
      filesConnectGistBtn.textContent = "Unlock Gist";
      filesConnectGistBtn.title = "Use your passkey to restore\nyour saved GitHub Gist token";
      filesConnectGistBtn.setAttribute("aria-label", "Unlock Gist");
    } else {
      filesConnectGistBtn.classList.add("svg-btn");
      filesConnectGistBtn.innerHTML = DRIVE_CONNECT_ICON;
      filesConnectGistBtn.title = "Connect GitHub Gist";
      filesConnectGistBtn.setAttribute("aria-label", "Connect Gist");
    }
  }
  if (filesDriveOfflineHint) {
    filesDriveOfflineHint.hidden = !needsOnlineToConnect;
  }
  if (filesEmptyConnectBtn) {
    filesEmptyConnectBtn.hidden =
      !driveConfigured || !driveMode || hasDriveRoot || needsOnlineToConnect;
  }
  if (filesEmptyConnectGistBtn) {
    filesEmptyConnectGistBtn.hidden =
      !gistConfigured || !gistMode || hasGistRoot || needsOnlineToConnect;
  }
  if (filesEmptyOpenBtn) {
    filesEmptyOpenBtn.hidden = cloudMode;
  }
  if (filesOpenFolderBtn) {
    filesOpenFolderBtn.hidden = cloudMode || !fsAccessSupported;
  }
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
  if (isGistFilesSource() && currentGistFile?.gistId) {
    const id = gistEntryId(currentGistFile.gistId, currentGistFile.filename);
    const row = filesTree?.querySelector(
      `.files-tree-row[data-gist-id="${cssEscape(id)}"]`,
    );
    row?.classList.add("is-active-file");
    return;
  }
  if (isDriveFilesSource() && currentDriveFile?.id) {
    const row = filesTree?.querySelector(
      `.files-tree-row[data-drive-id="${cssEscape(currentDriveFile.id)}"]`,
    );
    row?.classList.add("is-active-file");
    return;
  }
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

async function ensureDriveNavRoot(token) {
  const rootId = await ensureDriveAppFolder(token);
  if (!driveNavStack.length || driveNavStack[0].id !== rootId) {
    driveNavStack = [{ id: rootId, name: DRIVE_ROOT_UI_NAME }];
  } else {
    driveNavStack[0] = { id: rootId, name: DRIVE_ROOT_UI_NAME };
  }
  return rootId;
}

async function renderDriveTree() {
  if (!filesTree) return;
  driveEntries.clear();

  const token = getDriveAccessToken();
  if (!token) return;

  await ensureDriveNavRoot(token);
  const folderId = driveCurrentFolderId();
  const { entries } = await listDriveFolderChildren(token, folderId);

  // Re-check after awaits: local restore must not leave a half-painted shared tree.
  if (!isDriveFilesSource() || !driveConnected) return;
  filesTree.replaceChildren();

  if (driveNavStack.length > 1) {
    const { li } = createFilesTreeItem({
      id: "",
      kind: "directory",
      name: `.. (${driveNavStack[driveNavStack.length - 2].name})`,
      idAttr: "driveId",
      twistieText: "◀",
      rowClass: "files-tree-up",
      action: "up",
    });
    filesTree.append(li);
  }

  for (const entry of entries) {
    driveEntries.set(entry.id, entry);
    const { li } = createFilesTreeItem({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      idAttr: "driveId",
      twistieText: entry.kind === "directory" ? "▶" : "",
    });
    filesTree.append(li);
  }

  if (filesDrawerTitle && isDriveFilesSource() && driveConnected) {
    filesDrawerTitle.textContent = drivePathLabel();
    filesDrawerTitle.title = drivePathLabel();
  }
  highlightActiveFileInTree();
}

async function enterDriveFolder(folderId) {
  const entry = driveEntries.get(folderId);
  if (!entry || entry.kind !== "directory") return;
  driveNavStack.push({ id: entry.id, name: entry.name });
  await refreshDriveTree();
}

async function leaveDriveFolder() {
  if (driveNavStack.length <= 1) return;
  driveNavStack.pop();
  await refreshDriveTree();
}

/**
 * @param {{ id?: string, kind?: string } | null} [target]
 * @returns {Promise<string>}
 */
async function resolveDriveCreateParentId(target = null) {
  if (target?.kind === "directory" && target.id) {
    if (target.id !== driveCurrentFolderId()) {
      const entry = driveEntries.get(target.id);
      if (entry?.kind === "directory") {
        driveNavStack.push({ id: entry.id, name: entry.name });
      }
    }
    return target.id;
  }
  return driveCurrentFolderId() || (await ensureDriveAppFolder(await ensureDriveAccessToken()));
}

function beginDriveFilesLoading() {
  driveFilesLoading = true;
  if (filesTree) {
    filesTree.replaceChildren();
    filesTree.hidden = true;
  }
  updateFilesChrome();
}

function endDriveFilesLoading() {
  driveFilesLoading = false;
  updateFilesChrome();
}

async function refreshDriveTree() {
  if (!isDriveFilesSource() || !driveConnected) return;
  beginDriveFilesLoading();
  try {
    await renderDriveTree();
  } catch (err) {
    console.error(err);
    if (err?.status === 401 || /401|auth|token/i.test(String(err?.message || ""))) {
      clearDriveAccessToken();
      driveConnected = false;
      driveNavStack = [];
      driveEntries.clear();
      showToast("Google Drive session expired — connect again");
      return;
    }
    showToast(err?.message || "Could not refresh Drive");
  } finally {
    endDriveFilesLoading();
  }
}

async function connectGoogleDrive() {
  if (!driveConfigured) return;
  if (!isBrowserOnline()) {
    updateFilesChrome();
    showToast("You need to be online to connect Google Drive");
    return;
  }
  try {
    await ensureDriveAccessToken();
    driveConnected = true;
    filesSource = "drive";
    try {
      localStorage.setItem(STORAGE_KEYS.filesSource, "drive");
    } catch {
      /* ignore */
    }
    beginDriveFilesLoading();
    try {
      await renderDriveTree();
    } finally {
      endDriveFilesLoading();
    }
    if (isDriveSessionMemoryOnly()) {
      showToast(
        `Connected — ${DRIVE_ROOT_UI_NAME} (session won’t survive refresh or closing this tab)`,
      );
    } else {
      showToast(`Connected — ${DRIVE_ROOT_UI_NAME}`);
    }
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") return;
    console.error(err);
    driveConnected = false;
    endDriveFilesLoading();
    const offlineish =
      !isBrowserOnline() ||
      err?.name === "TypeError" ||
      /Failed to fetch|NetworkError|ERR_INTERNET/i.test(String(err?.message || ""));
    showToast(
      offlineish
        ? "You need to be online to connect Google Drive"
        : err?.message || "Could not connect Google Drive",
    );
    updateFilesChrome();
  }
}

async function disconnectGoogleDrive() {
  if (!driveConfigured) return;
  // Closing a Drive-backed doc must happen before the token is cleared so Cancel
  // leaves the session intact, and so Save cannot reconnect to an orphaned binding.
  if (currentDriveFile) {
    if (!confirmDiscardIfDirty()) return;
    openDocumentSeq += 1;
    await persistDraft(getMarkdownSource());
    setEditorValue("");
    clearCurrentFileBinding();
    await persistDraft("");
    renderMarkdown("");
    markDirtyBaseline();
    setContentExternal(false);
  }
  clearDriveAccessToken();
  driveConnected = false;
  driveFilesLoading = false;
  driveNavStack = [];
  driveEntries.clear();
  if (filesTree) {
    filesTree.replaceChildren();
    filesTree.hidden = true;
  }
  updateFilesChrome();
  showToast("Disconnected from Google Drive");
}

function beginGistFilesLoading() {
  gistFilesLoading = true;
  if (filesTree) {
    filesTree.replaceChildren();
    filesTree.hidden = true;
  }
  updateFilesChrome();
}

function endGistFilesLoading() {
  gistFilesLoading = false;
  updateFilesChrome();
}

async function renderGistTree() {
  if (!isGistFilesSource() || !gistConnected) return;
  const token = await ensureGistAccessToken();
  const gists = await listGists(token);
  gistEntries.clear();
  const frag = document.createDocumentFragment();
  for (const gist of gists) {
    const files = editableGistFiles(gist);
    for (const file of files) {
      const id = gistEntryId(gist.id, file.filename);
      const label = gist.description
        ? `${file.filename} — ${gist.description}`
        : file.filename;
      gistEntries.set(id, {
        kind: "file",
        id,
        gistId: gist.id,
        filename: file.filename,
        name: label,
        description: gist.description || "",
        isPublic: gist.public,
      });
      const { li } = createFilesTreeItem({
        id,
        kind: "file",
        name: label,
        idAttr: "gistId",
        twistieSpacer: true,
      });
      frag.append(li);
    }
  }
  if (filesTree) {
    filesTree.replaceChildren(frag);
    filesTree.hidden = false;
  }
  highlightActiveFileInTree();
  updateFilesChrome();
}

async function refreshGistTree() {
  if (!isGistFilesSource() || !gistConnected) return;
  beginGistFilesLoading();
  try {
    await renderGistTree();
  } catch (err) {
    console.error(err);
    if (err?.status === 401 || /401|auth|Bad credentials|token/i.test(String(err?.message || ""))) {
      clearGistAccessToken();
      gistConnected = false;
      gistEntries.clear();
      showToast("GitHub Gist session expired — connect again");
      return;
    }
    showToast(err?.message || "Could not refresh Gists");
  } finally {
    endGistFilesLoading();
  }
}

/**
 * @returns {Promise<string | null>} PAT or null if cancelled
 */
function promptGistPersonalAccessToken() {
  return new Promise((resolve) => {
    if (!gistPatModal || typeof gistPatModal.showModal !== "function") {
      const raw = window.prompt("GitHub personal access token (gist scope)");
      resolve(raw == null ? null : String(raw).trim() || null);
      return;
    }
    if (gistPatInput) gistPatInput.value = "";
    const onClose = () => {
      gistPatModal.removeEventListener("close", onClose);
      const value = gistPatModal.returnValue;
      if (value !== "connect") {
        resolve(null);
        return;
      }
      const token = String(gistPatInput?.value || "").trim();
      resolve(token || null);
    };
    gistPatModal.addEventListener("close", onClose);
    gistPatModal.showModal();
    gistPatInput?.focus();
  });
}

async function unlockGistAccessTokenSafe() {
  try {
    const token = await unlockGistAccessToken();
    return Boolean(token);
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") return false;
    throw err;
  }
}

async function connectGithubGist() {
  if (!gistConfigured) return;
  if (!isBrowserOnline()) {
    updateFilesChrome();
    showToast("You need to be online to connect GitHub Gist");
    return;
  }
  try {
    if (!(await tryRestoreGistAccessToken())) {
      if (hasSealedGistSession()) {
        const unlocked = await unlockGistAccessTokenSafe();
        if (!unlocked) {
          showToast("Unlock cancelled — connect again to paste a new token");
          return;
        }
      } else {
        try {
          await prepareGistTokenVault();
        } catch (err) {
          if (err?.name === "AbortError" || err?.name === "NotAllowedError") throw err;
        }
        const pat = await promptGistPersonalAccessToken();
        if (!pat) return;
        await verifyGistToken(pat);
        await setGistPersonalAccessToken(pat);
      }
    }
    await ensureGistAccessToken();
    gistConnected = true;
    filesSource = "gist";
    try {
      localStorage.setItem(STORAGE_KEYS.filesSource, "gist");
    } catch {
      /* ignore */
    }
    beginGistFilesLoading();
    try {
      await renderGistTree();
    } finally {
      endGistFilesLoading();
    }
    if (isGistSessionMemoryOnly()) {
      showToast("Connected — Gists (session won’t survive refresh or closing this tab)");
    } else {
      showToast("Connected — Gists");
    }
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "NotAllowedError") return;
    console.error(err);
    gistConnected = false;
    endGistFilesLoading();
    const offlineish =
      !isBrowserOnline() ||
      err?.name === "TypeError" ||
      /Failed to fetch|NetworkError|ERR_INTERNET/i.test(String(err?.message || ""));
    showToast(
      offlineish
        ? "You need to be online to connect GitHub Gist"
        : err?.message || "Could not connect GitHub Gist",
    );
    updateFilesChrome();
  }
}

async function disconnectGithubGist() {
  if (!gistConfigured) return;
  if (currentGistFile) {
    if (!confirmDiscardIfDirty()) return;
    openDocumentSeq += 1;
    await persistDraft(getMarkdownSource());
    setEditorValue("");
    clearCurrentFileBinding();
    await persistDraft("");
    renderMarkdown("");
    markDirtyBaseline();
    setContentExternal(false);
  }
  clearGistAccessToken();
  gistConnected = false;
  gistFilesLoading = false;
  gistEntries.clear();
  if (filesTree) {
    filesTree.replaceChildren();
    filesTree.hidden = true;
  }
  updateFilesChrome();
  showToast("Disconnected from GitHub Gist");
}

function setFilesSource(next) {
  let source = "local";
  if (next === "drive" && driveConfigured) source = "drive";
  else if (next === "gist" && gistConfigured) source = "gist";
  filesSource = source;
  try {
    localStorage.setItem(STORAGE_KEYS.filesSource, filesSource);
  } catch {
    /* ignore */
  }
  if (filesSource === "drive") {
    gistFilesLoading = false;
    if (driveConnected) {
      beginDriveFilesLoading();
      void refreshActiveFilesTree();
    } else {
      driveFilesLoading = false;
      if (filesTree) {
        filesTree.replaceChildren();
        filesTree.hidden = true;
      }
      updateFilesChrome();
    }
  } else if (filesSource === "gist") {
    driveFilesLoading = false;
    if (gistConnected) {
      beginGistFilesLoading();
      void refreshActiveFilesTree();
    } else {
      gistFilesLoading = false;
      if (filesTree) {
        filesTree.replaceChildren();
        filesTree.hidden = true;
      }
      updateFilesChrome();
    }
  } else {
    driveFilesLoading = false;
    gistFilesLoading = false;
    updateFilesChrome();
    if (rootDirHandle && !awaitingFsPermission) {
      void refreshActiveFilesTree();
    }
  }
}

/**
 * Bumped when starting a file open so a slow fetch cannot finish after a newer
 * click (which incorrectly looked like unsaved edits).
 * @type {number}
 */
let openDocumentSeq = 0;

/**
 * Shared post-load path after content is in the editor and the file is bound.
 * @param {string} name
 * @param {number} [seq]
 */
async function finishOpenDocument(name, seq = openDocumentSeq) {
  if (seq !== openDocumentSeq) return;
  await persistDraft(getMarkdownSource());
  if (seq !== openDocumentSeq) return;
  renderMarkdown(getMarkdownSource());
  await pushHistory(getMarkdownSource());
  if (seq !== openDocumentSeq) return;
  markCleanFromEditor();
  setContentExternal(false);
  highlightActiveFileInTree();
  showToast(`Loaded ${name}`);
}

async function openDriveTreeFile(fileId) {
  const entry = driveEntries.get(fileId);
  if (!entry || entry.kind !== "file") return;
  if (currentDriveFile?.id === fileId && !isDirty()) {
    highlightActiveFileInTree();
    return;
  }
  if (!confirmDiscardIfDirty()) return;
  const seq = ++openDocumentSeq;
  try {
    await persistDraft(getMarkdownSource());
    if (seq !== openDocumentSeq) return;
    const token = await ensureDriveAccessToken();
    if (seq !== openDocumentSeq) return;
    const content = await readDriveFileText(token, fileId);
    if (seq !== openDocumentSeq) return;
    setEditorValue(content);
    const fromKey = currentDocKey();
    bindCurrentDriveFile({ id: entry.id, name: entry.name, mimeType: entry.mimeType });
    const toKey = currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      moveSavedSnapshot(fromKey, toKey);
    }
    // Mark clean under the new doc key before any further awaits so the same
    // confirmDiscardIfDirty() used by switch/disconnect is not a false positive.
    markCleanFromEditor();
    await finishOpenDocument(entry.name, seq);
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (seq !== openDocumentSeq) return;
    console.error(err);
    showToast(err?.message || "Could not open Drive file");
  }
}

async function openGistTreeFile(entryId) {
  const entry = gistEntries.get(entryId);
  if (!entry || entry.kind !== "file") return;
  if (
    currentGistFile?.gistId === entry.gistId &&
    currentGistFile?.filename === entry.filename &&
    !isDirty()
  ) {
    highlightActiveFileInTree();
    return;
  }
  if (!confirmDiscardIfDirty()) return;
  const seq = ++openDocumentSeq;
  try {
    await persistDraft(getMarkdownSource());
    if (seq !== openDocumentSeq) return;
    const token = await ensureGistAccessToken();
    if (seq !== openDocumentSeq) return;
    const content = await readGistFileText(token, entry.gistId, entry.filename);
    if (seq !== openDocumentSeq) return;
    setEditorValue(content);
    const fromKey = currentDocKey();
    bindCurrentGistFile({ gistId: entry.gistId, filename: entry.filename });
    const toKey = currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      moveSavedSnapshot(fromKey, toKey);
    }
    markCleanFromEditor();
    await finishOpenDocument(entry.filename, seq);
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (seq !== openDocumentSeq) return;
    console.error(err);
    showToast(err?.message || "Could not open Gist file");
  }
}

/** Activate a tree row (open file or enter/toggle directory). */
async function activateFilesTreeEntry(id, kind) {
  if (isGistFilesSource()) {
    if (kind === "file") await openGistTreeFile(id);
    return;
  }
  if (isDriveFilesSource()) {
    if (kind === "directory") await enterDriveFolder(id);
    else await openDriveTreeFile(id);
    return;
  }
  if (kind === "directory") await toggleFsDirectory(id);
  else await openFsFile(id);
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

    const isDir = entry.kind === "directory";
    const { li } = createFilesTreeItem({
      id: childPath,
      kind: entry.kind,
      name: entry.name,
      idAttr: "path",
      twistieText: isDir ? (expandedPaths.has(childPath) ? "▼" : "▶") : "•",
      twistieSpacer: !isDir,
    });
    if (isDir) li.setAttribute("aria-expanded", "false");

    if (isDir) {
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
  // Cloud modes own the same #files-tree; do not paint local entries into it.
  if (isCloudFilesSource()) return;
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
  } else if (filesTree && !isCloudFilesSource()) {
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
  const seq = ++openDocumentSeq;
  try {
    // Persist the outgoing document under its own key before switching.
    await persistDraft(getMarkdownSource());
    if (seq !== openDocumentSeq) return;
    const text = await readTextFile(/** @type {FileSystemFileHandle} */ (entry.handle));
    if (seq !== openDocumentSeq) return;
    setEditorValue(text);
    bindCurrentFile(/** @type {FileSystemFileHandle} */ (entry.handle), entry.handle.name, path);
    selectFsPath(path);
    markCleanFromEditor();
    await finishOpenDocument(entry.handle.name, seq);
  } catch (err) {
    if (seq !== openDocumentSeq) return;
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

/**
 * @param {{ id?: string, kind?: string } | string | null} [target]
 * @returns {{ id: string, kind: "file"|"directory" } | null}
 */
function normalizeFilesTarget(target = null) {
  if (target == null) {
    if (isCloudFilesSource()) return { id: "", kind: "directory" };
    return { id: selectedPath || "", kind: "directory" };
  }
  if (typeof target === "string") return { id: target, kind: "directory" };
  return {
    id: target.id || "",
    kind: target.kind === "file" ? "file" : "directory",
  };
}

/**
 * After creating an empty document, bind it and clear the editor.
 * @param {() => void} bind
 */
async function openCreatedEmptyDocument(bind) {
  await persistDraft(getMarkdownSource());
  setEditorValue("");
  bind();
  await persistDraft("");
  renderMarkdown("");
  markCleanFromEditor();
  setContentExternal(false);
}

/**
 * @param {{ id?: string, kind?: string } | string | null} [target]
 */
async function promptCreateFile(target = null) {
  const dest = normalizeFilesTarget(target);
  const raw = window.prompt("New file name", "untitled.md");
  if (raw == null) return;
  const name = normalizeEntryName(raw, "file");
  if (!name) {
    showToast("Use a .md, .txt, or .html name");
    return;
  }

  try {
    if (isGistFilesSource()) {
      if (!gistConnected) return;
      if (!confirmDiscardIfDirty()) return;
      const token = await ensureGistAccessToken();
      const created = await createPrivateGist(token, { filename: name, content: "" });
      await openCreatedEmptyDocument(() =>
        bindCurrentGistFile({ gistId: created.id, filename: created.filename }),
      );
      await refreshActiveFilesTree();
      showToast(`Created ${name}`);
      return;
    }
    if (isDriveFilesSource()) {
      if (!driveConnected) return;
      if (!confirmDiscardIfDirty()) return;
      const parentId = await resolveDriveCreateParentId(dest);
      const file = await createDriveFileWithToken({ name, content: "", parentId });
      await openCreatedEmptyDocument(() => bindCurrentDriveFile(file));
      await refreshActiveFilesTree();
      showToast(`Created ${name}`);
      return;
    }

    const dir = getTargetDirForCreate(dest?.id ?? selectedPath);
    if (!dir) {
      showToast("Open a folder first");
      return;
    }
    const handle = await createFile(dir, name, "");
    const basePath =
      dir === rootDirHandle ? "" : ([...fsEntries.entries()].find(([, e]) => e.handle === dir)?.[0] ?? "");
    if (basePath) expandedPaths.add(basePath);
    await refreshActiveFilesTree();
    const createdPath = joinFsPath(basePath, name);
    await openCreatedEmptyDocument(() => bindCurrentFile(handle, name, createdPath));
    selectFsPath(createdPath);
    showToast(`Created ${name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast(err?.message || "Could not create file");
  }
}

/**
 * @param {{ id?: string, kind?: string } | string | null} [target]
 */
async function promptCreateFolder(target = null) {
  if (isGistFilesSource()) {
    showToast("Gists do not support folders");
    return;
  }
  const dest = normalizeFilesTarget(target);
  const raw = window.prompt("New folder name", isDriveFilesSource() ? "untitled" : "");
  if (raw == null) return;
  const name = normalizeEntryName(raw, "directory");
  if (!name) {
    showToast("Folder name required");
    return;
  }

  try {
    if (isDriveFilesSource()) {
      if (!driveConnected) return;
      const parentId = await resolveDriveCreateParentId(dest);
      await createDriveFolderWithToken(name, parentId);
      await refreshActiveFilesTree();
      showToast(`Created folder ${name}`);
      return;
    }

    const dir = getTargetDirForCreate(dest?.id ?? selectedPath);
    if (!dir) {
      showToast("Open a folder first");
      return;
    }
    await createFolder(dir, name);
    const basePath =
      dir === rootDirHandle ? "" : ([...fsEntries.entries()].find(([, e]) => e.handle === dir)?.[0] ?? "");
    if (basePath) expandedPaths.add(basePath);
    await refreshActiveFilesTree();
    showToast(`Created folder ${name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast(err?.message || "Could not create folder");
  }
}

/** @param {string} id */
async function promptRenameEntry(id) {
  const entry = getActiveTreeEntry(id);
  if (!entry) return;
  const next = window.prompt("Rename to", entry.name);
  if (next == null) return;
  const finalName = normalizeEntryName(next, entry.kind);
  if (!finalName) {
    if (entry.kind === "file") showToast("Use a .md, .txt, or .html name");
    return;
  }
  if (finalName === entry.name) return;

  try {
    if (isDriveFilesSource()) {
      const renamed = await renameDriveItemWithToken(id, finalName);
      if (currentDriveFile?.id === id) {
        const fromKey = currentDocKey();
        bindCurrentDriveFile({
          id: renamed.id,
          name: renamed.name || finalName,
          mimeType: renamed.mimeType,
        });
        const toKey = currentDocKey();
        if (fromKey !== toKey) {
          void moveDraft(fromKey, toKey);
          moveSavedSnapshot(fromKey, toKey);
        }
      }
      await refreshActiveFilesTree();
      showToast(`Renamed to ${finalName}`);
      return;
    }

    const fsEntry = fsEntries.get(id);
    if (!fsEntry || !fsEntry.parent) return;
    const wasCurrent = currentFileHandle === fsEntry.handle;
    const renamed = await renameEntry(fsEntry.parent, fsEntry.handle, finalName);
    if (id && expandedPaths.has(id)) {
      expandedPaths.delete(id);
      expandedPaths.add(joinFsPath(parentPathOf(id), finalName));
    }
    await refreshActiveFilesTree();
    if (wasCurrent) {
      const renamedPath = joinFsPath(parentPathOf(id), finalName);
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
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast(err?.message || "Could not rename");
  }
}

/** @param {string} id */
async function promptDeleteEntry(id) {
  const entry = getActiveTreeEntry(id);
  if (!entry) return;
  const label = entry.kind === "directory" ? `folder "${entry.name}"` : `"${entry.name}"`;
  const detail = isGistFilesSource()
    ? "The entire gist will be deleted on GitHub."
    : isDriveFilesSource()
      ? "It will move to Google Drive trash."
      : "This cannot be undone.";
  if (!window.confirm(`Delete ${label}? ${detail}`)) return;

  try {
    if (isGistFilesSource()) {
      const entry = gistEntries.get(id);
      if (!entry) return;
      const token = await ensureGistAccessToken();
      await deleteGist(token, entry.gistId);
      if (currentGistFile?.gistId === entry.gistId) clearCurrentFileBinding();
      await refreshActiveFilesTree();
      showToast("Deleted");
      return;
    }
    if (isDriveFilesSource()) {
      await trashDriveItemWithToken(id);
      if (currentDriveFile?.id === id) clearCurrentFileBinding();
      await refreshActiveFilesTree();
      showToast("Deleted");
      return;
    }

    const fsEntry = fsEntries.get(id);
    if (!fsEntry || !fsEntry.parent) return;
    const currentPath =
      currentFilePath || [...fsEntries.entries()].find(([, e]) => e.handle === currentFileHandle)?.[0];
    const affectsCurrent =
      Boolean(currentPath) && (currentPath === id || currentPath.startsWith(`${id}/`));
    await removeEntry(fsEntry.parent, fsEntry.handle.name, true);
    expandedPaths.delete(id);
    for (const p of [...expandedPaths]) {
      if (p.startsWith(`${id}/`)) expandedPaths.delete(p);
    }
    await refreshActiveFilesTree();
    if (affectsCurrent) clearCurrentFileBinding();
    if (selectedPath === id || selectedPath.startsWith(`${id}/`)) selectFsPath("");
    showToast("Deleted");
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast(err?.message || "Could not delete");
  }
}

async function saveCurrentDocumentToDrive() {
  if (!driveConfigured) return;
  const text = getMarkdownSource();
  try {
    if (currentDriveFile?.id) {
      await saveExistingDriveFile(currentDriveFile.id, {
        name: currentDriveFile.name || currentFileName || suggestedUntitledName(text),
        content: text,
      });
      markCleanFromEditor();
      showToast(`Saved ${currentDriveFile.name || currentFileName}`);
      void refreshDriveTree();
      return;
    }

    if (!driveConnected) {
      await connectGoogleDrive();
      if (!driveConnected) return;
    }

    const suggestedName = suggestedUntitledName(text);
    const raw = window.prompt("Save to Google Drive as", suggestedName);
    if (raw == null) return;
    const name = ensureEditableExtension(raw, text);
    const parentId =
      driveCurrentFolderId() || (await ensureDriveAppFolder(await ensureDriveAccessToken()));
    const file = await createDriveFileWithToken({ name, content: text, parentId });
    const fromKey = currentDocKey();
    bindCurrentDriveFile(file);
    const toKey = currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      moveSavedSnapshot(fromKey, toKey);
    }
    markCleanFromEditor();
    filesSource = "drive";
    try {
      localStorage.setItem(STORAGE_KEYS.filesSource, "drive");
    } catch {
      /* ignore */
    }
    await refreshDriveTree();
    updateFilesChrome();
    showToast(`Saved ${file.name}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast(err?.message || "Could not save to Google Drive");
  }
}

async function saveCurrentDocumentToGist() {
  if (!gistConfigured) return;
  const text = getMarkdownSource();
  try {
    if (currentGistFile?.gistId && currentGistFile?.filename) {
      const token = await ensureGistAccessToken();
      await updateGistFile(token, currentGistFile.gistId, currentGistFile.filename, text);
      markCleanFromEditor();
      showToast(`Saved ${currentGistFile.filename}`);
      void refreshGistTree();
      return;
    }

    if (!gistConnected) {
      await connectGithubGist();
      if (!gistConnected) return;
    }

    const suggestedName = suggestedUntitledName(text);
    const raw = window.prompt("Save as private gist filename", suggestedName);
    if (raw == null) return;
    const filename = ensureEditableExtension(raw, text);
    const token = await ensureGistAccessToken();
    const created = await createPrivateGist(token, { filename, content: text });
    const fromKey = currentDocKey();
    bindCurrentGistFile({ gistId: created.id, filename: created.filename });
    const toKey = currentDocKey();
    if (fromKey !== toKey) {
      void moveDraft(fromKey, toKey);
      moveSavedSnapshot(fromKey, toKey);
    }
    markCleanFromEditor();
    filesSource = "gist";
    try {
      localStorage.setItem(STORAGE_KEYS.filesSource, "gist");
    } catch {
      /* ignore */
    }
    await refreshGistTree();
    updateFilesChrome();
    showToast(`Saved ${created.filename}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    showToast(err?.message || "Could not save to GitHub Gist");
  }
}

async function saveCurrentDocument() {
  const text = getMarkdownSource();
  const suggestedName = suggestedUntitledName(text);
  try {
    if (currentGistFile?.gistId || isGistFilesSource()) {
      await saveCurrentDocumentToGist();
      return;
    }
    if (currentDriveFile?.id || isDriveFilesSource()) {
      await saveCurrentDocumentToDrive();
      return;
    }

    if (!fsAccessSupported) {
      if (gistConfigured) {
        await saveCurrentDocumentToGist();
      } else if (driveConfigured) {
        await saveCurrentDocumentToDrive();
      }
      return;
    }

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
    filesDrawer.classList.toggle("has-drive", driveConfigured);
    filesDrawer.classList.toggle("has-gist", gistConfigured);
    filesDrawer.setAttribute("aria-label", "Files");
  }
  if (filesBackdrop) filesBackdrop.hidden = false;
  if (filesToggleBtn) {
    filesToggleBtn.hidden = false;
    syncFilesToggleLabel();
  }

  filesToggleBtn?.addEventListener("click", () => toggleFilesDrawer());
  filesBackdrop?.addEventListener("click", () => setFilesDrawerOpen(false));
  // On narrow layouts, drag the panes left over the drawer to dismiss it.
  panes.addEventListener("pointerdown", onDrawerCloseDragPointerDown, { passive: true });
  // Non-passive so we can preventDefault once the dismiss gesture is claimed.
  panes.addEventListener("pointermove", onDrawerCloseDragPointerMove);
  panes.addEventListener("pointerup", onDrawerCloseDragPointerUp, { passive: true });
  panes.addEventListener("pointercancel", onDrawerCloseDragPointerCancel, { passive: true });

  if (driveConfigured || gistConfigured) {
    if (driveConfigured) {
      document.querySelectorAll(".drive-only").forEach((el) => {
        el.hidden = false;
      });
    }
    if (gistConfigured) {
      document.querySelectorAll(".gist-only").forEach((el) => {
        el.hidden = false;
      });
    }
    document.querySelectorAll(".cloud-only").forEach((el) => {
      el.hidden = false;
    });
    const savedSource = localStorage.getItem(STORAGE_KEYS.filesSource);
    if (savedSource === "drive" && driveConfigured) filesSource = "drive";
    else if (savedSource === "gist" && gistConfigured) filesSource = "gist";
    else if (savedSource === "local") filesSource = "local";
    // Clear legacy plaintext; boot restore is memory-only (PRF Unlock after refresh).
    if (driveConfigured) {
      purgeLegacyCleartextToken();
      driveConnected = false;
    }
    if (gistConfigured) {
      purgeLegacyGistCleartextToken();
      gistConnected = false;
    }
    filesSourceLocalBtn?.addEventListener("click", () => setFilesSource("local"));
    filesSourceDriveBtn?.addEventListener("click", () => setFilesSource("drive"));
    filesSourceGistBtn?.addEventListener("click", () => setFilesSource("gist"));
    filesConnectDriveBtn?.addEventListener("click", () => {
      if (driveConnected) void disconnectGoogleDrive();
      else void connectGoogleDrive();
    });
    filesConnectGistBtn?.addEventListener("click", () => {
      if (gistConnected) void disconnectGithubGist();
      else void connectGithubGist();
    });
    filesEmptyConnectBtn?.addEventListener("click", () => void connectGoogleDrive());
    filesEmptyConnectGistBtn?.addEventListener("click", () => void connectGithubGist());
    window.addEventListener("online", () => updateFilesChrome());
    window.addEventListener("offline", () => updateFilesChrome());
  }

  if (fsAccessSupported || driveConfigured || gistConfigured) {
    if (saveBtn) {
      saveBtn.hidden = false;
      saveBtn.addEventListener("click", () => void saveCurrentDocument());
    }
    filesNewFileBtn?.addEventListener("click", () => void createUntitledDocument());
    filesNewFolderBtn?.addEventListener("click", () => void promptCreateFolder());
    filesRefreshBtn?.addEventListener("click", () => void refreshActiveFilesTree());

    filesTree?.addEventListener("click", (e) => {
      const row = e.target.closest(".files-tree-row");
      if (!row) return;
      if (row.getAttribute("data-drive-action") === "up") {
        void leaveDriveFolder();
        return;
      }
      if (isGistFilesSource()) {
        if (!gistConnected) return;
      } else if (isDriveFilesSource()) {
        if (!driveConnected) return;
      } else if (!fsAccessSupported) {
        return;
      }
      const id = filesEntryIdFromRow(row);
      const kind = /** @type {"file"|"directory"} */ (row.getAttribute("data-kind") || "file");
      if (!id && kind !== "directory") return;
      if (!isCloudFilesSource() && kind === "directory") selectFsPath(id);
      void activateFilesTreeEntry(id, kind);
    });

    filesTree?.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".files-tree-row");
      if (!row || !filesTree.contains(row)) return;
      if (row.getAttribute("data-drive-action") === "up") return;
      if (isGistFilesSource()) {
        if (!gistConnected) return;
      } else if (isDriveFilesSource()) {
        if (!driveConnected) return;
      } else if (!fsAccessSupported) {
        return;
      }
      const id = filesEntryIdFromRow(row);
      if (isCloudFilesSource() && !id) return;
      e.preventDefault();
      const kind = /** @type {"file"|"directory"} */ (row.getAttribute("data-kind") || "file");
      if (!isCloudFilesSource()) selectFsPath(id);
      openFilesContextMenu(e.clientX, e.clientY, { id, kind });
    });

    filesDrawer?.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".files-tree-row")) return;
      // Empty-area "new file/folder" menu is only for the files panel, not the outline.
      if (!e.target.closest(".files-section")) return;
      if (isGistFilesSource()) {
        if (!gistConnected) return;
      } else if (isDriveFilesSource()) {
        if (!driveConnected) return;
      } else if (!fsAccessSupported || !rootDirHandle || awaitingFsPermission) {
        return;
      }
      e.preventDefault();
      if (!isCloudFilesSource()) selectFsPath("");
      openFilesContextMenu(e.clientX, e.clientY, { id: "", kind: "directory" });
    });

    filesContextMenu?.addEventListener("click", (e) => {
      const item = e.target.closest("[data-fs-action]");
      if (!item) return;
      const action = item.getAttribute("data-fs-action");
      const target = contextTarget;
      closeFilesContextMenu();
      if (!target) return;
      if (action === "new-file") void promptCreateFile(target);
      else if (action === "new-folder") void promptCreateFolder(target);
      else if (action === "rename" && target.id) void promptRenameEntry(target.id);
      else if (action === "delete" && target.id) void promptDeleteEntry(target.id);
    });
  }

  if (fsAccessSupported) {
    document.querySelectorAll(".fs-only").forEach((el) => {
      el.hidden = false;
    });
    filesOpenFolderBtn?.addEventListener("click", () => void pickOpenFolder());
    filesEmptyOpenBtn?.addEventListener("click", () => void pickOpenFolder());
    filesReopenBtn?.addEventListener("click", () => void pickOpenFolder());
    filesRegrantBtn?.addEventListener("click", () => void regrantFolderPermission());
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

  if (
    !isDriveFilesSource() &&
    fsAccessSupported &&
    rootDirHandle &&
    !awaitingFsPermission &&
    savedPath
  ) {
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
  updateViewModeMenuSelection();
}

function updateViewModeMenuSelection() {
  if (!viewModeMenu) return;
  for (const btn of viewModeMenu.querySelectorAll("[data-view]")) {
    btn.classList.toggle(
      "is-selected",
      btn.getAttribute("data-view") === currentView,
    );
  }
}

function onViewModeMenuClick(e) {
  // Scope to menuitems only — body also has [data-view], which closest() would hit.
  const item = e.target.closest("#view-mode-menu [role='menuitem']");
  if (!item) return;
  const view =
    item.getAttribute("data-view") ||
    (item.id === "present-menu-btn" ? "present" : null);
  if (!view) return;
  closeViewModeMenu();
  if (view === "present") enterPresentMode();
  else if (view === "slides") enterSlidesMode();
  else if (view === "edit") setView("edit");
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
      title: currentFileName || "Markdown Editor",
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

  // Best local English voice when available; otherwise highest-scored cloud voice.
  return voices.find((v) => v.localService) || voices[0] || null;
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
    const title = track?.title || currentFileName || "Markdown Editor";
    const artist = currentFileName || "Markdown Editor";
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
    if (!speechActive) void requestStartSpeaking();
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

/**
 * True when read-aloud would use a cloud voice because no local high-quality
 * English voice is available (the privacy-sensitive fallback default).
 */
function isDefaultedToCloudVoice() {
  const voice = preferredVoice();
  if (!voice || voice.localService) return false;
  return !listVoices().some((v) => v.localService);
}

/**
 * Confirm before starting cloud TTS when that voice is only the fallback default.
 * @returns {Promise<boolean>}
 */
function confirmCloudSpeechIfNeeded() {
  if (cloudSpeechAllowedThisSession || !isDefaultedToCloudVoice()) {
    return Promise.resolve(true);
  }
  if (!cloudSpeechModal || typeof cloudSpeechModal.showModal !== "function") {
    return Promise.resolve(
      window.confirm(
        "No local voice is available. Read aloud will use a cloud voice and send document text to the voice provider. Continue?",
      ),
    );
  }
  if (cloudSpeechModal.open) return Promise.resolve(false);

  return new Promise((resolve) => {
    const onClose = () => {
      cloudSpeechModal.removeEventListener("close", onClose);
      const ok = cloudSpeechModal.returnValue === "continue";
      if (ok) cloudSpeechAllowedThisSession = true;
      resolve(ok);
    };
    cloudSpeechModal.addEventListener("close", onClose);
    cloudSpeechModal.returnValue = "";
    cloudSpeechModal.showModal();
  });
}

async function requestStartSpeaking() {
  const allowed = await confirmCloudSpeechIfNeeded();
  if (!allowed) return;
  startSpeaking();
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
  else void requestStartSpeaking();
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
 * chrome-ai.js is loaded only when at least one API global is present.
 */
async function setupChromeAi() {
  if (!writingToolsDropdown || !writingToolsBtn || !writingToolsMenu) return;
  if (!anyWritingAiGlobalPresent()) return;

  const {
    assertInputFitsQuota,
    availabilityLabel,
    checkAvailability,
    checkPromptAvailability,
    createAiSession,
    createPromptSession,
    destroyAiSession,
    formatAiError,
    isAiSupported,
    isPromptApiSupported,
    PROMPT_TEXT_OPTIONS,
    promptSystemFor,
    renderCorrectedDiffHtml,
    resolveInsertRange,
    resolveTargetRange,
    runProofreadDocument,
    runPromptRewrite,
    runPromptWrite,
    runRewrite,
    runWrite,
    wrapPromptSessionAsProofreader,
    writingBackendFor,
  } = await loadChromeAiModule();

  writingToolsDropdown.hidden = false;

  const promptOk = isPromptApiSupported();
  if (aiWriteMenuBtn) {
    aiWriteMenuBtn.hidden = !(isAiSupported("Writer") || promptOk);
  }
  if (aiRewriteMenuBtn) {
    aiRewriteMenuBtn.hidden = !(isAiSupported("Rewriter") || promptOk);
  }
  if (aiProofreadMenuBtn) {
    aiProofreadMenuBtn.hidden = !(isAiSupported("Proofreader") || promptOk);
  }

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
    const backend = writingBackendFor(kind);
    if (!backend) {
      throw new Error(availabilityLabel("unavailable"));
    }

    if (backend === "prompt") {
      const promptOptions = {
        ...PROMPT_TEXT_OPTIONS,
        initialPrompts: [{ role: "system", content: promptSystemFor(kind) }],
      };
      const status = await checkPromptAvailability(PROMPT_TEXT_OPTIONS);
      if (status === "unavailable") {
        throw new Error(availabilityLabel(status));
      }
      const lm = await createPromptSession(promptOptions, {
        signal: aiAbort?.signal,
        onProgress,
      });
      activeSession =
        kind === "Proofreader" ? wrapPromptSessionAsProofreader(lm) : lm;
      return activeSession;
    }

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
      syncProofEditorHighlightScroll();
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
    syncProofEditorHighlightScroll();
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
      const tone = toneEl?.value || "neutral";
      const length = lengthEl?.value || "short";
      const backend = writingBackendFor("Writer");
      const options = {
        tone,
        length,
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
      const writeOpts = {
        context,
        signal: aiAbort.signal,
        onChunk: (text) => {
          pendingResult = text;
          showPreview(preview, text);
        },
      };
      const result =
        backend === "prompt"
          ? await runPromptWrite(session, prompt, { ...writeOpts, tone, length })
          : await runWrite(session, prompt, writeOpts);
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
      const tone = toneEl?.value || "as-is";
      const length = lengthEl?.value || "as-is";
      const backend = writingBackendFor("Rewriter");
      const options = {
        tone,
        length,
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
      const rewriteOpts = {
        context,
        signal: aiAbort.signal,
        onChunk: (text) => {
          pendingResult = text;
          showPreview(preview, text);
        },
      };
      const result =
        backend === "prompt"
          ? await runPromptRewrite(session, source, { ...rewriteOpts, tone, length })
          : await runRewrite(session, source, rewriteOpts);
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
  aiProofHighlight?.addEventListener(
    "scroll",
    () => {
      if (aiProofHighlight.scrollTop) aiProofHighlight.scrollTop = 0;
      if (aiProofHighlight.scrollLeft) aiProofHighlight.scrollLeft = 0;
    },
    { passive: true },
  );

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
  const savedMermaidLook = localStorage.getItem(STORAGE_KEYS.mermaidLook);
  setMermaidLook(MERMAID_LOOKS.includes(savedMermaidLook) ? savedMermaidLook : "classic", {
    persist: false,
    rerender: false,
  });
  applyCollapseState();
  setupSplitter();
  setupDragAndDrop();
  setupPwa();
  await loadGoogleDriveConfig();
  driveConfigured = googleDriveEnabled();
  await loadGithubGistConfig();
  gistConfigured = githubGistEnabled();
  setupFilesDrawer();
  setupDocOutline();
  setupMermaidZoom();
  setupStorageSync();
  historyIdbReady = await probeHistoryIdb();
  if (historyIdbReady) {
    await migrateHistoryIfNeeded();
    await hydrateHistoryIndexFromIdb();
  }
  // Sequential: file binding restore reads rootDirHandle set by directory restore.
  // Drive tree refresh waits until after local restore so both cannot race into #files-tree.
  await restoreFilesDirectoryOnLoad();
  if (guideSession) {
    // Help-preview tabs must not adopt the other tab's open file.
    clearCurrentFileBinding();
  } else {
    await restoreCurrentFileBindingOnLoad();
  }
  if (driveConfigured) {
    // Token is memory-only; refresh always needs Unlock (PRF) or Connect.
    driveConnected = await tryRestoreDriveAccessToken();
    updateFilesChrome();
  }
  if (gistConfigured) {
    gistConnected = await tryRestoreGistAccessToken();
    updateFilesChrome();
  }
  if (driveConfigured && driveConnected && isDriveFilesSource()) {
    await refreshDriveTree();
  }
  if (gistConfigured && gistConnected && isGistFilesSource()) {
    await refreshGistTree();
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

  // Paint the shell first, then render — large drafts can block marked/DOMPurify
  // for well over a second; the preview shows a delayed spinner while that runs.
  void renderMarkdown(getMarkdownSource());

  // Non-critical UI — after first paint (next frame), so speak/history work ASAP.
  requestAnimationFrame(() => {
    setupSpeech();
    void setupChromeAi();
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

  setupZenBrandUnlock();

  widthSelect.addEventListener("change", () => {
    setPreviewWidth(widthSelect.value, { persist: true });
    // Narrow: dismiss after pick so the preview is visible. Desktop: keep open for multi-tweaks.
    if (window.matchMedia(NARROW_MQ).matches && toolbarMenu.classList.contains("is-open")) {
      closeOverflowMenu();
    }
  });

  mermaidLookSelect?.addEventListener("change", () => {
    setMermaidLook(mermaidLookSelect.value, { persist: true });
    if (window.matchMedia(NARROW_MQ).matches && toolbarMenu.classList.contains("is-open")) {
      closeOverflowMenu();
    }
  });

  filesOpenFileBtn?.addEventListener("click", () => {
    fileInput?.click();
  });
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    handleFile(file);
    fileInput.value = "";
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
  viewModeMenu?.addEventListener("click", onViewModeMenuClick);
  presentViewBtn?.addEventListener("click", enterPresentMode);
  printBtn?.addEventListener("click", () => window.print());
  helpBtn?.addEventListener("click", (e) => {
    // Keep modified / middle clicks as real navigation (new tab).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    closeOverflowMenu();
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
  // overflow:hidden still lets scrollIntoView move scrollTop; pin it so Find cannot
  // desync the highlight layer from the textarea (which owns scrolling).
  editorHighlight.addEventListener(
    "scroll",
    () => {
      if (editorHighlight.scrollTop) editorHighlight.scrollTop = 0;
      if (editorHighlight.scrollLeft) editorHighlight.scrollLeft = 0;
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
    // Browser Find scrolls the textarea to the match; that scroll is not always
    // accompanied by a "scroll" event, so re-align the highlight layer here.
    syncEditorHighlightScroll();
    scheduleRevealPreviewForCaret();
  });
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      syncEditorHighlightScroll();
      invalidateScrollAnchors();
      scheduleMermaidScale();
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

  // Dismiss the overflow panel after choosing an action. Nested dropdown
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
    // Native <select> option picks can click body after the OS menu closes; keep
    // the kebab open while focus remains on a control inside it.
    if (!toolbarMenu.contains(e.target) && !toolbarMenu.contains(document.activeElement)) {
      closeOverflowMenu();
    }
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
    if (mermaidZoomDialog?.open) {
      // Zoom dialog owns Escape / +/- ; skip app shortcuts (incl. present nav).
      return;
    }
    if (setupChromeAi.isDialogOpen?.()) {
      // Let the dialog handle Escape; skip app-level shortcuts.
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      if (canSaveDocument() && isAuthoringView()) {
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

  syncToolbarBarPlacement();
  window.matchMedia(NARROW_MQ).addEventListener("change", (e) => {
    syncToolbarBarPlacement();
    if (!e.matches) closeOverflowMenu();
  });
}

init();
