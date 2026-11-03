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

- **Projects, Yarn and Swatches.** Everything lives in a project: uploads (images, video, audio, fonts, copy, SVG), a brand Swatch with a contrast checker, bundled offline fonts, and a SQLite library with backups.
- **The editor.** Drag, resize, snap, undo, locks, Fill mode for people who only fill in the copy, Parts (reusable pieces with locked and free slots), motion and a timeline, voiceover with captions.
- **Knitting.** One renderer draws the editor and the export, so what you see is what you get. Stills, video and audio mixing are deterministic and checked before and after.
- **A model, two ways in.** Ask your model from the editor (bring your own Anthropic key), or connect any MCP client. Both use the same 30 tools and the same lock rule.
- **Desktop app.** Electron, with ffmpeg included and nothing downloaded until you ask. Unsigned for now: see [docs/INSTALL.md](docs/INSTALL.md).
- **A landing site** (`apps/site`, static).

**Not yet:** code signing, auto-update, a Content-Security-Policy for the app window, and a few notch.fm features listed as gaps in [docs/PARITY.md](docs/PARITY.md). Nothing has run on Windows or Linux yet; CI is written for them.

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
npm run dev            # studio (:4100) and site (:4101) together
npm run dev:studio     # the studio only
npm run dev:site       # the site only
npm run desktop:dev    # the studio as a desktop app
npm test               # unit and guard tests; no browser needed
npm run test:render    # needs Chromium and ffmpeg
npm run test:e2e       # the real studio in a real browser
npm run desktop:pack   # an unpacked desktop app for this machine, in dist/desktop
```

Two builds come out of one repo: `npm run build:site` makes `dist/site`
(static files, deploy anywhere) and `npm run build:app` makes `dist/app` (the
studio server). See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the layout.

In development knitting needs two more things (the desktop app bundles both):

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
promises, every launch story has a `headline`, while an id is an
implementation detail that changes when somebody rebuilds the layout.

**A model cannot change a locked stitch.** The attempt is refused and reported,
never silently skipped: a model that believes it wrote a headline and did not
is worse than one that is told no. Unlocking is a human act in the studio.

## Context

[`docs/BRIEF.md`](docs/BRIEF.md) is where this came from: the brief it was
built against, what is and is not built yet, the decisions already taken, and
the production lessons inherited from the notch.fm tool it was extracted from.
Read it before changing the engine or the data model.

## Contributing

The design rules are in `KNITTED-THEME.md` and they are not suggestions:
most of them exist because the alternative was tried and read badly. The two
that catch people out:

- **Never white on ember.** It fails contrast at 3.75:1. Use `--on-ember`.
  The ember hex is chosen so that sentence is true; changing it breaks the rule
  rather than the rule being wrong.
- **One primary button per view, one brand colour field per screen.** Red and
  orange are the primary colours and carry the brand; white and black are
  secondary. Everything else stays neutral. `npm run check:contrast` measures
  every colour pair in both themes.

## Licence

MIT. Use it for anything, including commercially.
