import { hooks } from "./hooks.js";
import {
  editor,
  preview,
  shareBtn,
  shareMenu,
  exportBtn,
  exportMenu,
  writingToolsBtn,
  writingToolsMenu
} from "./state.js";
import {
  SHARE_URL_WARN_CHARS,
} from "./constants.js";
import {
  titleFromMarkdown
} from "./vendor-deps.js";
import {
  loadExportModule
} from "./lazy-modules.js";

export async function copyText(url, toastMessage) {
  try {
    await navigator.clipboard.writeText(url);
    hooks.showToast(toastMessage);
  } catch {
    window.prompt(toastMessage.replace(/copied\.?$/i, "").trim() + ":", url);
  }
}

export async function copyShareUrl() {
  const url = await hooks.buildShareUrl({
    markdown: hooks.getMarkdownSource(),
    theme: document.documentElement.dataset.theme,
  });
  const tooLong = url.length > SHARE_URL_WARN_CHARS;
  const label = tooLong
    ? "Link copied — may be too long for some apps"
    : "Share link copied";
  await copyText(url, label);
}

export function closeShareMenu() {
  // Share is a single-click action now; kept for call sites that close open menus.
  if (!shareMenu || !shareBtn) return;
  shareMenu.hidden = true;
  shareBtn.setAttribute("aria-expanded", "false");
}

export function openExportMenu() {
  if (!exportMenu) return;
  exportMenu.hidden = false;
  exportBtn.setAttribute("aria-expanded", "true");
}

export function closeExportMenu() {
  if (!exportMenu || !exportBtn) return;
  exportMenu.hidden = true;
  exportBtn.setAttribute("aria-expanded", "false");
}

export function openWritingToolsMenu() {
  if (!writingToolsMenu || !writingToolsBtn) return;
  writingToolsMenu.hidden = false;
  writingToolsBtn.setAttribute("aria-expanded", "true");
}

export function closeWritingToolsMenu() {
  if (!writingToolsMenu || !writingToolsBtn) return;
  writingToolsMenu.hidden = true;
  writingToolsBtn.setAttribute("aria-expanded", "false");
}

export function toggleWritingToolsMenu() {
  if (!writingToolsMenu) return;
  if (writingToolsMenu.hidden) {
    hooks.closeHistory();
    hooks.closeVoiceMenu();
    closeShareMenu();
    closeExportMenu();
    hooks.closeViewModeMenu();
    hooks.closeHeadingMenu();
    hooks.closeImageMenu();
    hooks.closeFormatMoreMenu();
    openWritingToolsMenu();
  } else {
    closeWritingToolsMenu();
  }
}

export function toggleExportMenu() {
  if (!exportMenu) return;
  if (exportMenu.hidden) {
    hooks.closeHistory();
    hooks.closeVoiceMenu();
    closeShareMenu();
    closeWritingToolsMenu();
    hooks.closeViewModeMenu();
    hooks.closeHeadingMenu();
    hooks.closeImageMenu();
    hooks.closeFormatMoreMenu();
    openExportMenu();
  } else {
    closeExportMenu();
  }
}

export async function exportDocument(format) {
  const markdown = hooks.getMarkdownSource();
  if (!markdown.trim()) {
    hooks.showToast("Nothing to export");
    closeExportMenu();
    return;
  }

  // Ensure Mermaid diagrams are finished before HTML/DOCX/RTF/PDF capture.
  // Force layout for slides/folds so every diagram gets a real size.
  await hooks.renderMermaidDiagrams({ force: true });

  const {
    buildDocxBlob,
    buildHtmlDocument,
    buildMarkdownFile,
    buildRtfDocument,
    cleanPreviewHtmlForPrint,
    downloadBlob,
    exportBasename,
    exportStyleOptionsFromPreview,
    printPreviewAsPdf,
  } = await loadExportModule();

  const title = titleFromMarkdown(markdown);
  const base = exportBasename(title);
  const styleOptions = exportStyleOptionsFromPreview(preview);

  try {
    if (format === "markdown") {
      downloadBlob(buildMarkdownFile(markdown, title), `${base}.md`, "text/markdown;charset=utf-8");
      hooks.showToast("Markdown downloaded");
    } else if (format === "html") {
      // Inline Mermaid SVG computed paints (same as PDF) so chart text/fills
      // survive outside the live preview stylesheet.
      const html = buildHtmlDocument(
        cleanPreviewHtmlForPrint(preview),
        title,
        styleOptions,
      );
      downloadBlob(html, `${base}.html`, "text/html;charset=utf-8");
      hooks.showToast("HTML downloaded");
    } else if (format === "pdf") {
      hooks.showToast("Choose Save as PDF in the print dialog");
      await printPreviewAsPdf(preview, title, styleOptions);
    } else if (format === "docx") {
      downloadBlob(buildDocxBlob(preview, title), `${base}.docx`);
      hooks.showToast("DOCX downloaded");
    } else if (format === "rtf") {
      downloadBlob(buildRtfDocument(preview, title), `${base}.rtf`, "application/rtf;charset=utf-8");
      hooks.showToast("RTF downloaded");
    }
  } catch {
    hooks.showToast("Export failed");
  }

  closeExportMenu();
}

hooks.copyText = copyText;
hooks.copyShareUrl = copyShareUrl;
hooks.closeShareMenu = closeShareMenu;
hooks.openExportMenu = openExportMenu;
hooks.closeExportMenu = closeExportMenu;
hooks.openWritingToolsMenu = openWritingToolsMenu;
hooks.closeWritingToolsMenu = closeWritingToolsMenu;
hooks.toggleWritingToolsMenu = toggleWritingToolsMenu;
hooks.toggleExportMenu = toggleExportMenu;
hooks.exportDocument = exportDocument;
