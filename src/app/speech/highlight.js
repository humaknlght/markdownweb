import { hooks } from "../hooks.js";
import {
  state,
  preview,
  voiceMenuBtn,
  voiceMenu,
  speechSupported
} from "../state.js";
import {
  STORAGE_KEYS,
  SPEECH_HIGHLIGHT
} from "../constants.js";
import {
  listVoicesFromList,
  voiceKey,
  voiceQualityScore
} from "../vendor-deps.js";

export function listVoices() {
  return listVoicesFromList(window.speechSynthesis.getVoices());
}

export function rangeFromSpeechOffsets(map, start, end) {
  if (!map?.nodes?.length || end <= start) return null;

  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;

  for (const entry of map.nodes) {
    if (!startNode && start >= entry.start && start < entry.end) {
      startNode = entry.node;
      startOffset = start - entry.start;
    }
    if (end > entry.start && end <= entry.end) {
      endNode = entry.node;
      endOffset = end - entry.start;
      break;
    }
    if (end > entry.end && start < entry.end) {
      endNode = entry.node;
      endOffset = entry.end - entry.start;
    }
  }

  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(startOffset, startNode.data.length));
    range.setEnd(endNode, Math.min(endOffset, endNode.data.length));
    return range;
  } catch {
    return null;
  }
}

export function clearSpeechHighlight() {
  if (typeof CSS !== "undefined" && CSS.highlights) {
    CSS.highlights.delete(SPEECH_HIGHLIGHT);
  }
  for (const mark of preview.querySelectorAll("mark.speech-word")) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

export function highlightSpeechOffsets(start, end) {
  if (!state.speechMap) return;
  const range = rangeFromSpeechOffsets(state.speechMap, start, end);
  if (!range) return;

  // CSS Custom Highlight does not mutate the DOM, so speechMap offsets stay valid.
  if (typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined") {
    CSS.highlights.set(SPEECH_HIGHLIGHT, new Highlight(range));
  } else {
    clearSpeechHighlight();
    try {
      const mark = document.createElement("mark");
      mark.className = "speech-word";
      range.surroundContents(mark);
      // Remap after DOM mutation so later words still resolve.
      const text = state.speechMap.text;
      state.speechMap = hooks.buildPreviewSpeechMap();
      state.speechMap.text = text;
    } catch {
      return;
    }
  }

  const anchor =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
  if (anchor && typeof anchor.scrollIntoView === "function") {
    anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

export function preferredVoice() {
  const voices = listVoices();
  const allVoices = window.speechSynthesis.getVoices();
  if (!voices.length && !allVoices.length) return null;

  const saved = state.selectedVoiceURI || localStorage.getItem(STORAGE_KEYS.voice) || "";
  if (saved) {
    const match =
      voices.find((v) => voiceKey(v) === saved) ||
      allVoices.find((v) => voiceKey(v) === saved);
    if (match) return match;
  }

  // Best local English voice when available; otherwise highest-scored cloud voice.
  return voices.find((v) => v.localService) || voices[0] || null;
}

export function setVoice(voiceURI, { persist = true, restart = false } = {}) {
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find((v) => voiceKey(v) === voiceURI);
  if (!match) return;

  state.selectedVoiceURI = voiceKey(match);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.voice, state.selectedVoiceURI);
    } catch {
      /* storage may be unavailable */
    }
  }
  renderVoiceMenu();
  if (restart && state.speechActive) hooks.startSpeaking();
}

export function renderVoiceMenu() {
  if (!voiceMenu || !speechSupported) return;

  const voices = listVoices();
  const active = preferredVoice();
  if (active) state.selectedVoiceURI = voiceKey(active);

  voiceMenu.replaceChildren();

  if (!voices.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No high-quality English voices found";
    voiceMenu.appendChild(empty);
    return;
  }

  for (const voice of voices) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "option");
    const selected = active && voiceKey(voice) === voiceKey(active);
    btn.setAttribute("aria-selected", String(selected));
    if (selected) btn.classList.add("is-selected");

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = voice.name;

    const meta = document.createElement("span");
    meta.className = "item-meta";
    const score = voiceQualityScore(voice);
    const tier = score >= 90 ? "premium" : score >= 70 ? "enhanced" : "quality";
    meta.textContent = `${voice.lang} · ${tier}${voice.localService ? " · local" : " · cloud"}`;

    btn.append(title, meta);
    btn.addEventListener("click", () => {
      setVoice(voiceKey(voice), { persist: true, restart: state.speechActive });
      closeVoiceMenu();
    });

    li.appendChild(btn);
    voiceMenu.appendChild(li);
  }
}

export function openVoiceMenu() {
  renderVoiceMenu();
  voiceMenu.hidden = false;
  voiceMenuBtn.setAttribute("aria-expanded", "true");
}

export function closeVoiceMenu() {
  if (!voiceMenu || !voiceMenuBtn) return;
  voiceMenu.hidden = true;
  voiceMenuBtn.setAttribute("aria-expanded", "false");
}

export function toggleVoiceMenu() {
  if (voiceMenu.hidden) openVoiceMenu();
  else closeVoiceMenu();
}

hooks.listVoices = listVoices;
hooks.rangeFromSpeechOffsets = rangeFromSpeechOffsets;
hooks.clearSpeechHighlight = clearSpeechHighlight;
hooks.highlightSpeechOffsets = highlightSpeechOffsets;
hooks.preferredVoice = preferredVoice;
hooks.setVoice = setVoice;
hooks.renderVoiceMenu = renderVoiceMenu;
hooks.openVoiceMenu = openVoiceMenu;
hooks.closeVoiceMenu = closeVoiceMenu;
hooks.toggleVoiceMenu = toggleVoiceMenu;
