---
title: Quick start
order: 1
summary: From nothing to your first knit, with the desktop app or a clone.
status: shipped
---
# Quick start

## With the desktop app

1. Download knitted for your computer from the [download page](/download/) and open it. Early installers need one extra click; the [install guide](/download/install/) shows it.
2. Make a project, open one of its Patterns, fill its free Stitches and knit.
3. To let Claude Code do the work, open Settings, Model, and copy the command under **Connect Claude Code**. See [Using your model](/docs/using-your-model/).

Your files stay on your computer. Help, **Reveal my library** opens the folder.

## From a clone

The rest of this page runs knitted from the repository instead.

### What you need

- Node 22.13 or newer.
- For knitting only: Playwright with its Chromium browser, and ffmpeg. Everything else works without them.

### 1. Get the code

```bash
git clone https://github.com/seanbrill/knitted-studio.git
cd knitted-studio
npm install
```

### 2. Install the knitting tools

Knitting takes a picture of each frame and encodes the result, so it needs a browser engine and ffmpeg.

```bash
npm install playwright
npx playwright install chromium
```

Install ffmpeg with your package manager, for example `brew install ffmpeg` on macOS.

### 3. Connect your model

Add the MCP server to your model's settings. See [Using your model](/docs/using-your-model/) for the snippet.

### 4. Ask for a knit

Ask your model to list your projects, read a Pattern and fill its free slots. Then ask it to knit. Your files appear in a folder you can open. By default that folder is `.knitted-studio` in your home directory.

## What comes next

See [the vocabulary](/docs/the-vocabulary/) to learn the words, and [Troubleshooting](/docs/troubleshooting/) if something does not run.
