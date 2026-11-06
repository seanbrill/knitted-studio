// The pure parts of the engine: frame timing and page generation.
//
// These are tested because they are the parts where an off-by-one is invisible
// until the audio no longer lines up, and because they need neither a browser
// nor ffmpeg - so they run in CI without a 300MB download.

import assert from "node:assert/strict";
import test from "node:test";
import { FPS, frameTimes } from "@knitted/engine";
import { pageFor } from "@knitted/render";

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

test("every style a stitch declares survives into the page, including after a font name", () => {
  // The regression this pins: a quoted font name inside style="..." ended the
  // attribute and silently dropped font-size, colour and everything after it.
  const html = pageFor({ id: "p", size: { name: "S", w: 1000, h: 1000 }, durationMs: 0, stitches: [
    { id: "t", kind: "text", slot: "headline", x: 0, y: 0, w: 1, h: 0.2, locked: false, content: "Hi", style: { fontFamily: "Playfair Display", fontSize: 0.1, color: "#112233", fontWeight: 800 } },
  ] });
  const style = html.match(/data-stitch-id="t"[^>]*style="([^"]*)"/)[1];
  assert.match(style, /font-family:'Playfair Display'/);
  assert.match(style, /font-size:100px/);
  assert.match(style, /color:#112233/);
  assert.match(style, /font-weight:800/);
});

test("a capture job reads the site for its pages, pictures them, says how it went, and stops when cancelled", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { getBrief, openStore } = await import("@knitted/core/node");
  const { cancelJob, startCaptureJob } = await import("@knitted/engine");
  const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-capjob-")), "k.db"));
  const project = store.createProject({ name: "Capture job" });
  const settled = async (id) => { for (let i = 0; i < 200; i++) { const j = store.getJob(id); if (!["queued", "running"].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 10)); } return store.getJob(id); };
  const reader = async (url) => ({ url, name: "Hollow Oak", pages: [{ url: `${url}/`, title: "Home" }, { url: `${url}/about`, title: "About" }], notes: [] });
  const capture = async (_s, _p, pages, o) => {
    pages.forEach((p, i) => o.onShot({ url: p.url, done: i + 1, total: pages.length }));
    return { shots: pages.map((p, i) => ({ yarnId: `yr_${i}`, url: p.url, device: "desktop", replaced: i === 0 })), skipped: [] };
  };
  const done = await settled(startCaptureJob(store, { projectId: project.id, url: "https://hollowoak.example", reader, capture }).id);
  assert.equal(done.status, "done");
  assert.deepEqual([done.result.pictures, done.result.replaced, done.result.yarnIds], [2, 1, ["yr_0", "yr_1"]]);
  assert.deepEqual([getBrief(store, project.id).site.url, getBrief(store, project.id).site.pictures], ["https://hollowoak.example", 2]);
  assert.ok(store.activity(project.id).some((a) => a.action === "brief.synced" && a.actor === "model"));

  const none = await settled(startCaptureJob(store, { projectId: project.id, url: "https://x.example", reader, capture: async () => ({ shots: [], skipped: [{ url: "https://x.example/", why: "it answered 500" }] }) }).id);
  assert.deepEqual([none.status, none.error], ["failed", "None could be taken: it answered 500."]);

  const slow = startCaptureJob(store, { projectId: project.id, url: "https://slow.example", reader: (_u, o) => new Promise((_r, no) => o.signal.addEventListener("abort", () => no(new Error("aborted")))), capture });
  cancelJob(store, slow.id);
  assert.equal((await settled(slow.id)).status, "cancelled");
});
