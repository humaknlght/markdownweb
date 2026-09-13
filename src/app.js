import { marked } from "marked";
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
};

const HISTORY_LIMIT = 20;
const HISTORY_MAX_CHARS = 200_000;
const RENDER_DEBOUNCE_MS = 80;
const HISTORY_DEBOUNCE_MS = 1000;
const SPLIT_MIN = 15;
const SPLIT_MAX = 85;
const AUTO_HIGHLIGHT_MAX = 8_000;
const NARROW_MQ = "(max-width: 800px)";
const TEXT_FILE_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
const THEMES = ["github-light", "github-dark", "sepia", "terminal", "salesforce", "fancy"];
const WIDTHS = ["readable", "full"];

const editor = document.getElementById("editor");
const preview = document.getElementById("preview");
const panes = document.getElementById("panes");
const splitter = document.getElementById("splitter");
const themeSelect = document.getElementById("theme-select");
const widthSelect = document.getElementById("width-select");
const fileInput = document.getElementById("file-input");
const shareBtn = document.getElementById("share-btn");
const speakDropdown = document.getElementById("speak-dropdown");
const speakBtn = document.getElementById("speak-btn");
const speakPauseBtn = document.getElementById("speak-pause-btn");
const voiceMenuBtn = document.getElementById("voice-menu-btn");
const voiceMenu = document.getElementById("voice-menu");
const collapseEditorBtn = document.getElementById("collapse-editor");
const collapsePreviewBtn = document.getElementById("collapse-preview");
const historyBtn = document.getElementById("history-btn");
const historyMenu = document.getElementById("history-menu");
const historyDropdown = document.getElementById("history-dropdown");
const toolbarMenu = document.getElementById("toolbar-menu");
const overflowBtn = document.getElementById("overflow-btn");
const toastEl = document.getElementById("toast");
const dropOverlay = document.getElementById("drop-overlay");
const photoCredit = document.getElementById("photo-credit");

const speechSupported = typeof window.SpeechSynthesisUtterance !== "undefined";

marked.setOptions({
  gfm: true,
  breaks: false,
});

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || "").trim().split(/\s+/)[0].toLowerCase();
      if (language === "mermaid") {
        return `<div class="mermaid">${escapeHtml(text.replace(/\n$/, ""))}</div>\n`;
      }
      const code = text.replace(/\n$/, "") + "\n";
      const { html, language: highlighted } = highlightCode(code, lang);
      const classes = ["hljs"];
      if (highlighted) classes.push(`language-${highlighted}`);
      return `<pre><code class="${classes.join(" ")}">${html}</code></pre>\n`;
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
const SPEECH_CHUNK_MAX = 180;
const SPEECH_HIGHLIGHT = "speech-word";
const MERMAID_CDN =
  "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js";
const MERMAID_SRI =
  "sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2";

let mermaidModule;
let mermaidGen = 0;

function mermaidTheme() {
  const scheme = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-scheme")
    .trim();
  return scheme === "dark" ? "dark" : "default";
}

function initMermaid(mermaid) {
  mermaid.startOnLoad = false;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: mermaidTheme(),
  });
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
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: mermaidTheme(),
    });
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

function utf8ToBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUtf8(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function getMdFromUrl() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    const params = new URLSearchParams(hash);
    const md = params.get("md");
    if (md != null && md !== "") {
      try {
        return base64UrlToUtf8(md);
      } catch {
        /* ignore invalid hash */
      }
    }
  }

  const query = new URLSearchParams(window.location.search);
  const md = query.get("md");
  if (md != null && md !== "") {
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

  return null;
}

function buildShareUrl(markdown) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `md=${utf8ToBase64Url(markdown)}`;
  return url.toString();
}

function renderMarkdown(source) {
  if (speechActive) stopSpeaking();

  const raw = marked.parse(source || "", { async: false });
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
  });

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    mermaidGen += 1;
    preview.innerHTML = clean;
    rafId = 0;
    renderMermaidDiagrams();
  });
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderMarkdown(editor.value);
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
  const content = markdown ?? editor.value;
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
      editor.value = entry.content;
      lastHistoryContent = entry.content;
      localStorage.setItem(STORAGE_KEYS.draft, entry.content);
      renderMarkdown(entry.content);
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
  panes.style.setProperty("--split-rest", `${100 - splitPercent}%`);
  splitter.setAttribute("aria-valuenow", String(Math.round(splitPercent)));
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

function onEditorInput() {
  localStorage.setItem(STORAGE_KEYS.draft, editor.value);
  scheduleRender();
  window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => pushHistory(editor.value), HISTORY_DEBOUNCE_MS);
}

function handleFile(file) {
  if (!file) return;
  if (!TEXT_FILE_RE.test(file.name) && !file.type.startsWith("text/")) {
    showToast("Only Markdown or text files are supported");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result ?? "");
    editor.value = text;
    localStorage.setItem(STORAGE_KEYS.draft, text);
    renderMarkdown(text);
    pushHistory(text);
    showToast(`Loaded ${file.name}`);
  };
  reader.onerror = () => showToast("Could not read file");
  reader.readAsText(file);
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

async function copyShareUrl() {
  const url = buildShareUrl(editor.value);
  try {
    await navigator.clipboard.writeText(url);
    showToast("Share URL copied");
  } catch {
    window.prompt("Copy share URL:", url);
  }
}

function buildPreviewSpeechMap() {
  const nodes = [];
  let text = "";
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script, style, .mermaid")) return NodeFilter.FILTER_REJECT;
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
  return (editor.value || "").trim();
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
    toggleVoiceMenu();
  });
  window.addEventListener("pagehide", stopSpeaking);
}

function init() {
  const fromUrl = getMdFromUrl();
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  if (savedTheme && THEMES.includes(savedTheme)) {
    setTheme(savedTheme);
  } else {
    setTheme(preferredGithubTheme(), { persist: false });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = () => {
      if (!localStorage.getItem(STORAGE_KEYS.theme)) {
        setTheme(preferredGithubTheme(), { persist: false });
        renderMarkdown(editor.value);
      }
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onSchemeChange);
    } else if (typeof media.addListener === "function") {
      media.addListener(onSchemeChange);
    }
  }
  const savedWidth = localStorage.getItem(STORAGE_KEYS.width);
  setPreviewWidth(WIDTHS.includes(savedWidth) ? savedWidth : "readable", { persist: false });
  applyCollapseState();
  setupSplitter();
  setupDragAndDrop();
  setupSpeech();

  if (fromUrl != null) {
    editor.value = fromUrl;
    localStorage.setItem(STORAGE_KEYS.draft, fromUrl);
    lastHistoryContent = fromUrl;
    pushHistory(fromUrl);
  } else {
    const draft = localStorage.getItem(STORAGE_KEYS.draft) || "";
    editor.value = draft;
    lastHistoryContent = draft;
  }

  renderMarkdown(editor.value);
  renderHistoryMenu();

  editor.addEventListener("input", onEditorInput);

  themeSelect.addEventListener("change", () => {
    setTheme(themeSelect.value, { persist: true });
    renderMarkdown(editor.value);
  });

  widthSelect.addEventListener("change", () => {
    setPreviewWidth(widthSelect.value, { persist: true });
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    handleFile(file);
    fileInput.value = "";
  });

  shareBtn.addEventListener("click", copyShareUrl);
  collapseEditorBtn.addEventListener("click", toggleEditorCollapse);
  collapsePreviewBtn.addEventListener("click", togglePreviewCollapse);
  historyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeVoiceMenu();
    toggleHistory();
  });

  overflowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleOverflowMenu();
  });

  document.addEventListener("click", (e) => {
    if (!historyDropdown.contains(e.target)) closeHistory();
    if (speakDropdown && !speakDropdown.contains(e.target)) closeVoiceMenu();
    if (!toolbarMenu.contains(e.target)) closeOverflowMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeHistory();
      closeVoiceMenu();
      closeOverflowMenu();
      if (speechActive) stopSpeaking();
    }
  });

  window.matchMedia(NARROW_MQ).addEventListener("change", (e) => {
    if (!e.matches) closeOverflowMenu();
  });
}

init();
