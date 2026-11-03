# Security notes

What protects a person using the desktop app, and what is honestly not done yet.

## In place (each has a test or a visible check)

- **Local gate.** The server listens on 127.0.0.1 only. The shell gives it a random 256-bit token at launch and gives the same token, as an httpOnly SameSite=Strict cookie, only to its own window. Every page and API call needs it; a wrong or missing token gets 401, and a foreign `Host` header (DNS rebinding) gets 421. Test: `test/desktop-security.test.mjs`.
- **Window hardening.** `contextIsolation` on, `nodeIntegration` off, `sandbox` on, no preload, no `webview`. New windows are denied; off-origin navigation is blocked and http(s) links open in the user's browser. Camera, microphone, location and notification requests are denied.
- **Secrets.** The model key lives in the OS keychain (or an environment variable). It is never in the database, logs, jobs or activity. Tests: `packages/agent/test/agent.test.mjs`, `test/e2e/ask.e2e.mjs`.
- **Locks.** One pure function enforces locks for people, the in-app model and MCP alike.
- **Untrusted text.** Anything from a file or website is wrapped as data before a model sees it, and a closing tag inside it cannot escape the wrapper.
- **Uploads and URLs.** SVGs are sanitised; URL imports refuse private addresses; stored paths are relative and checked against traversal.
- **Parts with code.** Rendered in a sandboxed iframe with no scripts and a CSP.

## Not done yet

- **Content-Security-Policy for the app window.** Next's inline bootstrap scripts need a nonce-based policy; it is not set yet.
- **Code signing and notarisation.** Builds are unsigned (see INSTALL.md).
- **Auto-update.** Not included; updating means installing the new release over the old one. The library is untouched.
