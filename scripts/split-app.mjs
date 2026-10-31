#!/usr/bin/env node
/**
 * String-aware mechanical split of src/app/app.js into focused modules.
 * Run: node scripts/split-app.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "src/app/app.js");
const appDir = path.join(root, "src/app");

const LET_NAMES = [
  "pendingFormatImageRange", "rootDirHandle", "selectedDirHandle", "selectedPath",
  "currentFileHandle", "currentDriveFile", "currentGistFile", "currentFileName",
  "currentFilePath", "currentFileRevision", "driveConfigured", "gistConfigured",
  "filesSource", "driveNavStack", "driveConnected", "gistConnected",
  "driveFilesLoading", "gistFilesLoading", "savedSnapshot", "pendingExternalFromUrl",
  "guideSession", "contextTarget", "filesDrawerOpen", "awaitingFsPermission",
  "deferredInstallPrompt", "editorHighlightRaf", "suppressEditorInput", "renderTimer",
  "historyTimer", "rafId", "paintGen", "renderLoadingTimer", "toastTimer",
  "lastHistoryContent", "historyIdbReady", "persistRequested", "storageChannel",
  "applyingRemoteStorage", "splitPercent", "speechActive", "speechPaused",
  "speechQueue", "speechKeepalive", "selectedVoiceURI", "cloudSpeechAllowedThisSession",
  "speechMap", "speechTracks", "speechTrackIndex", "speechGeneration", "currentView",
  "viewBeforePresent", "presentSections", "presentIndex", "presentChromeHideTimer",
  "presentSwipe", "drawerCloseDrag", "contentIsExternal", "pendingExternalContent",
  "preExternalSnapshot", "syncScrollEnabled", "lineWrapEnabled", "syncScrollDriver",
  "syncScrollUnlockTimer", "scrollAnchors", "lineMirror", "caretRevealRaf",
  "mermaidModule", "svg2roughModule", "mermaidGen", "mermaidLook", "mermaidScaleRaf",
  "mermaidRelayoutTimer", "mermaidPendingTimer", "mermaidZoomFactor", "mermaidZoomBaseW",
  "mermaidZoomBaseH", "historyIndexCache", "zenThemeWanted", "zenTypingListener",
  "zenTypingLastMs", "zenBrandClicks", "zenBrandClickTimer", "outlineScrollSource",
  "outlineHighlightRaf", "appBadgePermissionPrompted", "faviconCleanEntries",
  "faviconDirtyApplied", "faviconDirtyHref", "faviconDirtyGen", "openDocumentSeq",
  "sectionFoldAnimGen", "speechSessionAudio", "speechSessionAudioUrl", "guidePromise",
].sort((a, b) => b.length - a.length);

const STATE_EXPORTS = [
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

const CONST_EXPORTS = [
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

const FIXED_RANGES = [
  { file: "marked-setup.js", start: 552, end: 571 },
  { file: "editor.js", start: 575, end: 757 },
  { file: "marked-renderer.js", start: 759, end: 893 },
  { file: "mermaid/normalize.js", start: 970, end: 977 },
  { file: "mermaid/theme-css.js", start: 982, end: 1315 },
  { file: "mermaid/color.js", start: 1328, end: 1524 },
  { file: "mermaid/sketch.js", start: 1526, end: 1819 },
  { file: "mermaid/load.js", start: 1821, end: 1974 },
  { file: "mermaid/render.js", start: 2003, end: 2074 },
  { file: "mermaid/zoom.js", start: 2076, end: 2245 },
  { file: "mermaid/render-layout.js", start: 2247, end: 2533 },
  { file: "ui-feedback.js", start: 2535, end: 2656 },
  { file: "external-trust.js", start: 2658, end: 2702 },
  { file: "draft-storage.js", start: 2704, end: 2854 },
  { file: "history-rewrite.js", start: 2856, end: 3029 },
  { file: "pwa.js", start: 3031, end: 3127 },
  { file: "share-url.js", start: 3129, end: 3156 },
  { file: "render-markdown.js", start: 3158, end: 3273 },
  { file: "history-commit.js", start: 3275, end: 3627 },
  { file: "history-ui.js", start: 3629, end: 3698 },
  { file: "toolbar-menus.js", start: 3700, end: 3794 },
  { file: "theme-layout.js", start: 3796, end: 3936 },
  { file: "splitter.js", start: 3938, end: 4081 },
  { file: "sync-scroll.js", start: 4083, end: 4608 },
  { file: "format-bar.js", start: 4610, end: 4891 },
  { file: "document-model.js", start: 4893, end: 5282 },
  { file: "files/drawer.js", start: 5284, end: 5442 },
  { file: "files/chrome.js", start: 5444, end: 5798 },
  { file: "files/drive-tree.js", start: 5800, end: 5995 },
  { file: "files/gist-tree.js", start: 5997, end: 6259 },
  { file: "files/local-tree.js", start: 6261, end: 6845 },
  { file: "files/save.js", start: 6847, end: 7066 },
  { file: "sections-folds.js", start: 7068, end: 7391 },
  { file: "sections-outline.js", start: 7393, end: 7562 },
  { file: "files/bootstrap.js", start: 7564, end: 7972 },
  { file: "open-export.js", start: 7974, end: 8122 },
  { file: "view-present.js", start: 8124, end: 8560 },
  { file: "speech/tracks.js", start: 8562, end: 8665 },
  { file: "speech/highlight.js", start: 8667, end: 8847 },
  { file: "speech/session.js", start: 8849, end: 9329 },
  { file: "speech/ui.js", start: 9331, end: 9364 },
  { file: "chrome-ai/dialogs.js", start: 9366, end: 9700 },
  { file: "chrome-ai/actions.js", start: 9701, end: 10050 },
  { file: "chrome-ai/setup.js", start: 10051, end: 10214 },
  { file: "guide.js", start: 10216, end: 10298 },
  { file: "boot-init.js", start: 10300, end: 10600 },
  { file: "boot-listeners.js", start: 10601, end: 10924 },
];

/** Replace identifiers outside strings/comments/templates. */
function replaceIdents(code, names, replacer) {
  const nameRe = new RegExp(`^(?:${names.join("|")})$`);
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    // line comment
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      const j = end === -1 ? code.length : end;
      out += code.slice(i, j);
      i = j;
      continue;
    }
    // block comment
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const j = end === -1 ? code.length : end + 2;
      out += code.slice(i, j);
      i = j;
      continue;
    }
    // strings
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === quote) {
          j += 1;
          break;
        }
        // template nesting not fully handled; good enough for this codebase
        j += 1;
      }
      out += code.slice(i, j);
      i = j;
      continue;
    }
    // identifier
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < code.length && /[\w$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (nameRe.test(word)) {
        const before = out.length ? out[out.length - 1] : "";
        // skip property access obj.word and state.word already
        if (before === ".") {
          out += word;
        } else {
          // skip object-literal keys: word followed by :
          let k = j;
          while (k < code.length && /\s/.test(code[k])) k++;
          if (code[k] === ":") {
            // Could be ternary `cond ? word :` or label/key. If preceded by ? it's ternary value... 
            // Object key if previous nonspace is { or ,
            let p = out.length - 1;
            while (p >= 0 && /\s/.test(out[p])) p--;
            const prev = p >= 0 ? out[p] : "";
            if (prev === "{" || prev === ",") {
              out += word; // keep as key; value may be rewritten separately if shorthand — handle below
            } else {
              out += replacer(word);
            }
          } else if (code[k] === "," || code[k] === "}") {
            // possible shorthand property { word, } or { word }
            let p = out.length - 1;
            while (p >= 0 && /\s/.test(out[p])) p--;
            const prev = p >= 0 ? out[p] : "";
            if (prev === "{" || prev === ",") {
              out += `${word}: ${replacer(word)}`;
            } else {
              out += replacer(word);
            }
          } else {
            out += replacer(word);
          }
        }
      } else {
        out += word;
      }
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function rewriteState(code) {
  return replaceIdents(code, LET_NAMES, (w) => `state.${w}`);
}

function extractTopLevelFns(code) {
  return [...code.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(
    (m) => m[1],
  );
}

function addExportKeywords(code) {
  return code.replace(/^(async\s+function|function)\s+/gm, "export $1 ");
}

function depthOf(file) {
  return file.split("/").length - 1;
}

function rewriteLibImports(importBlock, depth) {
  if (depth === 0) return importBlock;
  const up = "../".repeat(depth + 1);
  return importBlock
    .replace(/from "\.\.\//g, `from "${up}`)
    .replace(/import\("\.\.\//g, `import("${up}`);
}

async function main() {
  const raw = await fs.readFile(appPath, "utf8");
  if (raw.split("\n").length < 5000) {
    console.error("app.js already looks split; aborting.");
    process.exit(1);
  }
  const lines = raw.split("\n");
  const slice = (start, end) => lines.slice(start - 1, end).join("\n");
  const origImports = slice(1, 136).replace(
    /^import hljsMarkdown[\s\S]*?hljs-markdown\.js";\n/m,
    "",
  ).replace(
    /^import hljsXml[\s\S]*?xml\.min\.js";\n/m,
    "",
  ).replace(
    /^import hljs from "highlight\.js";\n/m,
    'import hljs from "highlight.js";\n',
  );

  // Prefer vendor-deps for shared libs to keep headers shorter
  const vendorHeader = (depth) => {
    const p = depth === 0 ? "./" : "../".repeat(depth);
    return `import { hooks } from "${p}hooks.js";
import {
  ${STATE_EXPORTS.join(",\n  ")}
} from "${p}state.js";
import {
  ${CONST_EXPORTS.join(",\n  ")}
} from "${p}constants.js";
import * as V from "${p}vendor-deps.js";
import {
  ensureHljsLanguage,
  ensureHljsLanguagesForSource,
} from "${p}hljs-setup.js";
import {
  loadExportModule,
  loadChromeAiModule,
  loadZenModule,
  loadZenCss,
  anyWritingAiGlobalPresent,
  CDN_INTEGRITY_URLS,
} from "${p}lazy-modules.js";

const {
  alertExtension, defListExtension, emojiExtension, collapseDataUris,
  collapseDataUrisPreservingSelection, collapsedEmbedUriTouched, expandEmbeds,
  findCollapsedEmbeds, formatEmbedMarkdown, insertCodeBlock, insertHorizontalRule,
  insertImage, insertLink, insertTable, prefixLines, wrapInline, frontmatterExtension,
  tablePipesExtension, clearStoredDirectory, createFile, createFolder,
  ensureEditableExtension, ensureHandlePermission, isEditableFileName,
  isFsAccessSupported, listDirectory, openDirectory, openWithPicker, readTextFileMeta,
  removeEntry, renameEntry, restoreDirectory, loadStoredCurrentFileHandle, resolveFilePath,
  revisionStampChanged, saveWithPicker, storeCurrentFileHandle, suggestedUntitledName,
  writeTextFile, stripRemoteMediaAttributes, loadGoogleDriveConfig, DRIVE_DEFAULT_FOLDER_NAME,
  clearDriveAccessToken, createDriveFileWithToken, createDriveFolderWithToken,
  ensureDriveAccessToken, ensureDriveAppFolder, getDriveAccessToken, googleDriveEnabled,
  hasSealedDriveSession, isDriveSessionMemoryOnly, getDriveFileMeta, listDriveFolderChildren,
  readDriveFileWithMeta, renameDriveItemWithToken, saveExistingDriveFile,
  trashDriveItemWithToken, tryRestoreDriveAccessToken, purgeLegacyCleartextToken,
  loadGithubGistConfig, clearGistAccessToken, createPrivateGist, deleteGist,
  editableGistFiles, ensureGistAccessToken, githubGistEnabled, hasSealedGistSession,
  isGistSessionMemoryOnly, listGists, prepareGistTokenVault, readGistFileWithMeta,
  setGistPersonalAccessToken, tryRestoreGistAccessToken, unlockGistAccessToken,
  updateGistFile, verifyGistToken, purgeLegacyGistCleartextToken, applyPatch, contentHash,
  makeRevisionBody, clearHistoryBodies, commitHistoryBodies, getDraft, getHistoryIndex,
  getRev, getTip, moveDraft, probeHistoryIdb, requestPersistentStorage, setDraft,
  setHistoryIndex, setTip, storageBudgetOk, HLJS_LANG_ALIASES, SPLIT_MAX, SPLIT_MIN,
  canonicalHljsLang, clampSplit, collectEditorLanguages, escapeHtml, formatRelativeTime,
  highlightEditorMarkdown, joinFsPath, parentPathOf, parseDraftMirror, titleFromMarkdown,
  wrapHighlightedLines, compressUtf8ToBase64Url, readShareParamsFromUrl, chunkSpeechText,
  listVoicesFromList, voiceKey, voiceQualityScore, wordEndOffset, marked, Renderer,
  DOMPurify, hljs,
} = V;
`;
  };

  // Fix chrome-ai / boot splits: don't cut mid-function. Use safer ranges.
  // Revert chrome-ai and boot to single files for correctness.
  const ranges = FIXED_RANGES.filter(
    (r) =>
      !r.file.startsWith("chrome-ai/") &&
      !r.file.startsWith("boot-"),
  ).concat([
    { file: "chrome-ai/setup.js", start: 9366, end: 10214 },
    { file: "boot.js", start: 10300, end: 10924 },
  ]);

  const moduleFns = new Map();
  const allFnNames = new Set();

  for (const r of ranges) {
    let body = slice(r.start, r.end);
    // Drop duplicate let outlineScrollSource / sectionFold etc. if present in slice
    body = body.replace(/^let outlineScrollSource[\s\S]*?;\n/m, "");
    body = body.replace(/^let outlineHighlightRaf[\s\S]*?;\n/m, "");
    body = body.replace(/^let sectionFoldAnimGen[\s\S]*?;\n/m, "");
    body = body.replace(/^let historyIndexCache[\s\S]*?;\n/m, "");
    body = body.replace(/^let zenThemeWanted[\s\S]*?;\n/m, "");
    body = body.replace(/^let zenTypingListener[\s\S]*?;\n/m, "");
    body = body.replace(/^let zenTypingLastMs[\s\S]*?;\n/m, "");
    body = body.replace(/^let zenBrandClicks[\s\S]*?;\n/m, "");
    body = body.replace(/^let zenBrandClickTimer[\s\S]*?;\n/m, "");
    body = body.replace(/^let appBadgePermissionPrompted[\s\S]*?;\n/m, "");
    body = body.replace(/^let faviconCleanEntries[\s\S]*?;\n/m, "");
    body = body.replace(/^let faviconDirtyApplied[\s\S]*?;\n/m, "");
    body = body.replace(/^let faviconDirtyHref[\s\S]*?;\n/m, "");
    body = body.replace(/^let faviconDirtyGen[\s\S]*?;\n/m, "");
    body = body.replace(/^let openDocumentSeq[\s\S]*?;\n/m, "");
    body = body.replace(/^let speechSessionAudio[\s\S]*?;\n/m, "");
    body = body.replace(/^let speechSessionAudioUrl[\s\S]*?;\n/m, "");
    body = body.replace(/^let guidePromise[\s\S]*?;\n/m, "");
    body = body.replace(/^let suppressEditorInput[\s\S]*?;\n/m, "");
    body = body.replace(/^const rendererProto[\s\S]*?;\n/m, "const rendererProto = Renderer.prototype;\n");

    body = rewriteState(body);
    body = addExportKeywords(body);
    body = body.replace(
      /^const MERMAID_THEME_CSS\s*=/m,
      "export const MERMAID_THEME_CSS =",
    );

    const fns = extractTopLevelFns(body);
    moduleFns.set(r.file, fns);
    for (const f of fns) allFnNames.add(f);
    await fs.mkdir(path.dirname(path.join(appDir, r.file)), { recursive: true });
    await fs.writeFile(path.join(appDir, r.file), body + "\n", "utf8");
  }

  const sortedFns = [...allFnNames].sort((a, b) => b.length - a.length);

  for (const r of ranges) {
    let body = await fs.readFile(path.join(appDir, r.file), "utf8");
    const local = new Set(moduleFns.get(r.file));

    body = replaceIdents(
      body,
      sortedFns.filter((f) => !local.has(f)),
      (name) => {
        // Only rewrite call sites — replaceIdents replaces all idents.
        // We'll do a second pass for calls only.
        return name;
      },
    );

    // Call-site only rewrite for hooks
    body = body.replace(
      new RegExp(`\\b(${sortedFns.join("|")})\\s*\\(`, "g"),
      (m, name) => (local.has(name) ? m : `hooks.${name}(`),
    );
    body = body.replace(
      /^export (async )?function hooks\.(\w+)/gm,
      "export $1function $2",
    );

    const depth = depthOf(r.file);
    const header = vendorHeader(depth);
    const register = moduleFns
      .get(r.file)
      .map((f) => `hooks.${f} = ${f};`)
      .join("\n");
    const extra = body.includes("export const MERMAID_THEME_CSS")
      ? "\nhooks.MERMAID_THEME_CSS = MERMAID_THEME_CSS;"
      : "";

    const out = `${header}\n${body.trim()}\n\n${register}${extra}\n`;
    await fs.writeFile(path.join(appDir, r.file), out, "utf8");
    console.log(`${r.file}: ${out.split("\n").length} lines`);
  }

  const sideEffects = ranges.map((r) => `import "./${r.file}";`).join("\n");
  const entry = `/**
 * App entry — domain modules register onto hooks, then boot runs.
 */
import "./constants.js";
import "./lazy-modules.js";
import "./hljs-setup.js";
import {
  state,
  installBtn,
  isStandaloneDisplay,
} from "./state.js";
import { hooks } from "./hooks.js";

${sideEffects}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  if (installBtn && !isStandaloneDisplay()) {
    installBtn.hidden = false;
  }
});
window.addEventListener("appinstalled", () => {
  state.deferredInstallPrompt = null;
  if (installBtn) installBtn.hidden = true;
  hooks.showToast?.("App installed");
});

hooks.init();
`;

  if (!(await fs.stat(appPath + ".monolith.bak").catch(() => null))) {
    await fs.writeFile(appPath + ".monolith.bak", raw, "utf8");
  }
  await fs.writeFile(appPath, entry, "utf8");
  console.log("Wrote thin app.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
