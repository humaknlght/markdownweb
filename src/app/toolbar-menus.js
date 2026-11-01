import { hooks } from "./hooks.js";
import {
  state,
  shareMenu,
  exportMenu,
  writingToolsMenu,
  voiceMenu,
  headingMenu,
  imageMenu,
  formatMoreMenu,
  historyMenu,
  toolbarMenu,
  toolbarBar,
  toolbarActions,
  overflowBtn,
  viewModeMenu,
  mermaidZoomDialog,
  filesContextMenu
} from "./state.js";
import {
  NARROW_MQ
} from "./constants.js";

export function openOverflowMenu() {
  toolbarMenu.classList.add("is-open");
  overflowBtn.setAttribute("aria-expanded", "true");
  overflowBtn.setAttribute("aria-label", "Close more");
}

export function closeOverflowMenu() {
  toolbarMenu.classList.remove("is-open");
  overflowBtn.setAttribute("aria-expanded", "false");
  overflowBtn.setAttribute("aria-label", "More");
  hooks.closeHistory();
  hooks.closeVoiceMenu();
  hooks.closeShareMenu();
  hooks.closeExportMenu();
  hooks.closeWritingToolsMenu();
  hooks.closeViewModeMenu();
  hooks.closeHeadingMenu();
  hooks.closeImageMenu();
  hooks.closeFormatMoreMenu();
}

export function toggleOverflowMenu() {
  if (toolbarMenu.classList.contains("is-open")) closeOverflowMenu();
  else openOverflowMenu();
}

/** Desktop: #toolbar-bar in the header row. Narrow: first child of the overflow panel. */
export function syncToolbarBarPlacement() {
  if (!toolbarBar || !toolbarActions || !toolbarMenu) return;
  const narrow = window.matchMedia(NARROW_MQ).matches;
  if (narrow) {
    if (toolbarBar.parentElement !== toolbarActions) {
      toolbarActions.insertBefore(toolbarBar, toolbarActions.firstChild);
    }
  } else if (toolbarBar.parentElement === toolbarActions) {
    toolbarMenu.insertBefore(toolbarBar, toolbarActions);
  }
}

/** Close the topmost open menu/drawer. Returns true if something was dismissed. */
export function dismissOpenOverlay() {
  if (mermaidZoomDialog?.open) {
    hooks.closeMermaidZoom();
    return true;
  }
  if (viewModeMenu && !viewModeMenu.hidden) {
    hooks.closeViewModeMenu();
    return true;
  }
  if (headingMenu && !headingMenu.hidden) {
    hooks.closeHeadingMenu();
    return true;
  }
  if (imageMenu && !imageMenu.hidden) {
    hooks.closeImageMenu();
    return true;
  }
  if (formatMoreMenu && !formatMoreMenu.hidden) {
    hooks.closeFormatMoreMenu();
    return true;
  }
  if (historyMenu && !historyMenu.hidden) {
    hooks.closeHistory();
    return true;
  }
  if (voiceMenu && !voiceMenu.hidden) {
    hooks.closeVoiceMenu();
    return true;
  }
  if (shareMenu && !shareMenu.hidden) {
    hooks.closeShareMenu();
    return true;
  }
  if (exportMenu && !exportMenu.hidden) {
    hooks.closeExportMenu();
    return true;
  }
  if (writingToolsMenu && !writingToolsMenu.hidden) {
    hooks.closeWritingToolsMenu();
    return true;
  }
  if (toolbarMenu?.classList.contains("is-open")) {
    closeOverflowMenu();
    return true;
  }
  if (filesContextMenu && !filesContextMenu.hidden) {
    hooks.closeFilesContextMenu();
    return true;
  }
  if (state.filesDrawerOpen && window.matchMedia(NARROW_MQ).matches) {
    hooks.setFilesDrawerOpen(false);
    return true;
  }
  return false;
}

hooks.openOverflowMenu = openOverflowMenu;
hooks.closeOverflowMenu = closeOverflowMenu;
hooks.toggleOverflowMenu = toggleOverflowMenu;
hooks.syncToolbarBarPlacement = syncToolbarBarPlacement;
hooks.dismissOpenOverlay = dismissOpenOverlay;
