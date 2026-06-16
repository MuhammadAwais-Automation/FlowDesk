# Security Policy

FlowDesk is a local-first desktop app. User sessions, cookies, prompt data, and
workspace metadata are intended to stay on the user's machine unless a future
optional sync adapter is explicitly enabled.

## Reporting A Vulnerability

Please report security issues privately instead of opening a public issue.

Until a dedicated security contact is published, create a minimal private report
for the maintainers with:

- affected version or commit
- reproduction steps
- expected impact
- any suggested fix

## Security Expectations

- Do not commit secrets, cookies, tokens, API keys, or `.env` files.
- Keep Electron renderer code behind the preload `contextBridge`.
- Keep `nodeIntegration` disabled for remote content.
- Keep `contextIsolation` enabled.
- Validate user-controlled URLs before adding new embedded tools.
- Treat third-party websites opened in `WebContentsView` as untrusted content.

## Supported Versions

Security support is currently focused on the latest `main` branch until the
project starts publishing versioned releases.
