import { isFsAccessSupported } from "../lib/fs.js";
import { DRIVE_DEFAULT_FOLDER_NAME } from "../drive/google-drive.js";

export const editor = document.getElementById("editor");
export const editorHighlight = document.getElementById("editor-highlight");
export const editorHighlightCode = editorHighlight.querySelector("code");
export const preview = document.getElementById("preview");
export const panes = document.getElementById("panes");
export const splitter = document.getElementById("splitter");
export const themeSelect = document.getElementById("theme-select");
export const widthSelect = document.getElementById("width-select");
export const mermaidLookSelect = document.getElementById("mermaid-look-select");
export const fileInput = document.getElementById("file-input");
export const filesOpenFileBtn = document.getElementById("files-open-file-btn");
export const shareDropdown = document.getElementById("share-dropdown");
export const shareBtn = document.getElementById("share-btn");
export const shareMenu = document.getElementById("share-menu");
export const exportDropdown = document.getElementById("export-dropdown");
export const exportBtn = document.getElementById("export-btn");
export const exportMenu = document.getElementById("export-menu");
export const writingToolsDropdown = document.getElementById("writing-tools-dropdown");
export const writingToolsBtn = document.getElementById("writing-tools-btn");
export const writingToolsMenu = document.getElementById("writing-tools-menu");
export const aiWriteMenuBtn = document.getElementById("ai-write-menu-btn");
export const aiRewriteMenuBtn = document.getElementById("ai-rewrite-menu-btn");
export const aiProofreadMenuBtn = document.getElementById("ai-proofread-menu-btn");
export const aiWriteDialog = document.getElementById("ai-write-dialog");
export const aiRewriteDialog = document.getElementById("ai-rewrite-dialog");
export const aiProofreadDialog = document.getElementById("ai-proofread-dialog");
export const aiProofEditorWrap = document.getElementById("ai-proof-editor-wrap");
export const aiProofEditor = document.getElementById("ai-proof-editor");
export const aiProofHighlight = document.getElementById("ai-proof-highlight");
export const aiProofHighlightCode = aiProofHighlight?.querySelector("code") ?? null;
export const speakDropdown = document.getElementById("speak-dropdown");
export const speakBtn = document.getElementById("speak-btn");
export const speakPauseBtn = document.getElementById("speak-pause-btn");
export const speakPrevBtn = document.getElementById("speak-prev-btn");
export const speakNextBtn = document.getElementById("speak-next-btn");
export const voiceMenuBtn = document.getElementById("voice-menu-btn");
export const voiceMenu = document.getElementById("voice-menu");
export const collapseEditorBtn = document.getElementById("collapse-editor");
export const collapsePreviewBtn = document.getElementById("collapse-preview");
export const syncScrollBtn = document.getElementById("sync-scroll-btn");
export const lineWrapBtn = document.getElementById("line-wrap-btn");
export const formatBar = document.getElementById("format-bar");
export const headingDropdown = document.getElementById("heading-dropdown");
export const headingMenuBtn = document.getElementById("heading-menu-btn");
export const headingMenu = document.getElementById("heading-menu");
export const imageDropdown = document.getElementById("image-dropdown");
export const imageMenuBtn = document.getElementById("image-menu-btn");
export const imageMenu = document.getElementById("image-menu");
export const formatImageInput = document.getElementById("format-image-input");
export const formatMoreDropdown = document.getElementById("format-more-dropdown");
export const formatMoreBtn = document.getElementById("format-more-btn");
export const formatMoreMenu = document.getElementById("format-more-menu");
export const previewPane = document.getElementById("preview-pane");
export const renderLoading = document.getElementById("render-loading");
export const historyBtn = document.getElementById("history-btn");
export const historyMenu = document.getElementById("history-menu");
export const historyDropdown = document.getElementById("history-dropdown");
export const toolbarMenu = document.getElementById("toolbar-menu");
export const toolbarBar = document.getElementById("toolbar-bar");
export const toolbarActions = document.getElementById("toolbar-actions");
export const overflowBtn = document.getElementById("overflow-btn");
export const toastEl = document.getElementById("toast");
export const dropOverlay = document.getElementById("drop-overlay");
export const photoCredit = document.getElementById("photo-credit");
export const editViewBtn = document.getElementById("edit-view-btn");
export const viewModeDropdown = document.getElementById("view-mode-dropdown");
export const viewModeMainBtn = document.getElementById("view-mode-main-btn");
export const viewModeMenuBtn = document.getElementById("view-mode-menu-btn");
export const viewModeMenu = document.getElementById("view-mode-menu");
export const presentViewBtn = document.getElementById("present-view-btn");
export const printBtn = document.getElementById("print-btn");
export const helpBtn = document.getElementById("help-btn");
export const presentChrome = document.getElementById("present-chrome");
export const presentPrevBtn = document.getElementById("present-prev-btn");
export const presentNextBtn = document.getElementById("present-next-btn");
export const presentExitBtn = document.getElementById("present-exit-btn");
export const presentProgress = document.getElementById("present-progress");
export const externalModal = document.getElementById("external-modal");
export const cloudSpeechModal = document.getElementById("cloud-speech-modal");
export const mermaidZoomDialog = document.getElementById("mermaid-zoom-dialog");
export const mermaidZoomStage = document.getElementById("mermaid-zoom-stage");
export const mermaidZoomLevel = document.getElementById("mermaid-zoom-level");
export const mermaidZoomInBtn = document.getElementById("mermaid-zoom-in");
export const mermaidZoomOutBtn = document.getElementById("mermaid-zoom-out");
export const mermaidZoomResetBtn = document.getElementById("mermaid-zoom-reset");
export const mermaidZoomCloseBtn = document.getElementById("mermaid-zoom-close");
export const installBtn = document.getElementById("install-btn");
export const updateToast = document.getElementById("update-toast");
export const updateReloadBtn = document.getElementById("update-reload-btn");
export const filesToggleBtn = document.getElementById("files-toggle-btn");
export const saveBtn = document.getElementById("save-btn");
export const filesDrawer = document.getElementById("files-drawer");
export const filesBackdrop = document.getElementById("files-backdrop");
export const filesDrawerTitle = document.getElementById("files-drawer-title");
export const filesOpenFolderBtn = document.getElementById("files-open-folder-btn");
export const filesSourceToggle = document.getElementById("files-source-toggle");
export const filesSourceLocalBtn = document.getElementById("files-source-local-btn");
export const filesSourceDriveBtn = document.getElementById("files-source-drive-btn");
export const filesSourceGistBtn = document.getElementById("files-source-gist-btn");
export const filesConnectDriveBtn = document.getElementById("files-connect-drive-btn");
export const filesConnectGistBtn = document.getElementById("files-connect-gist-btn");
export const filesDriveOfflineHint = document.getElementById("files-drive-offline-hint");
export const filesEmptyConnectBtn = document.getElementById("files-empty-connect-btn");
export const filesEmptyConnectGistBtn = document.getElementById("files-empty-connect-gist-btn");
export const filesEmptyCopy = document.getElementById("files-empty-copy");
export const filesNewFileBtn = document.getElementById("files-new-file-btn");
export const filesNewFolderBtn = document.getElementById("files-new-folder-btn");
export const filesRefreshBtn = document.getElementById("files-refresh-btn");
export const filesEmpty = document.getElementById("files-empty");
export const filesEmptyOpenBtn = document.getElementById("files-empty-open-btn");
export const filesLoading = document.getElementById("files-loading");
export const filesLoadingCopy = document.getElementById("files-loading-copy");
export const filesPermission = document.getElementById("files-permission");
export const filesRegrantBtn = document.getElementById("files-regrant-btn");
export const filesReopenBtn = document.getElementById("files-reopen-btn");
export const filesTree = document.getElementById("files-tree");
export const filesContextMenu = document.getElementById("files-context-menu");
export const gistPatModal = document.getElementById("gist-pat-modal");
export const gistPatInput = document.getElementById("gist-pat-input");
export const currentFileNameEl = document.getElementById("current-file-name");
export const outlineEmpty = document.getElementById("outline-empty");
export const outlineList = document.getElementById("outline-list");

export const speechSupported = typeof window.SpeechSynthesisUtterance !== "undefined";
export const fsAccessSupported = isFsAccessSupported();

/** UI label for the Drive app root (leading slash marks it as a directory). */
export const DRIVE_ROOT_UI_NAME = `/${DRIVE_DEFAULT_FOLDER_NAME}`;

/** @type {Map<string, { kind: "file"|"directory", id: string, name: string, mimeType?: string }>} */
export const driveEntries = new Map();
/** @type {Map<string, { kind: "file", id: string, gistId: string, filename: string, name: string, description: string, isPublic: boolean }>} */
export const gistEntries = new Map();
/** @type {Map<string, { kind: "file"|"directory", handle: FileSystemHandle, parent: FileSystemDirectoryHandle|null, path: string }>} */
export const fsEntries = new Map();
/** @type {Set<string>} */
export const expandedPaths = new Set();
/** Collapsed preview sections keyed by `level:title` (default: all expanded). */
export const collapsedSections = new Set();
/** @type {WeakMap<HTMLElement, string>} */
export const mermaidSources = new WeakMap();
/** Last rendered host height per Mermaid source — reserves space across paints. */
export const mermaidHeightCache = new Map();

/**
 * Shared mutable runtime state. Domain modules read/write properties on this
 * object so assignments stay visible across ESM module boundaries.
 */
export const state = {
  /** @type {{ start: number, end: number }|null} */
  pendingFormatImageRange: null,
  /** @type {FileSystemDirectoryHandle|null} */
  rootDirHandle: null,
  /** @type {FileSystemDirectoryHandle|null} */
  selectedDirHandle: null,
  /** @type {string} */
  selectedPath: "",
  /** @type {FileSystemFileHandle|null} */
  currentFileHandle: null,
  /** @type {{ id: string, name: string, mimeType?: string } | null} */
  currentDriveFile: null,
  /** @type {{ gistId: string, filename: string } | null} */
  currentGistFile: null,
  /** @type {string} */
  currentFileName: "",
  /** @type {string} Relative path under the open folder, when known. */
  currentFilePath: "",
  /**
   * Revision stamp for conflict-aware Save (local lastModified, Drive modifiedTime, Gist updated_at).
   * @type {{ source: "fs"|"drive"|"gist", value: string } | null}
   */
  currentFileRevision: null,
  /** Set after loadGoogleDriveConfig() during boot. */
  driveConfigured: false,
  /** Set after loadGithubGistConfig() during boot. */
  gistConfigured: false,
  /** @type {"local"|"drive"|"gist"} */
  filesSource: "local",
  /** @type {{ id: string, name: string }[]} navigation stack; [0] is markdown-editor root */
  driveNavStack: [],
  driveConnected: false,
  gistConnected: false,
  /** True while the Drive files tree is fetching from Google. */
  driveFilesLoading: false,
  /** True while the Gist files tree is fetching from GitHub. */
  gistFilesLoading: false,
  /** @type {string} Last disk- or URL-baseline content for dirty checks. */
  savedSnapshot: "",
  /** True while the trust modal holds markdown that arrived via `#md` / `#mdz`. */
  pendingExternalFromUrl: false,
  /** True when this tab was opened via `#guide=1` (help preview; do not touch drafts). */
  guideSession: false,
  /** @type {{ id: string, kind: "file"|"directory" }|null} */
  contextTarget: null,
  filesDrawerOpen: false,
  awaitingFsPermission: false,
  deferredInstallPrompt: null,
  editorHighlightRaf: 0,
  suppressEditorInput: false,
  renderTimer: 0,
  historyTimer: 0,
  rafId: 0,
  /** Bumps to cancel in-flight async markdown paints. */
  paintGen: 0,
  /** Timer that reveals the preview loading spinner after RENDER_LOADING_DELAY_MS. */
  renderLoadingTimer: 0,
  toastTimer: 0,
  lastHistoryContent: "",
  historyIdbReady: false,
  persistRequested: false,
  /** @type {BroadcastChannel | null} */
  storageChannel: null,
  applyingRemoteStorage: false,
  splitPercent: 50,
  speechActive: false,
  speechPaused: false,
  speechQueue: [],
  speechKeepalive: 0,
  selectedVoiceURI: "",
  /** Session flag: user accepted cloud TTS after the fallback confirmation. */
  cloudSpeechAllowedThisSession: false,
  speechMap: null,
  /** @type {{ title: string, sectionIndex: number, start: number, end: number, chunks: { text: string, start: number }[] }[]} */
  speechTracks: [],
  speechTrackIndex: 0,
  /** Bumped when switching/stopping tracks so stale utterance callbacks are ignored. */
  speechGeneration: 0,
  currentView: "edit",
  /** View to restore when leaving present; defaults to slides when none was recorded. */
  viewBeforePresent: "slides",
  presentSections: [],
  presentIndex: 0,
  presentChromeHideTimer: 0,
  /** @type {{ id: number, x: number, y: number } | null} */
  presentSwipe: null,
  /** @type {{ id: number, startX: number, startY: number, width: number, active: boolean } | null} */
  drawerCloseDrag: null,
  /** True when Markdown was loaded from a share URL, upload, or OS file launch. */
  contentIsExternal: false,
  /** Content awaiting Accept/Reject; kept so Reject can scrub history after edits. */
  pendingExternalContent: null,
  /** Snapshot taken before applying untrusted content — restored on Reject. */
  preExternalSnapshot: null,
  syncScrollEnabled: false,
  /** Soft-wrap long lines in the editor and preview code blocks (default on). */
  lineWrapEnabled: true,
  /** Which pane is driving sync; suppresses echo scroll events. */
  syncScrollDriver: null,
  syncScrollUnlockTimer: 0,
  scrollAnchors: null,
  lineMirror: null,
  caretRevealRaf: 0,
  mermaidModule: undefined,
  svg2roughModule: undefined,
  mermaidGen: 0,
  /** @type {"classic" | "handDrawn"} */
  mermaidLook: "classic",
  mermaidScaleRaf: 0,
  mermaidRelayoutTimer: 0,
  mermaidPendingTimer: 0,
  /** @type {number} */
  mermaidZoomFactor: 1,
  /** @type {number} */
  mermaidZoomBaseW: 0,
  /** @type {number} */
  mermaidZoomBaseH: 0,
  historyIndexCache: null,
  zenThemeWanted: false,
  zenTypingListener: null,
  zenTypingLastMs: 0,
  zenBrandClicks: 0,
  zenBrandClickTimer: 0,
  outlineScrollSource: "editor",
  outlineHighlightRaf: 0,
  appBadgePermissionPrompted: false,
  faviconCleanEntries: null,
  faviconDirtyApplied: null,
  faviconDirtyHref: null,
  faviconDirtyGen: 0,
  openDocumentSeq: 0,
  sectionFoldAnimGen: 0,
  speechSessionAudio: null,
  speechSessionAudioUrl: "",
  guidePromise: null,
};

export function driveCurrentFolderId() {
  return state.driveNavStack.length
    ? state.driveNavStack[state.driveNavStack.length - 1].id
    : "";
}

export function drivePathLabel() {
  if (!state.driveNavStack.length) return DRIVE_ROOT_UI_NAME;
  return state.driveNavStack.map((p) => p.name).join("/");
}

export function isStandaloneDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}
