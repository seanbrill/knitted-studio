import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, compileMotion, motionEnd, motionLint, preflight, PRESETS, FALLBACK_SWATCH } from "../src/index.ts";

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

test("stitch-in reveals in rows and type-on in characters", () => {
  assert.match(compileMotion(base({ tracks: { h: [clip("a", "stitch-in", 0, 640)] } })), /steps\(5, end\)/);
  assert.match(compileMotion(base({ tracks: { h: [clip("a", "type-on", 0, 900)] } })), /steps\(21, end\)/, "one step per character of \"Make it knitted today\"");
});

test("ken burns acts on the picture inside the box, not the box", () => {
  const css = compileMotion({ stitches: [{ id: "i", kind: "image", x: 0, y: 0, w: 1, h: 1, locked: false }], motion: { tracks: { i: [clip("k", "ken-burns", 0, 4000)] } } });
  assert.match(css, /\[data-stitch-id="i"\] \.media img\{animation:/);
});

test("no motion means no CSS", () => assert.equal(compileMotion(base(undefined)), ""));
test("the timeline ends where the last clip or sound ends", () => {
  assert.equal(motionEnd({ tracks: { h: [clip("a", "fade-in", 0, 800), clip("b", "fade-out", 4000, 4500)] } }), 4500);
  assert.equal(motionEnd({ tracks: {}, audio: [{ id: "v", yarnId: "y", startMs: 1000, kind: "voice" }] }, () => 3000), 4000);
  assert.equal(motionEnd(undefined), 0);
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
const good = () => base({ tracks: { b: [clip("bg", "fade-in", 0, 500)], h: [clip("a", "slide-up", 400, 950)] } }, 4000);

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
