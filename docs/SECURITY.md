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
- **MCP address.** Claude Code and other MCP clients cannot have the window's token, so they get their own door, `/api/mcp/<key>`, with a 192-bit random key in the path, compared in constant time. A wrong key gets 404, a request from a web page (a foreign `Origin`) gets 403, and the `Host` check still applies. Settings, Model makes a new key, which shuts the old address. It reaches the same tools and locks as the in-app model, nothing more. Test: `test/desktop-security.test.mjs`.
- **Updates.** Checking is the person's choice: the app asks once, and the menu changes it. The release list comes over HTTPS from the site, and a download is installed only if its SHA-256 matches the list. On a Mac the new app's signature must be whole (`codesign --verify --deep --strict`) and its bundle id and version must be the ones expected, and if it cannot take the old app's place the old app is put back. Tests: `test/update.test.mjs`; the swap itself is checked by hand on packed apps (RELEASING.md).

## Not done yet

- **Content-Security-Policy for the app window.** Next's inline bootstrap scripts need a nonce-based policy; it is not set yet.
- **Code signing and notarisation.** No developer certificates yet: the Mac app is ad-hoc signed, which keeps it whole but names no developer, and Windows builds are unsigned (see INSTALL.md).
- **Who made an update.** With no signing certificates, the SHA-256 proves a download is the file the release list names, not who made it: someone able to change both the release folder and the site could ship a different app. Developer ID and Authenticode signatures close this, and the updater should then check the signer too.
- **Updates on Windows and Linux.** Written (`apps/studio/electron/update.mjs`) but not yet tried on real machines.
