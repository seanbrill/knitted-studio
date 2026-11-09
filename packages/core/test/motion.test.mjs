import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, compileMotion, entersAt, motionEnd, motionLint, pieceTimes, preflight, PRESETS, FALLBACK_SWATCH, posterMs, sceneChange, shownOf, stillMs, wordMs } from "../src/index.ts";

const base = (motion, durationMs = 6000, extra = {}) => ({
  id: "p", projectId: "pj", name: "M", size: { name: "S", w: 1080, h: 1920 }, durationMs, version: 1, updatedAt: "", motion,
  stitches: [
    { id: "h", kind: "text", slot: "headline", x: 0.1, y: 0.4, w: 0.8, h: 0.2, locked: false, content: "Make it knitted today", style: {} },
    { id: "b", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: {} },
    { id: "lock", kind: "text", slot: "eyebrow", x: 0, y: 0, w: 0.3, h: 0.05, locked: true, content: "NEW" },
  ], ...extra,
});
const clip = (id, preset, startMs, endMs, extra = {}) => ({ id, preset, startMs, endMs, ...extra });

test("every preset compiles to keyframes, and a stitch gets one animation per clip", () => {
  for (const p of PRESETS) {
    const css = compileMotion(base({ tracks: { h: [clip("a", p.id, 200, 900)] } }));
    assert.match(css, new RegExp(`@keyframes kn-${p.id}\\{`), `${p.id} has keyframes`);
    assert.match(css, /\[data-stitch-id="h"\]/);
  }
  const two = compileMotion(base({ tracks: { h: [clip("a", "fade-in", 0, 500), clip("b", "fade-out", 3000, 3400)] } }));
  assert.equal(two.match(/kn-fade-(in|out) \d+ms/g).length, 2);
});

test("animations use the independent translate and scale properties, so they compose with a stitch's own rotation", () => {
  const css = compileMotion(base({ tracks: { h: [clip("a", "slide-up", 0, 500), clip("b", "pop", 600, 1100)] } }));
  assert.match(css, /translate:/);
  assert.match(css, /scale:/);
  assert.doesNotMatch(css, /[^-]transform:/, "a `transform` animation would REPLACE the stitch's rotation");
});

test("fill-mode both: a stitch waits in its start state and holds its end state", () => {
  assert.match(compileMotion(base({ tracks: { h: [clip("a", "fade-in", 1000, 1500)] } })), /1000ms 1 both/);
});

test("type-on and stitch-in on text are played by the characters and words, not by sweeping the box", () => {
  const typed = compileMotion(base({ tracks: { h: [clip("a", "type-on", 0, 900)] } }));
  assert.match(typed, /\[data-stitch-id="h"\] \.kc\{animation:kn-char/);
  assert.doesNotMatch(typed, /\[data-stitch-id="h"\]\{animation/, "the box itself does not sweep");
  const stitched = compileMotion(base({ tracks: { h: [clip("a", "stitch-in", 0, 800)] } }));
  assert.match(stitched, /\[data-stitch-id="h"\] \.kw\{display:inline-block;animation:kn-word 450ms/);
  assert.doesNotMatch(stitched, /steps\(/, "no hard steps");
  // On a shape, stitch-in is a smooth reveal from the top.
  assert.match(compileMotion(base({ tracks: { b: [clip("a", "stitch-in", 0, 800)] } })), /\[data-stitch-id="b"\]\{animation:kn-stitch-in 800ms cubic-bezier/);
});

test("each character's moment comes evenly through the clip, the last at its end; words land by the end", () => {
  assert.deepEqual(pieceTimes(clip("a", "type-on", 1000, 1400), 4), [1099, 1199, 1299, 1399]);
  const w = pieceTimes(clip("a", "stitch-in", 0, 1000), 3);
  assert.deepEqual(w, [0, 275, 550]);
  assert.equal(w.at(-1) + wordMs(clip("a", "stitch-in", 0, 1000)), 1000);
});

test("ken burns acts on the picture inside the box, not the box", () => {
  const css = compileMotion({ stitches: [{ id: "i", kind: "image", x: 0, y: 0, w: 1, h: 1, locked: false }], motion: { tracks: { i: [clip("k", "ken-burns", 0, 4000)] } } });
  assert.match(css, /\[data-stitch-id="i"\] \.media img,/);
  assert.doesNotMatch(css, /\[data-stitch-id="i"\]\{animation/, "the box itself does not move");
});

test("no motion means no CSS", () => assert.equal(compileMotion(base(undefined)), ""));
test("the timeline ends where the last clip or sound ends", () => {
  assert.equal(motionEnd({ tracks: { h: [clip("a", "fade-in", 0, 800), clip("b", "fade-out", 4000, 4500)] } }), 4500);
  assert.equal(motionEnd({ tracks: {}, audio: [{ id: "v", yarnId: "y", startMs: 1000, kind: "voice" }] }, () => 3000), 4000);
  assert.equal(motionEnd(undefined), 0);
});
test("one picture of a video is once everything that enters before anything leaves is in", () => {
  assert.equal(stillMs(base({ tracks: { h: [clip("a", "slide-up", 200, 1000)], b: [clip("c", "fade-in", 900, 1400)] } })), 1400, "the last entrance");
  assert.equal(stillMs(base({ tracks: { h: [clip("a", "fade-in", 0, 600), clip("b", "fade-out", 3600, 4000)], b: [clip("c", "pop", 4000, 4400)] } })), 600, "the first scene before it leaves, not the next one coming in");
  assert.equal(stillMs(base({ tracks: { h: [clip("a", "pulse", 0, 1200)] } })), 0, "a loop is not an entrance");
  assert.equal(stillMs(base({ tracks: { h: [clip("a", "fade-in", 0, 600)] } }, 0)), 0, "a pattern that is not a video is knitted at its start");
  assert.equal(stillMs(base(undefined)), 0);
});
test("a video's poster is its still moment; with nothing coming in, a second in; never past its last frame", () => {
  assert.equal(posterMs(base({ tracks: { h: [clip("a", "fade-in", 0, 1000)] } })), 1000);
  assert.equal(posterMs(base({ tracks: { h: [clip("a", "pulse", 0, 1200)] } })), 1000, "footage that opens on black is past it");
  assert.equal(posterMs({ ...base({ tracks: {} }), durationMs: 2000 }), 500, "a quarter of a short one");
  assert.equal(posterMs({ ...base({ tracks: { h: [clip("a", "fade-in", 0, 3000)] } }), durationMs: 3000 }, 30), 2967, "the last frame, not after it");
  assert.equal(posterMs(base({ tracks: { h: [clip("a", "fade-in", 0, 600)] } }, 0)), 0, "a picture has none");
});

// ── commands ────────────────────────────────────────────────────────────────
test("setMotion sets a stitch's clips, sorts them, drops empty ones, and undoes exactly", () => {
  const p = base(undefined);
  const r = applyCommand(p, { type: "setMotion", stitchId: "h", clips: [clip("b", "fade-out", 3000, 3400), clip("a", "fade-in", 0, 500), clip("z", "pop", 900, 900)] }, "human");
  assert.deepEqual(r.pattern.motion.tracks.h.map((c) => c.id), ["a", "b"], "sorted, and the zero-length clip is dropped");
  const back = applyCommand(r.pattern, r.inverse, "human");
  assert.equal(back.pattern.motion.tracks.h, undefined);
});

test("a model cannot animate a locked stitch", () => {
  const r = applyCommand(base(undefined), { type: "setMotion", stitchId: "lock", clips: [clip("a", "pop", 0, 500)] }, "model");
  assert.equal(r.changed, false);
  assert.equal(r.refusals.length, 1);
});

test("deleting an animated stitch and undoing brings the animation back too", () => {
  const p = base({ tracks: { h: [clip("a", "fade-in", 0, 500)] } });
  const del = applyCommand(p, { type: "removeStitch", id: "h" }, "human");
  assert.equal(del.pattern.motion.tracks.h, undefined);
  const undo = applyCommand(del.pattern, del.inverse, "human");
  assert.deepEqual(undo.pattern.motion.tracks.h, p.motion.tracks.h);
  assert.ok(undo.pattern.stitches.some((s) => s.id === "h"));
});

// ── lint: each rule is shown failing, then passing ──────────────────────────
const codes = (p) => motionLint(p).map((i) => i.code);
const good = () => base({ tracks: { b: [clip("bg", "fade-in", 0, 500)], h: [clip("a", "slide-up", 400, 950)] } }, 3500);

test("lint: a well-made timeline is clean", () => assert.deepEqual(codes(good()), []));
test("lint: text that is up too briefly to read is flagged", () => {
  const p = base({ tracks: { h: [clip("a", "fade-in", 0, 400), clip("o", "fade-out", 700, 1100)] } }, 4000);
  assert.ok(codes(p).includes("text-too-brief"));
});
test("lint: five things moving at once is flagged as too busy", () => {
  const stitches = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, kind: "shape", x: 0, y: 0, w: 0.1, h: 0.1, locked: false }));
  const p = { ...good(), stitches, motion: { tracks: Object.fromEntries(stitches.map((s) => [s.id, [clip(`c${s.id}`, "pop", 0, 800)]])) } };
  assert.ok(codes(p).includes("too-busy"));
});
test("lint: more than three flashes in a second is flagged", () => {
  const cs = [0, 200, 400, 600].map((t, i) => clip(`f${i}`, i % 2 ? "fade-out" : "fade-in", t, t + 150));
  assert.ok(codes(base({ tracks: { b: cs } }, 4000)).includes("flashing"));
});
test("lint: a long stretch with nothing moving is flagged", () => {
  assert.ok(codes(base({ tracks: { b: [clip("a", "fade-in", 0, 500), clip("b", "fade-out", 5000, 5400)] } }, 6000)).includes("dead-air"));
});
test("lint: dead air is every gap, the end included, and a slow zoom through a gap fills it while a pulse does not", () => {
  const gaps = (tracks, dur) => motionLint(base({ tracks }, dur)).filter((i) => i.code === "dead-air").map((i) => i.message);
  // Two gaps: the old check stopped at the first.
  assert.equal(gaps({ b: [clip("a", "fade-in", 0, 500), clip("b", "pulse", 600, 4000), clip("c", "fade-out", 3500, 3900), clip("d", "fade-in", 7000, 7500)] }, 8500).length, 2);
  // Frozen for the last 3.5 s: never checked before.
  assert.match(gaps({ h: [clip("a", "slide-up", 0, 550), clip("b", "fade-in", 2000, 2500)] }, 6000)[0], /Nothing moves for the last 3\.5s, from 2\.5s/);
  assert.deepEqual(gaps({ h: [clip("a", "slide-up", 0, 550)], b: [clip("k", "ken-burns", 0, 6000)] }, 6000), [], "a slow zoom keeps it alive");
});
test("lint: an entrance too short to see, and type-on faster than a letter a frame, are flagged", () => {
  const fast = (tracks, content) => motionLint({ ...base({ tracks }, 4000), stitches: base({}).stitches.map((s) => (s.id === "h" && content ? { ...s, content } : s)) }).filter((i) => i.code === "too-fast").map((i) => i.message);
  assert.match(fast({ h: [clip("a", "slide-up", 400, 650)] })[0], /The headline takes 250 ms to come in: 8 frames, which reads as a jump/);
  assert.deepEqual(fast({ h: [clip("a", "slide-up", 400, 700)] }), [], "300 ms is quick but fine, as the guide says");
  // Many quick entrances are one warning, not one each.
  const many = fast({ h: [clip("a", "slide-up", 400, 600)], b: [clip("b", "pop", 0, 250)], lock: [clip("c", "fade-in", 0, 280)] });
  assert.equal(many.length, 1);
  assert.match(many[0], /^3 things take as little as 200 ms to come in \(headline, shape, eyebrow\): 6 frames/);
  assert.match(fast({ h: [clip("a", "type-on", 0, 1400)] }, "Fifty characters of a quote typed out far too fast!")[0], /types 51 characters in 1400 ms, 27 ms each.*2040 ms or more/);
  assert.deepEqual(fast({ h: [clip("a", "type-on", 0, 1400)] }, "Short line"), []);
  assert.deepEqual(fast({ h: [clip("a", "fade-out", 0, 200)] }), [], "exits may be quick");
});
test("lint: a clip running past the end of the video is flagged", () => {
  assert.ok(codes(base({ tracks: { b: [clip("a", "fade-in", 0, 5000)] } }, 3000)).includes("past-end"));
});
test("lint: ending right as the last animation ends is flagged", () => {
  assert.ok(codes(base({ tracks: { b: [clip("a", "fade-in", 0, 3900)] } }, 4000)).includes("no-hold"));
});
test("lint runs inside preflight, so Knit shows it before anyone waits", () => {
  const p = base({ tracks: { h: [clip("a", "fade-in", 0, 400), clip("o", "fade-out", 700, 1100)] } }, 4000);
  assert.ok(preflight(p, FALLBACK_SWATCH, { yarn: {} }).some((i) => i.code === "text-too-brief"));
});
test("a still has no motion lint at all", () => assert.deepEqual(codes(base({ tracks: { h: [clip("a", "fade-in", 0, 100)] } }, 0)), []));

test("only a stitch's first clip waits in its start state, so a later clip cannot override it from frame 0", () => {
  const css = compileMotion(base({ tracks: { h: [clip("b", "fade-out", 3000, 3400), clip("a", "fade-in", 0, 500)] } }));
  assert.match(css, /kn-fade-in 500ms cubic-bezier\([^)]*\) 0ms 1 both,kn-fade-out 400ms cubic-bezier\([^)]*\) 3000ms 1 forwards/, "in time order, the later one forwards only");
});

test("ken burns zooms footage as well as pictures", () => {
  const css = compileMotion({ stitches: [{ id: "v", kind: "video", x: 0, y: 0, w: 1, h: 1, locked: false }], motion: { tracks: { v: [clip("k", "ken-burns", 0, 4000)] } } });
  assert.match(css, /\[data-stitch-id="v"\] \.media video/);
});

test("a pulse beats inside its clip, not for the clip's length again per beat", () => {
  assert.match(compileMotion(base({ tracks: { h: [clip("p", "pulse", 1000, 2200)] } })), /kn-pulse 600ms cubic-bezier\([^)]*\) 1000ms 2 both/);
});

// ── exits, scene changes, and what covers what ──────────────────────────────
const scene = (motion, durationMs = 8000) => ({
  id: "p", projectId: "pj", name: "Scenes", size: { name: "Story", w: 1080, h: 1920 }, durationMs, version: 1, updatedAt: "", motion,
  stitches: [
    { id: "bg", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: {} },
    { id: "h1", kind: "text", slot: "headline", x: 0.1, y: 0.3, w: 0.8, h: 0.1, locked: false, content: "Your files, anywhere", style: {} },
    { id: "s1", kind: "text", slot: "sub", x: 0.1, y: 0.45, w: 0.8, h: 0.08, locked: false, content: "Open them on any device", style: {} },
    { id: "pic", kind: "image", slot: "scene2", x: 0, y: 0.2, w: 1, h: 0.5, locked: false, style: {} },
    { id: "pill", kind: "shape", slot: "button", x: 0.3, y: 0.8, w: 0.4, h: 0.06, locked: false, style: { background: "$color.primary" } },
    { id: "cta", kind: "text", slot: "cta", x: 0.33, y: 0.81, w: 0.34, h: 0.04, locked: false, content: "Try it", style: {} },
  ],
});
const lintOf = (p) => motionLint(p);

test("exits: each way out compiles, leaves the stitch gone, and slides out by less than a slide in", () => {
  const outs = PRESETS.filter((p) => p.kind === "out").map((p) => p.id);
  assert.deepEqual(outs, ["fade-out", "slide-out-up", "slide-out-down", "slide-out-left", "slide-out-right", "shrink-out", "wipe-out"]);
  for (const id of outs) {
    const css = compileMotion(scene({ tracks: { h1: [clip("a", "fade-in", 0, 500), clip("b", id, 3000, 3400)] } }));
    assert.match(css, new RegExp(`kn-${id} 400ms (cubic-bezier\\([^)]+\\)|linear) 3000ms 1 forwards`), `${id} holds its end once it has run`);
  }
  assert.match(compileMotion(scene({ tracks: { h1: [clip("b", "slide-out-up", 3000, 3400)] } })), /@keyframes kn-slide-out-up\{from\{opacity:1;translate:0 0\}to\{opacity:0;translate:0 -40%\}\}/);
  assert.match(compileMotion(scene({ tracks: { h1: [clip("b", "wipe-out", 3000, 3400)] } })), /to\{clip-path:inset\(0 0 0 100%\)\}/, "away the way the wipe in came");
});

test("when a stitch is on screen: from its first entrance to its exit, or the whole video", () => {
  const m = { tracks: { h1: [clip("a", "fade-in", 500, 1000), clip("p", "pulse", 1200, 2400), clip("o", "fade-out", 3000, 3400)], s1: [clip("p", "pulse", 1000, 2200)] } };
  assert.deepEqual(shownOf("h1", m, 8000), { from: 500, inAt: 1000, outAt: 3000, goneAt: 3400 });
  assert.deepEqual(shownOf("s1", m, 8000), { from: 0, inAt: 0, outAt: 8000, goneAt: 8000 }, "a pulse is not an entrance");
  assert.deepEqual(shownOf("pic", m, 8000), { from: 0, inAt: 0, outAt: 8000, goneAt: 8000 });
  assert.equal(entersAt("h1", m), 500);
});

test("a scene change: what leaves goes out a little apart, all gone by the moment; what enters comes in from it, headline first", () => {
  const p = scene({ tracks: { h1: [clip("a", "fade-in", 0, 500), clip("old", "fade-out", 6000, 6400)], s1: [clip("b", "fade-in", 200, 700)], pic: [clip("k", "ken-burns", 0, 8000), clip("c", "fade-in", 6000, 6500)] } });
  const out = sceneChange(p, { atMs: 4000, leaving: ["s1", "h1"], entering: ["pic"], out: "slide-out-up", in: "scale-in" });
  const by = Object.fromEntries(out.map((t) => [t.stitchId, t.clips]));
  assert.deepEqual(by.h1.map((c) => [c.preset, c.startMs, c.endMs]), [["fade-in", 0, 500], ["slide-out-up", 3520, 3920]], "the headline goes first, and its later exit is replaced");
  assert.deepEqual(by.s1.map((c) => [c.preset, c.startMs, c.endMs]), [["fade-in", 200, 700], ["slide-out-up", 3600, 4000]], "the last one is gone at 4 s");
  assert.deepEqual(by.pic.map((c) => [c.preset, c.startMs, c.endMs]), [["scale-in", 4000, 4500], ["ken-burns", 0, 8000]], "its entrance is moved to the change, and its slow zoom stays");
  const typed = sceneChange(p, { atMs: 4000, entering: ["pic"], in: "type-on" });
  assert.equal(typed[0].clips[0].preset, "fade-in", "type-on is only for words");
  assert.equal(sceneChange(p, { atMs: 4000, leaving: ["h1"], out: "pop" })[0].clips.at(-1).preset, "fade-out", "an entrance cannot be an exit");
});

test("lint: words something solid comes in over, without leaving first, are told once per change, and count as gone for reading", () => {
  const covered = scene({ tracks: { h1: [clip("a", "fade-in", 0, 500)], s1: [clip("b", "fade-in", 200, 700)], pic: [clip("c", "fade-in", 1600, 2000)], pill: [clip("d", "fade-in", 0, 500)], cta: [clip("e", "fade-in", 300, 800)] } });
  const issues = lintOf(covered);
  const cov = issues.filter((i) => i.code === "covered");
  assert.equal(cov.length, 1);
  assert.match(cov[0].message, /^headline and sub are still on screen at 2\.0s when the scene2 comes in over them\. Take them out first/);
  assert.ok(issues.some((i) => i.code === "text-too-brief" && i.stitchId === "s1"), "the sub is readable from 0.7 s to 2 s only");
  // The same scene, with exits that end by the time the picture is in: clean.
  const changed = scene({ tracks: { h1: [clip("a", "fade-in", 0, 500), clip("x", "fade-out", 3000, 3400)], s1: [clip("b", "fade-in", 200, 700), clip("y", "fade-out", 3100, 3500)], pic: [clip("c", "fade-in", 3500, 4000)], pill: [clip("d", "fade-in", 0, 500)], cta: [clip("e", "fade-in", 300, 800)] } });
  assert.deepEqual(lintOf(changed).filter((i) => ["covered", "text-too-brief"].includes(i.code)), []);
  // A see-through cover, or one under the words, covers nothing.
  const glass = scene(covered.motion); glass.stitches.find((s) => s.id === "pic").style = { opacity: 0.3 };
  assert.equal(lintOf(glass).filter((i) => i.code === "covered").length, 0);
  const under = scene(covered.motion); under.stitches = [under.stitches[0], under.stitches[3], ...under.stitches.filter((s) => !["bg", "pic"].includes(s.id))];
  assert.equal(lintOf(under).filter((i) => i.code === "covered").length, 0);
});

test("lint: a part before its container, a container left empty, and a label left behind are each flagged; a backdrop is no one's container", () => {
  const ok = scene({ tracks: { pill: [clip("d", "pop", 1000, 1500)], cta: [clip("e", "fade-in", 1300, 1800)], h1: [clip("a", "fade-in", 0, 500)] } });
  assert.deepEqual(lintOf(ok).filter((i) => /container|behind/.test(i.code)), [], "the words a beat after their button, and nothing contained by the backdrop");
  const floating = scene({ tracks: { pill: [clip("d", "pop", 1000, 1500)], cta: [clip("e", "fade-in", 0, 500)] } });
  assert.deepEqual(lintOf(floating).filter((i) => i.code === "before-container").map((i) => i.message), ["The cta shows at 0.0s, before the button it sits on comes in at 1.0s, so it floats on the page. Bring it in with the button, or just after."]);
  const empty = scene({ tracks: { pill: [clip("d", "fade-in", 0, 500)], cta: [clip("e", "fade-in", 4200, 4700)] } });
  assert.match(lintOf(empty).find((i) => i.code === "empty-container").message, /^The button is empty from 0\.5s until 4\.2s/);
  const left = scene({ tracks: { pill: [clip("d", "fade-in", 0, 500), clip("o", "fade-out", 3000, 3400)], cta: [clip("e", "fade-in", 200, 700)] } });
  assert.match(lintOf(left).find((i) => i.code === "left-behind").message, /^The cta is still there after the button it sits on has gone, at 3\.4s/);
  const unnamed = scene(floating.motion); unnamed.stitches = unnamed.stitches.map((s) => (s.id === "pill" || s.id === "cta" ? { ...s, slot: undefined } : s));
  assert.match(lintOf(unnamed).find((i) => i.code === "before-container").message, /^The "Try it" shows at 0\.0s, before the shape at the bottom it sits on/);
});
