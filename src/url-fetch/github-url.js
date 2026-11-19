/**
 * GitHub.com / GitHub-compatible (GHE-style) URL parsing + local host list.
 * Company hostnames stay in localStorage only — never ship corp defaults.
 */

import { isAuthGatedHost, parseHttpsUrl } from "./url-fetch-api.js";

export const GITHUB_COMPATIBLE_HOSTS_KEY = "md-editor:github-compatible-hosts";

const GITHUB_COM = "github.com";
const RAW_GITHUBUSERCONTENT = "raw.githubusercontent.com";

/**
 * @returns {string[]}
 */
export function readGithubCompatibleHosts() {
  try {
    const raw = localStorage.getItem(GITHUB_COMPATIBLE_HOSTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .map((h) => normalizeHost(String(h || "")))
          .filter((h) => h && h !== GITHUB_COM && h !== RAW_GITHUBUSERCONTENT),
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * @param {string[]} hosts
 */
export function writeGithubCompatibleHosts(hosts) {
  const cleaned = [
    ...new Set(
      (hosts || [])
        .map((h) => normalizeHost(String(h || "")))
        .filter((h) => h && h !== GITHUB_COM && h !== RAW_GITHUBUSERCONTENT),
    ),
  ];
  localStorage.setItem(GITHUB_COMPATIBLE_HOSTS_KEY, JSON.stringify(cleaned));
}

/**
 * @param {string} host
 * @returns {string}
 */
export function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

/**
 * @param {string} host
 * @returns {boolean}
 */
export function addGithubCompatibleHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized || normalized === GITHUB_COM) return false;
  if (normalized.includes("/") || normalized.includes(" ")) return false;
  const list = readGithubCompatibleHosts();
  if (list.includes(normalized)) return true;
  list.push(normalized);
  writeGithubCompatibleHosts(list);
  return true;
}

/**
 * @param {string} hostname
 * @param {string[]} [extraHosts]
 * @returns {boolean}
 */
export function isGithubCompatibleHost(hostname, extraHosts) {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (host === GITHUB_COM || host === RAW_GITHUBUSERCONTENT) return true;
  const configured = extraHosts || readGithubCompatibleHosts();
  return configured.includes(host);
}

/**
 * @typedef {{
 *   apiBase: string,
 *   owner: string,
 *   repo: string,
 *   ref: string,
 *   path: string,
 *   name: string,
 *   host: string,
 * }} GithubFileTarget
 */

/**
 * Parse blob/raw/tree GitHub or GHE-style URLs into a Contents API target.
 * @param {string} value
 * @param {string[]} [extraHosts]
 * @returns {GithubFileTarget | null}
 */
export function parseGithubFileUrl(value, extraHosts) {
  const url = parseHttpsUrl(value);
  if (!url) return null;
  const host = normalizeHost(url.hostname);
  if (!isGithubCompatibleHost(host, extraHosts)) return null;
  if (isAuthGatedHost(host)) return null;

  if (host === RAW_GITHUBUSERCONTENT) {
    // /owner/repo/<ref>/path… or /owner/repo/refs/heads|tags/<name>/path…
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return null;
    const [owner, repo, ...rest] = parts;
    let ref;
    /** @type {string[]} */
    let pathSegs;
    if (
      rest[0] === "refs" &&
      (rest[1] === "heads" || rest[1] === "tags") &&
      rest.length >= 4
    ) {
      ref = `${rest[0]}/${rest[1]}/${decodePathSeg(rest[2])}`;
      pathSegs = rest.slice(3);
    } else {
      ref = decodePathSeg(rest[0]);
      pathSegs = rest.slice(1);
    }
    const filePath = pathSegs.map(decodePathSeg).join("/");
    if (!owner || !repo || !ref || !filePath) return null;
    return {
      apiBase: "https://api.github.com",
      owner,
      repo,
      ref,
      path: filePath,
      name: pathSegs[pathSegs.length - 1] || "untitled.md",
      host: GITHUB_COM,
    };
  }

  const apiBase = githubApiBase(host);

  // /owner/repo/(blob|raw|tree)/ref/path...
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 5) return null;
  const [owner, repo, kind, ref, ...rest] = parts;
  if (!owner || !repo || !ref || !rest.length) return null;
  if (kind !== "blob" && kind !== "raw" && kind !== "tree") return null;
  const filePath = rest.map(decodePathSeg).join("/");
  if (!filePath) return null;
  return {
    apiBase,
    owner,
    repo,
    ref: decodePathSeg(ref),
    path: filePath,
    name: rest[rest.length - 1] || "untitled.md",
    host,
  };
}

/**
 * REST API base for a GitHub or GitHub-compatible host.
 * @param {string} host
 * @returns {string}
 */
export function githubApiBase(host) {
  const normalized = normalizeHost(host);
  return normalized === GITHUB_COM
    ? "https://api.github.com"
    : `https://${normalized}/api/v3`;
}

/**
 * Whether a token saved for `tokenHost` may be sent with a request to `requestUrl`.
 * Tokens only ever go to the REST API of the host they were entered for.
 * @param {string} requestUrl
 * @param {string} tokenHost
 * @returns {boolean}
 */
export function tokenAllowedFor(requestUrl, tokenHost) {
  const url = parseHttpsUrl(requestUrl);
  const host = normalizeHost(tokenHost);
  if (!url || !host || host === RAW_GITHUBUSERCONTENT) return false;
  const base = new URL(githubApiBase(host));
  if (url.origin !== base.origin) return false;
  if (base.pathname === "/") return true;
  return url.pathname.startsWith(`${base.pathname}/`);
}

/**
 * @param {GithubFileTarget} target
 * @returns {string}
 */
export function githubContentsApiUrl(target) {
  const path = target.path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const base = `${target.apiBase}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${path}`;
  const url = new URL(base);
  if (target.ref) url.searchParams.set("ref", target.ref);
  return url.toString();
}

/**
 * Public raw CDN URL for github.com targets (null for enterprise hosts).
 * @param {GithubFileTarget} target
 * @returns {string | null}
 */
export function githubRawContentUrl(target) {
  if (target.host !== GITHUB_COM) return null;
  const ref = target.ref
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const path = target.path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://${RAW_GITHUBUSERCONTENT}/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${ref}/${path}`;
}

/**
 * @param {string} seg
 * @returns {string}
 */
function decodePathSeg(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Classify an open-URL input for the router.
 * @param {string} value
 * @param {string[]} [extraHosts]
 * @returns {"invalid" | "auth-fallback" | "github" | "public"}
 */
export function classifyOpenUrl(value, extraHosts) {
  const url = parseHttpsUrl(value);
  if (!url) return "invalid";
  if (isAuthGatedHost(url.hostname)) return "auth-fallback";
  // Public raw CDN URLs fetch directly (no PAT). github.com blob/raw/tree use Contents API.
  if (normalizeHost(url.hostname) === RAW_GITHUBUSERCONTENT) return "public";
  if (parseGithubFileUrl(value, extraHosts)) return "github";
  return "public";
}
