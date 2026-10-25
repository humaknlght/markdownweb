/**
 * GitHub Gist feature flag loaded at runtime from an optional JSON file.
 * Missing or empty config disables Gist UI. See CONTRIBUTING.md.
 *
 * File: ./github-gist-config.json (same directory as the app HTML).
 * Copy github-gist-config.example.json and set enabled: true.
 */

/** Same-origin config path relative to the main app HTML. */
export const GITHUB_GIST_CONFIG_URL = "./github-gist-config.json";

/** @type {{ enabled: boolean }} */
export const GITHUB_GIST = {
  enabled: false,
};

/** @type {Promise<boolean> | null} */
let loadPromise = null;

/**
 * @returns {boolean}
 */
export function isGithubGistConfigured() {
  return GITHUB_GIST.enabled === true;
}

/**
 * @param {unknown} data
 * @returns {boolean}
 */
export function applyGithubGistConfig(data) {
  GITHUB_GIST.enabled = false;
  if (!data || typeof data !== "object") return false;
  const obj = /** @type {Record<string, unknown>} */ (data);
  GITHUB_GIST.enabled = obj.enabled === true || obj.enabled === "true";
  return isGithubGistConfigured();
}

/**
 * Fetch optional github-gist-config.json. 404 / network errors leave Gist disabled.
 * @param {string} [configUrl]
 * @returns {Promise<boolean>}
 */
export function loadGithubGistConfig(configUrl = GITHUB_GIST_CONFIG_URL) {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(configUrl, { cache: "no-cache" });
      if (!res.ok) return false;
      const data = await res.json();
      return applyGithubGistConfig(data);
    } catch {
      applyGithubGistConfig(null);
      return false;
    }
  })();
  return loadPromise;
}

/** Test helper: reset cached load promise and credentials. */
export function resetGithubGistConfigForTests() {
  loadPromise = null;
  applyGithubGistConfig(null);
}
