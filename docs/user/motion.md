---
title: Motion
order: 10
summary: Animation built frame by frame, so it eases like real motion.
status: shipped
---
# Motion

Most video tools treat a video as a pile of still pictures switched on and off at set times. Everything is a hard cut, and nothing can ease or blend.

## How knitted does it

A Pattern is a page with a timeline. To make a video, knitted sets the time to an exact moment, takes a picture of that frame, then moves on to the next. ffmpeg only does the final encoding.

## Animating a Stitch

1. In the editor, select a Stitch and open **Animate** in the Inspector.
2. Pick an animation. It is added at the playhead, and a still Pattern becomes a video.
3. Press **Timeline** in the top bar to see when each Stitch comes in and goes.

The animations come in three groups:

- **Come in**: Fade in, Slide up, Slide down, Slide from right, Slide from left, Pop, Grow in, Stitch in and Wipe. Text can also **Type on**.
- **Go out**: Fade out, Slide out up, Slide out down, Slide out left, Slide out right, Shrink away and Wipe away.
- **Keep moving**: Pulse, and a **Slow zoom** on a picture or video.

Select several Stitches to give them all the same animation at once. They start a little apart, top to bottom: entrances 150 ms apart, exits 80 ms. One **Undo** takes back the lot.

## Changing scene

A video of more than one scene should change scene, not pile the next one on top of the last. Put the playhead where the next scene starts and press **Change scene** on the timeline.

- **Leaves** lists what is on screen then. What you tick goes out a little apart, and is gone by the playhead. The backdrop and anything the brand locked are not ticked, since they usually stay.
- **Comes in** lists what comes in from then. What you tick comes in from the playhead, a little apart, top to bottom.
- Pick **How it leaves** and **How it comes in**, then press **Change scene**. An earlier exit or entrance on those Stitches is replaced, and their other animations stay.

## Footage

A video Stitch plays from the start of its file when it comes in, so a clip in the second scene does not begin part way through. To start it later in the file, set **Starts from** in the Inspector's **Video** section.

## The timeline

- **Play**, or Space, plays the Pattern from the playhead, as it will be knitted.
- Drag along the top to scrub. With the scrub bar focused, the arrow keys step about a frame, or a second with Shift.
- Drag a clip to move it in time, or drag either end to make it longer or shorter. Undo takes it back.
- Click a clip to change its **Animation**, its **Easing**, and its **In** and **Out** times, or to **Delete clip**.
- **Len** sets how long the video is. **Fit to clips** makes it as long as its animations, and a moment more.

## Knitting a video

**Knit** offers **MP4 video** for a Pattern with motion, at **30 fps**, or **60 fps** for fast motion. Its checks warn about motion that will not work well:

- text not on screen long enough to read, counting text that something comes in over as gone from then;
- words still on screen when the next scene comes in over them;
- a part that shows before the box it sits in, like a button's words before the button, a box left empty for seconds before its words, and a part left behind when its box goes;
- too many things moving at once, flashing, long stretches where nothing moves, and an animation cut off by the end.

Footage is knitted from a copy made once at the size it is drawn, so 4K footage knits about as fast as footage made for the size. See [Batch knitting](/docs/batch-knitting/) for the rest of the Knit dialog.

## What you get

- Easing, fades, slides and masks, in your real brand fonts.
- The same result on a slow computer as on a fast one, because time is set rather than waited for.
- Stills and video through the same path, so a still always matches its video.

## Your model

Your model animates a Stitch with `set_motion`, using the same animations, which `list_presets` lists, and changes scene with `change_scene`. It cannot animate a locked Stitch.

## Needs

The desktop app has what it needs: it carries ffmpeg, and downloads the browser it draws frames with by itself the first time it starts. Running from a clone, install Playwright's Chromium and ffmpeg yourself ([Quick start](/docs/quick-start/) shows how).
