/**
 * Mermaid + svg2roughjs renderer for the sandboxed `mermaid-sandbox/` frame.
 * Inlined into mermaid-sandbox/index.html by serve/build so the page CSP can
 * hash it. The frame has an opaque origin (no app storage, cookies, or DOM);
 * it only returns SVG markup, which the app sanitizes before display.
 */

const MESSAGE_TYPE = "md-mermaid-sandbox";
const MERMAID_URL =
  "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs";
const SVG2ROUGH_URL = "https://cdn.jsdelivr.net/npm/svg2roughjs@3.2.3/+esm";
const MAX_HOST_WIDTH = 10_000;

/** @type {Promise<any> | null} */
let mermaidPromise = null;
/** @type {Promise<any> | null} */
let svg2roughPromise = null;

function loadMermaid() {
  mermaidPromise ??= import(MERMAID_URL)
    .then((mod) => {
      const mermaid = mod.default;
      if (!mermaid?.initialize || !mermaid?.run) {
        throw new Error("Mermaid failed to load");
      }
      return mermaid;
    })
    .catch((err) => {
      mermaidPromise = null;
      throw err;
    });
  return mermaidPromise;
}

function loadSvg2Rough() {
  svg2roughPromise ??= import(SVG2ROUGH_URL)
    .then((mod) => {
      if (typeof mod.Svg2Roughjs !== "function") {
        throw new Error("svg2roughjs failed to load");
      }
      return mod.Svg2Roughjs;
    })
    .catch((err) => {
      svg2roughPromise = null;
      throw err;
    });
  return svg2roughPromise;
}

/**
 * Mirror the app's text-measurement context: `--mermaid-*` tokens (themeCSS
 * fonts, svg2roughjs baked colors) and the body font the staging host inherits.
 * @param {{ vars?: Record<string, string>, font?: Record<string, string> }} env
 */
function applyEnvironment(env) {
  const root = document.documentElement;
  for (const name of [...root.style]) {
    if (name.startsWith("--")) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(env?.vars || {})) {
    if (/^--[\w-]+$/.test(name) && typeof value === "string") {
      root.style.setProperty(name, value);
    }
  }
  const font = env?.font || {};
  const body = document.body.style;
  body.fontFamily = String(font.family || "");
  body.fontSize = String(font.size || "");
  body.lineHeight = String(font.lineHeight || "");
  body.letterSpacing = String(font.letterSpacing || "");
}

/**
 * Mermaid can leave an empty sibling SVG next to the real diagram — keep the
 * richest one.
 * @param {HTMLElement} host
 * @returns {SVGSVGElement | null}
 */
function diagramSvg(host) {
  const svgs = [...host.querySelectorAll("svg")];
  if (!svgs.length) return null;
  return svgs.reduce((best, cur) =>
    cur.querySelectorAll("*").length > best.querySelectorAll("*").length
      ? cur
      : best,
  );
}

/**
 * Mermaid sometimes keeps `taskText` + middle anchoring when the label is wider
 * than the bar, but still parks `x` at the bar's right edge. That reads as a
 * large left gap inside the bar (common in readable width). Promote those
 * labels to outside-right placement. Runs before sketching so RoughJS draws
 * the corrected positions.
 * @param {SVGElement} svg
 */
function fixMermaidGanttLabels(svg) {
  if (svg.getAttribute("aria-roledescription") !== "gantt") return;
  const bars = [...svg.querySelectorAll("rect")]
    .map((r) => ({
      className: r.getAttribute("class") || "",
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      w: Number(r.getAttribute("width")),
      h: Number(r.getAttribute("height")),
    }))
    .filter(
      (b) =>
        /\b(task|active|done|crit)\b/i.test(b.className) &&
        Number.isFinite(b.x) &&
        Number.isFinite(b.w) &&
        b.h >= 12 &&
        b.h <= 28 &&
        b.w > 0,
    );

  for (const text of svg.querySelectorAll("text")) {
    const cls = text.getAttribute("class") || "";
    if (!/\btaskText\b|\b(?:active|done|crit)Text\d/.test(cls)) continue;
    if (/\btaskTextOutside(?:Left|Right)\b/.test(cls)) continue;

    const widthMatch = cls.match(/\bwidth-([\d.]+)\b/);
    const textW = widthMatch ? Number(widthMatch[1]) : 0;
    const x = Number(text.getAttribute("x"));
    const y = Number(text.getAttribute("y"));
    if (!(textW > 0) || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    const bar = bars
      .map((b) => ({ ...b, yDist: Math.abs(b.y + b.h / 2 - y) }))
      .sort((a, b) => a.yDist - b.yDist)[0];
    if (!bar || bar.yDist > bar.h || textW <= bar.w + 1) continue;

    const barEnd = bar.x + bar.w;
    const sec = cls.match(/\btaskText(\d)\b/)?.[1];
    text.classList.add("taskTextOutsideRight");
    if (sec != null) text.classList.add(`taskTextOutside${sec}`);
    text.setAttribute("text-anchor", "start");
    // Mermaid's outside-right offset is ~5px past the bar end.
    text.setAttribute("x", String(barEnd + 5));
  }
}

/**
 * Convert a rendered Mermaid SVG into a RoughJS sketch (Excalidraw-like).
 * The app finishes the sketch (theme color remap, viewBox fit, sizing) after
 * inserting it into the preview.
 * @param {SVGSVGElement} svg
 * @param {string} handFont
 */
async function sketchMermaidSvg(svg, handFont) {
  const Svg2Roughjs = await loadSvg2Rough();
  const preBox = svg.getBoundingClientRect();
  const srcClass = svg.getAttribute("class");
  const srcViewBox = svg.getAttribute("viewBox");
  const srcStyle = svg.querySelector("style");
  const srcVb = (srcViewBox || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const sourceSize = {
    cssWidth: preBox.width,
    cssHeight: preBox.height,
    viewBoxWidth: srcVb.length === 4 && srcVb[2] > 0 ? srcVb[2] : 0,
    hostWidth: svg.parentElement?.clientWidth ?? 0,
  };

  const staging = document.createElement("div");
  const scratch = document.createElement("div");
  for (const el of [staging, scratch]) {
    el.hidden = true;
    document.body.appendChild(el);
  }
  try {
    const source = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
    if (preBox.width > 0) source.style.width = `${preBox.width}px`;
    if (preBox.height > 0) source.style.height = `${preBox.height}px`;
    staging.appendChild(source);

    const converter = new Svg2Roughjs(scratch);
    converter.fontFamily = handFont;
    converter.randomize = false;
    converter.seed = 1;
    converter.roughConfig = {
      roughness: 1.2,
      bowing: 1,
      seed: 1,
      // Solid fills keep node/note backgrounds — hachure reuses fill pastels as
      // strokes, which fail WCAG against the diagram canvas on many themes.
      fillStyle: "solid",
    };
    converter.svg = source;
    await converter.sketch();
    const sketched = scratch.querySelector(":scope > svg");
    if (!sketched) return null;

    if (srcClass && !sketched.getAttribute("class")) {
      sketched.setAttribute("class", srcClass);
    }
    if (!sketched.getAttribute("viewBox") && srcViewBox) {
      sketched.setAttribute("viewBox", srcViewBox);
    }
    // svg2roughjs drops Mermaid's <style> (themeCSS, p{margin:0}) — copy it back
    // so labels/theme rules still apply after sketch (and in the zoom dialog).
    if (srcStyle && !sketched.querySelector("style")) {
      sketched.insertBefore(srcStyle.cloneNode(true), sketched.firstChild);
    }
    return { svg: sketched, sourceSize };
  } finally {
    staging.remove();
    scratch.remove();
  }
}

/**
 * @param {HTMLElement} host
 * @param {{ sketch?: boolean, handFont?: string }} msg
 */
async function collectResult(host, msg) {
  const svg = diagramSvg(host);
  if (!svg) return { svg: null };
  fixMermaidGanttLabels(svg);
  const scopeId = svg.id || "";
  if (msg.sketch) {
    try {
      const sketched = await sketchMermaidSvg(svg, String(msg.handFont || ""));
      if (sketched) {
        return {
          svg: sketched.svg.outerHTML,
          scopeId,
          sourceSize: sketched.sourceSize,
        };
      }
    } catch {
      /* keep the classic Mermaid SVG if the sketcher fails to load */
    }
  }
  return { svg: svg.outerHTML, scopeId };
}

/**
 * @param {{ items?: { source?: string, width?: number }[], config?: object, env?: object, sketch?: boolean, handFont?: string }} msg
 */
async function render(msg) {
  const items = Array.isArray(msg.items) ? msg.items : [];
  applyEnvironment(/** @type {any} */ (msg.env));
  if (msg.sketch && msg.handFont && document.fonts?.load) {
    await document.fonts.load(`16px ${msg.handFont}`).catch(() => {});
  }
  const mermaid = await loadMermaid();
  mermaid.initialize({
    ...(msg.config || {}),
    startOnLoad: false,
    securityLevel: "strict",
  });

  const hosts = items.map((item) => {
    const host = document.createElement("div");
    host.className = "mermaid";
    host.textContent = String(item?.source ?? "");
    const width = Math.min(
      Math.max(Math.round(Number(item?.width) || 1), 1),
      MAX_HOST_WIDTH,
    );
    host.style.cssText = `position:absolute;left:0;top:0;width:${width}px;visibility:hidden;pointer-events:none;`;
    document.body.appendChild(host);
    return host;
  });
  try {
    await mermaid.run({ nodes: hosts, suppressErrors: true });
    const results = [];
    for (const host of hosts) results.push(await collectResult(host, msg));
    return results;
  } finally {
    for (const host of hosts) host.remove();
  }
}

if (typeof window !== "undefined" && window.parent !== window) {
  let queue = Promise.resolve();
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.type !== MESSAGE_TYPE || msg.action !== "render") return;
    const req = String(msg.req ?? "");
    queue = queue.then(async () => {
      let reply;
      try {
        reply = { action: "result", results: await render(msg) };
      } catch (err) {
        reply = { action: "error", error: String(err?.message || err) };
      }
      window.parent.postMessage({ type: MESSAGE_TYPE, req, ...reply }, "*");
    });
  });
  window.parent.postMessage({ type: MESSAGE_TYPE, action: "ready" }, "*");
}
