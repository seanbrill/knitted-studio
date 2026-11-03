---
title: Motion
order: 10
summary: Animation built frame by frame, so it eases like real motion.
status: partial
note: The render engine works today. Setting up motion in the editor is not built yet.
---
# Motion

Most video tools treat a video as a pile of still pictures switched on and off at set times. Everything is a hard cut, and nothing can ease or blend.

## How knitted does it

A Pattern is a page with a timeline. To make a video, knitted sets the time to an exact moment, takes a picture of that frame, then moves on to the next. ffmpeg only does the final encoding.

## What you get

- Easing, fades, slides and masks, in your real brand fonts.
- The same result on a slow computer as on a fast one, because time is set rather than waited for.
- Stills and video through the same path, so a still always matches its video.

## Needs

Playwright and ffmpeg. The desktop app will include both.
