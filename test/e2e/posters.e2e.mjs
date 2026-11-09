// Knitting as it happens, and video posters (design sheet f45). The queue shows the file being
// drawn as soon as its frames start, and every file of the knit; a video's poster is the moment
// its pattern shows whole, the same picture as the video's own frame there; a card shows the
// poster and plays the video where it is pointed at. A video made before posters gets one from
// the video the first time it is asked for, and a knit deleted takes its poster with it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import test, { after, before } from "node:test";
import sharp from "sharp";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, patternId, video;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const POSTER_MS = 1000;
/** A picture as 48 by 48 grey levels, to compare two of them. */
const small = async (buf) => sharp(buf).resize(48, 48, { fit: "fill" }).greyscale().raw().toBuffer();
const apart = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;
/** The video's own frame at a moment, from ffmpeg. */
const frameAt = (file, ms) => execFileSync("ffmpeg", ["-v", "error", "-ss", (ms / 1000).toFixed(3), "-i", file, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"], { maxBuffer: 64 << 20 });
const posterFile = (k) => join(studio.home, "projects", k.projectId, "knits", ".posters", `${k.id}.jpg`);

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Posters e2e", starter: "social" })).body.id;
  patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
  // A big block that fades in over the first second of five: at the start it is not there yet.
  await j("POST", `/api/patterns/${patternId}/commands`, { command: { type: "batch", commands: [
    { type: "addStitch", stitch: { id: "block", kind: "shape", x: 0.05, y: 0.25, w: 0.9, h: 0.5, locked: false, style: { background: "#0b6b3a" } } },
    { type: "setMotion", stitchId: "block", clips: [{ id: "in", preset: "fade-in", startMs: 0, endMs: POSTER_MS }] },
    { type: "setMeta", durationMs: 5000 },
  ] }, actor: "human" });
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("while a video knits, the queue shows the file being drawn, and each file of the knit in its shape", async () => {
  const size = (await j("GET", `/api/patterns/${patternId}`)).body.size;
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  const started = await j("POST", `/api/patterns/${patternId}/knit`, { params: { fps: 60, sizes: [size, { name: "Square", w: 1080, h: 1080 }] } });
  assert.ok(started.status < 300, JSON.stringify(started.body));
  const jobId = started.body.jobId ?? started.body.id;
  const queue = page.getByRole("region", { name: "Knitting" });
  // The picture of the file being drawn, with its frames under way.
  await queue.locator(".kq-now img").waitFor({ timeout: 60_000 });
  const job = (await j("GET", `/api/jobs/${jobId}`)).body;
  assert.deepEqual(job.progress.shapes, [[size.w, size.h], [1080, 1080]]);
  assert.equal(job.progress.kind, "video");
  const preview = await fetch(`${studio.url}/api/jobs/${jobId}/preview?file=${job.progress.preview}`);
  assert.equal(preview.headers.get("content-type"), "image/jpeg");
  // Both files are in the strip, each named for a screen reader with how it stands.
  const files = queue.getByRole("list", { name: /^The files of / });
  assert.equal(await files.getByRole("listitem").count(), 2);
  await files.getByText(/: being made$/).first().waitFor();
  assert.deepEqual(await axeProblems(page), []);
  // The second file starts once the first has landed: the first shows as done.
  await files.getByText(/: done$/).first().waitFor({ timeout: 120_000 });
  await serverHas(studio, `/api/jobs/${jobId}`, (x) => x.status === "done", { timeout: 180_000 });
  assert.equal((await fetch(`${studio.url}/api/jobs/${jobId}/preview?file=1`)).status, 404, "the picture of the file being drawn goes when the knit is done");
});

test("a video's poster is its own frame at the moment the pattern shows whole, not its first", async () => {
  const knits = (await j("GET", `/api/projects/${projectId}/knits?every=1`)).body;
  assert.equal(knits.length, 2);
  video = knits.find((k) => k.width !== k.height) ?? knits[0];
  const res = await fetch(`${studio.url}/api/knits/${video.id}/poster`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  const poster = await small(Buffer.from(await res.arrayBuffer()));
  const file = join(studio.home, "projects", projectId, "knits", video.file);
  const there = await small(frameAt(file, POSTER_MS + 20));
  const first = await small(frameAt(file, 0));
  assert.ok(apart(poster, there) < 4, `the poster is the frame at ${POSTER_MS} ms (${apart(poster, there).toFixed(2)} apart)`);
  assert.ok(apart(poster, first) > 4 * apart(poster, there), `and not the first frame (${apart(poster, first).toFixed(2)} apart)`);
  assert.ok(existsSync(posterFile(video)), "kept beside the knits");
});

test("a card shows the poster with how long it runs, and plays the video where it is pointed at", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  const card = page.locator("li[data-thing]").first();
  const poster = card.locator('img[src$="/poster"]');
  await poster.waitFor();
  assert.ok(await poster.evaluate((img) => img.complete && img.naturalWidth > 0), "the poster loaded");
  await card.getByText("▶ 0:05").waitFor();
  assert.equal(await card.locator("video").count(), 0, "nothing plays by itself");
  await card.hover();
  await card.locator("video").waitFor();
  await page.mouse.move(5, 5);
  await poster.waitFor();
  assert.equal(await card.locator("video").count(), 0, "moving away puts the poster back");
});

test("a video made before posters gets one the first time it is shown, and a knit deleted takes its poster", async () => {
  rmSync(posterFile(video));
  assert.equal((await fetch(`${studio.url}/api/knits/${video.id}/poster`)).status, 200, "made from the video");
  assert.ok(existsSync(posterFile(video)), "and kept");
  const picture = (await j("GET", `/api/projects/${projectId}/knits?every=1`)).body;
  assert.equal((await fetch(`${studio.url}/api/knits/${picture.find((k) => k.kind === "image")?.id ?? "none"}/poster`)).status, 404, "a picture has none: it is its own");
  assert.equal((await j("DELETE", `/api/knits/${video.id}`)).status < 300, true);
  assert.equal(existsSync(posterFile(video)), false);
});
