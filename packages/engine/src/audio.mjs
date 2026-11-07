// The audio mix, as code. Every rule below was learned the hard way in notch.fm
// (see docs/BRIEF.md) and is pinned by a test that feeds it the failing case.
//
//  1. The voice bus is PADDED to the full duration. `sidechaincompress` stops when
//     its key input stops, so a voice that ends at 29.67s ended the ducked music
//     there, the mix followed, and `-shortest` then trimmed the PICTURE to 890
//     frames of 900. Nothing errored.
//  2. Loudness is set in TWO passes: the mix is measured, then turned up or down by one
//     steady gain to the target, and only then limited. Loudnorm in one pass has no
//     measurement to go on and rides the gain up and down: a burst then quiet came out
//     at -9.8 LUFS, a real knit at -10.2. The limiter sits after the gain, never ahead.
//  3. Loudness is measured with ebur128 INSIDE a filter graph, not by scraping a
//     `-f null` mapping, which reports ffmpeg's ordinary stream summary instead.
//  4. We never use -shortest. The mix is exactly the video's length, and the
//     decoded video stream is hashed before and after to prove every frame survived.
//  5. The PEAK is measured on the finished file, not on the mix. ffmpeg's own AAC
//     encoder added 4 to 7 dB of spikes to a mix limited at -4 dBFS, so knits went
//     out at +2.9 dBFS and crackled. Apple's encoder (in the Mac app's ffmpeg) adds
//     about 1 dB; where there is none, ffmpeg's runs at 256k, and a file still over
//     the ceiling is made again that much quieter.
//  6. Every voice take and music track is levelled to one loudness before anything
//     else: real takes came out anywhere from -19 to -30 LUFS, so lines jumped in volume,
//     and a track's gain meant something different for every file. Music ducks under
//     the voice by the voice clips' own timing, with short gaps bridged, not by a
//     compressor keyed on every word: that swelled the music 23 times in 29.5 s.

import { spawn } from "node:child_process";

function ff(args, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); reject(new Error("ffmpeg did not finish")); }, timeoutMs);
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("error", reject);
    c.on("close", (code) => { clearTimeout(t); if (code === 0) resolve({ out, err }); else reject(new Error(`ffmpeg failed: ${err.slice(-600)}`)); });
  });
}

const sec = (ms) => (ms / 1000).toFixed(3);
/** How long music cut off by the end of the video takes to fade out. */
export const MUSIC_TAIL_MS = 800;
/** Every voice take and music track is brought to this before mixing; a clip's gain is then relative to it. */
export const LEVEL_LUFS = -16;
/** Music under a voice: how far down (12 dB), how fast, and the longest pause it stays down through. */
export const DUCK = { gain: 0.25, downMs: 150, upMs: 400, bridgeMs: 1200 };
const clampDb = (db, max) => Math.max(-max, Math.min(max, db));

/** The stretches where a voice speaks, a pause shorter than DUCK.bridgeMs counting as speech. */
export function voiceSpans(clips, durationMs) {
  const spans = clips.filter((c) => c.kind === "voice")
    .map((c) => [c.startMs, Math.min(durationMs, c.startMs + (c.lengthMs ?? durationMs))])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of spans) {
    const last = out.at(-1);
    if (last && a - last[1] < DUCK.bridgeMs) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

/** The music's volume over time: 1, down to DUCK.gain just before each span, back up after it. */
function duckExpr(spans) {
  const on = spans.map(([a, b]) => `clip((t-(${sec(a - DUCK.downMs)}))/${sec(DUCK.downMs)},0,1)*clip((${sec(b + DUCK.upMs)}-t)/${sec(DUCK.upMs)},0,1)`);
  return `1-${(1 - DUCK.gain).toFixed(2)}*min(1,${on.join("+")})`;
}

/**
 * Build the filter graph for a mix. Pure and exported so a test can read it.
 * @param {{ file: string, startMs: number, kind: "voice"|"music", gain?: number, fadeInMs?: number, fadeOutMs?: number, loop?: boolean, lengthMs?: number }[]} clips
 */
export function buildMixGraph(clips, durationMs, { ceiling = -1.5, duck = true, gainDb = null } = {}) {
  const D = sec(durationMs);
  const parts = [];
  const voice = [], music = [];
  clips.forEach((c, i) => {
    let chain = `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo`;
    if (c.kind === "music" && c.loop) chain += `,aloop=loop=-1:size=2147483647`;
    if (c.levelDb) chain += `,volume=${c.levelDb.toFixed(2)}dB`;
    if (c.gain && c.gain !== 1) chain += `,volume=${c.gain}`;
    // How much of it is heard: the file, or until the video ends, whichever is first. A fade
    // timed to the file's own length landed after the end of a two-minute track, long after
    // a twelve-second video had stopped, so the music was cut dead on the last frame.
    const room = Math.max(0, durationMs - c.startMs);
    const heard = c.loop || c.lengthMs == null ? room : Math.min(c.lengthMs, room);
    const cutByEnd = c.loop || c.lengthMs == null || c.lengthMs > room;
    // Music the video's end cuts off fades out by itself, unless a fade was asked for.
    const fadeOut = c.fadeOutMs ?? (c.kind === "music" && cutByEnd ? Math.min(MUSIC_TAIL_MS, heard / 4) : 0);
    if (c.fadeInMs) chain += `,afade=t=in:st=0:d=${sec(c.fadeInMs)}`;
    if (fadeOut) chain += `,afade=t=out:st=${sec(Math.max(0, heard - fadeOut))}:d=${sec(fadeOut)}`;
    // Delay it into place, then PAD every stream to the full length so none can end the mix early.
    chain += `,adelay=${Math.round(c.startMs)}|${Math.round(c.startMs)},apad=whole_dur=${D},atrim=0:${D}[a${i}]`;
    parts.push(chain);
    (c.kind === "voice" ? voice : music).push(`[a${i}]`);
  });
  const bus = (list, name) => (list.length === 0 ? null : list.length === 1 ? `${list[0]}anull[${name}]` : `${list.join("")}amix=inputs=${list.length}:normalize=0:duration=longest[${name}]`);
  const vb = bus(voice, "voice"), mb = bus(music, "music");
  if (vb) parts.push(vb); if (mb) parts.push(mb);
  let mix;
  if (vb && mb && duck) {
    // Small frames (about 5 ms) so the ramps are smooth: volume changes once a frame.
    parts.push(`[music]asetnsamples=n=256:p=0,volume='${duckExpr(voiceSpans(clips, durationMs))}':eval=frame[ducked]`);
    parts.push(`[ducked][voice]amix=inputs=2:normalize=0:duration=longest[mix]`);
    mix = "mix";
  } else if (vb && mb) { parts.push(`[voice][music]amix=inputs=2:normalize=0:duration=longest[mix]`); mix = "mix"; }
  else if (vb) { parts.push(`[voice]anull[mix]`); mix = "mix"; }
  else if (mb) { parts.push(`[music]anull[mix]`); mix = "mix"; }
  else throw new Error("There is no sound to mix.");
  // Without a gain, the mix as it stands, to be measured. With one: that gain, THEN the limiter (rule 2).
  const level = gainDb == null ? "" : `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${Math.pow(10, (ceiling + 0.3) / 20).toFixed(3)}:level=false,`;
  parts.push(`[${mix}]${level}aresample=48000,apad=whole_dur=${D},atrim=0:${D}[out]`);
  return parts.join(";");
}

/** Mix to a WAV exactly `durationMs` long. */
export async function mixAudio({ clips, durationMs, out, targetLufs = -14, ceiling, duck }) {
  // Each take and track to one level first (rule 6); a file used twice is measured once.
  // Too short or too quiet to measure: left as it is.
  const measured = new Map();
  for (const file of new Set(clips.map((c) => c.file))) measured.set(file, (await measureLoudness(file).catch(() => ({ lufs: NaN }))).lufs);
  const levelled = clips.map((c) => { const lufs = measured.get(c.file); return Number.isFinite(lufs) && lufs > -70 ? { ...c, levelDb: clampDb(LEVEL_LUFS - lufs, 20) } : c; });
  const inputs = levelled.flatMap((c) => ["-i", c.file]);
  // Pass one: how loud is the mix as it stands? Pass two: one steady gain to the target (rule 2).
  const { err } = await ff(["-nostats", "-hide_banner", ...inputs, "-filter_complex", `${buildMixGraph(levelled, durationMs, { ceiling, duck })};[out]ebur128=peak=true[m]`, "-map", "[m]", "-f", "null", "-"]);
  const lufs = summary(err).lufs;
  const gainDb = Number.isFinite(lufs) && lufs > -70 ? clampDb(targetLufs - lufs, 24) : 0;
  await ff(["-v", "error", "-y", ...inputs, "-filter_complex", buildMixGraph(levelled, durationMs, { ceiling, duck, gainDb }), "-map", "[out]", "-ac", "2", "-ar", "48000", out]);
  return out;
}

function summary(err) {
  const sum = err.slice(err.lastIndexOf("Summary:"));
  return { lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]), truePeak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]) };
}

/** Integrated loudness and true peak, with the analyser INSIDE the graph (rule 3). */
export async function measureLoudness(file) {
  const { err } = await ff(["-nostats", "-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const { lufs, truePeak } = summary(err);
  if (!Number.isFinite(lufs)) throw new Error("Loudness could not be measured.");
  return { lufs, truePeak };
}

/** A hash of the decoded video, so we can prove adding sound changed no picture (rule 4). */
export async function videoHash(file) {
  const { out } = await ff(["-v", "error", "-i", file, "-map", "0:v:0", "-f", "framemd5", "-"]);
  return out.split("\n").filter((l) => /^0,/.test(l)).map((l) => l.split(",").pop().trim()).join("|");
}

let encoders;
/** The AAC encoder to use: Apple's where this ffmpeg has it, else ffmpeg's own at a higher rate (rule 5). */
export async function aacArgs() {
  encoders ??= ff(["-hide_banner", "-encoders"]).then((r) => r.out, () => "");
  return /\baac_at\b/.test(await encoders) ? ["-c:a", "aac_at", "-b:a", "192k"] : ["-c:a", "aac", "-b:a", "256k"];
}

/**
 * Put the mix on the video without touching a frame, and never with -shortest. The finished
 * file's true peak is kept under `ceiling` (rule 5), and its loudness and peak are returned.
 */
export async function muxAudio({ video, audio, out, ceiling = -1 }) {
  const enc = await aacArgs();
  let gainDb = 0, loud;
  for (let tries = 0; tries < 3; tries++) {
    await ff(["-v", "error", "-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", ...(gainDb ? ["-af", `volume=${gainDb.toFixed(2)}dB`] : []), ...enc, "-movflags", "+faststart", out]);
    loud = await measureLoudness(out);
    if (!(loud.truePeak > ceiling)) break;
    gainDb -= loud.truePeak - ceiling + 0.2;
  }
  return { out, ...loud };
}
