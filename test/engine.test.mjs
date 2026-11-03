// The pure parts of the engine: frame timing and page generation.
//
// These are tested because they are the parts where an off-by-one is invisible
// until the audio no longer lines up, and because they need neither a browser
// nor ffmpeg - so they run in CI without a 300MB download.

import assert from "node:assert/strict";
import test from "node:test";
import { FPS, frameTimes, pageFor } from "../engine/knit.mjs";

test("a still is one frame, at time zero", () => {
  assert.deepEqual(frameTimes(0), [0]);
  assert.deepEqual(frameTimes(undefined), [0]);
  assert.deepEqual(frameTimes(-5), [0]);
});

test("a one-second clip is exactly fps frames", () => {
  assert.equal(frameTimes(1000).length, FPS);
});

test("the first frame is the opening state, not one tick in", () => {
  // Rendering at the END of each slot would lose the frame at t=0, which is
  // the state the whole animation starts from.
  assert.equal(frameTimes(1000)[0], 0);
});

test("frames cover the duration without overrunning it", () => {
  const t = frameTimes(2000);
  assert.equal(t.length, 2 * FPS);
  assert.ok(t[t.length - 1] < 2000, "the last frame must start before the end");
});

test("a page carries the stage contract the renderer depends on", () => {
  const html = pageFor({
    id: "p", size: { name: "Square", w: 1080, h: 1080 }, durationMs: 0, stitches: [],
  });
  for (const needed of ["window.__stage", "seek(", "ready()", "duration:"]) {
    assert.ok(html.includes(needed), `page is missing ${needed}`);
  }
});

test("animations are paused, so a render is deterministic", () => {
  const html = pageFor({ id: "p", size: { name: "S", w: 10, h: 10 }, durationMs: 1000, stitches: [] });
  assert.ok(html.includes("animation-play-state:paused"),
    "an unpaused page renders a different video every run");
});

test("stitch coordinates become percentages, never pixels", () => {
  const html = pageFor({
    id: "p", size: { name: "Story", w: 1080, h: 1920 }, durationMs: 0,
    stitches: [{ id: "a", kind: "text", x: 0.08, y: 0.5, w: 0.84, h: 0.1, locked: false, content: "Hi" }],
  });
  assert.ok(html.includes("left:8%"), "x should be a percentage");
  assert.ok(html.includes("width:84%"), "w should be a percentage");
  assert.ok(!/left:\d+px/.test(html), "a pixel coordinate would pin the pattern to one size");
});

test("a hand-written pattern keeps its own html and still gets the stage", () => {
  const html = pageFor({
    id: "p", size: { name: "S", w: 10, h: 10 }, durationMs: 500,
    stitches: [], html: "<main id='mine'>custom</main>", css: ".x{color:red}",
  });
  assert.ok(html.includes("<main id='mine'>custom</main>"));
  assert.ok(html.includes(".x{color:red}"));
  assert.ok(html.includes("window.__stage"), "a code pattern renders through the same engine");
});
