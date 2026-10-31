import { hooks } from "../hooks.js";
import {
  state,
  panes,
  speakBtn,
  speakPauseBtn,
  speakPrevBtn,
  speakNextBtn,
  previewPane,
  cloudSpeechModal,
  speechSupported
} from "../state.js";
import {
  wordEndOffset
} from "../vendor-deps.js";

export function speakPreviousTrack() {
  if (!state.speechActive || !state.speechTracks.length) return;
  if (state.speechTrackIndex > 0) speakTrackAt(state.speechTrackIndex - 1);
  else speakTrackAt(0);
}

export function speakNextTrack() {
  if (!state.speechActive || !state.speechTracks.length) return;
  if (state.speechTrackIndex < state.speechTracks.length - 1) {
    speakTrackAt(state.speechTrackIndex + 1);
  }
}

export function clearSpeechKeepalive() {
  if (!state.speechKeepalive) return;
  window.clearInterval(state.speechKeepalive);
  state.speechKeepalive = 0;
}

export function startSpeechKeepalive() {
  clearSpeechKeepalive();
  state.speechKeepalive = window.setInterval(() => {
    if (!state.speechActive) {
      clearSpeechKeepalive();
      return;
    }
    // Chrome often auto-pauses after ~15s; don't fight an intentional pause.
    if (!state.speechPaused && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }, 5_000);
}

export function stopSpeaking() {
  state.speechActive = false;
  state.speechPaused = false;
  state.speechQueue = [];
  state.speechTracks = [];
  state.speechTrackIndex = 0;
  state.speechGeneration += 1;
  state.speechMap = null;
  clearSpeechKeepalive();
  hooks.clearSpeechHighlight();
  hooks.stopSpeechSessionAudio();
  if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending || window.speechSynthesis?.paused) {
    window.speechSynthesis.cancel();
  }
  hooks.updateSpeakButton();
}

export function pauseSpeaking() {
  if (!state.speechActive || state.speechPaused) return;
  state.speechPaused = true;
  window.speechSynthesis.pause();
  hooks.pauseSpeechSessionAudio();
  hooks.updateSpeakButton();
}

export function resumeSpeaking() {
  if (!state.speechActive || !state.speechPaused) return;
  state.speechPaused = false;
  window.speechSynthesis.resume();
  void hooks.startSpeechSessionAudio();
  hooks.updateSpeakButton();
}

export function togglePauseSpeaking() {
  if (!state.speechActive) return;
  if (state.speechPaused) resumeSpeaking();
  else pauseSpeaking();
}

export function syncPreviewToSpeechTrack() {
  if (!state.speechTracks.length) return;
  const track = state.speechTracks[state.speechTrackIndex];
  const sectionIndex =
    typeof track?.sectionIndex === "number" ? track.sectionIndex : state.speechTrackIndex;

  if (hooks.isSlideNavView()) {
    if (sectionIndex < 0 || sectionIndex >= state.presentSections.length) return;
    if (sectionIndex !== state.presentIndex) {
      hooks.showPresentSection(sectionIndex);
      hooks.syncEditorToPresentSection();
    }
    return;
  }

  const previewVisible = !panes.classList.contains("preview-collapsed");
  if (!previewVisible) return;

  state.outlineScrollSource = "preview";
  const line = hooks.sourceLineForPresentSection(sectionIndex);
  if (line != null) {
    hooks.scrollPreviewToSourceLine(line);
    hooks.highlightActiveOutlineItem();
    return;
  }

  const el = state.presentSections[sectionIndex]?.[0];
  if (!hooks.previewNodeIsLaidOut(el)) return;
  hooks.beginSyncDriver(panes.classList.contains("editor-collapsed") ? "preview" : "editor");
  hooks.clampScrollTop(previewPane, hooks.offsetWithin(el, previewPane) - 8);
  hooks.highlightActiveOutlineItem();
}

export function speakTrackAt(index) {
  if (!state.speechActive || !state.speechTracks.length) return;
  if (index < 0 || index >= state.speechTracks.length) {
    if (index >= state.speechTracks.length) stopSpeaking();
    return;
  }

  const track = state.speechTracks[index];
  const generation = ++state.speechGeneration;
  state.speechTrackIndex = index;
  state.speechPaused = false;
  state.speechQueue = track.chunks.map((chunk) => ({ text: chunk.text, start: chunk.start }));
  hooks.clearSpeechHighlight();
  syncPreviewToSpeechTrack();
  void hooks.startSpeechSessionAudio();
  hooks.updateSpeakButton();

  const wasSpeaking =
    window.speechSynthesis.speaking ||
    window.speechSynthesis.pending ||
    window.speechSynthesis.paused;
  if (wasSpeaking) window.speechSynthesis.cancel();

  const kickoff = () => {
    if (!state.speechActive || state.speechGeneration !== generation) return;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    speakNextChunk(generation);
  };

  // After cancel(), Chrome needs a tick before the next speak() works.
  if (wasSpeaking) window.setTimeout(kickoff, 50);
  else kickoff();
}

export function speakNextChunk(generation = state.speechGeneration) {
  if (!state.speechActive || state.speechGeneration !== generation) return;
  if (!state.speechQueue.length) {
    if (state.speechTrackIndex < state.speechTracks.length - 1) {
      speakTrackAt(state.speechTrackIndex + 1);
      return;
    }
    state.speechActive = false;
    state.speechPaused = false;
    state.speechTracks = [];
    state.speechTrackIndex = 0;
    state.speechGeneration += 1;
    clearSpeechKeepalive();
    hooks.clearSpeechHighlight();
    hooks.stopSpeechSessionAudio();
    hooks.updateSpeakButton();
    return;
  }

  const chunk = state.speechQueue.shift();
  const utterance = new SpeechSynthesisUtterance(chunk.text);
  const voice = hooks.preferredVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || document.documentElement.lang || "en-US";
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  // Only highlight when the engine fires word boundary events (many
  // Google/network voices do not support this in Chrome).
  utterance.addEventListener("boundary", (event) => {
    if (!state.speechActive || state.speechGeneration !== generation || event.name !== "word") return;
    const absoluteStart = chunk.start + event.charIndex;
    const absoluteEnd = wordEndOffset(
      state.speechMap?.text || chunk.text,
      absoluteStart,
      event.charLength || 0
    );
    hooks.highlightSpeechOffsets(absoluteStart, absoluteEnd);
  });

  utterance.onend = () => speakNextChunk(generation);
  utterance.onerror = (event) => {
    if (event.error === "interrupted" || event.error === "canceled") return;
    if (state.speechGeneration !== generation) return;
    state.speechActive = false;
    state.speechPaused = false;
    state.speechQueue = [];
    state.speechTracks = [];
    state.speechTrackIndex = 0;
    state.speechGeneration += 1;
    clearSpeechKeepalive();
    hooks.clearSpeechHighlight();
    hooks.stopSpeechSessionAudio();
    hooks.updateSpeakButton();
    hooks.showToast("Could not read aloud");
  };

  window.speechSynthesis.speak(utterance);
  if (state.speechPaused) window.speechSynthesis.pause();
}

/**
 * True when read-aloud would use a cloud voice because no local high-quality
 * English voice is available (the privacy-sensitive fallback default).
 */
export function isDefaultedToCloudVoice() {
  const voice = hooks.preferredVoice();
  if (!voice || voice.localService) return false;
  return !hooks.listVoices().some((v) => v.localService);
}

/**
 * Confirm before starting cloud TTS when that voice is only the fallback default.
 * @returns {Promise<boolean>}
 */
export function confirmCloudSpeechIfNeeded() {
  if (state.cloudSpeechAllowedThisSession || !isDefaultedToCloudVoice()) {
    return Promise.resolve(true);
  }
  if (!cloudSpeechModal || typeof cloudSpeechModal.showModal !== "function") {
    return Promise.resolve(
      window.confirm(
        "No local voice is available. Read aloud will use a cloud voice and send document text to the voice provider. Continue?",
      ),
    );
  }
  if (cloudSpeechModal.open) return Promise.resolve(false);

  return new Promise((resolve) => {
    const onClose = () => {
      cloudSpeechModal.removeEventListener("close", onClose);
      const ok = cloudSpeechModal.returnValue === "continue";
      if (ok) state.cloudSpeechAllowedThisSession = true;
      resolve(ok);
    };
    cloudSpeechModal.addEventListener("close", onClose);
    cloudSpeechModal.returnValue = "";
    cloudSpeechModal.showModal();
  });
}

export async function requestStartSpeaking() {
  const allowed = await confirmCloudSpeechIfNeeded();
  if (!allowed) return;
  startSpeaking();
}

export function startSpeaking() {
  const tracks = hooks.buildSpeechTracks();
  if (!tracks.length) {
    hooks.showToast("Nothing to read");
    return;
  }

  const wasSpeaking =
    window.speechSynthesis.speaking ||
    window.speechSynthesis.pending ||
    window.speechSynthesis.paused;
  const map = state.speechMap;
  let startIndex = 0;
  if (hooks.isSlideNavView()) {
    const match = tracks.findIndex((track) => track.sectionIndex === state.presentIndex);
    startIndex =
      match >= 0 ? match : Math.max(0, Math.min(state.presentIndex, tracks.length - 1));
  }

  stopSpeaking();
  state.speechMap = map;
  state.speechTracks = tracks;
  state.speechTrackIndex = startIndex;
  state.speechActive = true;
  state.speechPaused = false;
  hooks.updateSpeakButton();
  startSpeechKeepalive();
  hooks.closeVoiceMenu();
  syncPreviewToSpeechTrack();
  // Must start from the user gesture that triggered read-aloud so Chrome/macOS
  // media controllers attach to a real HTMLMediaElement session.
  void hooks.startSpeechSessionAudio();

  // speakTrackAt bumps generation and starts the engine.
  const kickoff = () => {
    if (!state.speechActive) return;
    speakTrackAt(startIndex);
  };

  // After cancel(), Chrome needs a tick before the next speak() works.
  if (wasSpeaking) window.setTimeout(kickoff, 50);
  else kickoff();
}

export function toggleSpeaking() {
  if (state.speechActive) stopSpeaking();
  else void requestStartSpeaking();
}

hooks.speakPreviousTrack = speakPreviousTrack;
hooks.speakNextTrack = speakNextTrack;
hooks.clearSpeechKeepalive = clearSpeechKeepalive;
hooks.startSpeechKeepalive = startSpeechKeepalive;
hooks.stopSpeaking = stopSpeaking;
hooks.pauseSpeaking = pauseSpeaking;
hooks.resumeSpeaking = resumeSpeaking;
hooks.togglePauseSpeaking = togglePauseSpeaking;
hooks.syncPreviewToSpeechTrack = syncPreviewToSpeechTrack;
hooks.speakTrackAt = speakTrackAt;
hooks.speakNextChunk = speakNextChunk;
hooks.isDefaultedToCloudVoice = isDefaultedToCloudVoice;
hooks.confirmCloudSpeechIfNeeded = confirmCloudSpeechIfNeeded;
hooks.requestStartSpeaking = requestStartSpeaking;
hooks.startSpeaking = startSpeaking;
hooks.toggleSpeaking = toggleSpeaking;
