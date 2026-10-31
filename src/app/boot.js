import { hooks } from "./hooks.js";
import {
  state,
  panes
} from "./state.js";
import {
  STORAGE_KEYS,
  THEMES,
  WIDTHS,
  MERMAID_LOOKS
} from "./constants.js";
import {
  loadGoogleDriveConfig,
  googleDriveEnabled,
  tryRestoreDriveAccessToken,
  loadGithubGistConfig,
  githubGistEnabled,
  tryRestoreGistAccessToken,
  getTip,
  probeHistoryIdb,
  setDraft
} from "./vendor-deps.js";

export async function init() {
  state.guideSession = hooks.hasGuideUrlFlag();
  const shareState = await hooks.getShareState();
  const fromUrl = shareState.markdown;
  let seededFromGuide = false;

  if (shareState.theme) {
    hooks.setTheme(shareState.theme, { persist: false });
  } else {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
    if (savedTheme && THEMES.includes(savedTheme)) {
      hooks.setTheme(savedTheme);
    } else {
      hooks.setTheme(hooks.preferredGithubTheme(), { persist: false });
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onSchemeChange = () => {
        if (!localStorage.getItem(STORAGE_KEYS.theme)) {
          hooks.setTheme(hooks.preferredGithubTheme(), { persist: false });
          hooks.renderMarkdown(hooks.getMarkdownSource());
        }
      };
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", onSchemeChange);
      } else if (typeof media.addListener === "function") {
        media.addListener(onSchemeChange);
      }
    }
  }

  const savedWidth = localStorage.getItem(STORAGE_KEYS.width);
  hooks.setPreviewWidth(WIDTHS.includes(savedWidth) ? savedWidth : "readable", { persist: false });
  const savedMermaidLook = localStorage.getItem(STORAGE_KEYS.mermaidLook);
  hooks.setMermaidLook(MERMAID_LOOKS.includes(savedMermaidLook) ? savedMermaidLook : "classic", {
    persist: false,
    rerender: false,
  });
  hooks.applyCollapseState();
  hooks.setupSplitter();
  hooks.setupDragAndDrop();
  hooks.setupPwa();
  await loadGoogleDriveConfig();
  state.driveConfigured = googleDriveEnabled();
  await loadGithubGistConfig();
  state.gistConfigured = githubGistEnabled();
  hooks.setupFilesDrawer();
  hooks.setupDocOutline();
  hooks.setupMermaidZoom();
  hooks.setupStorageSync();
  state.historyIdbReady = await probeHistoryIdb();
  if (state.historyIdbReady) {
    await hooks.migrateHistoryIfNeeded();
    await hooks.hydrateHistoryIndexFromIdb();
  }
  // Sequential: file binding restore reads rootDirHandle set by directory restore.
  // Drive tree refresh waits until after local restore so both cannot race into #files-tree.
  await hooks.restoreFilesDirectoryOnLoad();
  if (state.guideSession) {
    // Help-preview tabs must not adopt the other tab's open file.
    hooks.clearCurrentFileBinding();
  } else {
    await hooks.restoreCurrentFileBindingOnLoad();
  }
  if (state.driveConfigured) {
    // Token is memory-only; refresh always needs Unlock (PRF) or Connect.
    state.driveConnected = await tryRestoreDriveAccessToken();
    hooks.updateFilesChrome();
  }
  if (state.gistConfigured) {
    state.gistConnected = await tryRestoreGistAccessToken();
    hooks.updateFilesChrome();
  }
  if (state.driveConfigured && state.driveConnected && hooks.isDriveFilesSource()) {
    await hooks.refreshDriveTree();
  }
  if (state.gistConfigured && state.gistConnected && hooks.isGistFilesSource()) {
    await hooks.refreshGistTree();
  }

  const savedSyncScroll = localStorage.getItem(STORAGE_KEYS.syncScroll) === "1";
  hooks.setSyncScroll(savedSyncScroll, { persist: false });
  const savedLineWrap = localStorage.getItem(STORAGE_KEYS.lineWrap);
  hooks.setLineWrap(savedLineWrap == null ? true : savedLineWrap === "1", { persist: false });

  // URL markdown that matches our own draft/tip is local residue (e.g. an old
  // view-sync that wrote mdz), not untrusted external content.
  let urlIsExternal = fromUrl != null;
  if (fromUrl != null && !state.guideSession) {
    const storedDraft = await hooks.loadStoredDraftContent();
    const tip = state.historyIdbReady ? await getTip() : null;
    const matchesLocal =
      storedDraft === fromUrl ||
      (storedDraft == null && tip?.content === fromUrl);
    if (matchesLocal) {
      urlIsExternal = false;
      state.pendingExternalFromUrl = false;
      const content = storedDraft ?? fromUrl;
      await hooks.persistDraft(content);
      hooks.setEditorValue(content);
      state.lastHistoryContent = content;
      hooks.setContentExternal(false);
      hooks.clearShareMarkdownFromUrl();
    } else {
      hooks.stashPreExternalState(storedDraft ?? "");
      state.pendingExternalFromUrl = true;
      hooks.setEditorValue(fromUrl);
      state.lastHistoryContent = "";
      hooks.setContentExternal(true);
      hooks.clearCurrentFileBinding();
    }
  } else if (state.guideSession) {
    // Dedicated help tab: load GUIDE as trusted preview; do not touch drafts.
    urlIsExternal = false;
    state.pendingExternalFromUrl = false;
    const guide = await hooks.getDefaultGuide();
    seededFromGuide = Boolean(guide);
    hooks.setEditorValue(guide ?? "");
    state.lastHistoryContent = guide ?? "";
    hooks.setContentExternal(false);
  } else {
    state.pendingExternalFromUrl = false;
    // Prefer IndexedDB draft for this doc; fall back to localStorage mirror; seed GUIDE once.
    let draft = await hooks.loadStoredDraftContent();
    if (draft == null && hooks.currentDocKey() !== "untitled") {
      // Upgrade from pre-scoped single draft (migrated to "untitled").
      const legacy = await hooks.loadStoredDraftContent("untitled");
      if (legacy != null) {
        draft = legacy;
        if (state.historyIdbReady) await setDraft(legacy, hooks.currentDocKey());
      }
    }
    if (draft == null) {
      draft = await hooks.getDefaultGuide();
      seededFromGuide = Boolean(draft);
    }
    await hooks.persistDraft(draft ?? "");
    hooks.setEditorValue(draft ?? "");
    state.lastHistoryContent = draft ?? "";
    hooks.setContentExternal(false);
  }

  // Dirty = editor differs from last disk save or accepted URL baseline.
  // Draft auto-save alone never marks clean.
  try {
    if (state.guideSession) {
      // Ephemeral help tab — keep clean without writing saved snapshots.
      state.savedSnapshot = hooks.getMarkdownSource();
      hooks.updateSaveButton();
    } else if (state.pendingExternalFromUrl) {
      // Keep prior savedSnapshot from stash path; Accept will mark clean.
      hooks.updateSaveButton();
    } else if (state.currentFileHandle) {
      let storedSnapshot = hooks.readSavedSnapshot(hooks.currentDocKey());
      if (storedSnapshot == null && state.currentFileName && hooks.currentDocKey() !== "untitled") {
        const legacySnap = hooks.readSavedSnapshot("untitled");
        if (legacySnap != null) {
          storedSnapshot = legacySnap;
          hooks.writeSavedSnapshot(hooks.currentDocKey(), legacySnap);
        }
      }
      if (storedSnapshot != null) {
        state.savedSnapshot = storedSnapshot;
        hooks.updateSaveButton();
      } else {
        // Bound file with no snapshot yet — treat current text as matching disk.
        hooks.markCleanFromEditor();
      }
    } else {
      // Untitled: dirty until disk save — except the default GUIDE seed, which is
      // starter reading material, not a document the user needs to write out.
      if (seededFromGuide) {
        state.savedSnapshot = hooks.getMarkdownSource();
        hooks.writeSavedSnapshot(hooks.currentDocKey(), state.savedSnapshot);
        hooks.updateSaveButton();
      } else {
        const storedSnapshot = hooks.readSavedSnapshot(hooks.currentDocKey());
        if (storedSnapshot != null) {
          state.savedSnapshot = storedSnapshot;
          hooks.updateSaveButton();
        } else {
          // One-time recognition of a persisted GUIDE draft (no snapshot yet).
          const source = hooks.getMarkdownSource();
          if (!source) {
            hooks.markDirtyBaseline();
            hooks.writeSavedSnapshot(hooks.currentDocKey(), "");
          } else {
            const guide = await hooks.getDefaultGuide();
            if (guide && source === guide) {
              state.savedSnapshot = guide;
              hooks.writeSavedSnapshot(hooks.currentDocKey(), guide);
              hooks.updateSaveButton();
            } else {
              hooks.markDirtyBaseline();
              // Persist empty baseline so we do not re-fetch GUIDE on every boot.
              hooks.writeSavedSnapshot(hooks.currentDocKey(), "");
            }
          }
        }
      }
    }
  } catch {
    hooks.markDirtyBaseline();
  }

  const initialView = urlIsExternal
    ? "edit"
    : shareState.view || (state.guideSession ? "reader" : "edit");
  hooks.setView(initialView, { syncUrl: fromUrl != null || state.guideSession });

  // After draft/URL load so a launched file overwrites the restored editor.
  hooks.setupFileHandling();

  // Commit the restored layout before revealing the panes, so the stored
  // position is the first one shown and later collapses still animate.
  void getComputedStyle(panes).gridTemplateColumns;
  document.documentElement.classList.remove("is-booting");

  // Paint the shell first, then render — large drafts can block marked/DOMPurify
  // for well over a second; the preview shows a delayed spinner while that runs.
  void hooks.renderMarkdown(hooks.getMarkdownSource());

  hooks.setupBootListeners();
}

hooks.init = init;
