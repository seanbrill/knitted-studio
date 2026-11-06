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

## My model is missing a tool the docs list

An older copy of knitted may still be running: the app keeps the one it started with until you quit it. Your model can tell by asking `get_studio_info`, which says the version answering, when that build was made and when it started. Quit knitted and open it again.

## My model says a slot was refused

That slot is locked by the Pattern. This is the brand lock working. Unlock it in the studio if you really mean to change it.

## A sync did not write the profile

Your model writes it, so it needs your Anthropic key: add it in Settings, under Model, and press **Sync again** in the Brief. The other steps run without it.

## A sync took no pictures

Pictures are taken in knitted's own browser, the same one knitting uses. If it is still downloading, wait for it and sync again. A page that answers with an error, or needs you to sign in, is left out, and the sync says which.

## A sync read only a few pages

It reads the pages that say most about the business first, up to the number you chose, and leaves alone the pages the site's robots.txt asks it not to read. A site that draws its words with scripts may show little to a reader: the sync says so, and a write-up of your own fills the gap.

## The desktop installer shows a warning

Early installers have no developer certificate yet, so macOS says it could not verify knitted and Windows says it protected your PC. See the [install guide](/download/install/) for the one extra click.

## Still stuck

Open an issue on GitHub with what you ran and what you saw.
