import { hooks } from "./hooks.js";
import {
  state,
  externalModal
} from "./state.js";

export function isExternalModalOpen() {
  return Boolean(externalModal?.open);
}

export function syncExternalModal() {
  if (!externalModal) return;
  const show = state.contentIsExternal;
  if (show) {
    if (!externalModal.open) {
      externalModal.returnValue = "";
      externalModal.showModal();
    }
  } else if (externalModal.open) {
    externalModal.returnValue = "";
    externalModal.close();
  }
}

/** Strip md / mdz from both the query string and the hash. */
export function clearShareMarkdownFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("md");
  url.searchParams.delete("mdz");

  if (url.hash.length > 1) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    hashParams.delete("md");
    hashParams.delete("mdz");
    if (
      hashParams.get("view") === "reader" ||
      hashParams.get("view") === "present" ||
      hashParams.get("view") === "slides"
    ) {
      hashParams.set("view", "edit");
    }
    url.hash = hashParams.toString();
  }

  history.replaceState(null, "", url);
}

hooks.isExternalModalOpen = isExternalModalOpen;
hooks.syncExternalModal = syncExternalModal;
hooks.clearShareMarkdownFromUrl = clearShareMarkdownFromUrl;
