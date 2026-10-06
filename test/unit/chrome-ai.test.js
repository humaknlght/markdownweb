import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accumulateStream,
  acceptProofreadResult,
  availabilityLabel,
  BR_PLACEHOLDER,
  diffWords,
  escapeAiHtml,
  finalizeProofreadSlice,
  findProofreadSplitOffset,
  formatAiError,
  INPUT_TOO_LARGE_MESSAGE,
  isHeadingOnlyMarkdown,
  isLightProofreadEdit,
  mapWithConcurrency,
  markdownFenceStructureIntact,
  preserveEdgeWhitespace,
  promptSystemFor,
  proofreadReplaceSpans,
  renderCorrectedDiffHtml,
  renderProofreadMarkup,
  resolveInsertRange,
  resolveTargetRange,
  runProofread,
  runProofreadChunked,
  runProofreadDocument,
  runPromptProofread,
  runPromptRewrite,
  runPromptWrite,
  splitProofreadChunks,
  splitMarkdownProofreadParts,
  findMermaidNoteSpans,
  findLineCommentSpans,
  stripOuterMarkdownFence,
  tokenizeForDiff,
  wrapPromptSessionAsProofreader,
  writingBackendFor,
} from "../../src/chrome-ai.js";

describe("chrome-ai helpers", () => {
  it("resolveTargetRange prefers a non-empty selection", () => {
    const r = resolveTargetRange("abcdef", 2, 5);
    assert.equal(r.start, 2);
    assert.equal(r.end, 5);
    assert.equal(r.slice, "cde");
    assert.equal(r.isSelection, true);
  });

  it("resolveTargetRange falls back to the whole document", () => {
    const r = resolveTargetRange("hello", 3, 3);
    assert.equal(r.start, 0);
    assert.equal(r.end, 5);
    assert.equal(r.slice, "hello");
    assert.equal(r.isSelection, false);
  });

  it("resolveTargetRange normalizes inverted selection", () => {
    const r = resolveTargetRange("abcdef", 5, 2);
    assert.equal(r.start, 2);
    assert.equal(r.end, 5);
    assert.equal(r.slice, "cde");
  });

  it("resolveInsertRange keeps a collapsed caret for insert-at-caret", () => {
    const r = resolveInsertRange("hello", 3, 3);
    assert.equal(r.start, 3);
    assert.equal(r.end, 3);
    assert.equal(r.slice, "");
    assert.equal(r.isSelection, false);
  });

  it("resolveInsertRange still replaces a non-empty selection", () => {
    const r = resolveInsertRange("abcdef", 2, 5);
    assert.equal(r.start, 2);
    assert.equal(r.end, 5);
    assert.equal(r.slice, "cde");
    assert.equal(r.isSelection, true);
  });

  it("stripOuterMarkdownFence removes a wrapping fence", () => {
    assert.equal(stripOuterMarkdownFence("```markdown\nHi\n```"), "Hi");
    assert.equal(stripOuterMarkdownFence("```\nHi\n```"), "Hi");
    assert.equal(stripOuterMarkdownFence("plain"), "plain");
    assert.equal(stripOuterMarkdownFence("```js\ncode\n```"), "```js\ncode\n```");
  });

  it("promptSystemFor covers write / rewrite / proofread", () => {
    assert.match(promptSystemFor("Writer"), /Markdown/);
    assert.match(promptSystemFor("Rewriter"), /rewrite/i);
    assert.match(promptSystemFor("Proofreader"), /proofread/i);
  });

  it("writingBackendFor prefers dedicated APIs over Prompt", () => {
    const hadWriter = "Writer" in globalThis;
    const hadLm = "LanguageModel" in globalThis;
    const prevWriter = globalThis.Writer;
    const prevLm = globalThis.LanguageModel;
    try {
      globalThis.Writer = { availability() {}, create() {} };
      globalThis.LanguageModel = { availability() {}, create() {} };
      assert.equal(writingBackendFor("Writer"), "dedicated");
      delete globalThis.Writer;
      assert.equal(writingBackendFor("Writer"), "prompt");
      delete globalThis.LanguageModel;
      assert.equal(writingBackendFor("Writer"), null);
    } finally {
      if (hadWriter) globalThis.Writer = prevWriter;
      else delete globalThis.Writer;
      if (hadLm) globalThis.LanguageModel = prevLm;
      else delete globalThis.LanguageModel;
    }
  });

  it("runPromptWrite streams Markdown and strips outer fences", async () => {
    const session = {
      async *promptStreaming() {
        yield "```markdown\n";
        yield "# Hello\n";
        yield "```";
      },
    };
    const seen = [];
    const out = await runPromptWrite(session, "greet", {
      tone: "casual",
      length: "short",
      onChunk: (s) => seen.push(s),
    });
    assert.equal(out, "# Hello");
    assert.ok(seen.length >= 1);
    assert.equal(seen.at(-1), "# Hello");
  });

  it("runPromptRewrite includes the source text in the prompt", async () => {
    let seen = "";
    const session = {
      async prompt(input) {
        seen = input;
        return "Rewritten";
      },
    };
    const out = await runPromptRewrite(session, "Original body", {
      tone: "more-formal",
      context: "Make it polite",
    });
    assert.equal(out, "Rewritten");
    assert.match(seen, /Original body/);
    assert.match(seen, /Make it polite/);
    assert.match(seen, /formal/i);
  });

  it("wrapPromptSessionAsProofreader feeds runProofreadDocument", async () => {
    const lm = {
      async prompt() {
        return "Fixed text.";
      },
    };
    const session = wrapPromptSessionAsProofreader(lm);
    const result = await runProofread(session, "Fixd text.");
    assert.equal(result.correctedInput, "Fixed text.");
  });

  it("runPromptProofread preserves unchanged text", async () => {
    const session = {
      async prompt() {
        return "Same text";
      },
    };
    const result = await runPromptProofread(session, "Same text");
    assert.equal(result.correctedInput, "Same text");
    assert.deepEqual(result.corrections, []);
  });

  it("accumulateStream joins chunks and reports progress", async () => {
    async function* gen() {
      yield "Hello";
      yield " ";
      yield "world";
    }
    const seen = [];
    const out = await accumulateStream(gen(), {
      onChunk: (s) => seen.push(s),
    });
    assert.equal(out, "Hello world");
    assert.deepEqual(seen, ["Hello", "Hello ", "Hello world"]);
  });

  it("accumulateStream aborts when signaled", async () => {
    const ac = new AbortController();
    async function* gen() {
      yield "a";
      ac.abort();
      yield "b";
    }
    await assert.rejects(
      () => accumulateStream(gen(), { signal: ac.signal }),
      (err) => err.name === "AbortError",
    );
  });

  it("escapeAiHtml escapes markup characters", () => {
    assert.equal(escapeAiHtml(`<a href="x">y's & z</a>`), "&lt;a href=&quot;x&quot;&gt;y&#39;s &amp; z&lt;/a&gt;");
  });

  it("renderProofreadMarkup highlights correction ranges", () => {
    const html = renderProofreadMarkup("I seen him.", [
      { startIndex: 2, endIndex: 6 },
    ]);
    assert.equal(html, 'I <mark class="ai-error">seen</mark> him.');
  });

  it("renderProofreadMarkup escapes text outside and inside marks", () => {
    const html = renderProofreadMarkup("a <b> c", [{ startIndex: 2, endIndex: 5 }]);
    assert.equal(html, 'a <mark class="ai-error">&lt;b&gt;</mark> c');
  });

  it("availabilityLabel covers known statuses", () => {
    assert.match(availabilityLabel("available"), /Ready/);
    assert.match(availabilityLabel("downloadable"), /download/i);
    assert.match(availabilityLabel("downloading"), /Downloading/);
    assert.match(availabilityLabel("unavailable"), /Not available/);
  });

  it("formatAiError maps quota / too-large failures", () => {
    assert.equal(
      formatAiError({ name: "QuotaExceededError", message: "x" }),
      INPUT_TOO_LARGE_MESSAGE,
    );
    assert.equal(
      formatAiError({ name: "Error", message: "The input is too large" }),
      INPUT_TOO_LARGE_MESSAGE,
    );
    assert.equal(formatAiError({ name: "AbortError" }), "Stopped.");
    assert.match(formatAiError({ message: "boom" }), /boom/);
  });

  it("tokenizeForDiff keeps words and whitespace", () => {
    assert.deepEqual(tokenizeForDiff("I seen  him"), ["I", " ", "seen", "  ", "him"]);
  });

  it("diffWords reports inserts and deletes", () => {
    const ops = diffWords("I seen him", "I saw him");
    assert.deepEqual(
      ops.filter((o) => o.type !== "equal"),
      [
        { type: "delete", value: "seen" },
        { type: "insert", value: "saw" },
      ],
    );
  });

  it("diffWords keeps large nearly-identical docs from painting everything", () => {
    const line = (i) => `line ${i} with enough words to inflate the token count here`;
    const lines = Array.from({ length: 120 }, (_, i) => line(i));
    const before = lines.join("\n");
    const after = lines
      .map((l, i) => (i === 57 ? l.replace("enough", "ample") : l))
      .join("\n");
    const tokens = before.match(/\s+|[^\s]+/g) || [];
    assert.ok(tokens.length * tokens.length > 250_000);
    const ops = diffWords(before, after);
    const inserts = ops.filter((o) => o.type === "insert");
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].value, "ample");
    const html = renderCorrectedDiffHtml(before, after);
    assert.match(html, /<mark class="ai-diff">ample<\/mark>/);
    assert.ok(!html.startsWith('<mark class="ai-diff">line 0'));
  });

  it("renderCorrectedDiffHtml highlights replacements in the corrected text", () => {
    const html = renderCorrectedDiffHtml("I seen him", "I saw him");
    assert.equal(html, 'I <mark class="ai-diff">saw</mark> him');
  });

  it("splitProofreadChunks preserves the full text when joined", () => {
    const text = "alpha\n\nbeta\n\ngamma ".repeat(200);
    const chunks = splitProofreadChunks(text, 500);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(""), text);
  });

  it("findProofreadSplitOffset prefers a heading boundary", () => {
    const text = "intro paragraph text\n\n## Next section\nmore";
    const cut = findProofreadSplitOffset(text, 40);
    assert.equal(text.slice(cut, cut + 2), "##");
  });

  it("splitProofreadChunks returns a single chunk for short text", () => {
    assert.deepEqual(splitProofreadChunks("short", 1800), ["short"]);
  });

  it("splitMarkdownProofreadParts round-trips with mermaid fences", () => {
    const md = [
      "Intro text.",
      "",
      "```mermaid",
      "sequenceDiagram",
      "    note over A: I seen him",
      "    A->>B: hello",
      "```",
      "",
      "Outro.",
    ].join("\n");
    const parts = splitMarkdownProofreadParts(md);
    assert.equal(parts.map((p) => (p.kind === "prose" ? p.text : p.open + p.body + p.close)).join(""), md);
    assert.equal(parts.filter((p) => p.kind === "fence").length, 1);
    assert.equal(parts.find((p) => p.kind === "fence")?.lang, "mermaid");
  });

  it("findMermaidNoteSpans targets note bodies only", () => {
    const body = "sequenceDiagram\n    note over Publish: I seen him\n    A->>B: x\n";
    const spans = findMermaidNoteSpans(body);
    assert.equal(spans.length, 1);
    assert.equal(body.slice(spans[0].start, spans[0].end), "I seen him");
  });

  it("findLineCommentSpans finds // comments and skips URLs", () => {
    const body = 'const u = "https://example.com"; // I seen him\n';
    const spans = findLineCommentSpans(body, "js");
    assert.equal(spans.length, 1);
    assert.equal(body.slice(spans[0].start, spans[0].end), "I seen him");
  });

  it("mapWithConcurrency preserves order with limited parallelism", async () => {
    const started = [];
    const results = await mapWithConcurrency([30, 10, 20], 2, async (ms, i) => {
      started.push(i);
      await new Promise((r) => setTimeout(r, ms));
      return i * 10;
    });
    assert.deepEqual(results, [0, 10, 20]);
    assert.equal(started[0], 0);
    assert.equal(started[1], 1);
  });

  it("acceptProofreadResult rejects repetition loops and length blowups", () => {
    assert.equal(acceptProofreadResult("## Retreive\n\n", "## Retrieve\n\n"), true);
    const loop = Array.from({ length: 40 }, () => "## Retriever").join("\n");
    assert.equal(acceptProofreadResult("## Retreive\n\n", loop), false);
    assert.equal(
      acceptProofreadResult("short note", `short note${"<".repeat(80)}`),
      false,
    );
    assert.equal(
      acceptProofreadResult(`a ${BR_PLACEHOLDER} b`, `a ${BR_PLACEHOLDER} b!`),
      true,
    );
    assert.equal(
      acceptProofreadResult(`a ${BR_PLACEHOLDER} b`, "a broken b"),
      false,
    );
  });

  it("acceptProofreadResult rejects heading/fence corruption", () => {
    assert.equal(isHeadingOnlyMarkdown("## Retreive\n\n"), true);
    assert.equal(
      acceptProofreadResult("## Retreive\n\n", "## Retrieve\n\n#"),
      false,
    );
    assert.equal(
      acceptProofreadResult("## Publish\n\n", "## Publish\n\n## Publish"),
      false,
    );
    assert.equal(
      finalizeProofreadSlice("## Retreive\n\n", "## Retrieve\n\n#"),
      "## Retreive\n\n",
    );
    assert.equal(
      finalizeProofreadSlice("## Retreive\n\n", "## Retrieve"),
      "## Retrieve\n\n",
    );
    assert.equal(
      finalizeProofreadSlice("## Retreive\n\n", "Retrieve"),
      "## Retreive\n\n",
    );
    assert.equal(
      preserveEdgeWhitespace("\n## Publish\n\n", "## Publish"),
      "\n## Publish\n\n",
    );
  });

  it("isLightProofreadEdit allows typos but rejects title-case rewrites", () => {
    assert.equal(isLightProofreadEdit("I seen him", "I saw him"), true);
    assert.equal(
      isLightProofreadEdit(
        "BUILD phase, store bytes and stamp metadata",
        "BUILD Phase, Store Bytes and Stamp Metadata",
      ),
      false,
    );
  });

  it("runProofread falls back when the model degenerates", async () => {
    const session = {
      proofread: async () => ({
        correctedInput: Array.from({ length: 30 }, () => "## Retriever").join("\n"),
        corrections: [{ startIndex: 0, endIndex: 3 }],
      }),
    };
    const result = await runProofread(session, "## Retreive\n\n");
    assert.equal(result.correctedInput, "## Retreive\n\n");
    assert.equal(result.corrections.length, 0);
  });

  it("runProofreadDocument keeps fence structure when prose is mangled", async () => {
    const md = "## Retreive\n\n```mermaid\nnote over A: hi\n```\n\n## Publish\n\n```mermaid\nnote over B: bye\n```\n";
    let call = 0;
    const session = {
      proofread: async (text) => {
        call += 1;
        if (String(text).includes("Retreive")) {
          return { correctedInput: "## Retrieve\n\n#", corrections: [] };
        }
        if (String(text).includes("Publish") && !String(text).includes("note")) {
          return { correctedInput: "## Publish\n\n## Publish", corrections: [] };
        }
        return { correctedInput: String(text).replace("hi", "hello"), corrections: [] };
      },
    };
    const result = await runProofreadDocument(session, md);
    assert.equal(markdownFenceStructureIntact(md, result.correctedInput), true);
    assert.match(result.correctedInput, /^## Retreive\n\n```mermaid/m);
    assert.match(result.correctedInput, /\n## Publish\n\n```mermaid/);
    assert.ok(!result.correctedInput.includes("#```"));
    assert.ok(!result.correctedInput.includes("## Publish```"));
    assert.ok(call >= 1);
  });

  it("runProofreadChunked runs chunks concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const session = {
      inputQuota: 2000,
      measureInputUsage: async (t) => String(t).length,
      proofread: async (text) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 40));
        active -= 1;
        // Light edit so acceptProofreadResult keeps the correction.
        return {
          correctedInput: String(text).replace("aaa", "aXa"),
          corrections: [{ startIndex: 0, endIndex: 3 }],
        };
      },
    };
    // Quota → ~1600-char chunks; three paragraphs force parallel work.
    const text = `${"a".repeat(900)}\n\n${"b".repeat(900)}\n\n${"c".repeat(900)}`;
    const result = await runProofreadChunked(session, text);
    assert.match(result.correctedInput, /^aXa/);
    assert.ok(result.chunkCount >= 2);
    assert.ok(maxActive >= 2, `expected parallel calls, maxActive=${maxActive}`);
  });

  it("proofreadReplaceSpans proofreads notes in parallel without packing", async () => {
    let calls = 0;
    const seen = [];
    const session = {
      proofread: async (text) => {
        calls += 1;
        seen.push(text);
        return {
          correctedInput: String(text).replaceAll("seen", "saw"),
          corrections: [{ startIndex: 0, endIndex: 4 }],
        };
      },
    };
    const body = [
      "sequenceDiagram",
      "    note over A: I seen one<br>more",
      "    note over B: I seen two",
      "    note over C: I seen three",
      "    A->>B: hello",
    ].join("\n");
    const spans = findMermaidNoteSpans(body);
    assert.equal(spans.length, 3);
    const result = await proofreadReplaceSpans(session, body, spans);
    assert.match(result.text, /I saw one<br>more/);
    assert.match(result.text, /I saw two/);
    assert.match(result.text, /I saw three/);
    assert.equal(calls, 3);
    assert.ok(seen.every((s) => !s.includes("<<<")));
    assert.ok(seen.some((s) => s.includes(BR_PLACEHOLDER)));
  });
});
