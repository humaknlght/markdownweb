import { hooks } from "./hooks.js";
import {
  state,
  saveBtn,
  fsAccessSupported,
  isStandaloneDisplay
} from "./state.js";

export function appBadgeNeedsNotificationPermission() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

/**
 * On macOS/iOS, setAppBadge succeeds without permission but the Dock / home-screen
 * badge stays hidden. Ask once from the installed PWA when edits become unsaved.
 */
export async function ensureAppBadgePermission() {
  if (!appBadgeNeedsNotificationPermission()) return;
  if (!isStandaloneDisplay()) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  if (state.appBadgePermissionPrompted) return;
  state.appBadgePermissionPrompted = true;
  try {
    hooks.showToast("Allow notifications to badge the app icon when unsaved");
    await Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

/** Show a generic OS app-icon flag when there are unsaved edits (installed PWA). */
export function updateUnsavedAppBadge(dirty = hooks.isDirty()) {
  if (!("setAppBadge" in navigator) || !("clearAppBadge" in navigator)) return;
  try {
    if (dirty) {
      // Request permission first on Apple platforms (may be a no-op), then flag badge.
      void ensureAppBadgePermission()
        .then(() => navigator.setAppBadge())
        .catch(() => {});
    } else {
      void navigator.clearAppBadge().catch(() => {});
    }
  } catch {
    /* NotAllowedError / InvalidStateError — ignore */
  }
}

/** @type {{ link: HTMLLinkElement, href: string }[] | null} */
/** @type {boolean | null} */
/** @type {string | null} */

export function faviconIconLinks() {
  return [...document.querySelectorAll('link[rel="icon"]')];
}

export function captureCleanFavicons() {
  if (state.faviconCleanEntries) return;
  state.faviconCleanEntries = faviconIconLinks().map((link) => ({
    link,
    href: link.getAttribute("href") || link.href,
  }));
}

export function applyFaviconHref(href) {
  for (const { link } of state.faviconCleanEntries || []) {
    link.href = href;
  }
}

export function restoreCleanFavicons() {
  for (const { link, href } of state.faviconCleanEntries || []) {
    link.href = href;
  }
}

/** Composite a corner badge onto the tab favicon while the document is unsaved. */
export function updateUnsavedFavicon(dirty = hooks.isDirty()) {
  if (state.faviconDirtyApplied === dirty) return;
  state.faviconDirtyApplied = dirty;
  captureCleanFavicons();
  if (!state.faviconCleanEntries?.length) return;

  if (!dirty) {
    state.faviconDirtyGen += 1;
    restoreCleanFavicons();
    return;
  }

  if (state.faviconDirtyHref) {
    applyFaviconHref(state.faviconDirtyHref);
    return;
  }

  const gen = ++state.faviconDirtyGen;
  const sourceHref = state.faviconCleanEntries[0].href;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    if (gen !== state.faviconDirtyGen || !state.faviconDirtyApplied) return;
    try {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const radius = size * 0.18;
      const cx = size - radius - size * 0.06;
      const cy = radius + size * 0.06;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#f85149";
      ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.05);
      ctx.strokeStyle = "#0d1117";
      ctx.stroke();
      state.faviconDirtyHref = canvas.toDataURL("image/png");
      applyFaviconHref(state.faviconDirtyHref);
    } catch {
      /* canvas taint / missing 2d — leave clean favicon */
    }
  };
  img.onerror = () => {
    /* keep clean favicon */
  };
  img.src = sourceHref;
}

export function canSaveDocument() {
  return (
    fsAccessSupported ||
    Boolean(state.currentDriveFile) ||
    Boolean(state.currentGistFile) ||
    state.driveConfigured ||
    state.gistConfigured
  );
}

export function updateSaveButton() {
  const dirty = hooks.isDirty();
  updateUnsavedAppBadge(dirty);
  updateUnsavedFavicon(dirty);
  if (!saveBtn || !canSaveDocument()) return;
  saveBtn.classList.toggle("is-dirty", dirty);
  saveBtn.title = dirty
    ? `Save unsaved changes (Ctrl/Cmd+S)`
    : state.currentFileName
      ? `Save ${state.currentFileName} (Ctrl/Cmd+S)`
      : "Save (Ctrl/Cmd+S)";
}

hooks.appBadgeNeedsNotificationPermission = appBadgeNeedsNotificationPermission;
hooks.ensureAppBadgePermission = ensureAppBadgePermission;
hooks.updateUnsavedAppBadge = updateUnsavedAppBadge;
hooks.faviconIconLinks = faviconIconLinks;
hooks.captureCleanFavicons = captureCleanFavicons;
hooks.applyFaviconHref = applyFaviconHref;
hooks.restoreCleanFavicons = restoreCleanFavicons;
hooks.updateUnsavedFavicon = updateUnsavedFavicon;
hooks.canSaveDocument = canSaveDocument;
hooks.updateSaveButton = updateSaveButton;
