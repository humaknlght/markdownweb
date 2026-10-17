import { nameToEmoji } from "gemoji";

/**
 * Emoticon → gemoji short name (markdown-it-emoji / common Markdown shortcuts).
 * Longer forms are matched first at runtime.
 * Bare `8)` / `8-)` are omitted — they false-positive on `(see step 8)`.
 */
const EMOTICON_NAMES = {
  ">:(": "angry",
  ">:-(": "angry",
  ':")': "blush",
  ':-")': "blush",
  "</3": "broken_heart",
  ":/": "confused",
  ":-/": "confused",
  ":\\": "confused",
  ":-\\": "confused",
  ":'(": "cry",
  ":'-(": "cry",
  ":,(": "cry",
  ":,-(": "cry",
  ":(": "frowning",
  ":-(": "frowning",
  "<3": "heart",
  "]:(": "imp",
  "]:-(": "imp",
  "o:)": "innocent",
  "O:)": "innocent",
  "o:-)": "innocent",
  "O:-)": "innocent",
  "0:)": "innocent",
  "0:-)": "innocent",
  ":')": "joy",
  ":'-)": "joy",
  ":,)": "joy",
  ":,-)": "joy",
  ":*)": "joy",
  ":-*)": "joy",
  ":*": "kissing_heart",
  ":-*": "kissing_heart",
  "x-)": "laughing",
  "X-)": "laughing",
  ":|": "neutral_face",
  ":-|": "neutral_face",
  ":o": "open_mouth",
  ":-o": "open_mouth",
  ":O": "open_mouth",
  ":-O": "open_mouth",
  ":@": "rage",
  ":-@": "rage",
  ":)": "slightly_smiling_face",
  ":-)": "slightly_smiling_face",
  "=]": "slightly_smiling_face",
  "=)": "slightly_smiling_face",
  ":D": "smiley",
  ":-D": "smiley",
  "=D": "smiley",
  ":P": "stuck_out_tongue",
  ":-P": "stuck_out_tongue",
  ":p": "stuck_out_tongue",
  ":-p": "stuck_out_tongue",
  ",:(": "sweat",
  ",:-(": "sweat",
  ",:)": "sweat_smile",
  ",:-)": "sweat_smile",
  ":s": "unamused",
  ":-S": "unamused",
  ":z": "unamused",
  ":-Z": "unamused",
  ":$": "unamused",
  ":-$": "unamused",
  ";)": "wink",
  ";-)": "wink",
};

const EMOTICONS = Object.keys(EMOTICON_NAMES)
  .map((raw) => ({
    raw,
    emoji: nameToEmoji[EMOTICON_NAMES[raw]],
  }))
  .filter((entry) => entry.emoji)
  .sort((a, b) => b.raw.length - a.raw.length);

const EMOTICON_STARTERS = new Set(EMOTICONS.map((entry) => entry.raw[0]));

const SHORTCODE_RE = /^:([a-z0-9_+-]+):/;

/** True at string edges or when `ch` is not a letter, digit, or underscore. */
function isEmoticonBoundaryChar(ch) {
  if (ch == null || ch === "") return true;
  return !/[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Emoticons only match when isolated from word characters on both sides
 * (start/end, whitespace, or punctuation) — so `C:\Users` and `cost:$5` stay plain.
 */
function hasEmoticonBoundaries(src, start, length) {
  const before = start > 0 ? src[start - 1] : null;
  const after = start + length < src.length ? src[start + length] : null;
  return isEmoticonBoundaryChar(before) && isEmoticonBoundaryChar(after);
}

/**
 * True when `index` sits inside a URL-like token (http(s)://…, www.…, or a
 * mid-parse remnant starting with :// after the scheme was already consumed).
 * Prevents `:/` in `http://` and emoticons in query/path from converting.
 */
function isInsideUrl(src, index) {
  let start = index;
  while (start > 0 && !/\s/.test(src[start - 1])) start--;
  let end = index;
  while (end < src.length && !/\s/.test(src[end])) end++;
  const run = src.slice(start, end);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(run)) return true;
  if (/^www\./i.test(run)) return true;
  if (run.startsWith("://")) return true;
  return false;
}

function findShortcodeIndex(src) {
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== ":") continue;
    if (isInsideUrl(src, i)) continue;
    return i;
  }
  return -1;
}

function findEmoticonIndex(src) {
  for (let i = 0; i < src.length; i++) {
    if (!EMOTICON_STARTERS.has(src[i])) continue;
    if (isInsideUrl(src, i)) continue;
    for (const entry of EMOTICONS) {
      if (!src.startsWith(entry.raw, i)) continue;
      if (!hasEmoticonBoundaries(src, i, entry.raw.length)) continue;
      return i;
    }
  }
  return -1;
}

function matchEmoticon(src) {
  if (isInsideUrl(src, 0)) return null;
  for (const entry of EMOTICONS) {
    if (!src.startsWith(entry.raw)) continue;
    // Left boundary was enforced in start(); right varies by match length.
    if (!isEmoticonBoundaryChar(src[entry.raw.length] ?? null)) continue;
    return entry;
  }
  return null;
}

/** marked extension: `:wink:` shortcodes + `:-)`-style emoticons → Unicode emoji */
export function emojiExtension() {
  return {
    extensions: [
      {
        name: "emojiShortcode",
        level: "inline",
        start(src) {
          const index = findShortcodeIndex(src);
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          if (isInsideUrl(src, 0)) return;
          const match = SHORTCODE_RE.exec(src);
          if (!match) return;
          const emoji = nameToEmoji[match[1]];
          if (!emoji) return;
          return {
            type: "emojiShortcode",
            raw: match[0],
            name: match[1],
            emoji,
          };
        },
        renderer(token) {
          return token.emoji;
        },
      },
      {
        name: "emojiEmoticon",
        level: "inline",
        start(src) {
          const index = findEmoticonIndex(src);
          return index === -1 ? undefined : index;
        },
        tokenizer(src) {
          const entry = matchEmoticon(src);
          if (!entry) return;
          return {
            type: "emojiEmoticon",
            raw: entry.raw,
            emoji: entry.emoji,
          };
        },
        renderer(token) {
          return token.emoji;
        },
      },
    ],
  };
}
