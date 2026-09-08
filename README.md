# Markdown Preview

A fast, client-side Markdown previewer. Paste or upload Markdown and see rendered HTML beside it. Everything runs in the browser — no server processing.

## Features

- Live split-pane editor and preview
- Collapse the editor or preview for more space
- Upload `.md`, `.markdown`, or `.txt` files
- Load content from the URL (`#md=` or `?md=`, base64url-encoded)
- Copy a share URL for the current document
- Theme dropdown: GitHub Light, GitHub Dark, Sepia, Terminal, Salesforce Cosmos, Fancy
- Syntax highlighting for fenced code blocks
- Local history of recent Markdown (remembered in `localStorage`)

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

- Bundles and minifies JS (marked, DOMPurify, highlight.js inlined)
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

Content is encoded as UTF-8 → base64url and placed in the hash:

```
https://example.com/#md=<base64url>
```

Query form also works: `?md=<base64url>`. On load, URL content takes priority over the saved draft.
