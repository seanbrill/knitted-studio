// The audio mix against real ffmpeg. Each rule from the brief is a test, and the
// two that matter most are shown FAILING on the naive graph first.

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeSwatch, knitPath, openStore, importYarn, uploadTempPath } from "@knitted/core/node";
import { buildMixGraph, measureLoudness, mixAudio, muxAudio, openRenderer, runKnit, videoHash, voiceSpans } from "@knitted/engine";

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

// RMS of a stretch of a file, in dB; `af` picks out part of it (a band, say).
const level = (file, from, dur, af = "anull") => { const r = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", String(dur), "-i", file, "-af", `${af},astats=measure_perchannel=none`, "-f", "null", "-"], { encoding: "utf8" }); const m = /RMS level dB:\s+(-?[\d.]+|-inf)/.exec(r.stderr); return m ? (m[1] === "-inf" ? -Infinity : Number(m[1])) : NaN; };

test("the graph pads every stream to full length, and limits AFTER the gain (rules 1 and 2)", () => {
  const g = buildMixGraph(clips, 6000, { gainDb: 3 });
  assert.equal((g.match(/apad=whole_dur=6\.000/g) ?? []).length >= 3, true, "each clip, and the output, is padded");
  assert.ok(g.indexOf("volume=3.00dB") < g.indexOf("alimiter"), "limiter downstream of the gain");
  assert.doesNotMatch(buildMixGraph(clips, 6000), /alimiter|volume=[-\d.]+dB/, "the mix measured in pass one has neither");
  assert.doesNotMatch(g, /loudnorm|sidechaincompress/, "no gain that rides up and down by itself");
});

test("a loud burst then quiet lands at the target: one steady gain, not loudnorm riding the quiet part up", async () => {
  // Loudnorm in one pass made this -9.8 LUFS, 4 dB over; a real knit went out at -10.2.
  ff("-f", "lavfi", "-i", "aevalsrc='if(lt(t,0.08),0.95*sgn(sin(2*PI*80*t)),0.0005*sin(2*PI*300*t))':s=48000:d=5", "-ac", "2", f("burst.wav"));
  await mixAudio({ clips: [{ file: f("burst.wav"), startMs: 0, kind: "music", lengthMs: 5000 }], durationMs: 5000, out: f("burst-mix.wav") });
  const { lufs } = await measureLoudness(f("burst-mix.wav"));
  assert.ok(lufs <= -13 && lufs >= -16, `came out at ${lufs} LUFS`);
});

test("voice takes and music tracks recorded at different levels come out at one level (rule 6)", async () => {
  // About -10 and -30 LUFS: the real takes ran from -19 to -30. (ffmpeg's sine starts at 1/8.)
  ff("-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-af", "volume=4", f("loud-take.wav"));
  ff("-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-af", "volume=0.4", f("quiet-take.wav"));
  await mixAudio({ clips: [{ file: f("loud-take.wav"), startMs: 0, kind: "voice", lengthMs: 2000 }, { file: f("quiet-take.wav"), startMs: 3000, kind: "voice", lengthMs: 2000 }], durationMs: 6000, out: f("takes.wav") });
  const a = level(f("takes.wav"), 0.5, 1), b = level(f("takes.wav"), 3.5, 1);
  assert.ok(Math.abs(a - b) < 1, `the two lines are ${a.toFixed(1)} and ${b.toFixed(1)} dB: 20 dB apart as recorded`);
  // And music: the same gain on a loud master and a quiet one sits at the same level.
  await mixAudio({ clips: [{ file: f("loud-take.wav"), startMs: 0, kind: "music", gain: 0.5, lengthMs: 2000 }, { file: f("quiet-take.wav"), startMs: 3000, kind: "music", gain: 0.5, lengthMs: 2000 }], durationMs: 6000, out: f("tracks.wav") });
  const c = level(f("tracks.wav"), 0.5, 1), d = level(f("tracks.wav"), 3.5, 1);
  assert.ok(Math.abs(c - d) < 1, `the two tracks are ${c.toFixed(1)} and ${d.toFixed(1)} dB`);
});

test("music ducks ONCE under lines with short pauses between them, and comes back up after (rule 6)", async () => {
  // Three lines 400 ms apart. A compressor keyed on the voice let the music swell in every pause.
  ff("-f", "lavfi", "-i", "sine=frequency=1000:duration=1", "-af", "volume=0.5", f("line.wav"));
  ff("-f", "lavfi", "-i", "sine=frequency=100:duration=8", "-af", "volume=0.3", f("bass.wav"));
  const lines = [500, 1900, 3300].map((startMs) => ({ file: f("line.wav"), startMs, kind: "voice", lengthMs: 1000 }));
  assert.deepEqual(voiceSpans(lines, 7000), [[500, 4300]], "the pauses are bridged");
  await mixAudio({ clips: [...lines, { file: f("bass.wav"), startMs: 0, kind: "music", lengthMs: 8000 }], durationMs: 7000, out: f("duck.wav") });
  const music = (from) => level(f("duck.wav"), from, 0.2, "lowpass=f=200,lowpass=f=200");
  const free = music(5.5), speaking = music(2.2), pause = music(1.6), pause2 = music(3.0);
  assert.ok(free - speaking > 10, `down under the voice: ${speaking.toFixed(1)} against ${free.toFixed(1)} dB`);
  assert.ok(Math.abs(pause - speaking) < 1.5 && Math.abs(pause2 - speaking) < 1.5, `and stays down in the pauses: ${pause.toFixed(1)}, ${pause2.toFixed(1)} against ${speaking.toFixed(1)} dB`);
});

test("music the video cuts off fades out at the video's end, asked for or not", async () => {
  // An 8 s track in a 6 s video: the fade ends at 6 s, not at 8 s where nobody hears it.
  assert.match(buildMixGraph(clips, 6000), /afade=t=out:st=5\.200:d=0\.800/);
  const plain = [{ file: f("music.wav"), startMs: 0, kind: "music", lengthMs: 8000 }];
  assert.match(buildMixGraph(plain, 6000), /afade=t=out:st=5\.200:d=0\.800/, "a fade of its own when none was asked for");
  assert.doesNotMatch(buildMixGraph([{ ...plain[0], lengthMs: 4000 }], 6000), /afade=t=out/, "a track that ends by itself is left alone");
  await mixAudio({ clips: plain, durationMs: 6000, out: f("tail.wav") });
  const stats = (from) => { const r = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", "0.1", "-i", f("tail.wav"), "-af", "astats=measure_perchannel=none", "-f", "null", "-"], { encoding: "utf8" }); const m = /RMS level dB:\s+(-?[\d.]+|-inf)/.exec(r.stderr); return m ? (m[1] === "-inf" ? -Infinity : Number(m[1])) : NaN; };
  // Faded, the last tenth of a second is about 20 dB down; cut dead it would be level with the middle.
  assert.ok(stats(5.88) < stats(3) - 15, `the last frames are quiet: ${stats(5.88)} dB against ${stats(3)} dB in the middle`);
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

test("the FINISHED file's peak stays under the ceiling, even when the sound given is hotter than it", async () => {
  // The AAC encoder can add peaks the mix never had (ffmpeg's own added 4 to 7 dB), so the
  // peak is measured on the finished file, and one over the ceiling is made again quieter.
  ff("-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=6", "-af", "volume=0.98", "-ac", "2", f("hot.wav"));
  const r = await muxAudio({ video: f("video.mp4"), audio: f("hot.wav"), out: f("hot.mp4") });
  assert.ok(r.truePeak <= -1, `the finished file peaks at ${r.truePeak} dBFS`);
  assert.equal(r.truePeak, (await measureLoudness(f("hot.mp4"))).truePeak, "what is reported is what the file holds");
  assert.equal(await videoHash(f("video.mp4")), await videoHash(f("hot.mp4")), "and no frame changed");
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
