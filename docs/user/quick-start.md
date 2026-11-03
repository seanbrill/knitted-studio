---
title: Quick start
order: 1
summary: From a fresh clone to your first knit, using what exists today.
status: partial
note: The desktop app and the studio editor are not built yet. This page covers what works today, which is running from source and driving knitted through your model.
---
# Quick start

This page gets you from nothing to a knit using what is available today. The desktop app is not released yet, so for now you run knitted from a clone of the repository.

## What you need

- Node 22.13 or newer.
- For knitting only: Playwright with its Chromium browser, and ffmpeg. Everything else works without them.

## 1. Get the code

```bash
git clone https://github.com/seanbrill/knitted-studio.git
cd knitted-studio
npm install
```

## 2. Install the knitting tools

Knitting takes a picture of each frame and encodes the result, so it needs a browser engine and ffmpeg.

```bash
npm install playwright
npx playwright install chromium
```

Install ffmpeg with your package manager, for example `brew install ffmpeg` on macOS.

## 3. Connect your model

Add the MCP server to your model's settings. See [Using your model](/docs/using-your-model/) for the snippet.

## 4. Ask for a knit

Ask your model to list your projects, read a Pattern and fill its free slots. Then ask it to knit. Your files appear in a folder you can open. By default that folder is `.knitted-studio` in your home directory.

## What comes next

When the desktop app ships, this page becomes: install, open, knit. Until then, see [the vocabulary](/docs/the-vocabulary/) to learn the words, and [Troubleshooting](/docs/troubleshooting/) if something does not run.
