# Contributing

Read `docs/BRIEF.md` first: where this came from and what is already decided.
The design rules are in `KNITTED-THEME.md`.

## Layout

```
apps/
  site/      the marketing site, a static export          -> dist/site
  studio/    the studio: a Next server, plus electron/    -> dist/app, desktop
packages/
  core/      types, paths(), and from Phase 2 the SQLite store and the lock rules
  render/    a Pattern as a page (shared by the editor and the engine)
  engine/    frame capture and ffmpeg encode
  mcp/       the MCP server
  ui/        design tokens and shared components
  voice/     TTS providers (later)
test/        cross-package tests and the house-style guards
scripts/     build collection and verification
```

`@knitted/core` has two entry points. The default one is safe in a browser.
`@knitted/core/node` touches the filesystem and must never be imported from a
`"use client"` file; the studio build fails if you do.

## Running it

```bash
npm install
npm run dev            # studio (:4100) and site (:4101) together
npm run dev:studio     # the studio only
npm run dev:site       # the site only
npm run desktop:dev    # the studio in the desktop shell (Electron)
npm test               # unit and guard tests, no browser needed
npm run lint && npm run typecheck
```

Knitting needs Playwright and ffmpeg (both optional for working on the UI):

```bash
npx playwright install chromium
# and ffmpeg on your PATH
```

## The two builds

```bash
npm run build:site     # dist/site : static files, deploy anywhere
npm run build:app      # dist/app  : the studio server, needs Node
npm run build          # both
npm run verify:builds  # loads both outputs and checks they work
```

`dist/site` works from any static host. It does not work from `file://`: the
export uses root-absolute asset paths.

## Rules that are enforced by tests

- **No em dashes**, anywhere. Use a comma, a colon, or a full stop.
- **Nothing loads from a third party.** No CDN scripts, no Google Fonts. Fonts
  are bundled. The app has to work offline.
- **Playwright and Electron have one home each.** Lint fails on an import of
  either outside `packages/engine` and `apps/studio/electron`.

## Rules for anything that will ship in the desktop app

1. Every file location comes from `paths()`. Never call `homedir()` yourself,
   and never store an absolute path in the database.
2. No `fetch` of a third-party URL except behind a named user action.
3. Server code never imports Playwright or Electron at the top level.
4. Do not assume a port. The studio runs on a random free one in the desktop
   app.
5. Long work is a job with progress events, never an HTTP request held open.

## Editors built on Electron

VS Code exports `ELECTRON_RUN_AS_NODE=1` to its terminals. Use
`npm run desktop:dev`, which clears it, rather than calling `electron` directly.

## A check has to be able to fail

When you add a test or guard, show it failing against a deliberately broken
input before you trust it. The guards here carry their own fixtures for that.
