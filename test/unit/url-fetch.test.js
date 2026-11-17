import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyOpenUrl,
  githubContentsApiUrl,
  githubRawContentUrl,
  parseGithubFileUrl,
} from "../../src/url-fetch/github-url.js";
import {
  fileNameFromUrl,
  isAllowedFetchContentType,
  isAuthGatedHost,
  isUrlFetchMessage,
  makeUrlFetchMessage,
  parseHttpsUrl,
} from "../../src/url-fetch/url-fetch-api.js";

describe("url-fetch-api", () => {
  it("accepts https URLs only", () => {
    assert.equal(
      parseHttpsUrl("https://example.com/a.md")?.hostname,
      "example.com",
    );
    assert.equal(parseHttpsUrl("http://example.com/a.md"), null);
    assert.equal(parseHttpsUrl("javascript:alert(1)"), null);
    assert.equal(parseHttpsUrl("https://user:pass@example.com/a.md"), null);
  });

  it("derives file names from paths", () => {
    assert.equal(
      fileNameFromUrl("https://example.com/docs/readme.md"),
      "readme.md",
    );
    assert.equal(fileNameFromUrl("https://example.com/"), "untitled.md");
  });

  it("allows soft content types", () => {
    assert.equal(
      isAllowedFetchContentType("text/markdown; charset=utf-8"),
      true,
    );
    assert.equal(isAllowedFetchContentType("application/octet-stream"), true);
    assert.equal(isAllowedFetchContentType("image/png"), false);
  });

  it("detects Slack auth-gated hosts", () => {
    assert.equal(isAuthGatedHost("files.slack.com"), true);
    assert.equal(isAuthGatedHost("app.slack.com"), true);
    assert.equal(isAuthGatedHost("example.com"), false);
  });

  it("validates message shapes", () => {
    const msg = makeUrlFetchMessage({
      action: "fetch",
      req: "1",
      url: "https://x",
    });
    assert.equal(isUrlFetchMessage(msg), true);
    assert.equal(isUrlFetchMessage({ type: "nope" }), false);
  });
});

describe("github-url", () => {
  it("parses github.com blob URLs", () => {
    const target = parseGithubFileUrl(
      "https://github.com/acme/widgets/blob/main/docs/guide.md",
    );
    assert.ok(target);
    assert.equal(target.owner, "acme");
    assert.equal(target.repo, "widgets");
    assert.equal(target.ref, "main");
    assert.equal(target.path, "docs/guide.md");
    assert.equal(target.apiBase, "https://api.github.com");
    assert.match(
      githubContentsApiUrl(target),
      /api\.github\.com\/repos\/acme\/widgets\/contents\/docs\/guide\.md\?ref=main/,
    );
    assert.equal(
      githubRawContentUrl(target),
      "https://raw.githubusercontent.com/acme/widgets/main/docs/guide.md",
    );
  });

  it("parses raw.githubusercontent.com URLs", () => {
    const target = parseGithubFileUrl(
      "https://raw.githubusercontent.com/acme/widgets/main/README.md",
    );
    assert.ok(target);
    assert.equal(target.path, "README.md");
    assert.equal(target.ref, "main");
  });

  it("parses raw.githubusercontent.com refs/heads URLs", () => {
    const target = parseGithubFileUrl(
      "https://raw.githubusercontent.com/mxstbr/markdown-test-file/refs/heads/master/TEST.md",
    );
    assert.ok(target);
    assert.equal(target.owner, "mxstbr");
    assert.equal(target.repo, "markdown-test-file");
    assert.equal(target.ref, "refs/heads/master");
    assert.equal(target.path, "TEST.md");
  });

  it("parses configured enterprise hosts", () => {
    const target = parseGithubFileUrl(
      "https://github.example.test/org/repo/blob/develop/a.md",
      ["github.example.test"],
    );
    assert.ok(target);
    assert.equal(target.apiBase, "https://github.example.test/api/v3");
    assert.equal(target.host, "github.example.test");
  });

  it("classifies open URL kinds", () => {
    assert.equal(classifyOpenUrl("not-a-url"), "invalid");
    assert.equal(
      classifyOpenUrl("https://files.slack.com/files-pri/T/F/download/x.md"),
      "auth-fallback",
    );
    assert.equal(
      classifyOpenUrl("https://github.com/a/b/blob/main/x.md"),
      "github",
    );
    assert.equal(
      classifyOpenUrl(
        "https://raw.githubusercontent.com/acme/widgets/main/README.md",
      ),
      "public",
    );
    assert.equal(classifyOpenUrl("https://example.com/x.md"), "public");
  });
});
