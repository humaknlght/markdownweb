import { marked } from "./vendor/marked.esm.js";
import DOMPurify from "./vendor/purify.es.mjs";
import hljs from "./vendor/highlight.min.js";

const STORAGE_KEYS = {
  draft: "md-preview:draft",
  theme: "md-preview:theme",
  editorCollapsed: "md-preview:editor-collapsed",
  previewCollapsed: "md-preview:preview-collapsed",
  history: "md-preview:history",
  split: "md-preview:split",
  width: "md-preview:width",
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
      const code = text.replace(/\n$/, "") + "\n";
      const { html, language } = highlightCode(code, lang);
      const classes = ["hljs"];
      if (language) classes.push(`language-${language}`);
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
  const raw = marked.parse(source || "", { async: false });
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
  });

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    preview.innerHTML = clean;
    rafId = 0;
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
    toggleHistory();
  });

  overflowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleOverflowMenu();
  });

  document.addEventListener("click", (e) => {
    if (!historyDropdown.contains(e.target)) closeHistory();
    if (!toolbarMenu.contains(e.target)) closeOverflowMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeHistory();
      closeOverflowMenu();
    }
  });

  window.matchMedia(NARROW_MQ).addEventListener("change", (e) => {
    if (!e.matches) closeOverflowMenu();
  });
}

init();
