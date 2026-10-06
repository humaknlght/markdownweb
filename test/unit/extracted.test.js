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
  collectEditorLanguages,
  collectFenceLanguages,
  escapeHtml,
  formatRelativeTime,
  highlightEditorMarkdown,
  highlightFrontmatterYaml,
  joinFsPath,
  parentPathOf,
  parseDraftMirror,
  titleFromMarkdown,
  wrapHighlightedLines,
  SPLIT_MIN,
  SPLIT_MAX,
} from "../../src/markdown-utils.js";
import hljsMermaid from "../../src/hljs-mermaid.js";
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

  it("does not fetch a yaml grammar just for front matter", () => {
    assert.deepEqual(collectEditorLanguages("---\ntitle: Hi\n---\n\n# Body"), []);
    assert.deepEqual(
      collectEditorLanguages("---\nx: 1\n---\n\n```js\n1\n```"),
      ["js"],
    );
    assert.deepEqual(collectEditorLanguages("# No front matter\n```py\n1\n```"), ["py"]);
  });

  it("highlights front matter YAML with whole-value string tokens", () => {
    const html = highlightFrontmatterYaml(
      "title: My First Post\nname_name: Jane Doe\ndraft: false\ndate: 2026-10-05\n",
    );
    assert.match(html, /class="hljs-attr">title</);
    assert.match(html, /class="hljs-string">My First Post</);
    assert.match(html, /class="hljs-attr">name_name</);
    assert.match(html, /class="hljs-string">Jane Doe</);
    assert.match(html, /class="hljs-literal">false</);
    assert.match(html, /class="hljs-number">2026-10-05</);
    assert.doesNotMatch(html, /hljs-emphasis/);
    assert.doesNotMatch(html, /class="hljs-string">My</);
  });

  it("highlights YAML front matter separately from the markdown body", () => {
    const langs = new Set(["markdown"]);
    const hljs = {
      getLanguage: (name) => langs.has(name),
      highlight(text, { language }) {
        return {
          value: `<span class="lang-${language}">${escapeHtml(text)}</span>`,
        };
      },
    };
    const source = [
      "---",
      "title: My First Post",
      "tags:",
      "  - markdown",
      "author:",
      "  name_name: Jane Doe",
      "---",
      "",
      "# My First Post",
      "This is the actual content of the file.",
      "",
    ].join("\n");
    const html = highlightEditorMarkdown(source, hljs);
    assert.match(html, /class="hljs-meta"/);
    assert.match(html, /class="md-frontmatter"/);
    assert.match(html, /class="hljs-string">My First Post</);
    assert.match(html, /class="hljs-attr">name_name</);
    assert.match(html, /lang-markdown/);
    // YAML must not be fed to the markdown grammar (lists / emphasis).
    assert.doesNotMatch(html, /hljs-emphasis/);
    assert.doesNotMatch(html, /lang-markdown">[^<]*name_name/);
    const text = html
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    assert.equal(text, source);
  });

  it("highlights mermaid fences with a registered grammar", () => {
    const langs = new Set(["markdown", "mermaid"]);
    const hljs = {
      getLanguage: (name) => langs.has(name),
      highlight(text, { language }) {
        return {
          value: `<span class="lang-${language}">${escapeHtml(text)}</span>`,
        };
      },
    };
    const source = "# Hi\n\n```mermaid\nflowchart LR\n  A-->B\n```\n\nDone.";
    const html = highlightEditorMarkdown(source, hljs);
    assert.match(html, /lang-markdown/);
    assert.match(html, /lang-mermaid/);
    assert.match(html, /flowchart LR/);
    assert.match(html, /class="hljs-code"/);
    // Overlay text must stay aligned with the textarea source.
    const text = html
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    assert.equal(text, source);
  });

  it("falls back to plain code spans for unknown fence languages", () => {
    const hljs = {
      getLanguage: (name) => name === "markdown",
      highlight(text, { language }) {
        return {
          value: `<span class="lang-${language}">${escapeHtml(text)}</span>`,
        };
      },
    };
    const html = highlightEditorMarkdown("```nosuchlang\nx\n```", hljs);
    assert.match(html, /hljs-code/);
    assert.doesNotMatch(html, /lang-nosuchlang/);
  });

  it("exports a mermaid highlight.js grammar", () => {
    const grammar = hljsMermaid({
      COMMENT: (begin, end) => ({ className: "comment", begin, end }),
    });
    assert.equal(grammar.name, "Mermaid");
    assert.deepEqual(grammar.aliases, ["mermaid"]);
    assert.ok(grammar.contains.length > 0);
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

  it("collapses and expands reference-style data URI definitions", () => {
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const md = [
      "This paragraph references a transparent pixel right here: ![Pixel][transparent-pixel].",
      "",
      `[transparent-pixel]: ${dataUrl}`,
      "",
    ].join("\n");
    const collapsed = collapseDataUris(md);
    assert.match(collapsed, /\[transparent-pixel\]: data:image\/png;base64,iVBORw0KGgoA…#\d+/);
    assert.doesNotMatch(collapsed, /AAAAASUVORK5CYII=/);
    assert.equal(expandEmbeds(collapsed), md);

    const embeds = findCollapsedEmbeds(collapsed);
    assert.equal(embeds.length, 1);
    const def = collapsed.match(/\[transparent-pixel\]: data:image\/png;base64,[^\n]+/)?.[0];
    assert.equal(collapsed.slice(embeds[0].fullStart, embeds[0].fullEnd), def);
  });

  it("preserves carets when collapsing reference definitions", () => {
    const dataUrl = `data:image/png;base64,${"E".repeat(80)}`;
    const before = `![x][ref]\n\n[ref]: ${dataUrl}\n`;
    const { text, caretStart, caretEnd } = collapseDataUrisPreservingSelection(
      before,
      before.length,
      before.length,
    );
    assert.equal(caretStart, text.length);
    assert.equal(caretEnd, text.length);
    assert.equal(expandEmbeds(text), before);
  });
});
