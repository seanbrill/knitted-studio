<div align="center">

# knitted.studio

**Make high-quality marketing material without becoming a designer.**

An open-source studio where you and your model knit social posts, ads and web
graphics from reusable brand patterns.

[knitted.studio](https://knitted.studio) · MIT

</div>

---

## Why

If you are building something on your own, the marketing material is the part
that quietly eats the week. Every post is a fresh file, every ad is a new
layout, and the tenth one looks nothing like the first. Agencies solve this
with a brand system and a designer; most people building software have neither.

knitted gives you the brand system as a **pattern** you set once, and then lets
you or your model produce from it as often as you like. The brand parts are
locked. The content parts are not. That difference is the whole product, and it
is drawn on screen: locked stitches have a dashed orange outline, free ones a
solid one.

## The words

The vocabulary is used consistently in the UI, the docs and the API, so what
you read is what you call it.

| Term | Means |
|---|---|
| **Pattern** | A reusable layout with locked brand slots |
| **Swatch** | A brand kit: colours, fonts, logos and voice |
| **Yarn** | Raw assets: photos, logos, video, copy |
| **Stitch** | One element in a pattern (text box, image slot, shape) |
| **Knit** | The verb for producing output: "Knit 12 posts from this pattern" |

## What works today

This is a first iteration and the honest state of it is:

- **The design system.** Every colour, size, radius and motion rule from the
  theme document, as tokens in `app/globals.css`. Night is the default.
- **The editor shell.** The 56px rail, the canvas, the 300px inspector, the
  48px top bar with the Knit button, the floating prompt bar, the stitch
  motif, and the locked/free outline language.
- **The engine.** `engine/knit.mjs` renders a Pattern frame by frame and
  encodes it. Stills and motion go through the same path.
- **MCP.** `mcp/server.mjs` exposes the same operations the editor uses, so a
  model can read a Pattern, fill its slots and knit it.

**Not yet:** persistence beyond a JSON file, uploads, the local TTS voiceover,
multi-project management in the UI, and the human/model co-editing loop. The
data model and the MCP surface are shaped for all of them.

## The idea the engine rests on

The unit of animation is a **frame**, not a still.

The usual way to animate with ffmpeg is `zoompan` for Ken Burns and overlay
PNGs gated by `enable='between(t,a,b)'`. The unit there is a still, so nothing
can ease, mask, transform or blend, and every caption is a hard cut. That is a
ceiling you cannot work around.

Here a Pattern is a web page holding a timeline. We address it by **time**,
screenshot each frame, and let ffmpeg do nothing but encode. CSS then gives
easing, transforms, clip-path, blend modes and filters, in real brand faces. A
still is simply a Pattern whose duration is zero.

Every Pattern page exposes:

```js
window.__stage = {
  duration,          // milliseconds; 0 for a still
  seek(ms),          // put the timeline at this moment
  ready(),           // fonts loaded, images decoded, first paint done
}
```

Renders are deterministic by construction: animations are paused and the time
is **set**, never waited for. A renderer that sleeps between screenshots
produces a different video on a loaded machine, which is how reels end up with
captions that drift.

## Running it

```bash
npm install
npm run dev        # the studio, on :4100
npm test           # the engine and MCP tests; no browser needed
```

Knitting needs two more things, kept optional so you can work on the editor
without them:

```bash
npm i playwright && npx playwright install chromium
# and ffmpeg on your PATH
```

## For a model

```bash
npm run mcp
```

Four tools: `list_projects`, `get_pattern`, `fill_slots`, `knit_pattern`.

Slots are addressed **by name**, not by id, because a slot is what a Pattern
promises — every launch story has a `headline` — while an id is an
implementation detail that changes when somebody rebuilds the layout.

**A model cannot change a locked stitch.** The attempt is refused and reported,
never silently skipped: a model that believes it wrote a headline and did not
is worse than one that is told no. Unlocking is a human act in the studio.

## Contributing

The design rules are in `KNITTED-THEME.md` and they are not suggestions —
most of them exist because the alternative was tried and read badly. The two
that catch people out:

- **Never white on ember.** It fails contrast at 3.75:1. Use `--on-ember`.
  The ember hex is chosen so that sentence is true; changing it breaks the rule
  rather than the rule being wrong.
- **One ember area outside the canvas.** The work is meant to be the brightest
  thing on screen. If a screen has two, remove one.

## Licence

MIT. Use it for anything, including commercially.
