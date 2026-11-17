/**
 * Hidden iframe worker: fetch https Markdown without widening main-page CSP.
 * Optional Authorization is memory-only for one request (never stored).
 */

import {
  fileNameFromUrl,
  isAllowedFetchContentType,
  isUrlFetchMessage,
  makeUrlFetchMessage,
  parseHttpsUrl,
  URL_FETCH_MAX_BYTES,
  URL_FETCH_TIMEOUT_MS,
} from "./url-fetch-api.js";

const statusEl = document.getElementById("status");

/**
 * @param {string} text
 */
function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

/**
 * @param {MessageEvent} event
 * @param {import("./url-fetch-api.js").UrlFetchMessage} fields
 */
function reply(event, fields) {
  const source = event.source;
  if (!source || typeof source.postMessage !== "function") return;
  source.postMessage(makeUrlFetchMessage(fields), event.origin);
}

/**
 * @param {string} urlString
 * @param {string} [authorization]
 * @returns {Promise<{ content: string, name: string }>}
 */
async function fetchText(urlString, authorization) {
  const url = parseHttpsUrl(urlString);
  if (!url) {
    throw Object.assign(new Error("Only https:// URLs are supported"), {
      code: "invalid_url",
    });
  }

  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    URL_FETCH_TIMEOUT_MS,
  );

  /** @type {HeadersInit} */
  const headers = {
    Accept:
      "application/vnd.github.raw, text/*, application/json;q=0.9, */*;q=0.8",
  };
  if (authorization) {
    headers.Authorization = authorization;
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      mode: "cors",
      redirect: "follow",
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      throw Object.assign(new Error(`Request failed (${response.status})`), {
        code:
          response.status === 401 || response.status === 403
            ? "unauthorized"
            : response.status === 404
              ? "not_found"
              : "http_error",
      });
    }

    const contentType = response.headers.get("content-type");
    if (!isAllowedFetchContentType(contentType)) {
      throw Object.assign(new Error("Unsupported content type"), {
        code: "content_type",
      });
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > URL_FETCH_MAX_BYTES) {
      throw Object.assign(new Error("File is too large (max 1 MB)"), {
        code: "too_large",
      });
    }

    let content = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

    // GitHub Contents JSON (when raw Accept is ignored).
    const trimmedType = (contentType || "").split(";")[0].trim().toLowerCase();
    if (
      trimmedType === "application/json" ||
      content.trimStart().startsWith("{")
    ) {
      try {
        const json = JSON.parse(content);
        if (json && typeof json === "object" && json.encoding === "base64") {
          if (typeof json.content !== "string") {
            throw new Error("Missing file content");
          }
          if (json.type && json.type !== "file") {
            throw Object.assign(new Error("URL does not point to a file"), {
              code: "not_file",
            });
          }
          const binary = atob(String(json.content).replace(/\s+/g, ""));
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
          if (bytes.byteLength > URL_FETCH_MAX_BYTES) {
            throw Object.assign(new Error("File is too large (max 1 MB)"), {
              code: "too_large",
            });
          }
          content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          const name =
            typeof json.name === "string" && json.name
              ? json.name
              : fileNameFromUrl(url);
          return { content, name };
        }
      } catch (err) {
        if (err && typeof err === "object" && "code" in err) throw err;
        /* not GitHub contents JSON — keep as text */
      }
    }

    return { content, name: fileNameFromUrl(url) };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw Object.assign(new Error("Request timed out"), { code: "timeout" });
    }
    if (err && typeof err === "object" && "code" in err) throw err;
    // CORS / network — browser hides details.
    throw Object.assign(
      new Error(
        err?.message && /failed|network|cors/i.test(String(err.message))
          ? "Could not fetch URL (network or CORS)"
          : String(err?.message || "Could not fetch URL"),
      ),
      { code: "network" },
    );
  } finally {
    window.clearTimeout(timer);
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (!isUrlFetchMessage(event.data)) return;
  if (event.data.action !== "fetch") return;
  const req = typeof event.data.req === "string" ? event.data.req : "";
  if (!req) return;

  setStatus("Fetching…");
  void (async () => {
    try {
      const { content, name } = await fetchText(
        String(event.data.url || ""),
        typeof event.data.authorization === "string"
          ? event.data.authorization
          : undefined,
      );
      reply(event, { action: "ok", req, content, name });
      setStatus("Done");
    } catch (err) {
      reply(event, {
        action: "error",
        req,
        error: String(err?.message || "Could not fetch URL"),
        code: String(err?.code || "error"),
      });
      setStatus("Failed");
    }
  })();
});

setStatus("Ready");
