#!/usr/bin/env node
/**
 * Replace duplicated mega-import headers in split app modules with short
 * star-imports from vendor-deps / state / constants, and qualify identifiers.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../src/app");

const VENDOR = [
  "alertExtension",
  "defListExtension",
  "emojiExtension",
  "collapseDataUris",
  "collapseDataUrisPreservingSelection",
  "collapsedEmbedUriTouched",
  "expandEmbeds",
  "findCollapsedEmbeds",
  "formatEmbedMarkdown",
  "insertCodeBlock",
  "insertHorizontalRule",
  "insertImage",
  "insertLink",
  "insertTable",
  "prefixLines",
  "wrapInline",
  "frontmatterExtension",
  "tablePipesExtension",
  "clearStoredDirectory",
  "createFile",
  "createFolder",
  "ensureEditableExtension",
  "ensureHandlePermission",
  "isEditableFileName",
  "isFsAccessSupported",
  "listDirectory",
  "openDirectory",
  "openWithPicker",
  "readTextFileMeta",
  "removeEntry",
  "renameEntry",
  "restoreDirectory",
  "loadStoredCurrentFileHandle",
  "resolveFilePath",
  "revisionStampChanged",
  "saveWithPicker",
  "storeCurrentFileHandle",
  "suggestedUntitledName",
  "writeTextFile",
  "stripRemoteMediaAttributes",
  "loadGoogleDriveConfig",
  "DRIVE_DEFAULT_FOLDER_NAME",
  "clearDriveAccessToken",
  "createDriveFileWithToken",
  "createDriveFolderWithToken",
  "ensureDriveAccessToken",
  "ensureDriveAppFolder",
  "getDriveAccessToken",
  "googleDriveEnabled",
  "hasSealedDriveSession",
  "isDriveSessionMemoryOnly",
  "getDriveFileMeta",
  "listDriveFolderChildren",
  "readDriveFileWithMeta",
  "renameDriveItemWithToken",
  "saveExistingDriveFile",
  "trashDriveItemWithToken",
  "tryRestoreDriveAccessToken",
  "purgeLegacyCleartextToken",
  "loadGithubGistConfig",
  "clearGistAccessToken",
  "createPrivateGist",
  "deleteGist",
  "editableGistFiles",
  "ensureGistAccessToken",
  "githubGistEnabled",
  "hasSealedGistSession",
  "isGistSessionMemoryOnly",
  "listGists",
  "prepareGistTokenVault",
  "readGistFileWithMeta",
  "setGistPersonalAccessToken",
  "tryRestoreGistAccessToken",
  "unlockGistAccessToken",
  "updateGistFile",
  "verifyGistToken",
  "purgeLegacyGistCleartextToken",
  "applyPatch",
  "contentHash",
  "makeRevisionBody",
  "clearHistoryBodies",
  "commitHistoryBodies",
  "getDraft",
  "getHistoryIndex",
  "getRev",
  "getTip",
  "moveDraft",
  "probeHistoryIdb",
  "requestPersistentStorage",
  "setDraft",
  "setHistoryIndex",
  "setTip",
  "storageBudgetOk",
  "HLJS_LANG_ALIASES",
  "SPLIT_MAX",
  "SPLIT_MIN",
  "canonicalHljsLang",
  "clampSplit",
  "collectEditorLanguages",
  "escapeHtml",
  "formatRelativeTime",
  "highlightEditorMarkdown",
  "joinFsPath",
  "parentPathOf",
  "parseDraftMirror",
  "titleFromMarkdown",
  "wrapHighlightedLines",
  "compressUtf8ToBase64Url",
  "readShareParamsFromUrl",
  "chunkSpeechText",
  "listVoicesFromList",
  "voiceKey",
  "voiceQualityScore",
  "wordEndOffset",
  "marked",
  "Renderer",
  "DOMPurify",
  "hljs",
];

const CONSTS = [
  "STORAGE_KEYS",
  "SAVED_SNAPSHOT_MAX_KEYS",
  "HISTORY_LIMIT",
  "HISTORY_MAX_CHARS",
  "HISTORY_TIP_MAX",
  "EMERGENCY_LS_MAX",
  "HISTORY_INDEX_VERSION",
  "PATCH_MAX_CHARS",
  "STORAGE_CHANNEL",
  "RENDER_DEBOUNCE_MS",
  "RENDER_LOADING_DELAY_MS",
  "RENDER_LOADING_EAGER_CHARS",
  "HISTORY_DEBOUNCE_MS",
  "EDITOR_HIGHLIGHT_MAX",
  "NARROW_MQ",
  "TEXT_FILE_RE",
  "IMAGE_MIME_RE",
  "IMAGE_PASTE_MAX_BYTES",
  "THEMES",
  "WIDTHS",
  "MERMAID_LOOKS",
  "MERMAID_HAND_FONT",
  "VIEWS",
  "PRESENT_CHROME_IDLE_MS",
  "PRESENT_SWIPE_MIN_DX",
  "DRAWER_CLOSE_SWIPE_MIN_DX",
  "SPEECH_HIGHLIGHT",
  "MERMAID_CDN",
  "SVG2ROUGH_CDN",
  "MERMAID_MIN_HOST_WIDTH",
  "MERMAID_MIN_GANTT_HOST_WIDTH",
  "MERMAID_ZOOM_MIN",
  "MERMAID_ZOOM_MAX",
  "MERMAID_ZOOM_STEP",
  "MERMAID_ZOOM_BTN_SVG",
];

const DOM_AND_STATE = [
  "state",
  "editor",
  "editorHighlight",
  "editorHighlightCode",
  "preview",
  "panes",
  "splitter",
  "themeSelect",
  "widthSelect",
  "mermaidLookSelect",
  "fileInput",
  "filesOpenFileBtn",
  "shareDropdown",
  "shareBtn",
  "shareMenu",
  "exportDropdown",
  "exportBtn",
  "exportMenu",
  "writingToolsDropdown",
  "writingToolsBtn",
  "writingToolsMenu",
  "aiWriteMenuBtn",
  "aiRewriteMenuBtn",
  "aiProofreadMenuBtn",
  "aiWriteDialog",
  "aiRewriteDialog",
  "aiProofreadDialog",
  "aiProofEditorWrap",
  "aiProofEditor",
  "aiProofHighlight",
  "aiProofHighlightCode",
  "speakDropdown",
  "speakBtn",
  "speakPauseBtn",
  "speakPrevBtn",
  "speakNextBtn",
  "voiceMenuBtn",
  "voiceMenu",
  "collapseEditorBtn",
  "collapsePreviewBtn",
  "syncScrollBtn",
  "lineWrapBtn",
  "formatBar",
  "headingDropdown",
  "headingMenuBtn",
  "headingMenu",
  "imageDropdown",
  "imageMenuBtn",
  "imageMenu",
  "formatImageInput",
  "formatMoreDropdown",
  "formatMoreBtn",
  "formatMoreMenu",
  "previewPane",
  "renderLoading",
  "historyBtn",
  "historyMenu",
  "historyDropdown",
  "toolbarMenu",
  "toolbarBar",
  "toolbarActions",
  "overflowBtn",
  "toastEl",
  "dropOverlay",
  "photoCredit",
  "editViewBtn",
  "viewModeDropdown",
  "viewModeMainBtn",
  "viewModeMenuBtn",
  "viewModeMenu",
  "presentViewBtn",
  "printBtn",
  "helpBtn",
  "presentChrome",
  "presentPrevBtn",
  "presentNextBtn",
  "presentExitBtn",
  "presentProgress",
  "externalModal",
  "cloudSpeechModal",
  "mermaidZoomDialog",
  "mermaidZoomStage",
  "mermaidZoomLevel",
  "mermaidZoomInBtn",
  "mermaidZoomOutBtn",
  "mermaidZoomResetBtn",
  "mermaidZoomCloseBtn",
  "installBtn",
  "updateToast",
  "updateReloadBtn",
  "filesToggleBtn",
  "saveBtn",
  "filesDrawer",
  "filesBackdrop",
  "filesDrawerTitle",
  "filesOpenFolderBtn",
  "filesSourceToggle",
  "filesSourceLocalBtn",
  "filesSourceDriveBtn",
  "filesSourceGistBtn",
  "filesConnectDriveBtn",
  "filesConnectGistBtn",
  "filesDriveOfflineHint",
  "filesEmptyConnectBtn",
  "filesEmptyConnectGistBtn",
  "filesEmptyCopy",
  "filesNewFileBtn",
  "filesNewFolderBtn",
  "filesRefreshBtn",
  "filesEmpty",
  "filesEmptyOpenBtn",
  "filesLoading",
  "filesLoadingCopy",
  "filesPermission",
  "filesRegrantBtn",
  "filesReopenBtn",
  "filesTree",
  "filesContextMenu",
  "gistPatModal",
  "gistPatInput",
  "currentFileNameEl",
  "outlineEmpty",
  "outlineList",
  "speechSupported",
  "fsAccessSupported",
  "DRIVE_ROOT_UI_NAME",
  "driveEntries",
  "gistEntries",
  "fsEntries",
  "expandedPaths",
  "collapsedSections",
  "mermaidSources",
  "mermaidHeightCache",
  "driveCurrentFolderId",
  "drivePathLabel",
  "isStandaloneDisplay",
];

const LAZY = [
  "ensureHljsLanguage",
  "ensureHljsLanguagesForSource",
  "loadExportModule",
  "loadChromeAiModule",
  "loadZenModule",
  "loadZenCss",
  "anyWritingAiGlobalPresent",
  "CDN_INTEGRITY_URLS",
];

function depthOf(rel) {
  return rel.split("/").length - 1;
}

function qualify(code, names, prefix) {
  const re = new RegExp(
    `\\b(${[...names].sort((a, b) => b.length - a.length).join("|")})\\b`,
    "g",
  );
  return code.replace(re, (match, name, offset, full) => {
    const before = full.slice(Math.max(0, offset - prefix.length - 1), offset);
    if (before.endsWith(prefix + ".") || before.endsWith(".")) return match;
    // skip object keys
    if (/^\s*:/.test(full.slice(offset + name.length))) {
      if (/[\{\,]\s*$/.test(before) || /\n\s*$/.test(before)) return match;
    }
    // skip import/export names in import lists — headers already stripped
    return `${prefix}.${name}`;
  });
}

async function walk(dir, base = "") {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = path.join(base, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(path.join(dir, ent.name), rel)));
    else if (ent.name.endsWith(".js")) out.push(rel);
  }
  return out;
}

const SKIP = new Set([
  "app.js",
  "constants.js",
  "state.js",
  "hooks.js",
  "lazy-modules.js",
  "hljs-setup.js",
  "vendor-deps.js",
]);

async function main() {
  const files = (await walk(appDir)).filter((f) => !SKIP.has(f));

  for (const rel of files) {
    const full = path.join(appDir, rel);
    let text = await fs.readFile(full, "utf8");

    // Find start of real body: first export function/const after imports
    const bodyMatch = text.match(
      /\n(?=export (?:async )?function |export const MERMAID_THEME_CSS|marked\.setOptions|DOMPurify\.addHook)/,
    );
    if (!bodyMatch) {
      console.warn("skip (no body marker):", rel);
      continue;
    }
    const bodyStart = bodyMatch.index + 1;
    let body = text.slice(bodyStart);

    // Strip trailing hooks registrations then re-add after qualify
    const regMatch = body.match(/\nhooks\.\w+ = \w+;/);
    let registrations = "";
    if (regMatch) {
      const idx = body.indexOf(regMatch[0]);
      // find start of registration block (consecutive hooks.x = x)
      let regStart = idx;
      while (regStart > 0 && body[regStart - 1] === "\n") regStart--;
      // walk back to first hooks. assignment in a run at end
      const parts = body.split("\n");
      let i = parts.length - 1;
      while (i >= 0 && (parts[i] === "" || /^hooks\.\w+ = /.test(parts[i]))) {
        i--;
      }
      registrations = parts.slice(i + 1).filter(Boolean).join("\n");
      body = parts.slice(0, i + 1).join("\n").trimEnd() + "\n";
    }

    // Don't qualify local function names / exports
    const localFns = [...body.matchAll(/^export (?:async )?function (\w+)/gm)].map(
      (m) => m[1],
    );
    const localSet = new Set(localFns);

    const vendorNames = VENDOR.filter((n) => !localSet.has(n));
    const constNames = CONSTS.filter((n) => !localSet.has(n));
    const domNames = DOM_AND_STATE.filter((n) => n !== "state" && !localSet.has(n));
    const lazyNames = LAZY.filter((n) => !localSet.has(n));

    body = qualify(body, vendorNames, "V");
    body = qualify(body, constNames, "C");
    body = qualify(body, domNames, "$");
    body = qualify(body, lazyNames, "L");
    // state. already prefixed; ensure $.state not V.state
    body = body.replace(/\bV\.state\b/g, "$.state");
    body = body.replace(/\bC\.state\b/g, "$.state");
    // Fix state. already there — was not under $
    // Keep state.xxx as $.state.xxx for consistency? Currently state.xxx from rewriteState.
    // Map state. -> $.state.
    body = body.replace(/(?<![.$])\bstate\./g, "$.state.");

    // Fix accidental qualification of hooks
    body = body.replace(/\bV\.hooks\b/g, "hooks");
    body = body.replace(/\b\$\.hooks\b/g, "hooks");

    // Fix function declarations wrongly qualified
    body = body.replace(
      /^export (async )?function (?:V|C|\$|L)\.(\w+)/gm,
      "export $1function $2",
    );

    const depth = depthOf(rel);
    const p = depth === 0 ? "./" : "../".repeat(depth);

    const header = `import { hooks } from "${p}hooks.js";
import * as $ from "${p}state.js";
import * as C from "${p}constants.js";
import * as V from "${p}vendor-deps.js";
import * as L from "${p}lazy-modules.js";
import {
  ensureHljsLanguage,
  ensureHljsLanguagesForSource,
} from "${p}hljs-setup.js";

const {
  ${lazyNames.includes("ensureHljsLanguage") ? "" : ""}
} = L;
void ensureHljsLanguage;
void ensureHljsLanguagesForSource;
`;

    // Simpler header without the void nonsense
    const header2 = `import { hooks } from "${p}hooks.js";
import * as $ from "${p}state.js";
import * as C from "${p}constants.js";
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

`;

    // Re-bind locals used without prefix for hljs helpers that were L. qualified
    body = body.replace(/\bL\.ensureHljsLanguage\b/g, "ensureHljsLanguage");
    body = body.replace(
      /\bL\.ensureHljsLanguagesForSource\b/g,
      "ensureHljsLanguagesForSource",
    );
    body = body.replace(/\bL\.loadExportModule\b/g, "loadExportModule");
    body = body.replace(/\bL\.loadChromeAiModule\b/g, "loadChromeAiModule");
    body = body.replace(/\bL\.loadZenModule\b/g, "loadZenModule");
    body = body.replace(/\bL\.loadZenCss\b/g, "loadZenCss");
    body = body.replace(
      /\bL\.anyWritingAiGlobalPresent\b/g,
      "anyWritingAiGlobalPresent",
    );
    body = body.replace(/\bL\.CDN_INTEGRITY_URLS\b/g, "CDN_INTEGRITY_URLS");

    // Rebuild registrations from local fns
    const reg =
      localFns.map((f) => `hooks.${f} = ${f};`).join("\n") +
      (body.includes("MERMAID_THEME_CSS")
        ? "\nhooks.MERMAID_THEME_CSS = MERMAID_THEME_CSS;"
        : "");

    const out = `${header2}${body.trim()}\n\n${reg}\n`;
    await fs.writeFile(full, out, "utf8");
    console.log(`${rel}: ${out.split("\n").length} lines`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
