// The audio mix against real ffmpeg. Each rule from the brief is a test, and the
// two that matter most are shown FAILING on the naive graph first.

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeSwatch, knitPath, openStore, importYarn, uploadTempPath } from "@knitted/core/node";
import { buildMixGraph, measureLoudness, mixAudio, muxAudio, openRenderer, runKnit, videoHash } from "@knitted/engine";

const dir = mkdtempSync(join(tmpdir(), "knitted-audio-"));
const f = (n) => join(dir, n);
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
const probe = (file, entry) => execFileSync("ffprobe", ["-v", "error", "-show_entries", entry, "-of", "default=nw=1:nk=1", file]).toString().trim();
const seconds = (file) => Number(probe(file, "format=duration"));

// Fixtures: 2s of "speech" (a tone), 8s of "music" (noise), and a 6s picture at 30fps.
ff("-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-af", "volume=0.5", f("voice.wav"));
ff("-f", "lavfi", "-i", "anoisesrc=color=pink:duration=8:amplitude=0.3", f("music.wav"));
ff("-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=6", "-pix_fmt", "yuv420p", "-c:v", "libx264", f("video.mp4"));
const clips = [{ file: f("voice.wav"), startMs: 500, kind: "voice", lengthMs: 2000 }, { file: f("music.wav"), startMs: 0, kind: "music", gain: 0.6, fadeInMs: 300, fadeOutMs: 800, lengthMs: 8000 }];

test("the graph pads every stream to full length and limits AFTER loudnorm (rules 1 and 2)", () => {
  const g = buildMixGraph(clips, 6000);
  assert.equal((g.match(/apad=whole_dur=6\.000/g) ?? []).length >= 3, true, "each clip, and the output, is padded");
  assert.match(g, /sidechaincompress/);
  assert.ok(g.indexOf("loudnorm") < g.indexOf("alimiter"), "limiter downstream of loudnorm");
  assert.match(g, /loudnorm=I=-14:TP=-1\.5:LRA=11:linear=true/);
});

test("we never use -shortest: that is how a picture lost 10 frames in notch.fm (rule 4)", () => {
  // As an actual ffmpeg argument (a quoted string), not as a word in a comment explaining why not.
  const code = readFileSync(new URL("../../packages/engine/src/audio.mjs", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /-shortest/);
});

test("the mix is exactly as long as the picture, at the right loudness and peak", async () => {
  await mixAudio({ clips, durationMs: 6000, out: f("mix.wav") });
  assert.ok(Math.abs(seconds(f("mix.wav")) - 6) < 0.03, `length ${seconds(f("mix.wav"))}`);
  const { lufs, truePeak } = await measureLoudness(f("mix.wav"));
  assert.ok(Math.abs(lufs - -14) < 1.0, `integrated ${lufs} LUFS, target -14`);
  assert.ok(truePeak <= -1.0 + 0.05, `true peak ${truePeak}`);
});

test("THE 890-OF-900 BUG: a voice that ends early must not shorten the mix or the picture", async () => {
  // Voice stops at 2.5s of a 6s video. Mixed correctly, the sound still runs the full 6s.
  await mixAudio({ clips, durationMs: 6000, out: f("full.wav") });
  await muxAudio({ video: f("video.mp4"), audio: f("full.wav"), out: f("with-sound.mp4") });
  assert.equal(probe(f("with-sound.mp4"), "stream=nb_frames").split("\n")[0], "180", "every one of the 180 frames survived");
  assert.equal(await videoHash(f("video.mp4")), await videoHash(f("with-sound.mp4")), "and not one of them changed");
  assert.ok(Math.abs(seconds(f("with-sound.mp4")) - 6) < 0.1);
});

test("the NAIVE graph really does cut the mix short, so the check above can fail", async () => {
  // Same sources, but the voice is not padded and the music is keyed by it: the mix ends with the voice.
  ff("-i", f("voice.wav"), "-i", f("music.wav"), "-filter_complex", "[0:a]adelay=500|500,asplit=2[k][v];[1:a][k]sidechaincompress[d];[d][v]amix=inputs=2:duration=shortest[o]", "-map", "[o]", f("naive.wav"));
  assert.ok(seconds(f("naive.wav")) < 3.5, `the naive mix is ${seconds(f("naive.wav"))}s, nowhere near 6`);
  ff("-i", f("video.mp4"), "-i", f("naive.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f("naive.mp4"));
  assert.ok(Number(probe(f("naive.mp4"), "stream=nb_frames").split("\n")[0]) < 180, "and -shortest then drops frames of picture, silently");
});

test("a loop makes short music last the whole video", async () => {
  ff("-f", "lavfi", "-i", "sine=frequency=200:duration=1", f("short.wav"));
  await mixAudio({ clips: [{ file: f("short.wav"), startMs: 0, kind: "music", loop: true }], durationMs: 5000, out: f("loop.wav") });
  assert.ok(Math.abs(seconds(f("loop.wav")) - 5) < 0.03);
  const { lufs } = await measureLoudness(f("loop.wav"));
  assert.ok(lufs > -30, "and it is audible all the way, not one second of sound then silence");
});

test("with no sound there is nothing to mix, and it says so", async () => {
  assert.throws(() => buildMixGraph([], 1000), /no sound to mix/);
});

// ── end to end through the Knit runner ──────────────────────────────────────
const store = openStore(join(dir, "k.db"));
const renderer = await openRenderer();
after(async () => { await renderer.close(); });

test("a pattern with a voiceover and music knits to an MP4 with sound, the picture untouched, loudness in the report", async () => {
  const project = store.createProject({ name: "Sound", starter: "blank" });
  const yarn = {};
  for (const [name, file] of [["voice", "voice.wav"], ["music", "music.wav"]]) {
    const tmp = uploadTempPath(store, project.id);
    execFileSync("mkdir", ["-p", join(tmp, "..")]); execFileSync("cp", [f(file), tmp]);
    yarn[name] = (await importYarn(store, project.id, tmp, file, { name })).yarn;
  }
  const p = store.createPattern(project.id, { name: "With sound", size: { name: "T", w: 360, h: 640 }, stitches: [{ id: "b", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "$color.primary" } }] });
  store.apply(p.id, { type: "setMeta", durationMs: 4000 }, "human");
  store.apply(p.id, { type: "setAudio", audio: [{ id: "v", yarnId: yarn.voice.id, startMs: 500, kind: "voice" }, { id: "m", yarnId: yarn.music.id, startMs: 0, kind: "music", gain: 0.5, fadeOutMs: 600 }] }, "human");
  const job = store.createJob("knit", project.id, {});
  const r = await runKnit(store, { jobId: job.id, projectId: project.id, patternId: p.id, params: { reuse: false }, renderer });
  const k = r.knits[0];
  assert.equal(k.format, "mp4");
  const file = knitPath(store, k);
  assert.equal(probe(file, "stream=codec_name").split("\n").sort().join(), "aac,h264");
  assert.equal(probe(file, "stream=nb_frames").split("\n")[0], "120", "4s at 30fps: no frame lost to the sound");
  assert.ok(Math.abs(k.report.lufs - -14) < 1.2, `loudness in the report: ${k.report.lufs}`);
  assert.ok(k.report.truePeak <= -0.9);
  assert.equal(r.progress.units[0].status, "done");
});

test("a deleted sound file blocks the knit before anything is drawn, with a fix", async () => {
  const project = store.createProject({ name: "Gone", starter: "blank" });
  const p = store.createPattern(project.id, { name: "Orphan", size: { name: "T", w: 360, h: 640 }, stitches: [{ id: "b", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "#ff0000" } }] });
  store.apply(p.id, { type: "setMeta", durationMs: 2000 }, "human");
  store.apply(p.id, { type: "setAudio", audio: [{ id: "v", yarnId: "yn_deleted", startMs: 0, kind: "voice", label: "Intro" }] }, "human");
  const job = store.createJob("knit", project.id, {});
  const r = await runKnit(store, { jobId: job.id, projectId: project.id, patternId: p.id, params: { reuse: false }, renderer });
  assert.equal(r.knits.length, 0);
  assert.match(r.progress.units[0].issues[0].message, /voiceover "Intro" uses a file that was deleted/);
  void activeSwatch;
});
