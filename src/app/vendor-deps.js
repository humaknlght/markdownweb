/**
 * Re-export third-party and shared lib/markdown/drive/gist symbols used by app
 * domain modules so each file can use a short import header.
 */

export { default as DOMPurify } from "dompurify";
export { default as hljs } from "highlight.js";
export { marked, Renderer } from "marked";
export { purgeLegacyCleartextToken } from "../drive/drive-token-vault.js";
export {
  clearDriveAccessToken,
  createDriveFileWithToken,
  createDriveFolderWithToken,
  DRIVE_DEFAULT_FOLDER_NAME,
  ensureDriveAccessToken,
  ensureDriveAppFolder,
  getDriveAccessToken,
  getDriveFileMeta,
  googleDriveEnabled,
  hasSealedDriveSession,
  isDriveSessionMemoryOnly,
  listDriveFolderChildren,
  readDriveFileWithMeta,
  renameDriveItemWithToken,
  saveExistingDriveFile,
  trashDriveItemWithToken,
  tryRestoreDriveAccessToken,
} from "../drive/google-drive.js";
export { loadGoogleDriveConfig } from "../drive/google-drive-config.js";
export { purgeLegacyCleartextToken as purgeLegacyGistCleartextToken } from "../gist/gist-token-vault.js";
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
export { loadGithubGistConfig } from "../gist/github-gist-config.js";
export {
  clearStoredDirectory,
  createFile,
  createFolder,
  ensureEditableExtension,
  ensureHandlePermission,
  isEditableFileName,
  isFsAccessSupported,
  listDirectory,
  loadStoredCurrentFileHandle,
  openDirectory,
  openWithPicker,
  readTextFileMeta,
  removeEntry,
  renameEntry,
  resolveFilePath,
  restoreDirectory,
  revisionStampChanged,
  saveWithPicker,
  storeCurrentFileHandle,
  suggestedUntitledName,
  writeTextFile,
} from "../lib/fs.js";
export {
  applyPatch,
  contentHash,
  makeRevisionBody,
} from "../lib/history-diff.js";
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
  applyLinkTargetAttributes,
  installMarkdownLinkHooks,
  isSameDocumentHref,
  shouldOpenLinkInNewTab,
} from "../lib/link-targets.js";
export { stripRemoteMediaAttributes } from "../lib/safe-media-uri.js";
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
export { abbrExtension } from "../markdown/abbr.js";
export { alertExtension } from "../markdown/alert.js";
export { defListExtension } from "../markdown/deflist.js";
export {
  collapseDataUris,
  collapseDataUrisPreservingSelection,
  collapsedEmbedUriTouched,
  expandEmbeds,
  findCollapsedEmbeds,
  formatEmbedMarkdown,
} from "../markdown/embeds.js";
export { emojiExtension } from "../markdown/emoji.js";
export { footnoteExtension } from "../markdown/footnotes.js";
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
export { headingIdExtension } from "../markdown/heading-ids.js";
export { markHighlightExtension } from "../markdown/mark-highlight.js";
export {
  canonicalHljsLang,
  clampSplit,
  collectEditorLanguages,
  escapeHtml,
  formatRelativeTime,
  HLJS_LANG_ALIASES,
  highlightEditorMarkdown,
  joinFsPath,
  parentPathOf,
  parseDraftMirror,
  SPLIT_MAX,
  SPLIT_MIN,
  titleFromMarkdown,
  wrapHighlightedLines,
} from "../markdown/markdown-utils.js";
export { subSupExtension } from "../markdown/subsup.js";
export { tablePipesExtension } from "../markdown/tablePipes.js";
