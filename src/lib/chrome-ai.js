/**
 * Chrome built-in Writing Assistance APIs (Writer, Rewriter, Proofreader)
 * plus Prompt API (`LanguageModel`) fallback for the same Write / Rewrite /
 * Proofread flows. Feature-detect only — callers hide UI when none are present.
 */

/** @typedef {"Writer"|"Rewriter"|"Proofreader"} AiKind */
/** @typedef {"dedicated"|"prompt"} WritingBackend */

const GLOBALS = {
  Writer: "Writer",
  Rewriter: "Rewriter",
  Proofreader: "Proofreader",
};

/** Shared options for LanguageModel.availability / create (text, English). */
export const PROMPT_TEXT_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

/**
 * @param {AiKind} kind
 * @returns {boolean}
 */
export function isAiSupported(kind) {
  return typeof globalThis[GLOBALS[kind]] !== "undefined";
}

/** True when Chrome’s Prompt API (`LanguageModel`) is present. */
export function isPromptApiSupported() {
  return typeof globalThis.LanguageModel !== "undefined";
}

/** True when at least one writing path exists on this page. */
export function anyWritingAiSupported() {
  return (
    isAiSupported("Writer") ||
    isAiSupported("Rewriter") ||
    isAiSupported("Proofreader") ||
    isPromptApiSupported()
  );
}

/**
 * Prefer the dedicated writing API; fall back to Prompt API.
 * @param {AiKind} kind
 * @returns {WritingBackend|null}
 */
export function writingBackendFor(kind) {
  if (isAiSupported(kind)) return "dedicated";
  if (isPromptApiSupported()) return "prompt";
  return null;
}

/**
 * @param {AiKind} kind
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<"unavailable"|"downloadable"|"downloading"|"available">}
 */
export async function checkAvailability(kind, options = {}) {
  const Api = globalThis[GLOBALS[kind]];
  if (!Api || typeof Api.availability !== "function") return "unavailable";
  try {
    const status = await Api.availability(options);
    if (
      status === "unavailable" ||
      status === "downloadable" ||
      status === "downloading" ||
      status === "available"
    ) {
      return status;
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Prompt API availability with the same options used for create/prompt.
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<"unavailable"|"downloadable"|"downloading"|"available">}
 */
export async function checkPromptAvailability(options = PROMPT_TEXT_OPTIONS) {
  const Api = globalThis.LanguageModel;
  if (!Api || typeof Api.availability !== "function") return "unavailable";
  try {
    const status = await Api.availability(options);
    if (
      status === "unavailable" ||
      status === "downloadable" ||
      status === "downloading" ||
      status === "available"
    ) {
      return status;
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * @param {"unavailable"|"downloadable"|"downloading"|"available"} status
 * @returns {string}
 */
export function availabilityLabel(status) {
  switch (status) {
    case "available":
      return "Ready";
    case "downloadable":
      return "Model download required (one-time)";
    case "downloading":
      return "Downloading model…";
    default:
      return "Not available on this device";
  }
}

/** User-facing hint when the model rejects oversized input. */
export const INPUT_TOO_LARGE_MESSAGE =
  "Text is too long for the on-device model. Select a smaller section (a few paragraphs) and try again.";

/**
 * Map Chrome AI / DOMException failures to short UI copy.
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export function formatAiError(err, fallback = "Something went wrong.") {
  if (!err) return fallback;
  const name = /** @type {{ name?: string }} */ (err).name || "";
  const message = String(/** @type {{ message?: string }} */ (err).message || "");
  if (name === "AbortError") return "Stopped.";
  if (name === "QuotaExceededError" || /too large/i.test(message)) {
    return INPUT_TOO_LARGE_MESSAGE;
  }
  if (name === "NotSupportedError") {
    return "This language or option isn’t supported yet.";
  }
  return message.trim() || fallback;
}

/** Soft default when the session has no measureInputUsage/inputQuota. */
export const DEFAULT_PROOFREAD_CHUNK_CHARS = 2800;

/** Max concurrent Proofreader calls (Chrome allows parallel calls on one session). */
export const PROOFREAD_CONCURRENCY = 3;

/** ASCII stand-in for Mermaid `<br>` so the model does not mangle markup. */
export const BR_PLACEHOLDER = "[[MD_BR]]";

/**
 * Bounded Levenshtein distance, or null when it would exceed `maxDist`.
 * @param {string} a
 * @param {string} b
 * @param {number} maxDist
 * @returns {number | null}
 */
export function boundedLevenshtein(a, b, maxDist) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  const limit = Math.max(0, Math.floor(maxDist));
  if (Math.abs(left.length - right.length) > limit) return null;
  if (left === right) return 0;

  const n = left.length;
  const m = right.length;
  /** @type {Uint16Array} */
  let prev = new Uint16Array(m + 1);
  /** @type {Uint16Array} */
  let cur = new Uint16Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = left.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === right.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      const v = Math.min(del, ins, sub);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return null;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  const dist = prev[m];
  return dist > limit ? null : dist;
}

/** True when every non-empty line is an ATX heading. */
export function isHeadingOnlyMarkdown(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  return lines.every((l) => /^#{1,6}\s+\S/.test(l));
}

/**
 * Keep the original leading/trailing whitespace so fence boundaries stay intact.
 * @param {string} original
 * @param {string} corrected
 * @returns {string}
 */
export function preserveEdgeWhitespace(original, corrected) {
  const before = String(original ?? "");
  const after = String(corrected ?? "");
  const lead = before.match(/^\s*/)?.[0] ?? "";
  const trail = before.match(/\s*$/)?.[0] ?? "";
  const core = after.replace(/^\s*/, "").replace(/\s*$/, "");
  return lead + core + trail;
}

/**
 * True when the edit looks like light proofreading (not a rewrite / Title Case pass).
 * @param {string} original
 * @param {string} corrected
 * @returns {boolean}
 */
export function isLightProofreadEdit(original, corrected) {
  const before = String(original ?? "");
  const after = String(corrected ?? "");
  if (before === after) return true;
  const maxLen = Math.max(before.length, after.length, 1);
  // Pure case / punctuation restyle of longer text is not a spelling fix.
  if (
    before.length > 20 &&
    before.toLowerCase() === after.toLowerCase() &&
    before !== after
  ) {
    return false;
  }
  const limit = Math.max(8, Math.floor(maxLen * 0.3));
  const dist = boundedLevenshtein(before, after, limit);
  return dist != null;
}

/**
 * Guard against Proofreader degeneration (repetition loops, delimiter spam, etc.).
 * Rejected results fall back to the original input.
 * @param {string} original
 * @param {string} corrected
 * @returns {boolean}
 */
export function acceptProofreadResult(original, corrected) {
  const before = String(original ?? "");
  const after = String(corrected ?? "");
  if (after === before) return true;
  if (!after.trim() && before.trim()) return false;

  const maxLen = Math.max(Math.ceil(before.length * 1.4), before.length + 100);
  if (after.length > maxLen) return false;
  if (before.length > 40 && after.length < before.length * 0.5) return false;

  // Symbol runs like <<<<<<<<<<<<<<<<< from delimiter/model collapse.
  // (Letter runs are allowed — docs can contain long identifiers / fillers.)
  if (/([^a-zA-Z0-9\s])\1{24,}/u.test(after)) return false;

  // Must not invent or drop fence markers inside a single slice.
  const fenceBefore = (before.match(/```/g) || []).length;
  const fenceAfter = (after.match(/```/g) || []).length;
  if (fenceBefore !== fenceAfter) return false;

  // Repeated identical lines (e.g. "## Retriever" loops).
  const lines = after.split("\n");
  let run = 1;
  for (let i = 1; i < lines.length; i++) {
    const cur = lines[i].trim();
    const prev = lines[i - 1].trim();
    if (cur && cur === prev) {
      run += 1;
      if (run >= 6) return false;
    } else {
      run = 1;
    }
  }

  const nonEmpty = (s) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const beforeLines = nonEmpty(before);
  const afterLines = nonEmpty(after);
  const headingCount = (rows) => rows.filter((l) => /^#{1,6}\s+\S/.test(l)).length;

  // Short or heading-only slices: keep line/heading cardinality stable so we
  // never glue an extra "#" onto the following ``` fence.
  if (before.length < 160 || isHeadingOnlyMarkdown(before)) {
    if (afterLines.length !== beforeLines.length) return false;
    if (headingCount(afterLines) !== headingCount(beforeLines)) return false;
  }

  const beforeNl = (before.match(/\n/g) || []).length;
  const afterNl = (after.match(/\n/g) || []).length;
  if (beforeNl >= 2 && afterNl > beforeNl + 8) return false;
  if (before.length > 80 && beforeNl >= 2 && afterNl < Math.max(0, beforeNl - 8)) {
    return false;
  }

  // Placeholders must round-trip when present.
  if (before.includes(BR_PLACEHOLDER)) {
    const inCount = before.split(BR_PLACEHOLDER).length - 1;
    const outCount = after.split(BR_PLACEHOLDER).length - 1;
    if (outCount !== inCount) return false;
  }

  if (!isLightProofreadEdit(before, after)) return false;

  return true;
}

/**
 * Accept a model correction only when it passes guards; restore edge whitespace.
 * @param {string} original
 * @param {string} corrected
 * @returns {string}
 */
export function finalizeProofreadSlice(original, corrected) {
  const before = String(original ?? "");
  const after = String(corrected ?? "");
  if (after === before) return before;
  const rebuilt = preserveEdgeWhitespace(before, after);
  if (!acceptProofreadResult(before, rebuilt)) return before;
  return rebuilt;
}

/**
 * True when assembled markdown still has the same fence open/close count.
 * @param {string} original
 * @param {string} corrected
 * @returns {boolean}
 */
export function markdownFenceStructureIntact(original, corrected) {
  const countFences = (text) => {
    const lines = String(text ?? "").split("\n");
    let opens = 0;
    let inFence = false;
    let marker = "";
    for (const line of lines) {
      const open = line.match(/^ {0,3}([`~]{3,})(.*)$/);
      if (!inFence) {
        if (open) {
          inFence = true;
          marker = open[1][0];
          opens += 1;
        }
        continue;
      }
      const close = line.match(/^ {0,3}([`~]{3,})\s*$/);
      if (close && close[1][0] === marker && close[1].length >= 3) {
        inFence = false;
        marker = "";
      }
    }
    return { opens, closed: !inFence };
  };
  const a = countFences(original);
  const b = countFences(corrected);
  return a.opens === b.opens && a.closed && b.closed;
}

/**
 * Find a split offset ≤ maxLen that prefers markdown headings / paragraphs.
 * @param {string} text
 * @param {number} maxLen
 * @returns {number}
 */
export function findProofreadSplitOffset(text, maxLen) {
  const value = String(text ?? "");
  const limit = Math.max(1, Math.floor(maxLen));
  if (value.length <= limit) return value.length;
  const window = value.slice(0, limit);
  // Prefer a markdown ATX heading boundary.
  let bestHeading = -1;
  for (const match of window.matchAll(/\n(?=#{1,6}\s)/g)) {
    if (match.index != null) bestHeading = match.index + 1;
  }
  if (bestHeading > limit * 0.2) return bestHeading;
  // Prefer paragraph break, then line break, then word break.
  let idx = window.lastIndexOf("\n\n");
  if (idx > limit * 0.2) return idx + 2;
  idx = window.lastIndexOf("\n");
  if (idx > limit * 0.2) return idx + 1;
  idx = window.lastIndexOf(" ");
  if (idx > limit * 0.2) return idx + 1;
  return limit;
}

/**
 * Split text into proofread-sized chunks without dropping characters.
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
export function splitProofreadChunks(text, maxLen = DEFAULT_PROOFREAD_CHUNK_CHARS) {
  const value = String(text ?? "");
  const limit = Math.max(200, Number(maxLen) || DEFAULT_PROOFREAD_CHUNK_CHARS);
  if (!value) return [];
  if (value.length <= limit) return [value];
  /** @type {string[]} */
  const chunks = [];
  let rest = value;
  while (rest.length > limit) {
    const cut = findProofreadSplitOffset(rest, limit);
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Pick a character budget for each proofread call from session quota when possible.
 * @param {object} session
 * @param {string} text
 * @returns {Promise<number>}
 */
export async function resolveProofreadChunkLimit(session, text) {
  const fallback = DEFAULT_PROOFREAD_CHUNK_CHARS;
  const value = String(text ?? "");
  if (!session || typeof session.measureInputUsage !== "function") return fallback;
  const quota = Number(session.inputQuota);
  if (!Number.isFinite(quota) || quota <= 0) return fallback;
  try {
    // Measuring the whole document is itself slow on large inputs — only do it
    // when the text might fit in a single call.
    if (value && value.length <= fallback * 2) {
      const fullUsage = await session.measureInputUsage(value);
      if (typeof fullUsage === "number" && fullUsage <= quota) {
        return Math.max(value.length, fallback);
      }
    }
    const probe = value.slice(0, Math.min(800, value.length)) || "word ".repeat(40);
    const probeUsage = await session.measureInputUsage(probe);
    if (typeof probeUsage !== "number" || probeUsage <= 0) return fallback;
    const charsPerUnit = probe.length / probeUsage;
    // Leave some headroom — quotas are token-ish and not exact for all inputs.
    const limit = Math.floor(quota * 0.8 * charsPerUnit);
    return Math.max(400, Math.min(limit || fallback, 14_000));
  } catch {
    return fallback;
  }
}

/**
 * Run async work over items with a fixed concurrency limit. Results stay ordered.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  /** @type {R[]} */
  const results = new Array(list.length);
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * If the session exposes quota helpers, reject early when input won't fit.
 * @param {object} session
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function assertInputFitsQuota(session, text) {
  if (!session || typeof session.measureInputUsage !== "function") return;
  const quota = Number(session.inputQuota);
  if (!Number.isFinite(quota) || quota <= 0) return;
  try {
    const usage = await session.measureInputUsage(text);
    if (typeof usage === "number" && usage > quota) {
      const err = new DOMException(INPUT_TOO_LARGE_MESSAGE, "QuotaExceededError");
      throw err;
    }
  } catch (err) {
    if (err?.name === "QuotaExceededError") throw err;
    // Older builds may not support measureInputUsage; fall through to the call.
  }
}

/**
 * Clamp and normalize a selection into a range within `text`.
 * @param {string} text
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @returns {{ start: number, end: number, slice: string, isSelection: boolean }}
 */
function normalizeSelectionRange(text, selectionStart, selectionEnd) {
  const value = String(text ?? "");
  const start = Math.max(0, Math.min(Number(selectionStart) || 0, value.length));
  const end = Math.max(0, Math.min(Number(selectionEnd) || 0, value.length));
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return {
    start: from,
    end: to,
    slice: value.slice(from, to),
    isSelection: from !== to,
  };
}

/**
 * Resolve the editor range to rewrite/proofread.
 * Non-empty selection wins; otherwise the whole document.
 * @param {string} text
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @returns {{ start: number, end: number, slice: string, isSelection: boolean }}
 */
export function resolveTargetRange(text, selectionStart, selectionEnd) {
  const range = normalizeSelectionRange(text, selectionStart, selectionEnd);
  if (range.isSelection) return range;
  const value = String(text ?? "");
  return {
    start: 0,
    end: value.length,
    slice: value,
    isSelection: false,
  };
}

/**
 * Resolve the editor range for Write insert.
 * Non-empty selection is replaced; a collapsed caret stays put (insert in place).
 * @param {string} text
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @returns {{ start: number, end: number, slice: string, isSelection: boolean }}
 */
export function resolveInsertRange(text, selectionStart, selectionEnd) {
  return normalizeSelectionRange(text, selectionStart, selectionEnd);
}

/**
 * Accumulate an async iterable of string chunks into one string.
 * @param {AsyncIterable<string>} stream
 * @param {{ signal?: AbortSignal, onChunk?: (accumulated: string) => void }} [opts]
 * @returns {Promise<string>}
 */
export async function accumulateStream(stream, opts = {}) {
  const { signal, onChunk } = opts;
  let out = "";
  for await (const chunk of stream) {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    out += chunk == null ? "" : String(chunk);
    onChunk?.(out);
  }
  return out;
}

/**
 * Escape text for safe HTML insertion (mirrors markdown-utils escapeHtml).
 * @param {unknown} text
 * @returns {string}
 */
export function escapeAiHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build HTML that highlights correction spans in the original input.
 * Corrections use startIndex/endIndex into `input`.
 * @param {string} input
 * @param {Array<{ startIndex?: number, endIndex?: number }>} [corrections]
 * @returns {string}
 */
export function renderProofreadMarkup(input, corrections = []) {
  const text = String(input ?? "");
  const ranges = (corrections || [])
    .map((c) => ({
      start: Math.max(0, Math.min(Number(c.startIndex) || 0, text.length)),
      end: Math.max(0, Math.min(Number(c.endIndex) || 0, text.length)),
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let html = "";
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) {
      html += escapeAiHtml(text.slice(cursor, range.start));
    }
    html += `<mark class="ai-error">${escapeAiHtml(text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  if (cursor < text.length) {
    html += escapeAiHtml(text.slice(cursor));
  }
  return html || escapeAiHtml(text);
}

/** Soft cap on O(n·m) word-diff DP cells before falling back to line-oriented diff. */
export const DIFF_TOKEN_CELL_LIMIT = 250_000;

/**
 * Split text into words and whitespace runs for diffing.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeForDiff(text) {
  return String(text ?? "").match(/\s+|[^\s]+/g) || [];
}

/**
 * Split into line bodies and newline tokens so large docs can LCS cheaply.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeLinesForDiff(text) {
  return String(text ?? "").match(/[^\n]+|\n/g) || [];
}

/**
 * Myers/LCS ops over pre-tokenized sequences.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Array<{ type: "equal"|"insert"|"delete", value: string }>}
 */
function lcsTokenOps(a, b) {
  const n = a.length;
  const m = b.length;
  /** @type {Uint16Array[]} */
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  /** @type {Array<{ type: "equal"|"insert"|"delete", value: string }>} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", value: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", value: a[i] });
      i += 1;
    } else {
      ops.push({ type: "insert", value: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "delete", value: a[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "insert", value: b[j] });
    j += 1;
  }
  return ops;
}

/**
 * Expand line-level ops: word-diff each delete/insert hunk so only real edits highlight.
 * @param {Array<{ type: "equal"|"insert"|"delete", value: string }>} lineOps
 * @returns {Array<{ type: "equal"|"insert"|"delete", value: string }>}
 */
function expandLineOpsToWordOps(lineOps) {
  /** @type {Array<{ type: "equal"|"insert"|"delete", value: string }>} */
  const out = [];
  let i = 0;
  while (i < lineOps.length) {
    if (lineOps[i].type === "equal") {
      out.push(lineOps[i]);
      i += 1;
      continue;
    }
    /** @type {string[]} */
    const deleted = [];
    /** @type {string[]} */
    const inserted = [];
    while (i < lineOps.length && lineOps[i].type !== "equal") {
      if (lineOps[i].type === "delete") deleted.push(lineOps[i].value);
      else inserted.push(lineOps[i].value);
      i += 1;
    }
    const delText = deleted.join("");
    const insText = inserted.join("");
    if (delText === insText) {
      if (insText) out.push({ type: "equal", value: insText });
      continue;
    }
    const da = tokenizeForDiff(delText);
    const db = tokenizeForDiff(insText);
    if (da.length * db.length <= DIFF_TOKEN_CELL_LIMIT) {
      out.push(...lcsTokenOps(da, db));
    } else {
      if (delText) out.push({ type: "delete", value: delText });
      if (insText) out.push({ type: "insert", value: insText });
    }
  }
  return out;
}

/**
 * Word-level Myers/LCS ops from `before` → `after`.
 * Large inputs use a line-oriented pass first so a tiny edit does not
 * paint the entire document as changed.
 * @param {string} before
 * @param {string} after
 * @returns {Array<{ type: "equal"|"insert"|"delete", value: string }>}
 */
export function diffWords(before, after) {
  const left = String(before ?? "");
  const right = String(after ?? "");
  if (left === right) {
    return right ? [{ type: "equal", value: right }] : [];
  }

  const a = tokenizeForDiff(left);
  const b = tokenizeForDiff(right);
  if (a.length * b.length <= DIFF_TOKEN_CELL_LIMIT) {
    return lcsTokenOps(a, b);
  }

  const aLines = tokenizeLinesForDiff(left);
  const bLines = tokenizeLinesForDiff(right);
  // Line counts stay small even for long docs; fall back only if pathological.
  if (aLines.length * bLines.length <= DIFF_TOKEN_CELL_LIMIT) {
    return expandLineOpsToWordOps(lcsTokenOps(aLines, bLines));
  }

  return [
    ...(left ? [{ type: "delete", value: left }] : []),
    ...(right ? [{ type: "insert", value: right }] : []),
  ];
}

/**
 * HTML for the corrected text with inserted/replaced spans highlighted.
 * Deleted original tokens are omitted (they are not in the corrected editor).
 * @param {string} original
 * @param {string} corrected
 * @returns {string}
 */
export function renderCorrectedDiffHtml(original, corrected) {
  const ops = diffWords(original, corrected);
  let html = "";
  let pendingInsert = "";

  const flushInsert = () => {
    if (!pendingInsert) return;
    html += `<mark class="ai-diff">${escapeAiHtml(pendingInsert)}</mark>`;
    pendingInsert = "";
  };

  for (const op of ops) {
    if (op.type === "equal") {
      flushInsert();
      html += escapeAiHtml(op.value);
    } else if (op.type === "insert") {
      pendingInsert += op.value;
    }
    // deletes: skip in corrected view
  }
  flushInsert();
  return html || escapeAiHtml(corrected);
}

/**
 * Create a Chrome AI session with optional download progress.
 * @param {AiKind} kind
 * @param {Record<string, unknown>} [options]
 * @param {{ signal?: AbortSignal, onProgress?: (loaded: number) => void }} [hooks]
 * @returns {Promise<object>}
 */
export async function createAiSession(kind, options = {}, hooks = {}) {
  const Api = globalThis[GLOBALS[kind]];
  if (!Api || typeof Api.create !== "function") {
    throw new Error(`${kind} API is not available`);
  }
  const { signal, onProgress } = hooks;
  const createOpts = { ...options };
  if (signal) createOpts.signal = signal;
  if (typeof onProgress === "function") {
    createOpts.monitor = (m) => {
      m.addEventListener("downloadprogress", (e) => {
        const loaded = typeof e?.loaded === "number" ? e.loaded : 0;
        onProgress(loaded);
      });
    };
  }
  return Api.create(createOpts);
}

/**
 * Create a Prompt API (`LanguageModel`) session.
 * @param {Record<string, unknown>} [options]
 * @param {{ signal?: AbortSignal, onProgress?: (loaded: number) => void }} [hooks]
 * @returns {Promise<object>}
 */
export async function createPromptSession(options = PROMPT_TEXT_OPTIONS, hooks = {}) {
  const Api = globalThis.LanguageModel;
  if (!Api || typeof Api.create !== "function") {
    throw new Error("Prompt API is not available");
  }
  const { signal, onProgress } = hooks;
  const createOpts = { ...PROMPT_TEXT_OPTIONS, ...options };
  if (signal) createOpts.signal = signal;
  if (typeof onProgress === "function") {
    createOpts.monitor = (m) => {
      m.addEventListener("downloadprogress", (e) => {
        const loaded = typeof e?.loaded === "number" ? e.loaded : 0;
        onProgress(loaded);
      });
    };
  }
  return Api.create(createOpts);
}

/** System instructions for Prompt-backed Write. */
export const PROMPT_WRITE_SYSTEM =
  "You write Markdown for a Markdown editor. Output only the Markdown to insert — no preamble, no closing remarks, and do not wrap the entire answer in a code fence.";

/** System instructions for Prompt-backed Rewrite. */
export const PROMPT_REWRITE_SYSTEM =
  "You rewrite Markdown. Preserve structure (headings, lists, links, images, code fences). Output only the rewritten Markdown — no preamble, and do not wrap the entire answer in a code fence.";

/** System instructions for Prompt-backed Proofread. */
export const PROMPT_PROOFREAD_SYSTEM =
  "You proofread Markdown. Fix spelling, grammar, and punctuation only. Preserve Markdown structure, code fences, URLs, and meaning. Output only the corrected Markdown — no preamble, and do not wrap the entire answer in a code fence.";

/**
 * @param {AiKind} kind
 * @returns {string}
 */
export function promptSystemFor(kind) {
  switch (kind) {
    case "Writer":
      return PROMPT_WRITE_SYSTEM;
    case "Rewriter":
      return PROMPT_REWRITE_SYSTEM;
    case "Proofreader":
      return PROMPT_PROOFREAD_SYSTEM;
    default:
      return PROMPT_WRITE_SYSTEM;
  }
}

/**
 * Strip a single outer ``` / ```markdown fence if the model wrapped the whole answer.
 * Also trims a partial opening fence while the stream is still in flight.
 * @param {string} text
 * @returns {string}
 */
export function stripOuterMarkdownFence(text) {
  const raw = String(text ?? "");
  const value = raw.trim();
  const complete = value.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/i);
  if (complete) return complete[1];
  const streaming = raw.match(/^```(?:markdown|md)?\r?\n([\s\S]*)$/i);
  if (streaming) {
    return streaming[1].replace(/\r?\n```[\t ]*$/, "");
  }
  return raw;
}

/**
 * @param {string} [tone]
 * @param {string} [length]
 * @returns {string}
 */
function toneLengthInstructions(tone, length) {
  const parts = [];
  if (tone && tone !== "as-is" && tone !== "neutral") {
    if (tone === "formal" || tone === "more-formal") parts.push("Use a formal tone.");
    else if (tone === "casual" || tone === "more-casual") parts.push("Use a casual tone.");
    else parts.push(`Tone: ${tone}.`);
  }
  if (length && length !== "as-is") {
    if (length === "short" || length === "shorter") parts.push("Keep it short.");
    else if (length === "long" || length === "longer") parts.push("Make it longer.");
    else if (length === "medium") parts.push("Use a medium length.");
    else parts.push(`Length: ${length}.`);
  }
  return parts.length ? `${parts.join(" ")}\n\n` : "";
}

/**
 * Prompt the LanguageModel session (streaming when available).
 * @param {object} session
 * @param {string} input
 * @param {{ signal?: AbortSignal, onChunk?: (s: string) => void }} [opts]
 * @returns {Promise<string>}
 */
export async function runPrompt(session, input, opts = {}) {
  const { signal, onChunk } = opts;
  const promptOpts = signal ? { signal } : undefined;
  const cleanedOnChunk = onChunk
    ? (s) => onChunk(stripOuterMarkdownFence(s))
    : undefined;

  if (typeof session.promptStreaming === "function") {
    const stream = session.promptStreaming(input, promptOpts);
    const raw = await accumulateStream(stream, { signal, onChunk: cleanedOnChunk });
    return stripOuterMarkdownFence(raw);
  }
  if (typeof session.prompt !== "function") {
    throw new Error("Prompt API session has no prompt()");
  }
  const result = await session.prompt(input, promptOpts);
  const text = stripOuterMarkdownFence(result == null ? "" : String(result));
  onChunk?.(text);
  return text;
}

/**
 * @param {object} session
 * @param {string} prompt
 * @param {{
 *   context?: string,
 *   tone?: string,
 *   length?: string,
 *   signal?: AbortSignal,
 *   onChunk?: (s: string) => void,
 * }} [opts]
 */
export async function runPromptWrite(session, prompt, opts = {}) {
  const { context, tone, length, signal, onChunk } = opts;
  const guidance = toneLengthInstructions(tone, length);
  const ctx = context?.trim() ? `Context:\n${context.trim()}\n\n` : "";
  const input = `${guidance}${ctx}Write Markdown for this request:\n${prompt}`;
  return runPrompt(session, input, { signal, onChunk });
}

/**
 * @param {object} session
 * @param {string} text
 * @param {{
 *   context?: string,
 *   tone?: string,
 *   length?: string,
 *   signal?: AbortSignal,
 *   onChunk?: (s: string) => void,
 * }} [opts]
 */
export async function runPromptRewrite(session, text, opts = {}) {
  const { context, tone, length, signal, onChunk } = opts;
  const guidance = toneLengthInstructions(tone, length);
  const ctx = context?.trim() ? `Instructions:\n${context.trim()}\n\n` : "";
  const input = `${guidance}${ctx}Rewrite the following Markdown:\n\n${text}`;
  return runPrompt(session, input, { signal, onChunk });
}

/**
 * Proofread via Prompt API. Returns a Proofreader-shaped result (no span list).
 * @param {object} session
 * @param {string} text
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ correctedInput: string, corrections: Array<{ startIndex: number, endIndex: number }> }>}
 */
export async function runPromptProofread(session, text, opts = {}) {
  const { signal } = opts;
  const input = String(text ?? "");
  if (!input.trim()) {
    return { correctedInput: input, corrections: [] };
  }
  const raw = await runPrompt(
    session,
    `Proofread the following Markdown. Fix spelling, grammar, and punctuation only.\n\n${input}`,
    { signal },
  );
  const correctedInput = finalizeProofreadSlice(input, raw);
  return { correctedInput, corrections: [] };
}

/**
 * Adapt a LanguageModel session so runProofreadDocument can call `.proofread()`.
 * @param {object} lmSession
 * @returns {object}
 */
export function wrapPromptSessionAsProofreader(lmSession) {
  return {
    get inputQuota() {
      return lmSession?.inputQuota;
    },
    measureInputUsage(text) {
      return lmSession?.measureInputUsage?.(text);
    },
    async proofread(input, proofOpts) {
      return runPromptProofread(lmSession, input, proofOpts);
    },
    destroy() {
      lmSession?.destroy?.();
    },
  };
}

/**
 * @param {object} session
 * @param {string} prompt
 * @param {{ context?: string, signal?: AbortSignal, onChunk?: (s: string) => void }} [opts]
 */
export async function runWrite(session, prompt, opts = {}) {
  const { context, signal, onChunk } = opts;
  const writeOpts = {};
  if (context) writeOpts.context = context;
  if (signal) writeOpts.signal = signal;

  if (typeof session.writeStreaming === "function") {
    const stream = session.writeStreaming(prompt, writeOpts);
    return accumulateStream(stream, { signal, onChunk });
  }
  const result = await session.write(prompt, writeOpts);
  const text = result == null ? "" : String(result);
  onChunk?.(text);
  return text;
}

/**
 * @param {object} session
 * @param {string} text
 * @param {{ context?: string, signal?: AbortSignal, onChunk?: (s: string) => void }} [opts]
 */
export async function runRewrite(session, text, opts = {}) {
  const { context, signal, onChunk } = opts;
  const rewriteOpts = {};
  if (context) rewriteOpts.context = context;
  if (signal) rewriteOpts.signal = signal;

  if (typeof session.rewriteStreaming === "function") {
    const stream = session.rewriteStreaming(text, rewriteOpts);
    return accumulateStream(stream, { signal, onChunk });
  }
  const result = await session.rewrite(text, rewriteOpts);
  const out = result == null ? "" : String(result);
  onChunk?.(out);
  return out;
}

/**
 * @param {object} session
 * @param {string} text
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ correctedInput: string, corrections: Array<{ startIndex: number, endIndex: number }> }>}
 */
export async function runProofread(session, text, opts = {}) {
  const { signal } = opts;
  const input = String(text ?? "");
  const proofOpts = signal ? { signal } : undefined;
  const result = await session.proofread(input, proofOpts);
  const rawCorrected =
    result?.correctedInput != null ? String(result.correctedInput) : input;
  const correctedInput = finalizeProofreadSlice(input, rawCorrected);
  if (correctedInput === input) {
    return { correctedInput: input, corrections: [] };
  }
  const corrections = Array.isArray(result?.corrections) ? result.corrections : [];
  return { correctedInput, corrections };
}

/**
 * Proofread one chunk, recursively halving on QuotaExceededError.
 * @param {object} session
 * @param {string} chunk
 * @param {{ signal?: AbortSignal }} [opts]
 */
async function proofreadChunkWithRetry(session, chunk, opts = {}) {
  const { signal } = opts;
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
  if (!chunk.trim()) {
    return { correctedInput: chunk, corrections: [] };
  }
  try {
    return await runProofread(session, chunk, { signal });
  } catch (err) {
    const tooLarge =
      err?.name === "QuotaExceededError" || /too large/i.test(String(err?.message || ""));
    if (!tooLarge || chunk.length < 400) throw err;
    const halves = splitProofreadChunks(chunk, Math.ceil(chunk.length / 2));
    if (halves.length < 2) throw err;
    /** @type {Array<{ correctedInput: string, corrections: unknown[] }>} */
    const parts = [];
    for (const half of halves) {
      parts.push(await proofreadChunkWithRetry(session, half, opts));
    }
    return {
      correctedInput: parts.map((p) => p.correctedInput).join(""),
      corrections: parts.flatMap((p) => p.corrections),
    };
  }
}

/**
 * Proofread text in quota-sized sections (in parallel) and concatenate.
 * @param {object} session
 * @param {string} text
 * @param {{
 *   signal?: AbortSignal,
 *   onProgress?: (info: { index: number, total: number }) => void,
 * }} [opts]
 * @returns {Promise<{ correctedInput: string, correctionCount: number, chunkCount: number }>}
 */
export async function runProofreadChunked(session, text, opts = {}) {
  const { signal, onProgress } = opts;
  const value = String(text ?? "");
  if (!value) {
    return { correctedInput: "", correctionCount: 0, chunkCount: 0 };
  }

  const limit = await resolveProofreadChunkLimit(session, value);
  const chunks = splitProofreadChunks(value, limit);
  let completed = 0;

  const results = await mapWithConcurrency(
    chunks,
    PROOFREAD_CONCURRENCY,
    async (chunk) => {
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      const result = await proofreadChunkWithRetry(session, chunk, { signal });
      completed += 1;
      onProgress?.({ index: completed - 1, total: chunks.length });
      return result;
    },
  );

  return {
    correctedInput: results.map((r) => r.correctedInput).join(""),
    correctionCount: results.reduce((n, r) => n + r.corrections.length, 0),
    chunkCount: chunks.length,
  };
}

/**
 * Split markdown into prose and fenced-code parts (lossless when joined).
 * @param {string} markdown
 * @returns {Array<
 *   | { kind: "prose", text: string }
 *   | { kind: "fence", open: string, lang: string, body: string, close: string }
 * >}
 */
export function splitMarkdownProofreadParts(markdown) {
  const raw = String(markdown ?? "");
  const lines = raw.split("\n");
  /** @type {Array<{ kind: "prose", text: string } | { kind: "fence", open: string, lang: string, body: string, close: string }>} */
  const parts = [];
  /** @type {string[]} */
  let prose = [];
  let i = 0;

  const flushProse = ({ beforeFence = false } = {}) => {
    if (!prose.length) return;
    let text = prose.join("\n");
    // ["para", ""].join("\n") => "para\n", but the source had a blank line
    // before the fence ("para\n\n```"), so add the missing newline.
    if (beforeFence && prose[prose.length - 1] === "") text += "\n";
    parts.push({ kind: "prose", text });
    prose = [];
  };

  while (i < lines.length) {
    const open = lines[i].match(/^ {0,3}([`~]{3,})(.*)$/);
    if (!open) {
      prose.push(lines[i]);
      i += 1;
      continue;
    }

    flushProse({ beforeFence: true });
    const marker = open[1];
    const info = String(open[2] || "").trim();
    const lang = (info.split(/\s+/)[0] || "").toLowerCase();
    const openLine = lines[i];
    i += 1;
    /** @type {string[]} */
    const bodyLines = [];
    let closeLine = "";
    while (i < lines.length) {
      const closer = lines[i].match(/^ {0,3}([`~]{3,})\s*$/);
      if (
        closer &&
        closer[1][0] === marker[0] &&
        closer[1].length >= marker.length
      ) {
        closeLine = lines[i];
        i += 1;
        break;
      }
      bodyLines.push(lines[i]);
      i += 1;
    }
    parts.push({
      kind: "fence",
      open: `${openLine}\n`,
      lang,
      body: bodyLines.length ? `${bodyLines.join("\n")}\n` : "",
      // Preserve the newline after the closing fence when more content follows.
      close: closeLine ? closeLine + (i < lines.length ? "\n" : "") : "",
    });
  }
  flushProse();
  return parts;
}

/** @param {string} lang */
function lineCommentMarker(lang) {
  const l = String(lang || "").toLowerCase();
  if (
    [
      "py",
      "python",
      "sh",
      "bash",
      "zsh",
      "yaml",
      "yml",
      "rb",
      "ruby",
      "toml",
      "r",
      "perl",
      "dockerfile",
    ].includes(l)
  ) {
    return "#";
  }
  if (["sql", "pgsql", "mysql"].includes(l)) return "--";
  if (
    [
      "js",
      "javascript",
      "jsx",
      "ts",
      "tsx",
      "typescript",
      "java",
      "c",
      "cpp",
      "h",
      "hpp",
      "go",
      "rs",
      "rust",
      "kt",
      "kotlin",
      "swift",
      "css",
      "scss",
      "less",
      "jsonc",
      "csharp",
      "cs",
      "php",
    ].includes(l)
  ) {
    return "//";
  }
  return null;
}

/**
 * Spans of Mermaid `note … : text` bodies (text only, not the note keyword).
 * @param {string} body
 * @returns {Array<{ start: number, end: number }>}
 */
export function findMermaidNoteSpans(body) {
  const text = String(body ?? "");
  /** @type {Array<{ start: number, end: number }>} */
  const spans = [];
  const re =
    /^([ \t]*note[ \t]+(?:over|left[ \t]+of|right[ \t]+of)[ \t]+[^:\n]+:[ \t]*)(.*)$/gim;
  let match = re.exec(text);
  while (match) {
    const prefix = match[1] || "";
    const content = match[2] || "";
    if (content.trim()) {
      const start = match.index + prefix.length;
      spans.push({ start, end: start + content.length });
    }
    match = re.exec(text);
  }
  return spans;
}

/**
 * Spans of line-comment text for common languages (`//`, `#`, `--`).
 * @param {string} body
 * @param {string} lang
 * @returns {Array<{ start: number, end: number }>}
 */
export function findLineCommentSpans(body, lang) {
  const marker = lineCommentMarker(lang);
  if (!marker) return [];
  const text = String(body ?? "");
  const lines = text.split("\n");
  /** @type {Array<{ start: number, end: number }>} */
  const spans = [];
  let offset = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const idx = findLineCommentIndex(line, marker);
    if (idx >= 0) {
      let start = idx + marker.length;
      if (line[start] === " ") start += 1;
      if (start < line.length) {
        spans.push({ start: offset + start, end: offset + line.length });
      }
    }
    offset += line.length + (li < lines.length - 1 ? 1 : 0);
  }
  return spans;
}

/** @param {string} line @param {string} marker */
function findLineCommentIndex(line, marker) {
  if (marker !== "//") return line.indexOf(marker);
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      i += 1;
      while (i < line.length && line[i] !== q) {
        if (line[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (line.startsWith("//", i)) {
      if (i > 0 && line[i - 1] === ":") {
        i += 2;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

const BR_RE = /<br\s*\/?>/gi;

function protectBreakTags(text) {
  return String(text ?? "").replace(BR_RE, BR_PLACEHOLDER);
}

function restoreBreakTags(text) {
  return String(text ?? "").replaceAll(BR_PLACEHOLDER, "<br>");
}

/**
 * Proofread selected spans in `text` one-at-a-time (parallel) and splice back.
 * Spans are not packed into one request — shared delimiters made Gemini Nano
 * degenerate into repetition / `&lt;` spam on Mermaid notes.
 * @param {object} session
 * @param {string} text
 * @param {Array<{ start: number, end: number }>} spans
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function proofreadReplaceSpans(session, text, spans, opts = {}) {
  const { signal } = opts;
  const source = String(text ?? "");
  if (!spans.length) {
    return { text: source, correctionCount: 0, spanCount: 0 };
  }

  const items = spans
    .map((span) => {
      const start = Math.max(0, Math.min(span.start, source.length));
      const end = Math.max(start, Math.min(span.end, source.length));
      return { start, end, slice: source.slice(start, end) };
    })
    .filter((item) => item.slice.trim());

  if (!items.length) {
    return { text: source, correctionCount: 0, spanCount: spans.length };
  }

  /** @type {Array<{ start: number, end: number, corrected: string, correctionCount: number }>} */
  const replacements = await mapWithConcurrency(
    items,
    PROOFREAD_CONCURRENCY,
    async (item) => {
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      const protectedText = protectBreakTags(item.slice);
      let corrected;
      let correctionCount;
      if (protectedText.length > DEFAULT_PROOFREAD_CHUNK_CHARS) {
        const result = await runProofreadChunked(session, protectedText, { signal });
        corrected = restoreBreakTags(result.correctedInput);
        correctionCount = result.correctionCount;
      } else {
        const result = await runProofread(session, protectedText, { signal });
        corrected = restoreBreakTags(result.correctedInput);
        correctionCount = result.corrections.length;
      }
      // If break placeholders were lost despite acceptProofreadResult, keep original.
      if (item.slice !== corrected) {
        const originalBreaks = (item.slice.match(BR_RE) || []).length;
        const correctedBreaks = (corrected.match(BR_RE) || []).length;
        if (originalBreaks !== correctedBreaks) {
          return {
            start: item.start,
            end: item.end,
            corrected: item.slice,
            correctionCount: 0,
          };
        }
      }
      return {
        start: item.start,
        end: item.end,
        corrected,
        correctionCount,
      };
    },
  );

  replacements.sort((a, b) => b.start - a.start);
  let out = source;
  let correctionCount = 0;
  for (const rep of replacements) {
    out = out.slice(0, rep.start) + rep.corrected + out.slice(rep.end);
    correctionCount += rep.correctionCount;
  }
  return { text: out, correctionCount, spanCount: spans.length };
}

/**
 * Proofread Markdown while preserving code fences: only prose, Mermaid notes,
 * and line comments inside fences are sent to the model.
 * @param {object} session
 * @param {string} text
 * @param {{
 *   signal?: AbortSignal,
 *   onProgress?: (info: { index: number, total: number, label?: string }) => void,
 * }} [opts]
 */
export async function runProofreadDocument(session, text, opts = {}) {
  const { signal, onProgress } = opts;
  const value = String(text ?? "");
  if (!value) {
    return { correctedInput: "", correctionCount: 0, chunkCount: 0 };
  }

  const parts = splitMarkdownProofreadParts(value);
  let corrected = "";
  let correctionCount = 0;
  let chunkCount = 0;
  let unit = 0;

  // Rough total for progress: each prose part counts as ≥1, each annotated fence as 1.
  const totalHint = Math.max(
    1,
    parts.reduce((n, p) => {
      if (p.kind === "prose") return n + (p.text.trim() ? 1 : 0);
      if (p.kind === "fence") {
        if (p.lang === "mermaid" || p.lang.startsWith("mermaid")) return n + 1;
        if (lineCommentMarker(p.lang)) return n + 1;
      }
      return n;
    }, 0),
  );

  for (const part of parts) {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    if (part.kind === "prose") {
      if (!part.text.trim()) {
        corrected += part.text;
        continue;
      }
      onProgress?.({
        index: unit,
        total: Math.max(totalHint, unit + 1),
        label: "text",
      });
      const result = await runProofreadChunked(session, part.text, {
        signal,
        onProgress: ({ index, total }) => {
          onProgress?.({
            index: unit + index,
            total: Math.max(totalHint, unit + total),
            label: "text",
          });
        },
      });
      corrected += result.correctedInput;
      correctionCount += result.correctionCount;
      chunkCount += result.chunkCount;
      unit += Math.max(1, result.chunkCount);
      continue;
    }

    // Fenced code: structure passes through; only notes/comments are proofread.
    let body = part.body;
    if (part.lang === "mermaid" || part.lang.startsWith("mermaid")) {
      const spans = findMermaidNoteSpans(body);
      if (spans.length) {
        onProgress?.({
          index: unit,
          total: Math.max(totalHint, unit + 1),
          label: "mermaid-notes",
        });
        const result = await proofreadReplaceSpans(session, body, spans, { signal });
        body = result.text;
        correctionCount += result.correctionCount;
        chunkCount += 1;
        unit += 1;
      }
    } else {
      const spans = findLineCommentSpans(body, part.lang);
      if (spans.length) {
        onProgress?.({
          index: unit,
          total: Math.max(totalHint, unit + 1),
          label: "comments",
        });
        const result = await proofreadReplaceSpans(session, body, spans, { signal });
        body = result.text;
        correctionCount += result.correctionCount;
        chunkCount += 1;
        unit += 1;
      }
    }
    corrected += part.open + body + part.close;
  }

  if (!markdownFenceStructureIntact(value, corrected)) {
    return {
      correctedInput: value,
      correctionCount: 0,
      chunkCount: Math.max(1, chunkCount),
    };
  }

  return { correctedInput: corrected, correctionCount, chunkCount: Math.max(1, chunkCount) };
}

/** Destroy a session if the API exposes destroy(). */
export function destroyAiSession(session) {
  try {
    session?.destroy?.();
  } catch {
    /* ignore */
  }
}
