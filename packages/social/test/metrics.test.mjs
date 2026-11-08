// How posts did, against stand-ins for each platform: what knitted asks each one, when, and
// what it keeps. Nothing here reaches a platform, and secrets stay in memory.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPost, finishPost, getPost, insertKnit, metricsHistory, openStore, postInsights } from "@knitted/core/node";
import { checkOne, finishConnect, metricsDue, runMetrics, setSocialConfig, startConnect } from "../src/index.mjs";
import { saveTokens } from "../src/accounts.mjs";

const memory = () => { const m = new Map(); return { name: "memory", available: async () => true, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k) }; };
function net(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${(init.method ?? "GET").toUpperCase()} ${u.host}${u.pathname}`;
    const call = { key, url: u, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
    calls.push(call);
    const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    if (!route) return Response.json({ error: { message: `nothing at ${key}` } }, { status: 404 });
    const r = await route(call);
    return r instanceof Response ? r : Response.json(r);
  };
  return { fetch, calls };
}

const H = 3600_000, D = 24 * H;
const T0 = Date.parse("2026-11-01T15:00:00Z");

async function setup(platform, connectRoutes, app = { clientId: "id", clientSecret: "sec" }) {
  const dir = mkdtempSync(join(tmpdir(), "knitted-metrics-"));
  const store = openStore(join(dir, "k.db"));
  const project = store.createProject({ name: "Numbers" });
  mkdirSync(store.paths.outDir(project.id), { recursive: true });
  const secrets = memory();
  await setSocialConfig(store, { apps: { [platform]: app } }, { secrets });
  const { state } = await startConnect(store, platform, { port: 4321 }, { secrets });
  const account = await finishConnect(store, { code: "c", state }, { fetch: net(connectRoutes).fetch, secrets, wait: async () => {} });
  // Tokens that do not run out during the test's made-up month.
  await saveTokens(store, account.id, { access: "tok", refresh: "r", expiresAt: null }, { secrets });
  return { store, project, account, secrets };
}
function knit(store, project, kind = "video") {
  const file = `k${Math.random()}.${kind === "video" ? "mp4" : "png"}`;
  writeFileSync(join(store.paths.outDir(project.id), file), Buffer.alloc(10));
  return insertKnit(store, { projectId: project.id, patternId: null, patternName: "Launch", jobId: null, batchId: null, label: "k", file, kind, format: kind === "video" ? "mp4" : "png", width: 1080, height: kind === "video" ? 1920 : 1080, bytes: 10, durationMs: kind === "video" ? 12000 : null, hash: file, report: kind === "video" ? { lufs: -14 } : {} });
}
/** A post that went out at `at`, with this id on its platform. */
function posted(store, project, account, externalId, at = T0, options = {}, kind = "video") {
  const k = knit(store, project, kind);
  const p = createPost(store, { projectId: project.id, accountId: account.id, knitIds: [k.id], caption: "Hello #knit", title: "T", options: account.platform === "tiktok" ? { privacy: "PUBLIC_TO_EVERYONE" } : {}, draft: true });
  store.db.prepare("update social_posts set status = 'posted', external_id = ?, url = ?, posted_at = ?, options = ? where id = ?").run(externalId, null, new Date(at).toISOString(), JSON.stringify({ ...p.options, ...options }), p.id);
  return getPost(store, p.id);
}
const deps = (n, secrets, now) => ({ fetch: n.fetch, secrets, wait: async () => {}, now: () => now });

const IG = {
  "POST api.instagram.com/oauth/access_token": () => ({ access_token: "short", user_id: 1 }),
  "GET graph.instagram.com/access_token": () => ({ access_token: "long", expires_in: 5184000 }),
  "GET graph.instagram.com/v27.0/me": () => ({ user_id: "9", username: "knit" }),
};
const metaData = (o) => ({ data: Object.entries(o).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }] })) });

test("when knitted asks: an hour in, then 6 hours, a day, 3 days, a week, 2 weeks and a month; one look after a long close; none after a month", async () => {
  const { store, project, account } = await setup("instagram", IG);
  const p = posted(store, project, account, "m1");
  const due = (t) => metricsDue(store, t).map((x) => x.id);
  assert.deepEqual(due(T0 + 30 * 60_000), [], "not in its first hour");
  assert.deepEqual(due(T0 + H), [p.id]);
  store.db.prepare("update social_posts set metrics_at = ? where id = ?").run(new Date(T0 + H).toISOString(), p.id);
  assert.deepEqual(due(T0 + 2 * H), [], "asked an hour in: next at 6 hours");
  assert.deepEqual(due(T0 + 6 * H), [p.id]);
  // knitted closed from 6 hours to 5 days: one look when it opens, then the week's.
  store.db.prepare("update social_posts set metrics_at = ? where id = ?").run(new Date(T0 + 5 * D).toISOString(), p.id);
  assert.deepEqual(due(T0 + 6 * D), []);
  assert.deepEqual(due(T0 + 7 * D), [p.id]);
  assert.deepEqual(due(T0 + 40 * D), [], "after a month it is left alone");
});

test("Instagram: a Reel's numbers and how long it was watched, kept as the latest and in its history", async () => {
  const { store, project, account, secrets } = await setup("instagram", IG);
  const p = posted(store, project, account, "m1", T0, { shape: { kind: "video", durationMs: 12000, sound: true, patternName: "Launch" } });
  const n = net({ "GET graph.instagram.com/v27.0/m1/insights": ({ url }) => {
    assert.equal(url.searchParams.get("metric"), "views,reach,likes,comments,saved,shares,ig_reels_avg_watch_time");
    assert.equal(url.searchParams.get("access_token"), "tok");
    return metaData({ views: 1200, reach: 900, likes: 80, comments: 6, saved: 9, shares: 4, ig_reels_avg_watch_time: 6400 });
  } });
  await runMetrics(store, deps(n, secrets, T0 + H));
  const after = getPost(store, p.id);
  assert.deepEqual(after.metrics, { views: 1200, reach: 900, likes: 80, comments: 6, saves: 9, shares: 4, avgWatchSec: 6.4 });
  assert.equal(after.metricsNote, null);
  assert.equal(metricsHistory(store, [p.id]).get(p.id).length, 1);
});

test("Instagram: a Story is asked about before it goes, and too few viewers is a note, not an error", async () => {
  const { store, project, account, secrets } = await setup("instagram", IG);
  const p = posted(store, project, account, "s1", T0, { story: true }, "image");
  assert.deepEqual(metricsDue(store, T0 + 22 * H).map((x) => x.id), [p.id]);
  const n = net({ "GET graph.instagram.com/v27.0/s1/insights": ({ url }) => {
    assert.equal(url.searchParams.get("metric"), "views,reach,replies,shares");
    return Response.json({ error: { message: "(#10) Not enough viewers for the media to show insights", code: 10 } }, { status: 400 });
  } });
  await checkOne(store, p.id, deps(n, secrets, T0 + 22 * H));
  assert.match(getPost(store, p.id).metricsNote, /once 5 people have seen it/);
  store.db.prepare("update social_posts set metrics_at = ? where id = ?").run(new Date(T0 + 22 * H).toISOString(), p.id);
  assert.deepEqual(metricsDue(store, T0 + 3 * D), [], "a Story's numbers are gone after a day, so it is not asked again");
});

test("Instagram: a number Meta will not give for a post falls back to its likes and comments", async () => {
  const { store, project, account, secrets } = await setup("instagram", IG);
  const p = posted(store, project, account, "m2", T0, {}, "image");
  const n = net({
    "GET graph.instagram.com/v27.0/m2/insights": () => Response.json({ error: { message: "(#100) The Media Insights API does not support the views metric for this media", code: 100 } }, { status: 400 }),
    "GET graph.instagram.com/v27.0/m2": ({ url }) => { assert.equal(url.searchParams.get("fields"), "like_count,comments_count"); return { like_count: 12, comments_count: 3, id: "m2" }; },
  });
  await checkOne(store, p.id, deps(n, secrets, T0 + H));
  const after = getPost(store, p.id);
  assert.deepEqual(after.metrics, { likes: 12, comments: 3 });
  assert.match(after.metricsNote, /only its likes and comments/);
});

test("Threads: views, likes, replies as comments, reposts, quotes and shares", async () => {
  const { store, project, account, secrets } = await setup("threads", {
    "POST graph.threads.com/oauth/access_token": () => ({ access_token: "short", user_id: 5 }),
    "GET graph.threads.com/access_token": () => ({ access_token: "long", expires_in: 5184000 }),
    "GET graph.threads.com/v1.0/me": () => ({ id: "5", username: "knit" }),
  });
  const p = posted(store, project, account, "t1", T0, {}, "image");
  const n = net({ "GET graph.threads.com/v1.0/t1/insights": ({ url }) => { assert.equal(url.searchParams.get("metric"), "views,likes,replies,reposts,quotes,shares"); return metaData({ views: 300, likes: 20, replies: 4, reposts: 2, quotes: 1, shares: 0 }); } });
  await checkOne(store, p.id, deps(n, secrets, T0 + H));
  assert.deepEqual(getPost(store, p.id).metrics, { views: 300, likes: 20, comments: 4, reposts: 2, quotes: 1, shares: 0 });
});

const TT = {
  "POST open.tiktokapis.com/v2/oauth/token/": () => ({ access_token: "a", refresh_token: "r", expires_in: 86400, open_id: "o1", scope: "video.publish" }),
  "POST open.tiktokapis.com/v2/post/publish/creator_info/query/": () => ({ data: { creator_username: "knit", creator_nickname: "Knit" }, error: { code: "ok" } }),
};

test("TikTok: a private post has no numbers, said once in words; once public, its id and link are learned and it is counted", async () => {
  const { store, project, account, secrets } = await setup("tiktok", TT);
  const p = posted(store, project, account, "v_pub_file~v2-1.123", T0, { publishId: "v_pub_file~v2-1.123" });
  let pub = null;
  const n = net({
    "POST open.tiktokapis.com/v2/post/publish/status/fetch/": ({ body }) => { assert.equal(body.publish_id, "v_pub_file~v2-1.123"); return { data: { status: "PUBLISH_COMPLETE", ...(pub ? { publicaly_available_post_id: [pub] } : {}) }, error: { code: "ok" } }; },
    "POST open.tiktokapis.com/v2/video/query/": ({ url, body }) => {
      assert.equal(url.searchParams.get("fields"), "id,view_count,like_count,comment_count,share_count");
      assert.deepEqual(body, { filters: { video_ids: ["7300"] } });
      return { data: { videos: [{ id: "7300", view_count: 5000, like_count: 400, comment_count: 22, share_count: 31 }] }, error: { code: "ok" } };
    },
  });
  await checkOne(store, p.id, deps(n, secrets, T0 + H));
  assert.match(getPost(store, p.id).metricsNote, /only for a public video/);
  assert.equal(getPost(store, p.id).metrics, null);
  pub = 7300;
  await checkOne(store, p.id, deps(n, secrets, T0 + 6 * H));
  const after = getPost(store, p.id);
  assert.equal(after.externalId, "7300");
  assert.equal(after.url, "https://www.tiktok.com/@knit/video/7300");
  assert.deepEqual(after.metrics, { views: 5000, likes: 400, comments: 22, shares: 31 });
});

const XC = {
  "POST api.x.com/2/oauth2/token": () => ({ access_token: "xa", refresh_token: "xr", expires_in: 7200 }),
  "GET api.x.com/2/users/me": () => ({ data: { id: "42", username: "knit", name: "Knit" } }),
};

test("X: not asked until the person turns X numbers on, because X charges for each look; then its public counts", async () => {
  const { store, project, account, secrets } = await setup("x", XC);
  const p = posted(store, project, account, "1900", T0, {}, "image");
  const n = net({ "GET api.x.com/2/tweets": ({ url }) => {
    assert.equal(url.searchParams.get("ids"), "1900"); assert.equal(url.searchParams.get("tweet.fields"), "public_metrics");
    return { data: [{ id: "1900", public_metrics: { impression_count: 800, like_count: 30, reply_count: 2, retweet_count: 5, quote_count: 1, bookmark_count: 3 } }] };
  } });
  await runMetrics(store, deps(n, secrets, T0 + H));
  assert.equal(n.calls.length, 0, "nothing asked of X");
  assert.match(getPost(store, p.id).metricsNote, /X charges your developer account/);
  assert.deepEqual(metricsDue(store, T0 + 2 * D), [], "and the note is said once");
  await setSocialConfig(store, { metricsX: true }, { secrets });
  await runMetrics(store, deps(n, secrets, T0 + 2 * D));
  assert.deepEqual(getPost(store, p.id).metrics, { views: 800, likes: 30, comments: 2, reposts: 5, quotes: 1, saves: 3 });
  assert.equal(getPost(store, p.id).metricsNote, null);
});

const YT = {
  "POST oauth2.googleapis.com/token": () => ({ access_token: "ya", refresh_token: "yr", expires_in: 3599 }),
  "GET www.googleapis.com/youtube/v3/channels": () => ({ items: [{ id: "UC1", snippet: { title: "Knit", customUrl: "@knit" } }] }),
};

test("YouTube: counts from the start; from three days in, how long people watched; Analytics saying no leaves the counts", async () => {
  const { store, project, account, secrets } = await setup("youtube", YT);
  const p = posted(store, project, account, "vid1");
  let analytics = 0, refuse = false;
  const n = net({
    "GET www.googleapis.com/youtube/v3/videos": ({ url }) => { assert.equal(url.searchParams.get("part"), "statistics"); return { items: [{ id: "vid1", statistics: { viewCount: "2500", likeCount: "90", commentCount: "7", favoriteCount: "0" } }] }; },
    "GET youtubeanalytics.googleapis.com/v2/reports": ({ url }) => {
      analytics++;
      if (refuse) return Response.json({ error: { message: "Forbidden", errors: [{ reason: "forbidden" }] } }, { status: 403 });
      assert.equal(url.searchParams.get("ids"), "channel==MINE"); assert.equal(url.searchParams.get("filters"), "video==vid1");
      assert.equal(url.searchParams.get("startDate"), "2026-10-31");
      return { columnHeaders: [{ name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }, { name: "shares" }, { name: "subscribersGained" }], rows: [[310, 7, 12, 3]] };
    },
  });
  await checkOne(store, p.id, deps(n, secrets, T0 + H));
  assert.deepEqual(getPost(store, p.id).metrics, { views: 2500, likes: 90, comments: 7 });
  assert.equal(analytics, 0, "Analytics is days behind, so not asked yet");
  await checkOne(store, p.id, deps(n, secrets, T0 + 3 * D));
  assert.deepEqual(getPost(store, p.id).metrics, { views: 2500, likes: 90, comments: 7, minutesWatched: 310, avgWatchSec: 7, shares: 12, followers: 3 });
  refuse = true;
  await checkOne(store, p.id, deps(n, secrets, T0 + 7 * D));
  assert.deepEqual(getPost(store, p.id).metrics, { views: 2500, likes: 90, comments: 7 });
  assert.equal(getPost(store, p.id).metricsNote, null);
});

test("LinkedIn: no numbers for apps like this one, said once, and nothing asked of LinkedIn", async () => {
  const { store, project, account, secrets } = await setup("linkedin", {
    "POST www.linkedin.com/oauth/v2/accessToken": () => ({ access_token: "la", expires_in: 5184000 }),
    "GET api.linkedin.com/v2/userinfo": () => ({ sub: "abc", name: "Knit" }),
  });
  const p = posted(store, project, account, "urn:li:share:1", T0, {}, "image");
  const n = net({});
  await runMetrics(store, deps(n, secrets, T0 + H));
  assert.equal(n.calls.length, 0);
  assert.match(getPost(store, p.id).metricsNote, /approved for businesses/);
  assert.deepEqual(metricsDue(store, T0 + 7 * D), []);
});

test("a platform that fails keeps the last numbers and says why; it is asked again at its next time", async () => {
  const { store, project, account, secrets } = await setup("instagram", IG);
  const p = posted(store, project, account, "m1", T0, {}, "image");
  await checkOne(store, p.id, deps(net({ "GET graph.instagram.com/v27.0/m1/insights": () => metaData({ views: 10, likes: 1 }) }), secrets, T0 + H));
  await checkOne(store, p.id, deps(net({ "GET graph.instagram.com/v27.0/m1/insights": () => new Response("busy", { status: 503 }), "GET graph.instagram.com/v27.0/m1": () => new Response("busy", { status: 503 }) }), secrets, T0 + 6 * H));
  const after = getPost(store, p.id);
  assert.deepEqual(after.metrics, { views: 10, likes: 1 }, "the last numbers stay");
  assert.match(after.metricsNote, /503/);
  assert.deepEqual(metricsDue(store, T0 + D).map((x) => x.id), [p.id]);
});

test("Insights over real history: each post is compared at about a week in with its own account's usual", async () => {
  const { store, project, account, secrets } = await setup("instagram", IG);
  // Four videos and three pictures, each looked at a week in. Videos do about twice as well.
  const views = { video: [2000, 1800, 2200, 1900], image: [900, 1000, 800] };
  for (const [kind, list] of Object.entries(views)) {
    for (const [i, v] of list.entries()) {
      const at = T0 + i * D;
      const p = posted(store, project, account, `${kind}${i}`, at, {}, kind);
      await checkOne(store, p.id, deps(net({ [`GET graph.instagram.com/v27.0/${kind}${i}/insights`]: () => metaData({ views: v, likes: v / 20 }) }), secrets, at + 7 * D));
    }
  }
  const r = postInsights(store, {}, T0 + 20 * D);
  assert.equal(r.compared, 7);
  const what = r.findings.find((f) => f.factor === "What it was");
  assert.ok(what?.clear, JSON.stringify(r.findings));
  assert.equal(what.groups[0].label, "Videos");
  assert.match(what.text, /^Videos got 1\.\d times your usual views \(4 posts\); single pictures 0\.\d times \(3\)\.$/);
  assert.equal(r.platforms[0].platform, "instagram");
  assert.equal(r.platforms[0].posts, 7);
  void finishPost;
});
