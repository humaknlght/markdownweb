import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  applyGithubGistConfig,
  isGithubGistConfigured,
  resetGithubGistConfigForTests,
} from "../../src/gist/github-gist-config.js";
import { isSafeMediaUri } from "../../src/lib/safe-media-uri.js";

describe("github-gist-config", () => {
  beforeEach(() => {
    resetGithubGistConfigForTests();
  });

  it("enables only when enabled is true", () => {
    assert.equal(isGithubGistConfigured(), false);
    assert.equal(applyGithubGistConfig({ enabled: true }), true);
    assert.equal(isGithubGistConfigured(), true);
    assert.equal(applyGithubGistConfig({ enabled: false }), false);
    assert.equal(isGithubGistConfigured(), false);
  });
});

describe("gist + no-phone-home coexistence", () => {
  it("still blocks GitHub raw image hosts in media allowlist", () => {
    assert.equal(isSafeMediaUri("https://gist.githubusercontent.com/u/1/raw/x.png"), false);
    assert.equal(isSafeMediaUri("https://api.github.com/gists/1"), false);
  });
});
