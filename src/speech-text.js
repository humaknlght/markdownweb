/** Max characters per SpeechSynthesis utterance (Chrome silently fails on long ones). */
export const SPEECH_CHUNK_MAX = 180;

/**
 * Split text into ≤SPEECH_CHUNK_MAX chunks, preferring sentence ends then whitespace.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {Array<{ text: string, start: number }>}
 */
export function chunkSpeechText(text, maxChars = SPEECH_CHUNK_MAX) {
  const chunks = [];
  let i = 0;
  const src = String(text || "");

  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (i >= src.length) break;

    let end = Math.min(i + maxChars, src.length);
    if (end < src.length) {
      const window = src.slice(i, end);
      let breakAt = -1;
      for (let k = window.length - 1; k > Math.floor(window.length * 0.4); k -= 1) {
        if (/[.!?…]/.test(window[k])) {
          breakAt = k + 1;
          break;
        }
        if (/\s/.test(window[k])) breakAt = k;
      }
      if (breakAt > 0) end = i + breakAt;
    }

    while (end > i && /\s/.test(src[end - 1])) end -= 1;
    if (end > i) chunks.push({ text: src.slice(i, end), start: i });
    i = Math.max(end, i + 1);
  }

  return chunks;
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} charLength
 * @returns {number}
 */
export function wordEndOffset(text, start, charLength) {
  if (charLength > 0) return Math.min(text.length, start + charLength);
  let end = start;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return end;
}

/**
 * @param {{ name?: string, lang?: string, voiceURI?: string, localService?: boolean }} voice
 * @returns {string}
 */
export function voiceKey(voice) {
  return voice.voiceURI || `${voice.name || ""}::${voice.lang || ""}`;
}

/**
 * @param {{ name?: string }} voice
 * @returns {string}
 */
export function voiceName(voice) {
  return voice.name || "";
}

/**
 * @param {{ lang?: string }} voice
 * @returns {boolean}
 */
export function isEnglishVoice(voice) {
  return (voice.lang || "").toLowerCase().startsWith("en");
}

/**
 * Heuristic quality score for browser/OS voices (higher is better).
 * @param {{ name?: string, localService?: boolean }} voice
 * @returns {number}
 */
export function voiceQualityScore(voice) {
  const name = voiceName(voice).toLowerCase();
  let score = 0;

  if (/\bsiri\b/.test(name)) score += 100;
  if (/\bgoogle\b/.test(name)) score += 90;
  if (/\b(neural|natural|online|wavenet|studio|superstar)\b/.test(name)) score += 85;
  if (/\b(enhanced|premium|mature)\b/.test(name)) score += 75;

  if (
    /\b(samantha|ava|zoe|allison|nicky|susan|tom|daniel|moira|tessa|karen|lee|fiona|veena|rishi|martha|gordon|aria|guy|jenny|ryan)\b/.test(
      name,
    )
  ) {
    score += 55;
  }

  if (
    /\b(fred|junior|kathy|princess|ralph|albert|zarvox|trinoids|boing|bells|cellos|pipe organ|bad news|good news|whisper|bubbles|deranged|hysterical|bahh|buzko)\b/.test(
      name,
    )
  ) {
    score -= 120;
  }
  if (/\b(compact|eloquence|novelty)\b/.test(name)) score -= 60;

  if (voice.localService) score += 30;
  else if (score >= 0) score -= 25;

  return score;
}

/**
 * @param {{ name?: string, lang?: string, localService?: boolean }} voice
 * @returns {boolean}
 */
export function isHighQualityVoice(voice) {
  return isEnglishVoice(voice) && voiceQualityScore(voice) >= 50;
}

/**
 * Deduplicate high-quality English voices (prefer local) and sort by score.
 * @param {Iterable<{ name?: string, lang?: string, voiceURI?: string, localService?: boolean }>} voices
 * @returns {Array<object>}
 */
export function listVoices(voices) {
  const seen = new Map();

  for (const voice of voices) {
    if (!isHighQualityVoice(voice)) continue;

    const dedupeKey = `${voiceName(voice).toLowerCase()}::${(voice.lang || "").toLowerCase()}`;
    const existing = seen.get(dedupeKey);
    if (!existing) {
      seen.set(dedupeKey, voice);
      continue;
    }
    if (!existing.localService && voice.localService) {
      seen.set(dedupeKey, voice);
    }
  }

  return [...seen.values()].sort((a, b) => {
    const scoreCmp = voiceQualityScore(b) - voiceQualityScore(a);
    if (scoreCmp) return scoreCmp;
    const langCmp = (a.lang || "").localeCompare(b.lang || "", undefined, { sensitivity: "base" });
    if (langCmp) return langCmp;
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  });
}
