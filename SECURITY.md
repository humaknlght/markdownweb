# Security Policy

Markdown Preview is a client-side app. Markdown is rendered in the browser; this project does not run a server that stores or processes document contents.

## Supported versions

Security fixes are applied on the default branch and deployed to [https://dev.ericperret.org/markdown/](https://dev.ericperret.org/markdown/). There are no maintained older releases.

| Version | Supported |
| --- | --- |
| Default branch and the hosted instance above | Yes |
| Older commits, forks, and locally modified builds | No |

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public GitHub issue for a security problem.

Use GitHub private vulnerability reporting:

[https://github.com/humaknlght/markdownweb/security/advisories/new](https://github.com/humaknlght/markdownweb/security/advisories/new)

If that form is unavailable, email [markdown@ericperret.org](mailto:perree@gmail.com) with the subject line `markdownweb security`.

Include:

- A short description of the issue and the impact
- Steps to reproduce, or a minimal proof of concept
- The commit, build, or hosted URL you tested
- Browser and version, if the behavior depends on them

You should receive an acknowledgement within 7 business days. If a report is accepted, you will get updates as it is fixed. Fixes are developed privately and released on the default branch; a GitHub Security Advisory is published when the fix is available. Please allow a reasonable window before any public disclosure so the hosted instance can be updated.

Reports that are out of scope, duplicates, or not reproducible will be closed with a short explanation.

## Scope

In scope:

- Cross-site scripting or HTML injection that runs in the preview or the page after sanitization
- Content Security Policy bypasses in the shipped headers or production build
- Share-link or file-open handling that runs or keeps untrusted Markdown without the external-content prompt
- Service worker behavior that can serve attacker-controlled cached content
- Subresource Integrity or import-map checks that allow a script outside the intended allowlist
- Production build or Apache header changes that weaken the controls above

Out of scope:

- Markdown a person pastes, uploads, or opens in their own browser, with no path to another person’s session
- Denial of service from very large documents in the local browser
- Hosts or forks that drop the shipped `.htaccess` or the Node server’s security headers
- Attacks that need a modified build, disabled browser protections, or an accepted invalid TLS certificate
- Issues in a dependency or CDN that this app does not expose; report those to the upstream project
