import { hooks } from "./hooks.js";
import {
  state,
  editor,
  preview,
  viewModeMainBtn,
  viewModeMenuBtn,
  viewModeMenu,
  presentChrome,
  presentExitBtn,
  presentProgress
} from "./state.js";
import {
  THEMES,
  VIEWS,
  PRESENT_CHROME_IDLE_MS,
  PRESENT_SWIPE_MIN_DX
} from "./constants.js";

export function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export async function enterPresentFullscreen() {
  if (getFullscreenElement()) return;
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) return;
  try {
    await request.call(el);
  } catch {
    // Denied or missing user gesture — present mode still works windowed.
  }
}

export async function leavePresentFullscreen() {
  if (!getFullscreenElement()) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit) return;
  try {
    await exit.call(document);
  } catch {
    // ignore
  }
}

export function viewAfterPresent() {
  if (state.viewBeforePresent && state.viewBeforePresent !== "present" && VIEWS.includes(state.viewBeforePresent)) {
    return state.viewBeforePresent;
  }
  return "slides";
}

export function clearPresentChromeHideTimer() {
  if (state.presentChromeHideTimer) {
    clearTimeout(state.presentChromeHideTimer);
    state.presentChromeHideTimer = 0;
  }
}

export function setPresentChromeActive(active) {
  presentChrome?.classList.toggle("is-active", active);
}

export function schedulePresentChromeHide() {
  clearPresentChromeHideTimer();
  state.presentChromeHideTimer = window.setTimeout(() => {
    state.presentChromeHideTimer = 0;
    if (state.currentView === "present") setPresentChromeActive(false);
  }, PRESENT_CHROME_IDLE_MS);
}

export function revealPresentChrome() {
  if (state.currentView !== "present" || !presentChrome || presentChrome.hidden) return;
  setPresentChromeActive(true);
  schedulePresentChromeHide();
}

export function syncPresentChromeAutohide() {
  clearPresentChromeHideTimer();
  if (state.currentView === "present") {
    revealPresentChrome();
  } else {
    setPresentChromeActive(false);
  }
}

export function onPresentChromePointerActivity() {
  revealPresentChrome();
}

export function onPresentSwipePointerDown(e) {
  if (state.currentView !== "present") return;
  if (e.pointerType !== "touch") return;
  if (e.target.closest?.("#present-chrome")) return;
  state.presentSwipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
}

export function onPresentSwipePointerUp(e) {
  if (!state.presentSwipe || e.pointerId !== state.presentSwipe.id) return;
  const dx = e.clientX - state.presentSwipe.x;
  const dy = e.clientY - state.presentSwipe.y;
  state.presentSwipe = null;
  if (state.currentView !== "present") return;
  if (Math.abs(dx) < PRESENT_SWIPE_MIN_DX) return;
  if (Math.abs(dx) <= Math.abs(dy)) return;
  if (dx < 0) presentNext();
  else presentPrev();
  revealPresentChrome();
}

export function onPresentSwipePointerCancel(e) {
  if (state.presentSwipe && e.pointerId === state.presentSwipe.id) state.presentSwipe = null;
}

export function onPresentFullscreenChange() {
  if (state.currentView !== "present") return;
  if (getFullscreenElement()) return;
  // Browser left fullscreen (e.g. Esc) — leave present mode with it.
  hooks.setView(viewAfterPresent());
}

export function enterPresentMode() {
  if (state.currentView !== "present") {
    state.viewBeforePresent = state.currentView;
  }
  hooks.setView("present");
  void enterPresentFullscreen();
}

export function enterSlidesMode() {
  hooks.setView("slides");
}

/** Landscape pages when printing a slide deck; clear afterward so edit print stays default. */
export function syncPrintPageOrientation() {
  let el = document.getElementById("print-orientation-style");
  if (!el) {
    el = document.createElement("style");
    el.id = "print-orientation-style";
    document.head.appendChild(el);
  }
  const landscape = state.currentView === "slides" || state.currentView === "present";
  el.textContent = landscape
    ? "@media print { @page { size: landscape; margin: 0.5in; } }"
    : "";
}

export function clearPrintPageOrientation() {
  const el = document.getElementById("print-orientation-style");
  if (el) el.textContent = "";
}

export function exitPresentMode() {
  if (state.currentView === "slides") {
    hooks.setView("edit");
    return;
  }
  hooks.setView(viewAfterPresent());
}

export function presentNext() {
  if (!hooks.isSlideNavView()) return;
  hooks.showPresentSection(state.presentIndex + 1);
  hooks.syncEditorToPresentSection();
}

export function presentPrev() {
  if (!hooks.isSlideNavView()) return;
  hooks.showPresentSection(state.presentIndex - 1);
  hooks.syncEditorToPresentSection();
}

hooks.getFullscreenElement = getFullscreenElement;
hooks.enterPresentFullscreen = enterPresentFullscreen;
hooks.leavePresentFullscreen = leavePresentFullscreen;
hooks.viewAfterPresent = viewAfterPresent;
hooks.clearPresentChromeHideTimer = clearPresentChromeHideTimer;
hooks.setPresentChromeActive = setPresentChromeActive;
hooks.schedulePresentChromeHide = schedulePresentChromeHide;
hooks.revealPresentChrome = revealPresentChrome;
hooks.syncPresentChromeAutohide = syncPresentChromeAutohide;
hooks.onPresentChromePointerActivity = onPresentChromePointerActivity;
hooks.onPresentSwipePointerDown = onPresentSwipePointerDown;
hooks.onPresentSwipePointerUp = onPresentSwipePointerUp;
hooks.onPresentSwipePointerCancel = onPresentSwipePointerCancel;
hooks.onPresentFullscreenChange = onPresentFullscreenChange;
hooks.enterPresentMode = enterPresentMode;
hooks.enterSlidesMode = enterSlidesMode;
hooks.syncPrintPageOrientation = syncPrintPageOrientation;
hooks.clearPrintPageOrientation = clearPrintPageOrientation;
hooks.exitPresentMode = exitPresentMode;
hooks.presentNext = presentNext;
hooks.presentPrev = presentPrev;
