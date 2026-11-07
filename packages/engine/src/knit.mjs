// Knit a Pattern into files.
//
// ── THE IDEA THIS INHERITS ─────────────────────────────────────────────────
//
// Carried over from notch.fm's tools/media, whose core insight is worth
// restating because everything here depends on it:
//
//   The unit of animation is a FRAME, not a still.
//
// The usual way to animate with ffmpeg is `zoompan` for Ken Burns and overlay
// PNGs gated by `enable='between(t,a,b)'`. The unit there is a still, so
// nothing can ease, mask, transform or blend, and every caption is a hard cut.
// That is a ceiling you cannot work around.
//
// Here the Pattern is a web page that holds a timeline. We address it by TIME,
// screenshot each frame, and let ffmpeg do nothing but encode. CSS then gives
// easing, transforms, clip-path, blend modes and filters, in the real brand
// faces. A still is simply a Pattern whose duration is zero.
//
// ── THE CONTRACT A PATTERN MUST MEET ───────────────────────────────────────
//
// A rendered Pattern page exposes:
//
//   window.__stage = {
//     duration: number,        // milliseconds; 0 for a still
//     seek(ms): void,          // put the timeline at this moment
//     ready(): Promise<void>,  // fonts loaded, images decoded, first paint done
//   }
//
// Deterministic by construction: animations are paused and the time is SET,
// never waited for. A renderer that sleeps between screenshots produces a
// different video on a loaded machine, and that is how you get a reel whose
// captions drift.

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

/** Frames per second for motion Patterns. 30 is the floor for social video. */
export const FPS = 30;

/**
 * Run a command and resolve with its output, rejecting on a non-zero exit.
 *
 * Bounded by `timeoutMs`, because a hung ffmpeg is indistinguishable from a
 * slow one and the difference matters when a person is waiting.
 */
export function run(cmd, args, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} did not finish within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      // ffmpeg writes everything to stderr, so the tail of it IS the error.
      else reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`));
    });
  });
}

/**
 * Which moments to render.
 *
 * Exported and pure so it can be tested without a browser: an off-by-one here
 * is a video that is one frame short or one frame long, which nobody notices
 * until the audio no longer lines up.
 */
export function frameTimes(durationMs, fps = FPS) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [0];
  const n = Math.max(1, Math.round((durationMs / 1000) * fps));
  // n frames covering [0, duration), each at the START of its slot. Rendering
  // at the END would make the first frame 1/fps into the animation and lose
  // the opening state entirely.
  return Array.from({ length: n }, (_, i) => Math.round((i * 1000) / fps));
}

/**
 * Render one Pattern page at many times.
 *
 * `page` is a Playwright page already navigated to the Pattern. Playwright is
 * an optional dependency: the UI runs without it and only knitting needs it,
 * so a contributor can work on the editor without a 300MB browser download.
 */
export async function captureFrames(page, outDir, { durationMs, fps = FPS, signal, onFrame } = {}) {
  await mkdir(outDir, { recursive: true });
  await page.evaluate(() => window.__stage.ready());

  const times = frameTimes(durationMs, fps);
  const files = [];
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error("Knit cancelled."), { kind: "cancelled" });
    // SET the time; never wait for it. See the note at the top.
    await page.evaluate((t) => window.__stage.seek(t), times[i]);
    const file = join(outDir, `${String(i).padStart(5, "0")}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    files.push(file);
    onFrame?.(i + 1, times.length);
  }
  return files;
}

/**
 * Encode a frame directory to h264.
 *
 * `-pix_fmt yuv420p` is not optional: without it, anything with an odd
 * dimension or a non-standard pixel format plays as a green screen on iOS and
 * in several browsers, and the file looks fine in VLC while you work out why.
 */
export async function encode(frameDir, outFile, { fps = FPS, audio } = {}) {
  const args = [
    "-y",
    "-framerate", String(fps),
    "-i", join(frameDir, "%05d.png"),
    ...(audio ? ["-i", audio] : []),
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    ...(audio ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
    outFile,
  ];
  await run("ffmpeg", args);
  return outFile;
}

/**
 * The whole job: Pattern page to file.
 *
 * Frames are cleaned up unless `keepFrames`, because a 20-second story at 30fps
 * is 600 PNGs and they are pure intermediate. notch.fm's media-outputs grew to
 * 285MB partly on kept intermediates.
 */
export async function knit(page, { outDir, name, durationMs, fps = FPS, audio, keepFrames = false, signal, onFrame }) {
  await mkdir(outDir, { recursive: true });
  const frameDir = join(outDir, `.frames-${name}`);
  try {
    const frames = await captureFrames(page, frameDir, { durationMs, fps, signal, onFrame });
    if (!durationMs) {
      // A still: the single frame IS the output.
      const still = join(outDir, `${name}.png`);
      await run("cp", [frames[0], still]);
      return { files: [still] };
    }
    const video = join(outDir, `${name}.mp4`);
    await encode(frameDir, video, { fps, audio });
    return { files: [video] };
  } finally {
    if (!keepFrames) await rm(frameDir, { recursive: true, force: true });
  }
}
