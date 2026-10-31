/**
 * Re-export third-party and shared lib/markdown/drive/gist symbols used by app
 * domain modules so each file can use a short import header.
 */
export { alertExtension } from "../markdown/alert.js";
export { defListExtension } from "../markdown/deflist.js";
export { emojiExtension } from "../markdown/emoji.js";
export {
  collapseDataUris,
  collapseDataUrisPreservingSelection,
  collapsedEmbedUriTouched,
  expandEmbeds,
  findCollapsedEmbeds,
  formatEmbedMarkdown,
} from "../markdown/embeds.js";
export {
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertTable,
  prefixLines,
  wrapInline,
} from "../markdown/format-markdown.js";
export { frontmatterExtension } from "../markdown/frontmatter.js";
export { tablePipesExtension } from "../markdown/tablePipes.js";
export {
  clearStoredDirectory,
  createFile,
  createFolder,
  ensureEditableExtension,
  ensureHandlePermission,
  isEditableFileName,
  isFsAccessSupported,
  listDirectory,
  openDirectory,
  openWithPicker,
  readTextFileMeta,
  removeEntry,
  renameEntry,
  restoreDirectory,
  loadStoredCurrentFileHandle,
  resolveFilePath,
  revisionStampChanged,
  saveWithPicker,
  storeCurrentFileHandle,
  suggestedUntitledName,
  writeTextFile,
} from "../lib/fs.js";
export { stripRemoteMediaAttributes } from "../lib/safe-media-uri.js";
export { loadGoogleDriveConfig } from "../drive/google-drive-config.js";
export {
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
  getDriveFileMeta,
  listDriveFolderChildren,
  readDriveFileWithMeta,
  renameDriveItemWithToken,
  saveExistingDriveFile,
  trashDriveItemWithToken,
  tryRestoreDriveAccessToken,
} from "../drive/google-drive.js";
export { purgeLegacyCleartextToken } from "../drive/drive-token-vault.js";
export { loadGithubGistConfig } from "../gist/github-gist-config.js";
export {
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
  readGistFileWithMeta,
  setGistPersonalAccessToken,
  tryRestoreGistAccessToken,
  unlockGistAccessToken,
  updateGistFile,
  verifyGistToken,
} from "../gist/github-gist.js";
export { purgeLegacyCleartextToken as purgeLegacyGistCleartextToken } from "../gist/gist-token-vault.js";
export { applyPatch, contentHash, makeRevisionBody } from "../lib/history-diff.js";
export {
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
export {
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
export {
  compressUtf8ToBase64Url,
  readShareParams as readShareParamsFromUrl,
} from "../lib/share.js";
export {
  chunkSpeechText,
  listVoices as listVoicesFromList,
  voiceKey,
  voiceQualityScore,
  wordEndOffset,
} from "../lib/speech-text.js";
export { marked, Renderer } from "marked";
export { default as DOMPurify } from "dompurify";
export { default as hljs } from "highlight.js";
