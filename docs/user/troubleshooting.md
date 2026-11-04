---
title: Troubleshooting
order: 15
summary: Fixes for the problems people hit first.
status: shipped
---
# Troubleshooting

## Knitting waits for the browser

Knitting draws each frame in a browser of its own, so every copy comes out the same, and your model uses it to see a Pattern. The desktop app downloads it by itself the first time it starts: about 100 MB, once, kept in your data folder. The Knit dialog shows how far along it is, and you can knit when it is done. Everything else in the studio works meanwhile. Running from a clone, install it yourself:

```bash
npm install playwright
npx playwright install chromium
```

## The browser download stops

The Knit dialog, and Settings, About, say why. Most often it is the connection: the browser comes from `cdn.playwright.dev`, so a firewall or proxy that blocks it stops the download. Press **Try again** once that is fixed. knitted also tries again the next time it starts.

## A knit finishes with no video

Video needs ffmpeg. Check that `ffmpeg -version` prints a version in your terminal. If it does not, install ffmpeg and open a new terminal.

## My model cannot see the tools

Restart the model's app after editing its MCP settings. With the desktop app, knitted has to be open, and the address has to be the one in Settings, Model: making a new address shuts the old one. With a clone, check that the path points at `packages/mcp/src/server.mjs` inside it, and that Node 22.13 or newer is installed.

## My model says a slot was refused

That slot is locked by the Pattern. This is the brand lock working. Unlock it in the studio if you really mean to change it.

## The desktop installer shows a warning

Early installers have no developer certificate yet, so macOS says it could not verify knitted and Windows says it protected your PC. See the [install guide](/download/install/) for the one extra click.

## Still stuck

Open an issue on GitHub with what you ran and what you saw.
