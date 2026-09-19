/** Generator / provenance stamped into every export. */
export const GENERATOR_URL = "https://dev.ericperret.org/markdown/";

/**
 * @param {string} title
 * @returns {string}
 */
export function exportBasename(title) {
  const base = String(title || "Untitled")
    .replace(/[^\p{L}\p{N}\s._-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base || "markdown";
}

/**
 * @param {Blob|string} data
 * @param {string} filename
 * @param {string} [mime]
 */
export function downloadBlob(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/**
 * @param {HTMLElement} previewEl
 * @returns {string}
 */
export function cleanPreviewHtml(previewEl) {
  const clone = previewEl.cloneNode(true);
  cleanupClone(clone);
  return clone.innerHTML;
}

/**
 * Prefer this for PDF: clone keeps Mermaid SVG structure and inlines computed
 * paints so diagrams survive outside the app stylesheet.
 * @param {HTMLElement} previewEl
 * @returns {string}
 */
export function cleanPreviewHtmlForPrint(previewEl) {
  const clone = previewEl.cloneNode(true);
  cleanupClone(clone);
  const liveSvgs = previewEl.querySelectorAll("svg");
  const cloneSvgs = clone.querySelectorAll("svg");
  const count = Math.min(liveSvgs.length, cloneSvgs.length);
  for (let i = 0; i < count; i++) {
    inlineSvgComputedStyles(liveSvgs[i], cloneSvgs[i]);
  }
  return clone.innerHTML;
}

/** @param {HTMLElement} clone */
function cleanupClone(clone) {
  for (const el of clone.querySelectorAll("[data-source-line], [data-source-line-end]")) {
    el.removeAttribute("data-source-line");
    el.removeAttribute("data-source-line-end");
  }
  for (const mark of clone.querySelectorAll("mark.speech-word")) {
    mark.replaceWith(...mark.childNodes);
  }
  for (const el of clone.querySelectorAll("[data-pending]")) {
    el.removeAttribute("data-pending");
  }
}

/**
 * @param {string} markdown
 * @param {string} title
 * @returns {string}
 */
export function buildMarkdownFile(markdown, title) {
  const safeTitle = yamlEscape(title || "Untitled");
  return (
    `---\n` +
    `title: ${safeTitle}\n` +
    `generator: ${GENERATOR_URL}\n` +
    `---\n\n` +
    String(markdown ?? "").replace(/^\uFEFF/, "")
  );
}

/**
 * @param {string} bodyHtml
 * @param {string} title
 * @returns {string}
 */
export function buildHtmlDocument(bodyHtml, title) {
  const safeTitle = escapeHtml(title || "Untitled");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="${GENERATOR_URL}" />
  <link rel="canonical" href="${GENERATOR_URL}" />
  <title>${safeTitle}</title>
  <style>
    :root {
      color-scheme: light;
      --fg: #1f2328;
      --muted: #656d76;
      --link: #0969da;
      --rule: #d1d9e0;
      --code-bg: #f6f8fa;
      --quote: #d1d9e0;
      --mermaid-bg: #ffffff;
      --mermaid-fg: #333333;
      --mermaid-node-bg: #ececff;
      --mermaid-node-border: #9370db;
      --mermaid-cluster-bg: #ffffde;
      --mermaid-cluster-border: #aaaa33;
      --mermaid-line: #333333;
      --mermaid-label-bg: #e8e8e8;
      --mermaid-note-bg: #fff5ad;
    }
    @page { margin: 0.75in; }
    body {
      margin: 0;
      padding: 0;
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: var(--fg);
      background: #fff;
    }
    article {
      max-width: 52rem;
      margin: 0 auto;
      overflow-wrap: anywhere;
    }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.6em; }
    h1 { font-size: 2rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.3em; }
    h2 { font-size: 1.5rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.3em; }
    p, ul, ol, pre, blockquote, table { margin: 0 0 1em; }
    a { color: var(--link); }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.875em;
      background: var(--code-bg);
      padding: 0.15em 0.35em;
      border-radius: 4px;
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--rule);
      border-radius: 6px;
      padding: 0.85rem 1rem;
      overflow: auto;
    }
    pre code { background: none; padding: 0; font-size: 0.8125rem; }
    blockquote {
      margin-left: 0;
      padding: 0 1em;
      color: var(--muted);
      border-left: 0.25em solid var(--quote);
    }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid var(--rule); padding: 0.4rem 0.65rem; }
    th { background: var(--code-bg); }
    img { max-width: 100%; height: auto; }
    hr { border: 0; border-top: 1px solid var(--rule); margin: 1.5em 0; }
    .mermaid {
      overflow: visible;
      margin: 1rem 0;
      background: var(--mermaid-bg);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .mermaid svg {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 auto;
      background: var(--mermaid-bg);
    }
    .export-generator {
      margin-top: 2.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--rule);
      font-size: 0.75rem;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <article>
${bodyHtml}
    <p class="export-generator">Generated by ${escapeHtml(GENERATOR_URL)}</p>
  </article>
</body>
</html>
`;
}

/**
 * PDF export via the browser print engine so Mermaid SVGs render correctly
 * and export stays fast (no html2canvas). User chooses "Save as PDF".
 * @param {HTMLElement} previewEl
 * @param {string} title
 * @returns {Promise<void>}
 */
export async function printPreviewAsPdf(previewEl, title) {
  const html = buildHtmlDocument(cleanPreviewHtmlForPrint(previewEl), title);
  await printHtmlDocument(html);
}

/**
 * @param {string} html
 * @returns {Promise<void>}
 */
function printHtmlDocument(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.title = "Export PDF";
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
      iframe.remove();
      reject(new Error("Print frame unavailable"));
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      win.removeEventListener("afterprint", finish);
      iframe.remove();
      resolve();
    };

    win.addEventListener("afterprint", finish);

    doc.open();
    doc.write(html);
    doc.close();

    const triggerPrint = async () => {
      try {
        await waitForImages(doc);
        // Let SVG layout settle before the print snapshot.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        win.focus();
        win.print();
        // Some browsers never fire afterprint when the dialog is dismissed oddly.
        window.setTimeout(finish, 60_000);
      } catch (err) {
        finish();
        reject(err);
      }
    };

    if (doc.readyState === "complete") {
      void triggerPrint();
    } else {
      iframe.addEventListener("load", () => void triggerPrint(), { once: true });
    }
  });
}

/**
 * @param {HTMLElement} previewEl
 * @param {string} title
 * @returns {Blob}
 */
export function buildDocxBlob(previewEl, title) {
  const body = htmlToDocxBody(previewEl);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title || "Untitled")}</dc:title>
  <dc:creator>${escapeXml(GENERATOR_URL)}</dc:creator>
  <dc:description>Generated by ${escapeXml(GENERATOR_URL)}</dc:description>
  <cp:keywords>${escapeXml(GENERATOR_URL)}</cp:keywords>
  <cp:lastModifiedBy>${escapeXml(GENERATOR_URL)}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>${escapeXml(GENERATOR_URL)}</Application>
  <Company>${escapeXml(GENERATOR_URL)}</Company>
</Properties>`,
    "docProps/custom.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Generator">
    <vt:lpwstr>${escapeXml(GENERATOR_URL)}</vt:lpwstr>
  </property>
</Properties>`,
  };
  return new Blob([createZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/**
 * @param {HTMLElement} previewEl
 * @param {string} title
 * @returns {string}
 */
export function buildRtfDocument(previewEl, title) {
  const body = htmlToRtf(previewEl);
  return (
    `{\\rtf1\\ansi\\deff0\\uc1\n` +
    `{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fmodern\\fcharset0 Courier New;}}\n` +
    `{\\info\n` +
    `{\\title ${rtfEscape(title || "Untitled")}}\n` +
    `{\\author ${rtfEscape(GENERATOR_URL)}}\n` +
    `{\\operator ${rtfEscape(GENERATOR_URL)}}\n` +
    `{\\doccomm Generated by ${rtfEscape(GENERATOR_URL)}}\n` +
    `{\\company ${rtfEscape(GENERATOR_URL)}}\n` +
    `}\n` +
    `\\fs24\n` +
    body +
    `\n}`
  );
}

function yamlEscape(value) {
  const s = String(value);
  if (/[:#{}[\],&*?|>!%@`]/.test(s) || /^\s|\s$/.test(s) || s === "") {
    return JSON.stringify(s);
  }
  return s;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

/**
 * @param {Element} sourceRoot
 * @param {Element} cloneRoot
 */
function inlineSvgComputedStyles(sourceRoot, cloneRoot) {
  const props = [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "color",
    "display",
    "visibility",
    "stop-color",
    "stop-opacity",
  ];

  const walk = (src, dst) => {
    if (src.nodeType !== 1 || dst.nodeType !== 1) return;
    const cs = getComputedStyle(src);
    for (const prop of props) {
      const value = cs.getPropertyValue(prop);
      if (!value) continue;
      dst.style.setProperty(prop, value);
    }
    const fill = cs.fill;
    if (fill && fill !== "none") dst.setAttribute("fill", rgbToSvgColor(fill));
    const stroke = cs.stroke;
    if (stroke && stroke !== "none") dst.setAttribute("stroke", rgbToSvgColor(stroke));

    const srcChildren = [...src.children];
    const dstChildren = [...dst.children];
    const len = Math.min(srcChildren.length, dstChildren.length);
    for (let i = 0; i < len; i++) walk(srcChildren[i], dstChildren[i]);
  };

  walk(sourceRoot, cloneRoot);
}

/** @param {string} color */
function rgbToSvgColor(color) {
  const m = String(color).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) return color;
  const r = Math.round(Number(m[1]));
  const g = Math.round(Number(m[2]));
  const b = Math.round(Number(m[3]));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** @param {ParentNode} root */
async function waitForImages(root) {
  const images = [...root.querySelectorAll("img")];
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }),
    ),
  );
}

/**
 * @param {HTMLElement} root
 * @returns {string}
 */
function htmlToDocxBody(root) {
  /** @type {string[]} */
  const parts = [];

  const para = (text, { bold = false, heading = 0, code = false } = {}) => {
    const content = escapeXml(text);
    let rPr = "";
    if (heading) rPr += `<w:b/><w:sz w:val="${Math.max(24, 48 - heading * 4)}"/>`;
    else if (bold) rPr += `<w:b/>`;
    if (code) rPr += `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/>`;
    const rPrXml = rPr ? `<w:rPr>${rPr}</w:rPr>` : "";
    const pPr = heading
      ? `<w:pPr><w:pStyle w:val="Heading${heading}"/><w:spacing w:before="240" w:after="120"/></w:pPr>`
      : `<w:pPr><w:spacing w:after="120"/></w:pPr>`;
    parts.push(
      `    <w:p>${pPr}<w:r>${rPrXml}<w:t xml:space="preserve">${content}</w:t></w:r></w:p>`,
    );
  };

  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = (node.textContent || "").replace(/\s+/g, " ");
      if (text.trim()) para(text.trim());
      return;
    }
    if (node.nodeType !== 1) return;
    const el = /** @type {HTMLElement} */ (node);
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    if (/^H[1-6]$/.test(tag)) {
      para(el.innerText || "", { bold: true, heading: Number(tag[1]) });
      return;
    }
    if (tag === "P" || tag === "LI" || tag === "BLOCKQUOTE") {
      para(el.innerText || "");
      return;
    }
    if (tag === "PRE") {
      for (const line of (el.textContent || "").replace(/\n$/, "").split("\n")) {
        para(line, { code: true });
      }
      return;
    }
    if (tag === "HR") {
      para("―".repeat(20));
      return;
    }
    if (tag === "TABLE") {
      for (const row of el.querySelectorAll("tr")) {
        const cells = [...row.children].map((c) => (c.textContent || "").trim());
        para(cells.join(" | "));
      }
      return;
    }
    if (tag === "IMG") {
      para(`[Image: ${el.getAttribute("alt") || "image"}]`);
      return;
    }
    if (tag === "BR") {
      para("");
      return;
    }
    if (tag === "UL" || tag === "OL") {
      for (const child of el.children) walk(child);
      return;
    }
    if (el.childNodes.length) {
      for (const child of el.childNodes) walk(child);
    } else if ((el.textContent || "").trim()) {
      para(el.textContent || "");
    }
  };

  for (const child of root.childNodes) walk(child);
  if (!parts.length) para("");
  return parts.join("\n");
}

/**
 * @param {HTMLElement} root
 * @returns {string}
 */
function htmlToRtf(root) {
  /** @type {string[]} */
  const parts = [];

  const emit = (text, { bold = false, size = 24, mono = false } = {}) => {
    const font = mono ? "\\f1 " : "\\f0 ";
    const weight = bold ? "\\b " : "";
    parts.push(`{${font}${weight}\\fs${size} ${rtfUnicode(text)}\\par}\n`);
  };

  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text) emit(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = /** @type {HTMLElement} */ (node);
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      emit(el.innerText || "", { bold: true, size: Math.max(24, 36 - level * 2) });
      return;
    }
    if (tag === "P" || tag === "LI" || tag === "BLOCKQUOTE") {
      emit(el.innerText || "");
      return;
    }
    if (tag === "PRE") {
      for (const line of (el.textContent || "").replace(/\n$/, "").split("\n")) {
        emit(line, { mono: true, size: 18 });
      }
      return;
    }
    if (tag === "HR") {
      emit("----------------------------------------");
      return;
    }
    if (tag === "TABLE") {
      for (const row of el.querySelectorAll("tr")) {
        const cells = [...row.children].map((c) => (c.textContent || "").trim());
        emit(cells.join(" | "));
      }
      return;
    }
    if (tag === "IMG") {
      emit(`[Image: ${el.getAttribute("alt") || "image"}]`);
      return;
    }
    if (tag === "BR") {
      parts.push("\\par\n");
      return;
    }
    if (el.childNodes.length) {
      for (const child of el.childNodes) walk(child);
    } else if ((el.textContent || "").trim()) {
      emit(el.textContent || "");
    }
  };

  for (const child of root.childNodes) walk(child);
  return parts.join("") || "\\par\n";
}

function rtfEscape(text) {
  return rtfUnicode(text);
}

function rtfUnicode(text) {
  let out = "";
  for (const ch of String(text)) {
    const code = ch.codePointAt(0) || 0;
    if (ch === "\\" || ch === "{" || ch === "}") {
      out += `\\${ch}`;
    } else if (code === 10 || code === 13) {
      out += "\\par ";
    } else if (code < 128) {
      out += ch;
    } else if (code <= 0xffff) {
      const signed = code > 32767 ? code - 65536 : code;
      out += `\\u${signed}?`;
    } else {
      out += "?";
    }
  }
  return out;
}

/* ---- Minimal ZIP (STORE) writer for DOCX ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Record<string, string>} files
 * @returns {Uint8Array}
 */
function createZip(files) {
  const encoder = new TextEncoder();
  /** @type {{ name: string, data: Uint8Array, crc: number, offset: number }[]} */
  const entries = [];
  /** @type {Uint8Array[]} */
  const chunks = [];
  let offset = 0;

  const u16 = (n) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  };
  const u32 = (n) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  };

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = [
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ];
    entries.push({ name, data, crc, offset });
    for (const part of local) {
      chunks.push(part);
      offset += part.length;
    }
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const central = [
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(entry.crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(entry.offset),
      nameBytes,
    ];
    for (const part of central) {
      chunks.push(part);
      centralSize += part.length;
      offset += part.length;
    }
  }

  const end = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ];
  for (const part of end) chunks.push(part);

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
