import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  SPEECH_CHUNK_MAX,
  chunkSpeechText,
  isEnglishVoice,
  isHighQualityVoice,
  listVoices,
  voiceQualityScore,
  wordEndOffset,
} from "../../src/speech-text.js";
import {
  canonicalHljsLang,
  clampSplit,
  collectFenceLanguages,
  escapeHtml,
  formatRelativeTime,
  joinFsPath,
  parentPathOf,
  parseDraftMirror,
  titleFromMarkdown,
  wrapHighlightedLines,
  SPLIT_MIN,
  SPLIT_MAX,
} from "../../src/markdown-utils.js";
import {
  clearEmbeds,
  collapseDataUris,
  collapseDataUrisPreservingSelection,
  collapsedEmbedUriTouched,
  expandEmbeds,
  findCollapsedEmbeds,
  formatEmbedMarkdown,
  rememberEmbed,
} from "../../src/embeds.js";

describe("speech-text", () => {
  it("chunks long text at sentence boundaries under the max", () => {
    const text = "A".repeat(50) + ". " + "B".repeat(50) + "! " + "C".repeat(200);
    const chunks = chunkSpeechText(text);
    assert.ok(chunks.length >= 2);
    for (const chunk of chunks) {
      assert.ok(chunk.text.length <= SPEECH_CHUNK_MAX);
      assert.equal(text.slice(chunk.start, chunk.start + chunk.text.length), chunk.text);
    }
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(chunkSpeechText("   "), []);
  });

  it("scores Siri/Google high and novelty voices low", () => {
    assert.ok(voiceQualityScore({ name: "Samantha (Siri)", localService: true }) >= 100);
    assert.ok(voiceQualityScore({ name: "Google US English", localService: false }) >= 60);
    assert.ok(voiceQualityScore({ name: "Fred", localService: true }) < 0);
    assert.equal(isEnglishVoice({ lang: "en-US" }), true);
    assert.equal(isEnglishVoice({ lang: "fr-FR" }), false);
    assert.equal(isHighQualityVoice({ name: "Zarvox", lang: "en-US", localService: true }), false);
  });

  it("dedupes voices preferring local copies", () => {
    const voices = listVoices([
      { name: "Samantha", lang: "en-US", localService: false, voiceURI: "cloud" },
      { name: "Samantha", lang: "en-US", localService: true, voiceURI: "local" },
      { name: "Fred", lang: "en-US", localService: true, voiceURI: "fred" },
    ]);
    assert.equal(voices.length, 1);
    assert.equal(voices[0].voiceURI, "local");
  });

  it("computes word end offsets", () => {
    assert.equal(wordEndOffset("hello world", 0, 5), 5);
    assert.equal(wordEndOffset("hello world", 6, 0), 11);
  });
});

describe("markdown-utils", () => {
  it("escapes HTML", () => {
    assert.equal(escapeHtml(`<a & "'>`), "&lt;a &amp; &quot;&#39;&gt;");
  });

  it("normalizes highlight.js language names", () => {
    assert.equal(canonicalHljsLang("js"), "javascript");
    assert.equal(canonicalHljsLang("c++"), "cpp");
    assert.equal(canonicalHljsLang("C#"), "csharp");
    assert.equal(canonicalHljsLang("html"), "xml");
    assert.equal(canonicalHljsLang("plaintext"), "");
    assert.equal(canonicalHljsLang("../evil"), "");
  });

  it("collects fence languages and skips mermaid", () => {
    const langs = collectFenceLanguages("```js\nx\n```\n\n```mermaid\ngraph\n```\n\n~~~python\ny\n~~~");
    assert.deepEqual(langs, ["js", "python"]);
  });

  it("wraps highlighted lines and reopens spans", () => {
    const html = wrapHighlightedLines('<span class="k">a\nb</span>');
    assert.match(html, /code-line/);
    assert.match(html, /line-src/);
  });

  it("derives titles from front matter then headings", () => {
    assert.equal(titleFromMarkdown("---\ntitle: From FM\n---\n\n# Heading"), "From FM");
    assert.equal(titleFromMarkdown("# Heading only"), "Heading only");
    assert.equal(titleFromMarkdown("plain line"), "plain line");
    assert.equal(titleFromMarkdown("   "), "Untitled");
  });

  it("formats relative times with an injectable now", () => {
    const now = 1_000_000;
    assert.equal(formatRelativeTime(now - 10_000, now), "just now");
    assert.equal(formatRelativeTime(now - 120_000, now), "2m ago");
    assert.equal(formatRelativeTime(now - 3_600_000 * 3, now), "3h ago");
  });

  it("clamps split percentages", () => {
    assert.equal(clampSplit(0), SPLIT_MIN);
    assert.equal(clampSplit(100), SPLIT_MAX);
    assert.equal(clampSplit(40), 40);
  });

  it("joins and parents fs paths", () => {
    assert.equal(joinFsPath("", "a.md"), "a.md");
    assert.equal(joinFsPath("docs", "a.md"), "docs/a.md");
    assert.equal(parentPathOf("docs/a.md"), "docs");
    assert.equal(parentPathOf("a.md"), "");
  });

  it("parses draft mirrors including legacy plain strings", () => {
    assert.equal(parseDraftMirror(null), null);
    assert.deepEqual(parseDraftMirror("legacy"), {
      v: 1,
      docKey: "untitled",
      content: "legacy",
    });
    assert.deepEqual(
      parseDraftMirror(JSON.stringify({ v: 1, docKey: "path:x", content: "c" })),
      { v: 1, docKey: "path:x", content: "c" },
    );
  });
});

describe("embeds", () => {
  beforeEach(() => {
    clearEmbeds();
  });

  it("collapses and expands long data URIs exactly", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(80)}`;
    const md = `![alt](${dataUrl})`;
    const collapsed = collapseDataUris(md);
    assert.match(collapsed, /…#\d+/);
    assert.equal(expandEmbeds(collapsed), md);
  });

  it("reuses ids for the same data URL", () => {
    const dataUrl = `data:image/png;base64,${"B".repeat(80)}`;
    const a = rememberEmbed(dataUrl);
    const b = rememberEmbed(dataUrl);
    assert.equal(a, b);
  });

  it("preserves carets when collapsing", () => {
    const dataUrl = `data:image/png;base64,${"C".repeat(80)}`;
    const before = `prefix ![x](${dataUrl}) suffix`;
    const { text, caretStart, caretEnd } = collapseDataUrisPreservingSelection(
      before,
      before.length,
      before.length,
    );
    assert.equal(caretStart, text.length);
    assert.equal(caretEnd, text.length);
    assert.equal(expandEmbeds(text), before);
  });

  it("finds collapsed embeds and detects URI touches", () => {
    const dataUrl = `data:image/png;base64,${"D".repeat(80)}`;
    const collapsed = formatEmbedMarkdown("pic", dataUrl);
    const embeds = findCollapsedEmbeds(collapsed);
    assert.equal(embeds.length, 1);
    const emb = embeds[0];
    assert.equal(collapsedEmbedUriTouched(emb, emb.uriStart + 1, emb.uriStart + 1, "insertText"), true);
    assert.equal(
      collapsedEmbedUriTouched(emb, emb.uriEnd, emb.uriEnd, "deleteContentBackward"),
      true,
    );
    assert.equal(collapsedEmbedUriTouched(emb, 0, 0, "insertText"), false);
  });
});
