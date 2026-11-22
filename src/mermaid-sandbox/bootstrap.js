/**
 * Classic-script bootstrap for the opaque Mermaid sandbox.
 * Must run before any ES module so a dynamic import map can remap CDN URLs to
 * parent-fed blob: modules (offline via the app service worker).
 *
 * Build replaces __MERMAID_RUNTIME_JSON__ with JSON.stringify(runtime.js).
 */
(() => {
  const MESSAGE_TYPE = "md-mermaid-sandbox";
  /** @type {string} */
  const RUNTIME = "__MERMAID_RUNTIME_PLACEHOLDER__";

  let started = false;

  /**
   * @param {Record<string, string>} modules absolutized CDN URL → source
   */
  function installParentModules(modules) {
    if (started) return;
    if (!modules || typeof modules !== "object") {
      throw new Error("Mermaid modules missing");
    }
    /** @type {Record<string, string>} */
    const imports = {};
    for (const [url, source] of Object.entries(modules)) {
      if (typeof url !== "string" || typeof source !== "string") continue;
      if (!url.startsWith("https://cdn.jsdelivr.net/")) continue;
      imports[url] = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
    }
    if (!Object.keys(imports).length) {
      throw new Error("Mermaid modules empty");
    }

    // Dynamic inline import map (CSP allows unsafe-inline in this opaque frame).
    // Must be registered before any module script runs.
    const mapScript = document.createElement("script");
    mapScript.type = "importmap";
    mapScript.textContent = JSON.stringify({ imports });
    document.head.appendChild(mapScript);

    const runtimeScript = document.createElement("script");
    runtimeScript.type = "module";
    runtimeScript.src = URL.createObjectURL(
      new Blob([RUNTIME], { type: "text/javascript" }),
    );
    document.head.appendChild(runtimeScript);
    started = true;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.type !== MESSAGE_TYPE || msg.action !== "modules") return;
    try {
      installParentModules(msg.modules);
    } catch (err) {
      window.parent.postMessage(
        {
          type: MESSAGE_TYPE,
          action: "error",
          error: String(err?.message || err),
        },
        "*",
      );
    }
  });

  if (window.parent !== window) {
    window.parent.postMessage({ type: MESSAGE_TYPE, action: "boot" }, "*");
  }
})();
