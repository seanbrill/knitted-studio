// The audio mix, as code. Every rule below was learned the hard way in notch.fm
// (see docs/BRIEF.md) and is pinned by a test that feeds it the failing case.
//
//  1. The voice bus is PADDED to the full duration. `sidechaincompress` stops when
//     its key input stops, so a voice that ends at 29.67s ended the ducked music
//     there, the mix followed, and `-shortest` then trimmed the PICTURE to 890
//     frames of 900. Nothing errored.
//  2. The limiter sits AFTER loudnorm. With linear=true, loudnorm will not raise
//     past the true-peak ceiling, so a limiter ahead of it boxes it in.
//  3. Loudness is measured with ebur128 INSIDE a filter graph, not by scraping a
//     `-f null` mapping, which reports ffmpeg's ordinary stream summary instead.
//  4. We never use -shortest. The mix is exactly the video's length, and the
//     decoded video stream is hashed before and after to prove every frame survived.

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

/**
 * Build the filter graph for a mix. Pure and exported so a test can read it.
 * @param {{ file: string, startMs: number, kind: "voice"|"music", gain?: number, fadeInMs?: number, fadeOutMs?: number, loop?: boolean, lengthMs?: number }[]} clips
 */
export function buildMixGraph(clips, durationMs, { targetLufs = -14, ceiling = -1.5, duck = true } = {}) {
  const D = sec(durationMs);
  const parts = [];
  const voice = [], music = [];
  clips.forEach((c, i) => {
    let chain = `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo`;
    if (c.kind === "music" && c.loop) chain += `,aloop=loop=-1:size=2147483647`;
    if (c.gain && c.gain !== 1) chain += `,volume=${c.gain}`;
    const len = c.lengthMs ?? Math.max(0, durationMs - c.startMs);
    if (c.fadeInMs) chain += `,afade=t=in:st=0:d=${sec(c.fadeInMs)}`;
    if (c.fadeOutMs) chain += `,afade=t=out:st=${sec(Math.max(0, len - c.fadeOutMs))}:d=${sec(c.fadeOutMs)}`;
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
    // The voice is the KEY, split so one copy keys the compressor and one is heard.
    parts.push(`[voice]asplit=2[vkey][vheard]`);
    parts.push(`[music][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400:makeup=1[ducked]`);
    parts.push(`[ducked][vheard]amix=inputs=2:normalize=0:duration=longest[mix]`);
    mix = "mix";
  } else if (vb && mb) { parts.push(`[voice][music]amix=inputs=2:normalize=0:duration=longest[mix]`); mix = "mix"; }
  else if (vb) { parts.push(`[voice]anull[mix]`); mix = "mix"; }
  else if (mb) { parts.push(`[music]anull[mix]`); mix = "mix"; }
  else throw new Error("There is no sound to mix.");
  // Normalise first, THEN limit. The order matters (rule 2).
  parts.push(`[${mix}]loudnorm=I=${targetLufs}:TP=${ceiling}:LRA=11:linear=true[ln]`);
  parts.push(`[ln]alimiter=limit=${Math.pow(10, (ceiling + 0.3) / 20).toFixed(3)}:level=false,aresample=48000,apad=whole_dur=${D},atrim=0:${D}[out]`);
  return parts.join(";");
}

/** Mix to a WAV exactly `durationMs` long. */
export async function mixAudio({ clips, durationMs, out, targetLufs, ceiling, duck }) {
  const graph = buildMixGraph(clips, durationMs, { targetLufs, ceiling, duck });
  const inputs = clips.flatMap((c) => ["-i", c.file]);
  await ff(["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-ac", "2", "-ar", "48000", out]);
  return out;
}

/** Integrated loudness and true peak, with the analyser INSIDE the graph (rule 3). */
export async function measureLoudness(file) {
  const { err } = await ff(["-nostats", "-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const sum = err.slice(err.lastIndexOf("Summary:"));
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]);
  if (!Number.isFinite(lufs)) throw new Error("Loudness could not be measured.");
  return { lufs, truePeak: peak };
}

/** A hash of the decoded video, so we can prove adding sound changed no picture (rule 4). */
export async function videoHash(file) {
  const { out } = await ff(["-v", "error", "-i", file, "-map", "0:v:0", "-f", "framemd5", "-"]);
  return out.split("\n").filter((l) => /^0,/.test(l)).map((l) => l.split(",").pop().trim()).join("|");
}

/** Put the mix on the video without touching a frame, and never with -shortest. */
export async function muxAudio({ video, audio, out }) {
  await ff(["-v", "error", "-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  return out;
}
