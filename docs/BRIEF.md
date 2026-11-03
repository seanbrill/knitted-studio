# The brief

This file exists so that somebody opening this repository cold, a person or a
model, knows what it is for and what has already been decided. The README says
what the project is; this says where it came from and what was asked for.

Written 2026-11-03, the day the repository was created.

---

## Where this came from

knitted.studio is an extraction. Its engine, its vocabulary and most of its
hard-won detail were built inside **notch.fm**, a music rating app, as a folder
called `tools/media`. That tool was written to make notch.fm's own social posts,
Instagram reels and eventually a Google Ads video, and it grew good enough that
the right move was to make it a product rather than a subfolder.

So nothing here is speculative design. The engine has produced approved,
published marketing material. What is missing is everything that makes it a
tool other people can use.

`notch.fm/tools/media` still exists and still works. It stays until this
repository reaches parity, deliberately, so that notch.fm's marketing does not
stop while this is built.

---

## What was asked for

Sean's words, 2026-11-03, lightly trimmed only where he was describing
unrelated notch.fm work:

> lastly its time to move our social media tool to its own full blown repo and
> remove it from this project. Requirements:
>
> - user interface dashoard where you can setup multiple projects, for each
>   projcet you can upload assets, and create and manage prefabs, prefabs
>   include but not limited to reusable html components or code, animations etc.
>   we can build in one of the local llm tts models to add in voice overs into
>   the project
>
> put simply functional requirements: a system that through a user interface or
> through mcp/claude we can create and optimize and scale the creation of high
> quality marketing assets and visual content for various projects. This tool
> will be completely open source for public use. the usecase is to empower
> entrepeneures and other software engineers to allow them to focus more on
> building their applications and minimize the time and expense to produce high
> quality marketing material to be used as social media posts, stories,
> advertisements, or graphics on a website. Things can be made into re-usable
> preabs for the user or llm to optimize speed and efficnency as well as
> facilitate brand consistency. the tool should support all the things it does
> now plus a human facing editor tool where human and model can work together
> or alone to craft and tweak the media outputs
>
> please design and implement the first iteration of this in a new project
> called knitted-studio (just bought the domain knitted.studio) the images I
> have attached are ui inspiration for the first iteration. the ui should be
> kinda like canva

Four UI inspiration screenshots were attached, and the theme was supplied as a
separate document which is now `KNITTED-THEME.md` in this repository.

### The requirements, as a list

1. **Projects.** Multiple, each with its own assets and prefabs.
2. **Uploads.** Per project.
3. **Prefabs**, reusable and explicitly "not limited to" reusable HTML
   components or code, and animations.
4. **Local TTS** for voiceovers, using a local LLM TTS model.
5. **Two equal front doors**: a UI, and MCP so a model can do the same work.
   Not a UI with an API bolted on.
6. **A human-facing editor** where "human and model can work together or alone".
7. **Canva-like UI.**
8. **Open source, for public use.** MIT, chosen to match.
9. **Parity with what `tools/media` does now**, which is the acceptance bar for
   retiring that folder.

### The audience, which shapes everything

Entrepreneurs and software engineers who need marketing material and are not
designers. The named goal is to **minimise the time and expense of producing
high quality marketing material**. Two consequences worth holding on to:

- Brand consistency is a feature, not a nicety. It is why Patterns lock their
  brand slots, and why that lock is enforced against models too.
- The output has to be genuinely good, not merely generated. The person using
  this cannot tell a good layout from a bad one, which is the reason they are
  here, so the tool cannot push that judgement back onto them.

---

## The vocabulary

Used consistently in the UI, the docs and the API, so that what you read is
what you call it.

| Term | Means |
|---|---|
| **Pattern** | A reusable layout with locked brand slots |
| **Swatch** | A brand kit: colours, fonts, logos and voice |
| **Yarn** | Raw assets: photos, logos, video, copy |
| **Stitch** | One element in a pattern (text box, image slot, shape) |
| **Knit** | The verb for producing output |

---

## What exists today, against the brief

State at the end of the phased rebuild (see `claude-workspace/implementation-plans`). The first push (commit `50b6c05`) was a shell and an engine; the table below is the truth now.

| Asked for | State |
|---|---|
| The design system | Done. Day default, Night optional, red and orange primary, white and black secondary. |
| Editor | Done: drag, resize, snap, undo and redo, locks, Fill mode, history. Not done: grouping and per-size overrides. |
| The engine | Done. One renderer for editor and export; deterministic frames; audio mix pinned by tests. |
| MCP | 30 tools, shared with the in-app model. |
| Projects, Yarn, Swatches | Done, with uploads, dedupe, SVG sanitising and a contrast checker. |
| Prefabs | Done as **Parts**, including code Parts in a sandbox. |
| Local TTS | Built-in voice, an OpenAI-compatible voice server, and Piper (downloaded on request). |
| Human and model co-editing | Done: same document, locks enforced in one function, change sets with Keep or Undo all. |
| Persistence | SQLite (`node:sqlite`), daily and pre-migration backups. |
| Desktop app | Built for macOS (Apple silicon, Intel), Windows x64 and Linux (x64, ARM64) from one Mac with `npm run release`. Smoke-tested on macOS arm64; the others are checked by what is inside them, not yet run on their systems. Ad-hoc signed on macOS, unsigned on Windows. |
| Parity with `tools/media` | Inventoried in [PARITY.md](PARITY.md); gaps need decisions. Not yet compared byte for byte. |

---

## Decisions changed since the first push

Taken by Sean on 2026-11-03, after the first iteration was judged too dark and
mostly non-functional. These supersede anything earlier in this file or in
`KNITTED-THEME.md` that disagrees; the theme document is rewritten in Phase 1.

| Decision | Detail |
|---|---|
| **Desktop app** | Production is an installable app for Windows, macOS and Linux, for non-technical users. `npm run dev` stays for development. Shell is Electron |
| **Two builds** | The marketing site and the studio are separate: `dist/site` (static) and `dist/app` (server), plus installers |
| **Colour roles** | **Red and orange are the primary colours; white and black are secondary.** The first iteration made black the primary and shipped Night as the default, which is the opposite of the intent. The app now defaults to a light, warm workspace with Night as an option. The old rules "the work glows, the tool recedes" and "one ember area outside the canvas" are retired |
| **Models** | Bring your own key. The in-app model and MCP share one tool set |
| **Prefabs** | New noun **Part**: a reusable fragment smaller than a Pattern. Pattern, then Part, then Stitch. Resolves the open question below |
| **Storage** | SQLite via Node's built-in `node:sqlite` (no native module, so no per-platform or per-Electron-ABI rebuild), plus plain files for media |
| **ffmpeg** | Bundled with the desktop app as a separate subprocess, with licence notices |
| **Site hosting** | filefreak.io Static Sites |

Found during Phase 0, worth knowing:

- `dist/site` cannot be opened from `file://`. Next's export writes root-absolute
  asset paths, which a static host serves and a double click does not. Making
  them relative would break every page below the root.
- `ELECTRON_RUN_AS_NODE=1` is exported by VS Code to its terminals and makes the
  electron binary behave as plain Node. Use `npm run desktop:dev`.
- `next` 15.5.4 carried a critical remote code execution advisory; the repo is
  on 15.5.28. One moderate and one high advisory remain, both in the `postcss`
  that ships inside Next, which only matters for attacker-controlled CSS. It
  goes away with a move to Next 16.

## Decisions already taken

Do not re-litigate these without reading why.

**The unit of animation is a frame, not a still.** The usual ffmpeg approach is
`zoompan` for Ken Burns and overlay PNGs gated by `enable='between(t,a,b)'`.
The unit there is a still, so nothing can ease, mask, transform or blend, and
every caption is a hard cut. That is a ceiling you cannot work around. Here a
Pattern is a web page holding a timeline: we address it by time, screenshot
each frame, and ffmpeg does nothing but encode. CSS then gives easing,
transforms, clip-path, blend modes and filters, in real brand faces.

**Renders are deterministic by construction.** Animations are paused and the
time is *set*, never waited for. A renderer that sleeps between screenshots
produces a different video on a loaded machine, which is how reels end up with
captions that drift. Every Pattern page exposes:

```js
window.__stage = {
  duration,   // milliseconds; 0 for a still
  seek(ms),   // put the timeline at this moment
  ready(),    // fonts loaded, images decoded, first paint done
}
```

**Slots are addressed by name, not by id.** A slot is what a Pattern promises:
every launch story has a `headline`. An id is an implementation detail that
changes when somebody rebuilds the layout. A model writing to slots keeps
working across a redesign.

**A model cannot change a locked stitch.** The attempt is refused *and
reported*, never silently skipped. A model that believes it wrote a headline
and did not is worse than one that is told no. Unlocking is a human act in the
studio. This is the mechanism behind the brand-consistency requirement, which
is why it is enforced rather than advisory.

**`--ember: #DF5A0F` is measured, not picked.** The theme document asserts that
white on ember fails contrast at 3.7:1. That exact hex puts white at 3.75:1 and
`--on-ember` at 5.06:1, so the rule "never white on ember, always on-ember" is
true of this value rather than merely asserted. Change the hex and the sentence
stops being true.

**Playwright and ffmpeg are optional dependencies.** The editor runs without
them; only knitting needs them. A contributor can work on the UI without a
300MB browser download, which matters for an open-source project.

**The MCP server is hand-rolled, not an SDK.** The protocol surface used is
three methods. A dependency that must be upgraded in lockstep with a host is a
poor trade for that, in a first iteration.

---

## Lessons inherited from notch.fm

These cost real time to find. They are production facts about rendering media
this way, not opinions, and they will all be rediscovered the hard way if this
section is ignored.

### Rendering

- **When you need "the same design on a different canvas", re-render the
  design, do not re-implement it.** notch.fm's reels are the social card
  rendered transparent at 1080x1920 and composited by ffmpeg, not `drawtext`
  reimplementing the card in filter syntax. A copy in another syntax drifts the
  first time either moves.
- **`-pix_fmt yuv420p` is not optional.** Without it, anything with an odd
  dimension or a non-standard pixel format plays as a green screen on iOS and
  in several browsers, and the file looks fine in VLC while you work out why.
- **A percentage translate is a percentage of the element, not of the box
  clipping it.** A clipped slide fails silently when 100% of the layer is
  smaller than its container.
- **A CSS minifier is not a passthrough.** In notch.fm it deleted a
  `translate: none` cancel and dropped hand-written `-webkit` pairs. Inspect the
  built stylesheet, not the source.
- **Framework-rendered `initial` styles ship as inline styles**, so CSS
  fallbacks for no-JS and reduced motion become no-ops unless they are
  `!important`.
- **A `var()` on one keyframe survives at full strength on the other.**

### Audio

- **`sidechaincompress` stops when its key input stops.** A voice bus that ends
  at 29.67s ended the ducked bed there, the mix followed, and `-shortest` then
  trimmed the *picture* to 890 frames of 900. Nothing errored. Fix:
  `apad=whole_dur=<duration>` on the key bus.
- **`-f null` measures nothing.** The analyser (`ebur128`) has to be *inside*
  the filter graph. Mapping a bus to the null muxer and scraping the log gets
  ffmpeg's ordinary stream summary.
- **A limiter ahead of `loudnorm` boxes it in.** With `linear=true`, loudnorm
  will not raise past the true-peak ceiling. The limiter goes downstream.
- **Use `ebur128`, not RMS, to set a speech-to-music ratio.** On a dense bed
  against sparse speech, RMS calls them closer than the ear does.
- After any dub, compare the decoded video stream's MD5 and frame count against
  the source. Equal hashes prove every frame came through.

### Measuring your own output

An entire session's worth of findings in notch.fm turned out to be bugs in the
measurement rather than in the media. A check that reports clean while its own
bug is live is worse than no check.

- `ffmpeg -v error` **suppresses `volumedetect`'s own output**, which prints at
  info level, so the measurement looks like silence.
- `astats` `reset=N` counts **frames, not samples**, so `reset=48000` is about
  1024 seconds and reports cumulative stats converging.
- A contact sheet silently tiled one image because the glob ran before the
  files were written.
- A layout check queried `header *, footer *`, reported "4 boxes" and looked
  healthy while a 1080x600 bezel covered the footage.

**Prove a check fails on its own bug before trusting it.**

### Touching code that produced approved work

notch.fm's rule, worth keeping: when you change a renderer that has already
produced published output, **re-render the old work and prove it is
byte-identical**. Four posts were rendered against both stages and five images
compared byte for byte. If honouring a fix would re-roll approved output, scope
the fix to the new caller instead.

### Brand and legal, for anyone shipping marketing material

This tool makes advertising, so this is a product concern and not only
notch.fm's. Checked against Apple's own published guidelines in 2026:

- **The Apple logo is never allowed** to represent Apple Music or at all,
  without an express written licence. Nor a self-made badge, nor anything
  implying endorsement.
- A referential compatibility phrase ("works with", "compatible with") *is*
  allowed, with the Apple word mark less prominent than your own name, plus the
  US credit line.
- **Real album art and metadata should not appear in marketing or advertising**
  without rights-holder authorisation. A boosted post and a Google Ads video
  are both paid advertising. notch.fm's answer was generated placeholder covers
  in its own palette.

The general shape of this rule applies to any third-party brand a user puts in
a Pattern, which is a thing this product should probably help them get right
rather than leave to them.

---

## Local TTS

Asked for as "one of the local llm tts models". The integration shape is
already known from notch.fm: `--voice` POSTs to an **OpenAI-compatible
`/v1/audio/speech`** endpoint, and Sean's own `llm-factory` builds Kokoro TTS
82M and Piper into exactly that shape. So a base URL is the whole integration,
with a platform `say`-style fallback.

---

## The open question about prefabs

Sean asked for prefabs that are "not limited to reusable html components or
code, animations etc", and separately for Patterns and Swatches. These overlap
and the boundary has not been settled.

The current model makes a **Pattern** the reusable layout and a **Swatch** the
reusable brand kit, which covers most of what "prefab" was pointing at. What is
not covered is a reusable *fragment* smaller than a Pattern: a lower-third, an
animated logo sting, a captioned-quote block that drops into many Patterns.
That is probably the real prefab, and it probably composes into Patterns rather
than sitting beside them. Worth deciding before the editor hardens.

---

## The assets have not moved

`notch.fm/tools/media/assets` is **870 MB** and is still in notch.fm: videos
571 MB, 67 loose top-level files 193 MB, audio 59 MB, memes 43 MB, TTS 4 MB,
screens 3 MB.

Sean, 2026-11-03: *"I'll move it when knitted is more flushed out and
working."*

This is deliberate, and it is a migration rather than a copy. knitted.studio
has **no flat assets concept**: raw material is Yarn inside a project under
`KNITTED_HOME`, addressed by name. Each file needs a project, an import as
Yarn, and the references in notch.fm's `posts.json` repointed. Doing it before
this tool can actually knit a post would also be unverifiable, because there
would be no way to confirm an asset still renders once it landed.

When it happens, start with the 67 loose files at the top of `assets/`.
Material sitting outside any of the five categories is usually what got dropped
in mid-session and never filed, so it is the likeliest to not need carrying over
at all.

---

## House style

One convention carried over from notch.fm, which is enforced there by a test:
**no em dashes**, anywhere. Use a comma, a colon, or a full stop.
