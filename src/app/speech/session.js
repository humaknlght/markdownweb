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


export function updateSpeakButton() {
  if (!speakBtn || !speechSupported) return;
  speakBtn.setAttribute("aria-pressed", String(state.speechActive));
  speakBtn.title = state.speechActive ? "Stop reading" : "Read aloud";
  speakBtn.setAttribute("aria-label", state.speechActive ? "Stop reading" : "Read aloud");

  if (speakPauseBtn) {
    speakPauseBtn.disabled = !state.speechActive;
    speakPauseBtn.setAttribute("aria-pressed", String(state.speechPaused));
    speakPauseBtn.title = state.speechPaused ? "Resume" : "Pause";
    speakPauseBtn.setAttribute("aria-label", state.speechPaused ? "Resume" : "Pause");
    speakPauseBtn.classList.toggle("is-paused", state.speechPaused);
  }

  const trackCount = state.speechTracks.length;
  const canSeekTracks = state.speechActive && trackCount > 0;
  if (speakPrevBtn) {
    speakPrevBtn.hidden = !state.speechActive;
    speakPrevBtn.disabled = !canSeekTracks;
  }
  if (speakNextBtn) {
    speakNextBtn.hidden = !state.speechActive;
    speakNextBtn.disabled = !canSeekTracks || state.speechTrackIndex >= trackCount - 1;
  }

  updateSpeechMediaSession();
}

const mediaSessionSupported =
  typeof navigator !== "undefined" && "mediaSession" in navigator && typeof MediaMetadata !== "undefined";

/** HTMLAudioElement that keeps OS / Chrome media controls alive for TTS. */
/** @type {string} */

export function buildNearSilentWavBlobUrl(seconds = 8, sampleRate = 8000) {
  const numSamples = seconds * sampleRate;
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  // Tiny alternating samples so UAs don't treat the stream as fully muted.
  for (let i = 0; i < numSamples; i += 1) {
    view.setInt16(44 + i * 2, i % 2 === 0 ? 1 : -1, true);
  }

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

export function ensureSpeechSessionAudio() {
  if (state.speechSessionAudio) return state.speechSessionAudio;
  if (!state.speechSessionAudioUrl) state.speechSessionAudioUrl = buildNearSilentWavBlobUrl();
  const audio = new Audio();
  audio.preload = "auto";
  audio.loop = true;
  audio.volume = 0.001;
  audio.src = state.speechSessionAudioUrl;
  audio.setAttribute("playsinline", "");
  state.speechSessionAudio = audio;
  return audio;
}

/** Chrome already exposes Now Playing for remote/Google speechSynthesis voices. */
export function speechVoiceOwnsBrowserSession(voice = hooks.preferredVoice()) {
  return Boolean(voice && !voice.localService);
}

export async function startSpeechSessionAudio() {
  // Avoid a second media card alongside Chrome's "Google Network Speech" session.
  if (speechVoiceOwnsBrowserSession()) {
    stopSpeechSessionAudio();
    if (state.speechActive) updateSpeechMediaSession();
    return;
  }

  const audio = ensureSpeechSessionAudio();
  try {
    if (audio.paused) await audio.play();
    if (state.speechActive) updateSpeechMediaSession();
  } catch {
    /* play() may still be blocked without a gesture / policy */
  }
}

export function pauseSpeechSessionAudio() {
  if (!state.speechSessionAudio || state.speechSessionAudio.paused) return;
  state.speechSessionAudio.pause();
}

export function stopSpeechSessionAudio() {
  if (!state.speechSessionAudio) return;
  state.speechSessionAudio.pause();
  try {
    state.speechSessionAudio.currentTime = 0;
  } catch {
    /* ignore seek errors */
  }
}

export function speechMediaArtwork() {
  const artwork = [];
  for (const link of document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) {
    const src = link.href;
    if (!src) continue;
    const sizes = link.getAttribute("sizes") || "192x192";
    const type = link.getAttribute("type") || "image/png";
    if (artwork.some((entry) => entry.src === src && entry.sizes === sizes)) continue;
    artwork.push({ src, sizes, type });
  }
  return artwork;
}

export function updateSpeechMediaSession() {
  if (!mediaSessionSupported) return;
  try {
    if (!state.speechActive) {
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.metadata = null;
      return;
    }

    const track = state.speechTracks[state.speechTrackIndex];
    const trackCount = state.speechTracks.length;
    const title = track?.title || state.currentFileName || "Markdown Editor";
    const artist = state.currentFileName || "Markdown Editor";
    const album =
      trackCount > 1 ? `${state.speechTrackIndex + 1} / ${trackCount}` : "Read aloud";

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: speechMediaArtwork(),
    });
    navigator.mediaSession.playbackState = state.speechPaused ? "paused" : "playing";
  } catch {
    /* Media Session may reject metadata or state on some platforms */
  }
}

export function setupSpeechMediaSession() {
  if (!mediaSessionSupported) return;

  const setHandler = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* action not supported in this browser */
    }
  };

  setHandler("play", () => {
    if (!state.speechActive) void hooks.requestStartSpeaking();
    else hooks.resumeSpeaking();
  });
  setHandler("pause", () => {
    if (state.speechActive) hooks.pauseSpeaking();
  });
  setHandler("stop", () => {
    if (state.speechActive) hooks.stopSpeaking();
  });
  setHandler("previoustrack", () => hooks.speakPreviousTrack());
  setHandler("nexttrack", () => hooks.speakNextTrack());
  // Some OS controllers only expose seek actions; map them to section skip.
  setHandler("seekbackward", () => hooks.speakPreviousTrack());
  setHandler("seekforward", () => hooks.speakNextTrack());
}

hooks.updateSpeakButton = updateSpeakButton;
hooks.buildNearSilentWavBlobUrl = buildNearSilentWavBlobUrl;
hooks.ensureSpeechSessionAudio = ensureSpeechSessionAudio;
hooks.speechVoiceOwnsBrowserSession = speechVoiceOwnsBrowserSession;
hooks.startSpeechSessionAudio = startSpeechSessionAudio;
hooks.pauseSpeechSessionAudio = pauseSpeechSessionAudio;
hooks.stopSpeechSessionAudio = stopSpeechSessionAudio;
hooks.speechMediaArtwork = speechMediaArtwork;
hooks.updateSpeechMediaSession = updateSpeechMediaSession;
hooks.setupSpeechMediaSession = setupSpeechMediaSession;
