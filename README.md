# Markdown Preview

A fast, client-side Markdown previewer. Paste upload, or open Markdown and see rendered HTML beside it. Everything runs in the browser — no server processing.

## Features

- Live split-pane editor and preview
- Collapse the editor or preview for more space
- Paste an image into the editor (inserted as a base64 data-URI Markdown image at the caret)
- Upload `.md`, `.markdown`, or `.txt` files
- Shareable **reader** and **present** links (`#mdz=` compressed Markdown + `theme` + `view`)
- **External content** modal when Markdown arrived via share URL, upload, or OS file launch (Accept to keep, Reject to discard and clear `#md` / `#mdz`)
- Present mode walks the doc by `h1`/`h2` sections (arrow keys / Space)
- Print / Save as PDF styles that hide chrome and keep the article clean
- Read aloud with high-quality voice picking and word highlighting (in supported browsers)
- Theme dropdown: GitHub Light, GitHub Dark, Sepia, Terminal, Salesforce Cosmos, Fancy
- Syntax highlighting in the Markdown editor and for fenced code blocks in the preview
- Emoji shortcodes (`:wink:`) and emoticons (`:-)`, `;)`)
- GitHub alert callouts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`)
- Mermaid diagrams from fenced `mermaid` code blocks (library loaded on demand from jsDelivr with SRI)
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

Open [http://127.0.0.1:3456](http://127.0.0.1:3456).

`npm run dev` and `npm run preview` use a small Node server that applies the same security headers as `public/.htaccess` (plain static servers like `serve` or Python’s `http.server` ignore `.htaccess`).

## Production build

```bash
npm install
npm run build
```

This writes a minified, bundled site to `dist/`:

- Bundles and minifies app JS (marked, DOMPurify, highlight.js, and Mermaid load from jsDelivr with Subresource Integrity)
- Minifies CSS and HTML
- Re-encodes `fancy.jpg` (mozjpeg, progressive)
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
https://example.com/#mdz=<deflate-raw+base64url>&theme=fancy&view=reader
```

| Param | Values | Notes |
| --- | --- | --- |
| `mdz` | deflate-raw → base64url Markdown | Preferred; used by new share links |
| `md` | base64url Markdown (uncompressed) | Legacy; still decoded for older links |
| `theme` | `github-light`, `github-dark`, `sepia`, `terminal`, `salesforce`, `fancy` | Optional; locks the look of the shared page |
| `view` | `reader`, `present`, `edit` | Optional; shared links default to `reader` |

Query form also works (`?mdz=...` or legacy `?md=...`). On load, URL content takes priority over the saved draft. Opening a document link lands in **reader** mode (not the split editor) unless `view=edit` or `view=present` is set. Very long documents can still produce URLs some apps truncate; the share toast warns when a link exceeds ~16KB.

Use the share control to copy a **reader** or **present** link. In reader mode, **Present**, **Print**, and **Edit** switch experiences without losing the document.
