/** Soft max for how many per-doc saved snapshots to keep in localStorage. */
export const SAVED_SNAPSHOT_MAX_KEYS = 30;

export const STORAGE_KEYS = {
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
  lineWrap: "md-editor:line-wrap",
  filesDrawer: "md-editor:filesDrawer",
  fsPermissionToastDismissed: "md-editor:fsPermissionToastDismissed",
  filesSource: "md-editor:filesSource",
  currentFile: "md-editor:currentFile",
  currentFilePath: "md-editor:currentFilePath",
  savedSnapshot: "md-editor:savedSnapshot",
  /** After first visit, early boot hides `.site-intro` before paint. */
  siteIntroSeen: "md-editor:site-intro-seen",
};

export const HISTORY_LIMIT = 20;
/** Legacy localStorage-only history / emergency mirror cap. */
export const HISTORY_MAX_CHARS = 200_000;
/** Soft max for IndexedDB tip / draft bodies. */
export const HISTORY_TIP_MAX = 5 * 1024 * 1024;
/** Sync localStorage mirror for draft when under this size (unload safety). */
export const EMERGENCY_LS_MAX = 100_000;
export const HISTORY_INDEX_VERSION = 3;
export const PATCH_MAX_CHARS = 100_000;
export const STORAGE_CHANNEL = "md-editor-storage";
export const RENDER_DEBOUNCE_MS = 80;
/**
 * CSP source for the embedding page origin, or "" when unavailable.
 * The preview frame is document.written into a srcless about:blank iframe;
 * Firefox resolves CSP `'self'` against about:blank there, so same-origin
 * stylesheets/images need an explicit host source (see Mozilla 2021482).
 * @param {string} [origin]
 * @returns {string}
 */
export function previewFrameOriginSrc(origin = globalThis.location?.origin || "") {
  if (!origin || origin === "null") return "";
  try {
    const url = new URL(origin);
    // Only exact http(s) origins are valid CSP host sources (no path/query).
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.origin !== origin) return "";
    return url.origin;
  } catch {
    return "";
  }
}

/**
 * CSP for the sandboxed preview iframe document.
 * Blocks scripts and all remote subresources (phone-home images, etc.).
 * @param {string} [origin] Embedding page origin (`location.origin`).
 */
export function buildPreviewFrameCsp(origin = globalThis.location?.origin || "") {
  const originSrc = previewFrameOriginSrc(origin);
  const withOrigin = originSrc ? ` ${originSrc}` : "";

  return `default-src 'none';script-src 'none';style-src 'self' 'unsafe-inline'${withOrigin};img-src 'self' data: blob:${withOrigin};media-src 'self' data: blob:${withOrigin};font-src https://cdn.jsdelivr.net;base-uri 'none';form-action 'none'`;
}

/** Stable CSP string without an embedder origin (unit / string compares). */
export const PREVIEW_FRAME_CSP = buildPreviewFrameCsp("");

/** Delay before the preview loading spinner becomes visible. */
export const RENDER_LOADING_DELAY_MS = 700;
/**
 * Docs at or above this size get a paint of the spinner before marked/DOMPurify
 * run. A long sync task would otherwise prevent the 700ms timer from firing.
 */
export const RENDER_LOADING_EAGER_CHARS = 16_000;
/** Soft warn when a share URL may exceed common app/OS paste limits. */
export const SHARE_URL_WARN_CHARS = 16_384;
export const HISTORY_DEBOUNCE_MS = 15_000;
export const EDITOR_HIGHLIGHT_MAX = 100_000;
export const NARROW_MQ = "(max-width: 800px)";
export const TEXT_FILE_RE = /\.(md|markdown|mdown|mkd|txt|html|htm)$/i;
export const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
/** Raw clipboard image size cap before base64 (keeps drafts / history workable). */
export const IMAGE_PASTE_MAX_BYTES = 2 * 1024 * 1024;
export const THEMES = [
  "github-light",
  "github-dark",
  "sepia",
  "terminal",
  "salesforce",
  "fancy",
  "zen",
];

/** Page / PWA chrome color for `<meta name="theme-color">` (WCO titlebar blend). */
export const THEME_COLORS = {
  "github-light": "#f6f7f9",
  "github-dark": "#010409",
  sepia: "#e8dcc4",
  terminal: "#060806",
  salesforce: "#eaf5fe",
  fancy: "#062436",
  zen: "#0b1c24",
};
export const WIDTHS = ["readable", "full"];
/** Mermaid `look` values — handDrawn is the RoughJS / Excalidraw-style sketch. */
export const MERMAID_LOOKS = ["classic", "handDrawn"];
/** Hand-drawn diagram face (cdn.jsdelivr.net/npm/excalifont@1.0.0). */
export const MERMAID_HAND_FONT = '"Excalifont","Segoe UI","Helvetica Neue",sans-serif';
export const VIEWS = ["edit", "reader", "present", "slides"];

export const PRESENT_CHROME_IDLE_MS = 5000;
export const PRESENT_SWIPE_MIN_DX = 56;
export const DRAWER_CLOSE_SWIPE_MIN_DX = 56;
export const SPEECH_HIGHLIGHT = "speech-word";

export const MERMAID_CDN =
  "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs";
/**
 * RoughJS SVG sketcher for the Excalidraw (handDrawn) look.
 * Mermaid's native handDrawn uses dense hachure fills that fail WCAG (fill color
 * becomes stroke ink). We always render classic Mermaid, then sketch with solid fills.
 */
export const SVG2ROUGH_CDN = "https://cdn.jsdelivr.net/npm/svg2roughjs@3.2.3/+esm";

export const MERMAID_MIN_HOST_WIDTH = 48;
export const MERMAID_MIN_GANTT_HOST_WIDTH = 220;
export const MERMAID_ZOOM_MIN = 0.5;
export const MERMAID_ZOOM_MAX = 4;
export const MERMAID_ZOOM_STEP = 0.25;
export const MERMAID_ZOOM_BTN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>';
