/**
 * Same-origin url-fetch-helper protocol + URL validation (shared by helper + app).
 */

export const URL_FETCH_MSG_TYPE = "md-editor:url-fetch";
export const URL_FETCH_MSG_VERSION = 1;
export const URL_FETCH_HELPER_PATH = "./url-fetch-helper/";

/** Soft cap for remote Markdown bodies (~1 MiB of UTF-8). */
export const URL_FETCH_MAX_BYTES = 1 * 1024 * 1024;

/** Fetch timeout inside the helper. */
export const URL_FETCH_TIMEOUT_MS = 30_000;

/**
 * @typedef {{
 *   type: typeof URL_FETCH_MSG_TYPE,
 *   v: number,
 *   action: string,
 *   req?: string,
 *   url?: string,
 *   authorization?: string,
 *   content?: string,
 *   name?: string,
 *   error?: string,
 *   code?: string,
 * }} UrlFetchMessage
 */

/**
 * @param {unknown} data
 * @returns {data is UrlFetchMessage}
 */
export function isUrlFetchMessage(data) {
  if (!data || typeof data !== "object") return false;
  const msg = /** @type {Record<string, unknown>} */ (data);
  return (
    msg.type === URL_FETCH_MSG_TYPE &&
    msg.v === URL_FETCH_MSG_VERSION &&
    typeof msg.action === "string"
  );
}

/**
 * @param {Partial<UrlFetchMessage> & { action: string }} fields
 * @returns {UrlFetchMessage}
 */
export function makeUrlFetchMessage(fields) {
  return {
    type: URL_FETCH_MSG_TYPE,
    v: URL_FETCH_MSG_VERSION,
    ...fields,
  };
}

/**
 * Absolute https URLs only (no credentials in the URL userinfo).
 * @param {string} value
 * @returns {URL | null}
 */
export function parseHttpsUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url;
}

/**
 * File name hint from a URL path (last segment), or untitled.md.
 * @param {string | URL} value
 * @returns {string}
 */
export function fileNameFromUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value));
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    if (last && !last.includes("\\")) {
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    }
  } catch {
    /* ignore */
  }
  return "untitled.md";
}

/**
 * Soft content-type allow for Markdown / text / opaque octet-stream.
 * @param {string | null | undefined} contentType
 * @returns {boolean}
 */
export function isAllowedFetchContentType(contentType) {
  if (!contentType) return true;
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (!base) return true;
  if (base.startsWith("text/")) return true;
  if (base === "application/octet-stream") return true;
  if (base === "application/json") return true;
  if (base.includes("markdown")) return true;
  return false;
}

/**
 * Hosts that should never be fetched anonymously (auth / CORS dead ends).
 * @param {string} hostname
 * @returns {boolean}
 */
export function isAuthGatedHost(hostname) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase();
  if (!host) return false;
  return (
    host === "slack.com" ||
    host.endsWith(".slack.com") ||
    host === "slack-files.com" ||
    host.endsWith(".slack-files.com") ||
    host === "slack-edge.com" ||
    host.endsWith(".slack-edge.com")
  );
}
