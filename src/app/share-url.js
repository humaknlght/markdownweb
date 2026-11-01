import { hooks } from "./hooks.js";
import {
  themeSelect
} from "./state.js";
import {
  THEMES,
  VIEWS
} from "./constants.js";
import {
  compressUtf8ToBase64Url,
  readShareParamsFromUrl
} from "./vendor-deps.js";

export async function readShareParams(searchParams) {
  return readShareParamsFromUrl(searchParams, { themes: THEMES, views: VIEWS });
}

export async function getShareState() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    const fromHash = await readShareParams(new URLSearchParams(hash));
    if (fromHash.markdown != null || fromHash.theme || fromHash.view) {
      return fromHash;
    }
  }

  return readShareParams(new URLSearchParams(window.location.search));
}

export async function buildShareUrl({ markdown, theme } = {}) {
  const url = new URL(window.location.href);
  url.search = "";
  const params = new URLSearchParams();
  params.set("mdz", await compressUtf8ToBase64Url(markdown ?? hooks.getMarkdownSource()));
  const nextTheme = theme || document.documentElement.dataset.theme || themeSelect.value;
  if (THEMES.includes(nextTheme)) params.set("theme", nextTheme);
  // Always edit: recipients need the source pane to identify the doc before Accept.
  params.set("view", "edit");
  url.hash = params.toString();
  return url.toString();
}

hooks.readShareParams = readShareParams;
hooks.getShareState = getShareState;
hooks.buildShareUrl = buildShareUrl;
