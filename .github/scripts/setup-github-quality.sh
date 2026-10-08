#!/usr/bin/env bash
# One-shot GitHub repo polish: About metadata, branch protection, v1.0.0 release.
# Requires: gh auth login (repo + admin:repo_hook scopes as needed)
set -euo pipefail

OWNER="${OWNER:-humaknlght}"
REPO="${REPO:-markdownweb}"
FULL="$OWNER/$REPO"

echo "==> About: description, homepage, topics"
gh api -X PATCH "repos/$FULL" \
  -f description='Client-side Markdown previewer with live HTML, Mermaid, themes, PWA, and share links' \
  -f homepage='https://dev.ericperret.org/markdown/' \
  -F has_issues=true \
  -F has_projects=false \
  -F has_wiki=false >/dev/null

gh api -X PUT "repos/$FULL/topics" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF' >/dev/null
{
  "names": [
    "markdown",
    "markdown-editor",
    "markdown-preview",
    "pwa",
    "mermaid",
    "client-side",
    "dompurify",
    "syntax-highlighting"
  ]
}
EOF

echo "==> Branch protection on main (require CI)"
# Context name is the job name from .github/workflows/ci.yml ("test")
gh api -X PUT "repos/$FULL/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF' >/dev/null
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

echo "==> Release v1.0.0 (idempotent if tag exists)"
if gh release view v1.0.0 --repo "$FULL" >/dev/null 2>&1; then
  echo "    release v1.0.0 already exists"
else
  gh release create v1.0.0 \
    --repo "$FULL" \
    --title "v1.0.0" \
    --notes "$(cat <<'NOTES'
## Markdown Preview v1.0.0

Client-side Markdown previewer with live HTML rendering.

**Try it:** https://dev.ericperret.org/markdown/

### Highlights
- Split-pane editor and preview, themes, share links (`#mdz=`)
- Mermaid diagrams, GitHub alerts, definition lists, YAML front matter
- PWA install / offline, local history, export and print
- CI on every push and pull request

See the [README](https://github.com/humaknlght/markdownweb#readme) for develop and deploy instructions.
NOTES
)" \
    --target main
fi

echo "Done."
