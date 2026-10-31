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
  filesSource: "md-editor:filesSource",
  currentFile: "md-editor:currentFile",
  currentFilePath: "md-editor:currentFilePath",
  savedSnapshot: "md-editor:savedSnapshot",
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
export const WIDTHS = ["readable", "full"];
/** Mermaid `look` values — handDrawn is the RoughJS / Excalidraw-style sketch. */
export const MERMAID_LOOKS = ["classic", "handDrawn"];
/** Hand-drawn diagram face (cdn.jsdelivr.net/npm/excalifont@1.0.0). */
export const MERMAID_HAND_FONT = '"Excalifont", "Segoe UI", "Helvetica Neue", sans-serif';
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
