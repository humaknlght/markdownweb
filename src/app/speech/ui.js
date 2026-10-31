import { hooks } from "../hooks.js";
import {
  state,
  speakDropdown,
  speakBtn,
  speakPauseBtn,
  speakPrevBtn,
  speakNextBtn,
  voiceMenuBtn,
  speechSupported
} from "../state.js";
import {
  STORAGE_KEYS
} from "../constants.js";

export function setupSpeech() {
  if (!speakBtn || !speakDropdown || !speechSupported || !window.speechSynthesis) return;
  speakDropdown.hidden = false;
  state.selectedVoiceURI = localStorage.getItem(STORAGE_KEYS.voice) || "";
  hooks.setupSpeechMediaSession();
  hooks.updateSpeakButton();

  // Chrome often returns [] until voiceschanged; refresh when the list arrives.
  const refreshVoices = () => {
    window.speechSynthesis.getVoices();
    hooks.renderVoiceMenu();
  };
  refreshVoices();
  window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);

  speakBtn.addEventListener("click", hooks.toggleSpeaking);
  speakPauseBtn?.addEventListener("click", hooks.togglePauseSpeaking);
  speakPrevBtn?.addEventListener("click", hooks.speakPreviousTrack);
  speakNextBtn?.addEventListener("click", hooks.speakNextTrack);
  voiceMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hooks.closeHistory();
    hooks.closeShareMenu();
    hooks.closeExportMenu();
    hooks.closeWritingToolsMenu();
    hooks.closeViewModeMenu();
    hooks.toggleVoiceMenu();
  });
  window.addEventListener("pagehide", hooks.stopSpeaking);
}

hooks.setupSpeech = setupSpeech;
