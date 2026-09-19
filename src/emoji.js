import { nameToEmoji } from "gemoji";

/**
 * Emoticon → gemoji short name (markdown-it-emoji / common Markdown shortcuts).
 * Longer forms are matched first at runtime.
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
  "8-)": "sunglasses",
  "8)": "sunglasses",
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
      if (src.startsWith(entry.raw, i)) return i;
    }
  }
  return -1;
}

function matchEmoticon(src) {
  if (isInsideUrl(src, 0)) return null;
  for (const entry of EMOTICONS) {
    if (src.startsWith(entry.raw)) return entry;
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
