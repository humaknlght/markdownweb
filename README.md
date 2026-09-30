# Markdown Preview

A fast, client-side Markdown previewer. Paste upload, or open Markdown and see rendered HTML beside it. Everything runs in the browser — no server processing.

Check out the hosted instance: [https://dev.ericperret.org/markdown/](https://dev.ericperret.org/markdown/)

## Features

- Live split-pane editor and preview
- Collapse the editor or preview for more space
- Paste an image into the editor (inserted as a base64 data-URI Markdown image at the caret)
- Upload `.md`, `.markdown`, or `.txt` files
- Shareable **edit** links (`#mdz=` compressed Markdown + `theme` + `view=edit`)
- **External content** modal when Markdown arrived via share URL, upload, or OS file launch (Accept to keep, Reject to restore your draft and clear `#md` / `#mdz`). Preview and editor syntax highlighting stay off until Accept.
- Present mode walks the doc by `h1`/`h2` sections (arrow keys / Space)
- **Slides** mode keeps the editor open while the preview walks those same sections
- Print / Save as PDF styles that hide chrome and keep the article clean
- Read aloud with high-quality voice picking and word highlighting (in supported browsers)
- **Writing tools** (Chrome on-device AI, when available): Write, Rewrite, and Proofread
- Theme dropdown: GitHub Light, GitHub Dark, Sepia, Terminal, Salesforce Cosmos, Fancy
- Syntax highlighting in the Markdown editor and for fenced code blocks in the preview
- Emoji shortcodes (`:wink:`) and emoticons (`:-)`, `;)`)
- GitHub alert callouts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`)
- YAML front matter at the start of a document → metadata table in the preview
- Mermaid diagrams from fenced `mermaid` code blocks (ESM build loaded on demand from jsDelivr; diagram chunks cached after first use)
- Local history of recent Markdown (remembered in `localStorage`)
- Progressive Web App: installable, offline (including CDN libs), update prompt
- Installed PWA can open `.md` / `.markdown` (and related text) files via “Open with” / OS default-app settings (Chromium desktop)

## Project layout

```
src/          Source (edit here)
public/       Apache .htaccess copied into the build
scripts/      Production build script
dist/         Optimized build output (deploy this)
```

## Develop

```bash
npm install
npm run dev
```

Open [https://127.0.0.1:3456](https://127.0.0.1:3456) (self-signed TLS so the server can speak HTTP/2; accept the browser warning once).

`npm run dev` and `npm run preview` use a small Node server that applies the same security headers as `public/.htaccess` (plain static servers like `serve` or Python’s `http.server` ignore `.htaccess`). When HTTP/2 is available it serves over HTTPS with HTTP/1.1 fallback; otherwise plain HTTP/1.1.

## Tests

```bash
npm test            # unit + script checks (node:test)
npm run test:e2e    # Playwright Chromium against the src server
npm run test:build  # production build invariants (opt-in; slower)
npm run test:all    # all of the above
```

## Production build

```bash
npm install
npm run build
```

This writes a minified, bundled site to `dist/`:

- Bundles and minifies app JS (marked, DOMPurify, highlight.js, gemoji, and yaml load from jsDelivr with Subresource Integrity; Mermaid uses the chunked ESM build)
- Minifies CSS and HTML
- **Content-hashes** JS, CSS, and images (`app.a1b2c3d4.js`, etc.) and rewrites HTML/CSS references for cache busting
- Precompresses HTML/CSS/JS with Zopfli (gzip) and brotli q=11; Apache (and `npm run preview`) serve brotli first, then gzip
- Injects a SHA-256 CSP hash for the inline theme boot script (no `unsafe-inline` for scripts)

Preview the build:

```bash
npm run preview
```

## Deploy to Apache

Copy everything inside `dist/` to your Apache document root (or VirtualHost directory), for example:

```bash
rsync -av --delete dist/ /var/www/html/markdown/
```

Ensure these modules are enabled when possible: `mod_mime`, `mod_deflate`, `mod_expires`, `mod_headers`. The included `.htaccess` sets MIME types, compression, and cache headers.

## Share URL format

Markdown is compressed with **deflate-raw**, then encoded as base64url in the hash, along with optional presentation options:

```
https://example.com/#mdz=<deflate-raw+base64url>&theme=fancy&view=edit
```

| Param | Values | Notes |
| --- | --- | --- |
| `mdz` | deflate-raw → base64url Markdown | Preferred; used by new share links |
| `md` | base64url Markdown (uncompressed) | Legacy; still decoded for older links |
| `theme` | `github-light`, `github-dark`, `sepia`, `terminal`, `salesforce`, `fancy` | Optional; locks the look of the shared page |
| `view` | `edit` (share links); also `reader`, `present`, `slides` for local navigation | Share button always writes `view=edit` |

Query form also works (`?mdz=...` or legacy `?md=...`). On load, URL content takes priority over the saved draft and opens in **edit** so the recipient can read the source before Accepting. Very long documents can still produce URLs some apps truncate; the share toast warns when a link exceeds ~16KB.

Use the share control to copy a link. After Accept, **Present**, **Print**, and **Slides** are available as usual.

## Chrome Writing tools

On supported Chrome builds, the toolbar **Writing tools** menu offers on-device Write, Rewrite, and Proofread (Gemini Nano). The menu stays hidden when the APIs are unavailable.

### Local (`127.0.0.1`)

Enable flags, then relaunch Chrome:

- `chrome://flags/#writer-api`
- `chrome://flags/#rewriter-api`
- `chrome://flags/#proofreader-api`

Also enable **Optimization Guide On Device Model** if prompted, and check `chrome://on-device-internals` for model download status. Hardware requirements apply (desktop OS, sufficient RAM/storage/GPU or CPU cores).

### Production ([https://dev.ericperret.org/markdown/](https://dev.ericperret.org/markdown/))

Register for the [Writer/Rewriter](https://developer.chrome.com/docs/ai/writer-api) and [Proofreader](https://developer.chrome.com/docs/ai/proofreader-api) origin trials for that origin. Uncomment and set the `Origin-Trial` headers in [`public/.htaccess`](public/.htaccess) (use `Header always add` once per token). Rebuild/deploy so Apache serves the headers on HTML responses.

Permissions-Policy already allows `writer`, `rewriter`, and `proofreader` for `self`.
