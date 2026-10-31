import { hooks } from "../hooks.js";
import {
  state,
  panes,
  filesToggleBtn,
  filesDrawer,
  filesBackdrop,
  filesContextMenu,
  fsAccessSupported
} from "../state.js";
import {
  STORAGE_KEYS,
  DRAWER_CLOSE_SWIPE_MIN_DX
} from "../constants.js";

export function filesDrawerToggleNoun() {
  return fsAccessSupported || state.driveConfigured || state.gistConfigured ? "Files" : "Outline";
}

export function syncFilesToggleLabel() {
  if (!filesToggleBtn) return;
  const label = `${state.filesDrawerOpen ? "Hide" : "Show"} ${filesDrawerToggleNoun()}`;
  filesToggleBtn.title = label;
  filesToggleBtn.setAttribute("aria-label", label);
}

export function setFilesDrawerOpen(open, { persist = true, preserveDragWidth = false } = {}) {
  state.filesDrawerOpen = Boolean(open);
  document.body.classList.toggle("files-drawer-open", state.filesDrawerOpen);
  if (filesDrawer) {
    filesDrawer.setAttribute("aria-hidden", state.filesDrawerOpen ? "false" : "true");
    if (state.filesDrawerOpen) filesDrawer.removeAttribute("inert");
    else filesDrawer.setAttribute("inert", "");
  }
  if (filesBackdrop) {
    filesBackdrop.setAttribute("aria-hidden", state.filesDrawerOpen ? "false" : "true");
  }
  filesToggleBtn?.setAttribute("aria-pressed", state.filesDrawerOpen ? "true" : "false");
  syncFilesToggleLabel();
  if (!state.filesDrawerOpen) {
    state.drawerCloseDrag = null;
    document.body.classList.remove("files-drawer-dragging");
    if (!preserveDragWidth) filesDrawer?.style.removeProperty("width");
  }
  if (persist) {
    localStorage.setItem(STORAGE_KEYS.filesDrawer, state.filesDrawerOpen ? "1" : "0");
  }
}

export function toggleFilesDrawer() {
  setFilesDrawerOpen(!state.filesDrawerOpen);
}

export function onDrawerCloseDragPointerDown(e) {
  if (!state.filesDrawerOpen || !filesDrawer) return;
  // Mouse included so narrow desktop / DevTools can exercise the same gesture.
  if (e.pointerType === "pen") return;
  if (!hooks.isStackedLayout()) return;
  // Don't steal the splitter resize gesture.
  if (e.target.closest?.("#splitter")) return;
  state.drawerCloseDrag = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    width: filesDrawer.getBoundingClientRect().width,
    active: false,
  };
}

export function onDrawerCloseDragPointerMove(e) {
  if (!state.drawerCloseDrag || e.pointerId !== state.drawerCloseDrag.id || !filesDrawer) return;
  const dx = e.clientX - state.drawerCloseDrag.startX;
  const dy = e.clientY - state.drawerCloseDrag.startY;

  if (!state.drawerCloseDrag.active) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    // Commit only to a clear leftward drag so vertical scrolling still works.
    if (dx >= 0 || Math.abs(dx) <= Math.abs(dy)) {
      state.drawerCloseDrag = null;
      return;
    }
    state.drawerCloseDrag.active = true;
    document.body.classList.add("files-drawer-dragging");
    try {
      panes.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  if (state.drawerCloseDrag.active) e.preventDefault();

  // Shrink the drawer so the panes slide left over it with the finger.
  const next = Math.max(0, Math.min(state.drawerCloseDrag.width, state.drawerCloseDrag.width + dx));
  filesDrawer.style.width = `${next}px`;
}

export function finishDrawerCloseDrag(e, { cancelled = false } = {}) {
  if (!state.drawerCloseDrag || e.pointerId !== state.drawerCloseDrag.id) return;
  const { active, width: startWidth, startX } = state.drawerCloseDrag;
  const dx = e.clientX - startX;
  const currentWidth = filesDrawer?.getBoundingClientRect().width ?? startWidth;
  state.drawerCloseDrag = null;

  if (!filesDrawer || !active || cancelled) {
    document.body.classList.remove("files-drawer-dragging");
    filesDrawer?.style.removeProperty("width");
    return;
  }

  const shouldClose =
    currentWidth < startWidth * 0.5 || dx <= -DRAWER_CLOSE_SWIPE_MIN_DX;

  // Re-enable transitions while still at the dragged width, then settle.
  filesDrawer.style.width = `${currentWidth}px`;
  document.body.classList.remove("files-drawer-dragging");
  void filesDrawer.offsetWidth;

  if (shouldClose) {
    setFilesDrawerOpen(false, { preserveDragWidth: true });
    filesDrawer.style.removeProperty("width");
  } else {
    // Snap the drawer back open under the panes.
    filesDrawer.style.removeProperty("width");
  }
}

export function onDrawerCloseDragPointerUp(e) {
  finishDrawerCloseDrag(e);
}

export function onDrawerCloseDragPointerCancel(e) {
  // If the browser cancelled after we already claimed the gesture, still finish
  // from the last dragged width instead of snapping open and ignoring the drag.
  finishDrawerCloseDrag(e, { cancelled: !state.drawerCloseDrag?.active });
}

export function closeFilesContextMenu() {
  if (!filesContextMenu) return;
  filesContextMenu.hidden = true;
  state.contextTarget = null;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {{ id?: string, kind: "file"|"directory" }} target
 */
export function openFilesContextMenu(x, y, target) {
  if (!filesContextMenu) return;
  const id = target.id || "";
  state.contextTarget = { id, kind: target.kind };
  const newFileItem = filesContextMenu.querySelector('[data-fs-action="new-file"]');
  const newFolderItem = filesContextMenu.querySelector('[data-fs-action="new-folder"]');
  const renameItem = filesContextMenu.querySelector('[data-fs-action="rename"]');
  const deleteItem = filesContextMenu.querySelector('[data-fs-action="delete"]');
  const gistMode = hooks.isGistFilesSource();
  // Gists are flat: empty-area creates a new private gist; no folders/rename.
  const showCreate = gistMode ? !id : target.kind === "directory";
  const showNewFolder = showCreate && !gistMode;
  const canMutate = Boolean(id);
  const canRename = canMutate && !gistMode;
  if (newFileItem?.parentElement) newFileItem.parentElement.hidden = !showCreate;
  if (newFolderItem?.parentElement) newFolderItem.parentElement.hidden = !showNewFolder;
  if (renameItem?.parentElement) renameItem.parentElement.hidden = !canRename;
  if (deleteItem?.parentElement) deleteItem.parentElement.hidden = !canMutate;

  filesContextMenu.hidden = false;
  const rect = filesContextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  filesContextMenu.style.left = `${Math.max(8, left)}px`;
  filesContextMenu.style.top = `${Math.max(8, top)}px`;
}

hooks.filesDrawerToggleNoun = filesDrawerToggleNoun;
hooks.syncFilesToggleLabel = syncFilesToggleLabel;
hooks.setFilesDrawerOpen = setFilesDrawerOpen;
hooks.toggleFilesDrawer = toggleFilesDrawer;
hooks.onDrawerCloseDragPointerDown = onDrawerCloseDragPointerDown;
hooks.onDrawerCloseDragPointerMove = onDrawerCloseDragPointerMove;
hooks.finishDrawerCloseDrag = finishDrawerCloseDrag;
hooks.onDrawerCloseDragPointerUp = onDrawerCloseDragPointerUp;
hooks.onDrawerCloseDragPointerCancel = onDrawerCloseDragPointerCancel;
hooks.closeFilesContextMenu = closeFilesContextMenu;
hooks.openFilesContextMenu = openFilesContextMenu;
