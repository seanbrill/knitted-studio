import assert from "node:assert/strict";
import test from "node:test";
import { engagement, insights, metricsLine, nextMetricsCheck, weekIn } from "../src/index.ts";

const H = 3600_000, D = 24 * H;
const T0 = Date.parse("2026-11-01T15:00:00Z");
const iso = (t) => new Date(t).toISOString();

test("a post's numbers in a line, with how many of those who saw it did something", () => {
  assert.equal(metricsLine({ views: 1240, likes: 87, comments: 12, saves: 0 }), "1,240 views · 87 likes · 12 comments · 0 saves · 8% engaged");
  assert.equal(metricsLine({ likes: 1, comments: 1 }), "1 like · 1 comment", "no views, no rate");
  assert.equal(metricsLine({ views: 2000, likes: 9, avgWatchSec: 6.42 }), "2,000 views · 9 likes · 6.4s watched on average · 0.5% engaged");
  assert.equal(metricsLine(null), "");
  assert.equal(engagement({ views: 0, likes: 3 }), null);
});

test("the next look: the first time past the last look; none after the last", () => {
  const posted = iso(T0);
  assert.equal(nextMetricsCheck(posted, null), T0 + H);
  assert.equal(nextMetricsCheck(posted, iso(T0 + 2 * H)), T0 + 6 * H);
  assert.equal(nextMetricsCheck(posted, iso(T0 + 30 * D)), null);
});

test("a post is compared by its look nearest a week in, and not before three days", () => {
  const snaps = [1, 2.5, 6, 12].map((d) => ({ at: iso(T0 + d * D), metrics: { views: d * 100 } }));
  assert.equal(weekIn(iso(T0), snaps).metrics.views, 600);
  assert.equal(weekIn(iso(T0), snaps.slice(0, 2)), null);
});

function post(id, { platform = "instagram", views, at = T0, kind = "video", caption = "Hi", by = "human", seen = 7 * D }) {
  return {
    p: { id, projectId: "p", accountId: "a", platform, knitIds: ["k"], caption, title: "", options: { shape: { kind, durationMs: 9000, sound: true, patternName: "Launch" } }, scheduledAt: null, status: "posted", externalId: id, url: null, error: null, attempts: 1, postedAt: iso(at), by, metrics: views == null ? null : { views }, metricsAt: views == null ? null : iso(at + seen), metricsNote: null, createdAt: iso(at), updatedAt: iso(at) },
    h: views == null ? [] : [{ at: iso(at + seen), metrics: { views } }],
  };
}
const run = (list, now = T0 + 30 * D) => insights(list.map((x) => x.p), new Map(list.map((x) => [x.p.id, x.h])), (p) => p.options.shape, now);

test("nothing is said about a factor until each side has three posts, and close results are called close", () => {
  const few = run([post("a", { views: 100 }), post("b", { views: 120 }), post("c", { views: 400, kind: "picture" })]);
  assert.equal(few.compared, 3);
  assert.equal(few.findings.find((f) => f.factor === "What it was"), undefined, "one picture is not a pattern");
  const close = run(["a", "b", "c"].map((id, i) => post(id, { views: 100 + i })).concat(["d", "e", "f"].map((id, i) => post(id, { views: 101 + i, kind: "picture" }))));
  const f = close.findings.find((x) => x.factor === "What it was");
  assert.equal(f.clear, false);
  assert.match(f.text, /^(Videos and single pictures|Single pictures and videos) did about as well as each other\.$/);
});

test("too new to compare, and an account with too few posts, are said, not guessed", () => {
  const r = run([post("new", { views: 50, at: T0 + 29 * D, seen: 6 * H }), post("old", { views: 500 })]);
  assert.match(r.posts.find((p) => p.id === "new").waiting, /Too new to compare/);
  assert.match(r.posts.find((p) => p.id === "old").waiting, /once this account has 3 posts/);
  assert.match(r.note, /Comparisons start once an account has 3 posts/);
  assert.equal(run([]).note, "Nothing has been posted yet.");
});

test("each account is its own yardstick: a small account's good post beats a big account's usual one", () => {
  const small = ["s1", "s2", "s3"].map((id, i) => post(id, { platform: "threads", views: [50, 60, 200][i] }));
  const big = ["b1", "b2", "b3"].map((id) => post(id, { views: 5000 }));
  const r = run([...small, ...big]);
  const s3 = r.posts.find((p) => p.id === "s3");
  assert.ok(s3.lift > 3, `three times its account's usual: ${s3.lift}`);
  assert.equal(r.posts.find((p) => p.id === "b1").lift, 1);
});
