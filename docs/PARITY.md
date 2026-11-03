# Parity with notch.fm `tools/media`

The brief's bar for retiring `tools/media` is that knitted does everything it does. This is the inventory, read from the code and READMEs (read only; nothing in notch.fm was changed), mapped to what knitted has today. **Status words are literal:** `built` means there is a feature and a test; `partial` says what is missing; `gap` means not built; `dropped` is a decision for you.

What has **not** been done: a side-by-side render of notch.fm's approved outputs against knitted's. Doing it needs notch.fm's stage fonts, its running app for the `route` shots, and a reviewer's eye. The table says which outputs can be compared and which cannot.

## Outputs

| notch.fm output | knitted | Status |
|---|---|---|
| Social card, 1080x1350 PNG, from `posts.json` + `stage.html` (`capture.mjs`) | A Pattern at that size, Knit to PNG; copy lives in named slots, batch rows replace `posts.json` | built |
| Caption file per post (`caption.txt`), with suggested songs below a rule | Not generated | **gap**: captions are not a knitted concept yet |
| Reel, 1080x1920, transparent copy card composited over footage by ffmpeg (`reel.mjs`) | A Pattern with a video Yarn stitch, Knit to MP4. Same single renderer for editor and export | built |
| Google Ads video, 16:9 and 9:16 | A Pattern at that size, Knit to MP4 | partial: sizes are chosen by hand, there are no named ad presets |
| Memes | A Pattern with a photo and text | built |
| Voiceover bus, music bed under voice, fade, `loudnorm` | Voiceover panel, audio mix with `apad`, `loudnorm` + limiter, 48 kHz pinned, loudness measured in-graph | built, pinned by `test/render/audio.test.mjs` |
| `--voice-file` (a narration you made yourself) | Import audio as Yarn, place on the timeline | built |
| `--voice` through an OpenAI-compatible `/v1/audio/speech` (Kokoro, Piper) | Voice settings: "A voice server" with the same API; macOS `say` as built-in | built |

## `posts.json` fields

| Field | knitted | Status |
|---|---|---|
| `slug`, `eyebrow`, `headline`, `sub` | Slot names and batch row columns | built |
| `shots[]` (several cards per post) | One Pattern per shot, in one project | built |
| `photo`, `bg`, `photoPos` | Image stitch with fit and focal position | built |
| `layout` (top, bottom, left, right, center) and `scrim` | Pattern layout plus a gradient shape; no named presets | partial |
| `font: "display"` | Swatch font slots (`$font.display`) | built |
| `appleMusic` lockup and its ordering rule | A Part ("Works with" row) with locked order | partial: the Part is not shipped as a built-in |
| `split: left/right` (copy beside a device) | Layout by hand | partial |
| `route`, `wait`, `scroll`, `js`, `after`, `phoneImage`, `deskImage`, `wide` (screenshot the running app inside a device frame) | Not built | **gap**: knitted does not drive a web app. Import the screenshot as Yarn |
| `statement` | A text-only Pattern | built |
| `songs`, `note`, `blockedShot` | Not carried | **gap** (notes can live in Yarn as copy) |
| `format` | Knit format | built |

## Guards that live in `capture.mjs` / `verify.mjs` / `reel.mjs`

These are the checks the old tool grew after real failures. Each has a counterpart:

| Old check | knitted |
|---|---|
| 40px margin floor | **gap**: `preflight` checks legibility and missing Yarn, not a margin floor |
| Display font really drew (not Impact fallback) | Fonts are bundled and loaded before frames are taken; there is no explicit "it drew" assertion. **partial** |
| Layout read back and compared with what was asked | One renderer, so editor and export cannot disagree |
| Overlay measured in the DOM, run fails if nothing drew | `postflight` (blank means transparent, or flat despite visible content) |
| Audio must be 44.1 or 48 kHz | 48 kHz pinned and asserted |
| Silent AAC track when no audio | Always muxed, tested |
| Photo path failing to load leaves a finished-looking card | `preflight` reports missing Yarn |

## Other tools in the folder

`analyze.mjs` (where is a photo quiet enough for type), `candidates.mjs` (one card against every photo), and the `discover-*` scripts (finding people to talk to) are **not** part of knitted. The first two are candidate features ("suggest placement", "try every photo"); the discover scripts are outside the product.

## Assets

`scripts/migrate-notch.mjs` moves the 870 MB library in as Yarn (dry run first, copy only). `posts.json` is **not** converted automatically: posts reference routes and the fields above that have no direct equivalent. Re-creating the 44 posts as Patterns is a manual step, aided by the model.

## Decisions for you

1. Captions and suggested songs: build, or keep in notes?
2. Layout and scrim presets: build named presets?
3. Screenshot-of-the-app shots: out of scope (import screenshots)?
4. `analyze` / `candidates` as features?
5. When to run the migration, and what to do with the 67 loose files.
