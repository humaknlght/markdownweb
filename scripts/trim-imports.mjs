#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/app");

const SKIP = new Set([
  "app.js",
  "constants.js",
  "state.js",
  "hooks.js",
  "lazy-modules.js",
  "hljs-setup.js",
  "vendor-deps.js",
]);

const STATE_NAMES = [
  "state", "editor", "editorHighlight", "editorHighlightCode", "preview", "panes",
  "splitter", "themeSelect", "widthSelect", "mermaidLookSelect", "fileInput",
  "filesOpenFileBtn", "shareDropdown", "shareBtn", "shareMenu", "exportDropdown",
  "exportBtn", "exportMenu", "writingToolsDropdown", "writingToolsBtn", "writingToolsMenu",
  "aiWriteMenuBtn", "aiRewriteMenuBtn", "aiProofreadMenuBtn", "aiWriteDialog",
  "aiRewriteDialog", "aiProofreadDialog", "aiProofEditorWrap", "aiProofEditor",
  "aiProofHighlight", "aiProofHighlightCode", "speakDropdown", "speakBtn",
  "speakPauseBtn", "speakPrevBtn", "speakNextBtn", "voiceMenuBtn", "voiceMenu",
  "collapseEditorBtn", "collapsePreviewBtn", "syncScrollBtn", "lineWrapBtn",
  "formatBar", "headingDropdown", "headingMenuBtn", "headingMenu", "imageDropdown",
  "imageMenuBtn", "imageMenu", "formatImageInput", "formatMoreDropdown", "formatMoreBtn",
  "formatMoreMenu", "previewPane", "renderLoading", "historyBtn", "historyMenu",
  "historyDropdown", "toolbarMenu", "toolbarBar", "toolbarActions", "overflowBtn",
  "toastEl", "dropOverlay", "photoCredit", "editViewBtn", "viewModeDropdown",
  "viewModeMainBtn", "viewModeMenuBtn", "viewModeMenu", "presentViewBtn", "printBtn",
  "helpBtn", "presentChrome", "presentPrevBtn", "presentNextBtn", "presentExitBtn",
  "presentProgress", "externalModal", "cloudSpeechModal", "mermaidZoomDialog",
  "mermaidZoomStage", "mermaidZoomLevel", "mermaidZoomInBtn", "mermaidZoomOutBtn",
  "mermaidZoomResetBtn", "mermaidZoomCloseBtn", "installBtn", "updateToast",
  "updateReloadBtn", "filesToggleBtn", "saveBtn", "filesDrawer", "filesBackdrop",
  "filesDrawerTitle", "filesOpenFolderBtn", "filesSourceToggle", "filesSourceLocalBtn",
  "filesSourceDriveBtn", "filesSourceGistBtn", "filesConnectDriveBtn", "filesConnectGistBtn",
  "filesDriveOfflineHint", "filesEmptyConnectBtn", "filesEmptyConnectGistBtn",
  "filesEmptyCopy", "filesNewFileBtn", "filesNewFolderBtn", "filesRefreshBtn",
  "filesEmpty", "filesEmptyOpenBtn", "filesLoading", "filesLoadingCopy", "filesPermission",
  "filesRegrantBtn", "filesReopenBtn", "filesTree", "filesContextMenu", "gistPatModal",
  "gistPatInput", "currentFileNameEl", "outlineEmpty", "outlineList", "speechSupported",
  "fsAccessSupported", "DRIVE_ROOT_UI_NAME", "driveEntries", "gistEntries", "fsEntries",
  "expandedPaths", "collapsedSections", "mermaidSources", "mermaidHeightCache",
  "driveCurrentFolderId", "drivePathLabel", "isStandaloneDisplay",
];

const CONST_NAMES = [
  "STORAGE_KEYS", "SAVED_SNAPSHOT_MAX_KEYS", "HISTORY_LIMIT", "HISTORY_MAX_CHARS",
  "HISTORY_TIP_MAX", "EMERGENCY_LS_MAX", "HISTORY_INDEX_VERSION", "PATCH_MAX_CHARS",
  "STORAGE_CHANNEL", "RENDER_DEBOUNCE_MS", "RENDER_LOADING_DELAY_MS",
  "RENDER_LOADING_EAGER_CHARS", "HISTORY_DEBOUNCE_MS", "EDITOR_HIGHLIGHT_MAX",
  "NARROW_MQ", "TEXT_FILE_RE", "IMAGE_MIME_RE", "IMAGE_PASTE_MAX_BYTES", "THEMES",
  "WIDTHS", "MERMAID_LOOKS", "MERMAID_HAND_FONT", "VIEWS", "PRESENT_CHROME_IDLE_MS",
  "PRESENT_SWIPE_MIN_DX", "DRAWER_CLOSE_SWIPE_MIN_DX", "SPEECH_HIGHLIGHT", "MERMAID_CDN",
  "SVG2ROUGH_CDN", "MERMAID_MIN_HOST_WIDTH", "MERMAID_MIN_GANTT_HOST_WIDTH",
  "MERMAID_ZOOM_MIN", "MERMAID_ZOOM_MAX", "MERMAID_ZOOM_STEP", "MERMAID_ZOOM_BTN_SVG",
];

const VENDOR_NAMES = [
  "alertExtension", "defListExtension", "emojiExtension", "collapseDataUris",
  "collapseDataUrisPreservingSelection", "collapsedEmbedUriTouched", "expandEmbeds",
  "findCollapsedEmbeds", "formatEmbedMarkdown", "insertCodeBlock", "insertHorizontalRule",
  "insertImage", "insertLink", "insertTable", "prefixLines", "wrapInline",
  "frontmatterExtension", "tablePipesExtension", "clearStoredDirectory", "createFile",
  "createFolder", "ensureEditableExtension", "ensureHandlePermission", "isEditableFileName",
  "isFsAccessSupported", "listDirectory", "openDirectory", "openWithPicker", "readTextFileMeta",
  "removeEntry", "renameEntry", "restoreDirectory", "loadStoredCurrentFileHandle",
  "resolveFilePath", "revisionStampChanged", "saveWithPicker", "storeCurrentFileHandle",
  "suggestedUntitledName", "writeTextFile", "stripRemoteMediaAttributes", "loadGoogleDriveConfig",
  "DRIVE_DEFAULT_FOLDER_NAME", "clearDriveAccessToken", "createDriveFileWithToken",
  "createDriveFolderWithToken", "ensureDriveAccessToken", "ensureDriveAppFolder",
  "getDriveAccessToken", "googleDriveEnabled", "hasSealedDriveSession", "isDriveSessionMemoryOnly",
  "getDriveFileMeta", "listDriveFolderChildren", "readDriveFileWithMeta", "renameDriveItemWithToken",
  "saveExistingDriveFile", "trashDriveItemWithToken", "tryRestoreDriveAccessToken",
  "purgeLegacyCleartextToken", "loadGithubGistConfig", "clearGistAccessToken", "createPrivateGist",
  "deleteGist", "editableGistFiles", "ensureGistAccessToken", "githubGistEnabled",
  "hasSealedGistSession", "isGistSessionMemoryOnly", "listGists", "prepareGistTokenVault",
  "readGistFileWithMeta", "setGistPersonalAccessToken", "tryRestoreGistAccessToken",
  "unlockGistAccessToken", "updateGistFile", "verifyGistToken", "purgeLegacyGistCleartextToken",
  "applyPatch", "contentHash", "makeRevisionBody", "clearHistoryBodies", "commitHistoryBodies",
  "getDraft", "getHistoryIndex", "getRev", "getTip", "moveDraft", "probeHistoryIdb",
  "requestPersistentStorage", "setDraft", "setHistoryIndex", "setTip", "storageBudgetOk",
  "HLJS_LANG_ALIASES", "SPLIT_MAX", "SPLIT_MIN", "canonicalHljsLang", "clampSplit",
  "collectEditorLanguages", "escapeHtml", "formatRelativeTime", "highlightEditorMarkdown",
  "joinFsPath", "parentPathOf", "parseDraftMirror", "titleFromMarkdown", "wrapHighlightedLines",
  "compressUtf8ToBase64Url", "readShareParamsFromUrl", "chunkSpeechText", "listVoicesFromList",
  "voiceKey", "voiceQualityScore", "wordEndOffset", "marked", "Renderer", "DOMPurify", "hljs",
];

const LAZY_NAMES = [
  "loadExportModule", "loadChromeAiModule", "loadZenModule", "loadZenCss",
  "anyWritingAiGlobalPresent", "CDN_INTEGRITY_URLS",
];
const HLJS_NAMES = ["ensureHljsLanguage", "ensureHljsLanguagesForSource"];

async function walk(dir, base = "") {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = path.join(base, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(path.join(dir, ent.name), rel)));
    else if (ent.name.endsWith(".js")) out.push(rel);
  }
  return out;
}

function usedIdents(code) {
  const set = new Set();
  const cleaned = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
  const re = /\b([A-Za-z_$][\w$]*)\b/g;
  let m;
  while ((m = re.exec(cleaned))) set.add(m[1]);
  return set;
}

function depthOf(rel) {
  return rel.split("/").length - 1;
}

function findBody(text) {
  // After last import block
  const re = /^import[\s\S]*?;\n/gm;
  let last = 0;
  let m;
  while ((m = re.exec(text))) last = m.index + m[0].length;
  return text.slice(last);
}

async function main() {
  for (const rel of await walk(appDir)) {
    if (SKIP.has(rel)) continue;
    const full = path.join(appDir, rel);
    const text = await fs.readFile(full, "utf8");
    const body = findBody(text);
    const lines = body.split("\n");
    let regStart = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] === "" || /^hooks\.\w+ = /.test(lines[i])) regStart = i;
      else break;
    }
    const bodyOnly = lines.slice(0, regStart).join("\n");
    const regs = lines.slice(regStart).filter(Boolean).join("\n");
    const used = usedIdents(bodyOnly + "\n" + regs);

    const needState = STATE_NAMES.filter((n) => used.has(n));
    const needConst = CONST_NAMES.filter((n) => used.has(n));
    const needVendor = VENDOR_NAMES.filter((n) => used.has(n));
    const needLazy = LAZY_NAMES.filter((n) => used.has(n));
    const needHljs = HLJS_NAMES.filter((n) => used.has(n));
    const needHooks = used.has("hooks") || regs.includes("hooks.");

    const depth = depthOf(rel);
    const p = depth === 0 ? "./" : "../".repeat(depth);
    const parts = [];
    if (needHooks || regs) parts.push(`import { hooks } from "${p}hooks.js";`);
    if (needState.length) {
      parts.push(`import {\n  ${needState.join(",\n  ")}\n} from "${p}state.js";`);
    }
    if (needConst.length) {
      parts.push(`import {\n  ${needConst.join(",\n  ")}\n} from "${p}constants.js";`);
    }
    if (needVendor.length) {
      parts.push(`import {\n  ${needVendor.join(",\n  ")}\n} from "${p}vendor-deps.js";`);
    }
    if (needHljs.length) {
      parts.push(`import {\n  ${needHljs.join(",\n  ")}\n} from "${p}hljs-setup.js";`);
    }
    if (needLazy.length) {
      parts.push(`import {\n  ${needLazy.join(",\n  ")}\n} from "${p}lazy-modules.js";`);
    }

    const out = `${parts.join("\n")}\n\n${bodyOnly.trim()}\n\n${regs}\n`;
    await fs.writeFile(full, out, "utf8");
    console.log(`${rel}: ${out.split("\n").length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
