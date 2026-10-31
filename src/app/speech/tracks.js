import { hooks } from "../hooks.js";
import {
  state,
  preview
} from "../state.js";
import {
  chunkSpeechText
} from "../vendor-deps.js";

export function buildPreviewSpeechMap() {
  const nodes = [];
  let text = "";
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script, style, .mermaid, .line-num")) return NodeFilter.FILTER_REJECT;
      // Skip fold chrome (▼) and bodies hidden by section collapse.
      if (parent.closest(".md-section-toggle, .md-section-folded")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.data) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    nodes.push({
      node,
      start: text.length,
      end: text.length + node.data.length,
    });
    text += node.data;
    node = walker.nextNode();
  }

  return { text, nodes };
}

export function speechOffsetsForSection(map, sectionNodes) {
  if (!map?.nodes?.length || !sectionNodes?.length) return null;
  let start = Infinity;
  let end = -1;
  for (const entry of map.nodes) {
    const parent = entry.node.parentElement;
    if (!parent) continue;
    if (!sectionNodes.some((section) => section === parent || section.contains(parent))) {
      continue;
    }
    start = Math.min(start, entry.start);
    end = Math.max(end, entry.end);
  }
  if (!Number.isFinite(start) || end <= start) return null;
  return { start, end };
}

export function speechSectionTitle(sectionNodes, index) {
  for (const node of sectionNodes) {
    if (!/^H[1-6]$/.test(node.tagName)) continue;
    const title = hooks.headingTitleText(node);
    if (title) return title.slice(0, 120);
  }
  if (index === 0) return state.currentFileName || "Introduction";
  return `Section ${index + 1}`;
}

export function buildSpeechTracks() {
  hooks.buildPresentSections();
  state.speechMap = buildPreviewSpeechMap();

  if (state.speechMap.text?.trim() && state.presentSections.length) {
    const tracks = [];
    for (let i = 0; i < state.presentSections.length; i++) {
      const offsets = speechOffsetsForSection(state.speechMap, state.presentSections[i]);
      if (!offsets) continue;
      const text = state.speechMap.text.slice(offsets.start, offsets.end);
      if (!text.trim()) continue;
      const chunks = chunkSpeechText(text).map((chunk) => ({
        text: chunk.text,
        start: chunk.start + offsets.start,
      }));
      if (!chunks.length) continue;
      tracks.push({
        title: speechSectionTitle(state.presentSections[i], i),
        sectionIndex: i,
        start: offsets.start,
        end: offsets.end,
        chunks,
      });
    }
    if (tracks.length) return tracks;
  }

  const text = state.speechMap.text?.trim()
    ? state.speechMap.text
    : (hooks.getMarkdownSource() || "").trim();
  if (!text) {
    state.speechMap = null;
    return [];
  }
  if (!state.speechMap.text?.trim()) state.speechMap = null;

  return [
    {
      title: state.currentFileName || "Markdown Editor",
      sectionIndex: 0,
      start: 0,
      end: text.length,
      chunks: chunkSpeechText(text),
    },
  ];
}

hooks.buildPreviewSpeechMap = buildPreviewSpeechMap;
hooks.speechOffsetsForSection = speechOffsetsForSection;
hooks.speechSectionTitle = speechSectionTitle;
hooks.buildSpeechTracks = buildSpeechTracks;
