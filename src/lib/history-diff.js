/**
 * Line-based patches + content hashing for history revisions.
 * Patches transform `base` → `target` when applied with applyPatch.
 */

/**
 * @param {string} text
 * @returns {string}
 */
export function contentHash(text) {
  // FNV-1a 32-bit — fast non-crypto identity for dedupe / matching.
  let h = 0x811c9dc5;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function toLines(text) {
  if (text === "") return [];
  const lines = String(text).split("\n");
  return lines;
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
function fromLines(lines) {
  return lines.join("\n");
}

/**
 * Myers O(ND) line diff → compact ops: keep | del-count | ins-lines.
 * Patch format (JSON): { v:1, ops: Array<"="|number|string[]> }
 * - "=" keep one line from base
 * - number N: delete N lines from base
 * - string[]: insert those lines
 *
 * @param {string} base
 * @param {string} target
 * @returns {string}
 */
export function makePatch(base, target) {
  if (base === target) return JSON.stringify({ v: 1, ops: [] });

  const a = toLines(base);
  const b = toLines(target);
  const n = a.length;
  const m = b.length;

  // LCS lengths via DP for moderate sizes; fall back to replace-all for huge pairs.
  const MAX_CELLS = 4_000_000;
  if (n * m > MAX_CELLS) {
    return JSON.stringify({ v: 1, ops: [n || 0, b] });
  }

  /** @type {Uint32Array[]} */
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    dp[i] = new Uint32Array(m + 1);
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  /** @type {Array<"="|number|string[]>} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push("=");
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      let del = 0;
      while (i < n && (j >= m || a[i] !== b[j]) && dp[i + 1][j] >= dp[i][j + 1]) {
        del++;
        i++;
      }
      ops.push(del);
    } else {
      /** @type {string[]} */
      const ins = [];
      while (j < m && (i >= n || a[i] !== b[j]) && dp[i + 1][j] < dp[i][j + 1]) {
        ins.push(b[j]);
        j++;
      }
      ops.push(ins);
    }
  }
  if (i < n) ops.push(n - i);
  if (j < m) ops.push(b.slice(j));

  return JSON.stringify({ v: 1, ops });
}

/**
 * @param {string} base
 * @param {string} patchJson
 * @returns {string}
 */
export function applyPatch(base, patchJson) {
  if (!patchJson) return base;
  let parsed;
  try {
    parsed = JSON.parse(patchJson);
  } catch {
    return base;
  }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.ops)) return base;

  const a = toLines(base);
  /** @type {string[]} */
  const out = [];
  let i = 0;
  for (const op of parsed.ops) {
    if (op === "=") {
      if (i < a.length) out.push(a[i++]);
    } else if (typeof op === "number") {
      i += op;
    } else if (Array.isArray(op)) {
      for (const line of op) out.push(String(line));
    }
  }
  return fromLines(out);
}

/**
 * Prefer storing a full body when the patch is not meaningfully smaller.
 * @param {string} base
 * @param {string} target
 * @param {number} [maxPatchChars]
 * @returns {{ kind: "patch", patch: string } | { kind: "full", content: string }}
 */
export function makeRevisionBody(base, target, maxPatchChars = 100_000) {
  const patch = makePatch(base, target);
  const threshold = Math.min(maxPatchChars, Math.max(1024, target.length));
  if (patch.length <= threshold && patch.length < target.length * 0.9) {
    return { kind: "patch", patch };
  }
  return { kind: "full", content: target };
}
