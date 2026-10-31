/**
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

import "./marked-setup.js";
import "./editor.js";
import "./marked-renderer.js";
import "./mermaid/normalize.js";
import "./mermaid/theme-css.js";
import "./mermaid/color.js";
import "./mermaid/sketch.js";
import "./mermaid/load.js";
import "./mermaid/render.js";
import "./mermaid/zoom.js";
import "./mermaid/render-layout.js";
import "./ui-feedback.js";
import "./external-trust.js";
import "./draft-storage.js";
import "./history-rewrite.js";
import "./pwa.js";
import "./share-url.js";
import "./render-markdown.js";
import "./history-commit.js";
import "./history-push.js";
import "./history-ui.js";
import "./toolbar-menus.js";
import "./theme-layout.js";
import "./splitter.js";
import "./sync-scroll.js";
import "./sync-scroll-caret.js";
import "./format-bar.js";
import "./format-menus.js";
import "./document-model.js";
import "./document-chrome.js";
import "./files/drawer.js";
import "./files/chrome.js";
import "./files/tree-ui.js";
import "./files/drive-tree.js";
import "./files/gist-tree.js";
import "./files/local-tree.js";
import "./files/local-crud.js";
import "./files/save.js";
import "./sections-folds.js";
import "./sections-fold-anim.js";
import "./sections-outline.js";
import "./files/bootstrap.js";
import "./files/open-drop.js";
import "./open-export.js";
import "./view-present.js";
import "./view-present-chrome.js";
import "./speech/tracks.js";
import "./speech/highlight.js";
import "./speech/session.js";
import "./speech/speak.js";
import "./speech/ui.js";
import "./guide.js";
import "./chrome-ai/setup.js";
import "./boot-listeners-core.js";
import "./boot-listeners-ui.js";
import "./boot-listeners.js";
import "./boot.js";

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
