# Contributing

Thanks for helping improve Markdown Preview. This is a client-side app; keep changes focused and easy to review.

## Before you start

- Open an [issue](https://github.com/humaknlght/markdownweb/issues) for bugs or features when the change is non-trivial.
- **Security:** do not file a public issue. Use [private vulnerability reporting](https://github.com/humaknlght/markdownweb/security/advisories/new). See [SECURITY.md](SECURITY.md).

## Develop

```bash
npm install
npm run dev
```

Open [https://127.0.0.1:3456](https://127.0.0.1:3456) (self-signed TLS; accept the browser warning once). Edit under `src/`. More detail is in the [README](README.md).

## Tests

CI runs the full suite on every pull request. Locally:

```bash
npm test                 # unit + script checks
npx playwright install chromium   # once, for e2e
npm run test:e2e
npm run test:build       # production build invariants (slower)
npm run test:all         # everything CI runs
```

Prefer a failing test (unit or Playwright) when fixing a bug.

## Pull requests

1. Branch from `main`.
2. Keep the diff scoped to one concern.
3. Ensure `npm run test:all` passes.
4. If you bump a CDN dependency (marked, DOMPurify, highlight.js, gemoji, yaml, Mermaid), run `npm run update:cdn-sri` and commit the updated `src/cdn-integrity.json`.
5. Open a PR against `main`. The **test** status check must pass before merge.

## Code notes

- Prefer small, readable changes that match existing style in `src/` and `test/`.
- Markdown is sanitized with DOMPurify; treat share links, uploads, and opened files as untrusted until Accept.
- Do not commit secrets, personal drafts, or `dist/` build output.
