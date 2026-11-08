// Posting, and the scheduler that does it at the time the person picked.
//
// The scheduler runs in the studio's server, so a post goes out while knitted is open. One
// due while it was closed goes out when it opens, if that is within two hours; later than
// that the moment has likely passed, so it waits as "missed" for the person to post or move.
// YouTube is the exception: a post scheduled ahead is uploaded at once, private, and YouTube
// publishes it at its time, knitted open or not.
//
// A post that fails for a passing reason (the network, the platform busy) before anything
// was sent is tried again, twice, a few minutes apart. One that fails after, when it may
// have gone out, is not: the person is told to look first, rather than post it twice.

import { PLATFORMS } from "@knitted/core";
import { claimPost, duePosts, finishPost, getAccount, getKnit, getPost, listAccounts, listPosts, postShape, recoverInterrupted, setAccountState, cancelPost } from "@knitted/core/node";
import { ADAPTERS, freshTokens, hostFor } from "./accounts.mjs";
import { SocialError, makeHttp } from "./http.mjs";
import { prepareMedia } from "./media.mjs";
import { runMetrics } from "./metrics.mjs";

export const GRACE_MS = 2 * 3600_000;
/** How far ahead a YouTube post must be for it to go up now and be published by YouTube. */
export const AHEAD_MS = 15 * 60_000;
const RETRIES = [2 * 60_000, 10 * 60_000];

/** Post it now: everything a platform needs, then the platform. `publishAt` for YouTube's own scheduling. */
export async function publishPost(store, post, deps = {}, extra = {}) {
  const http = deps.http ?? makeHttp({ fetch: deps.fetch, wait: deps.wait });
  if (!post.accountId) throw new SocialError("Its account was disconnected.");
  const account = getAccount(store, post.accountId);
  const adapter = ADAPTERS[post.platform];
  const knits = post.knitIds.map((id) => { try { return getKnit(store, id); } catch { throw new SocialError("A knit in this post was deleted before it went out. Knit it again, and make the post again."); } });
  const tokens = await freshTokens(store, account.id, http, deps);
  const { media, cleanup } = await prepareMedia(store, post.platform, knits, post.id);
  const hosted = [];
  let committed = false;
  try {
    if (PLATFORMS[post.platform].needsHost && media.length) {
      const host = await hostFor(store, deps);
      if (!host) throw new SocialError(`${PLATFORMS[post.platform].name} fetches what it posts from a public address, so it needs a media host: set one up in Settings, Social.`);
      for (const m of media) { const h = await host.put(m.path, m.mime); hosted.push(h); m.url = h.url; }
    }
    const c = { tokens, account, post: { caption: post.caption, title: post.title, options: post.options }, media, commit: () => { committed = true; } };
    return await adapter.publish(http, c, extra);
  } catch (e) {
    const err = e instanceof SocialError ? e : new SocialError(e?.message ?? String(e));
    err.committed = committed;
    throw err;
  } finally {
    for (const h of hosted) await h.remove().catch(() => {});
    await cleanup().catch(() => {});
  }
}

const when = (d) => new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** What to do with a failure: try again later, or stop and say why. */
function failed(store, p, e, now) {
  if (e.reconnect && p.accountId) { try { setAccountState(store, p.accountId, { status: "reconnect", note: e.message }); } catch { /* gone */ } }
  const again = RETRIES[p.attempts];
  if (e.retry && !e.committed && again !== undefined) {
    const at = new Date(now + again);
    return finishPost(store, p.id, { status: "scheduled", at: at.toISOString(), error: `${e.message} knitted tries again at ${when(at)}.` });
  }
  const name = PLATFORMS[p.platform].name;
  const unsure = e.committed && (e.retry || !e.status);
  return finishPost(store, p.id, { status: "failed", error: unsure ? `${e.message} It may have gone out anyway: look on ${name} before you post it again.` : e.message });
}

/** One post whose time has come: posted, or why not. */
async function postOne(store, p, deps, now) {
  const fresh = getPost(store, p.id);
  if (!claimPost(store, fresh.id, fresh.updatedAt)) return null;
  const taken = getPost(store, p.id);
  // What it was of, kept for Insights: its knits may be deleted later.
  const shape = postShape(store, taken);
  try {
    const r = await publishPost(store, taken, deps);
    return finishPost(store, p.id, { status: "posted", externalId: r.externalId ?? null, url: r.url ?? null, note: r.note ?? null, options: { shape, ...(r.options ?? {}) } });
  } catch (e) { return failed(store, taken, e, now); }
}

/** A YouTube post far enough ahead: up now, private, for YouTube to publish at its time. */
async function uploadAhead(store, p, deps, now) {
  const fresh = getPost(store, p.id);
  if (!claimPost(store, fresh.id, fresh.updatedAt)) return null;
  const taken = getPost(store, p.id);
  try {
    const r = await publishPost(store, taken, deps, { publishAt: new Date(taken.scheduledAt).toISOString() });
    return finishPost(store, p.id, { status: "scheduled", at: taken.scheduledAt, error: null, externalId: r.externalId, url: r.url, options: { uploaded: true, shape: postShape(store, taken) } });
  } catch (e) { return failed(store, taken, e, now); }
}

/** Everything due now. Returns the posts it changed. */
export async function runDue(store, deps = {}) {
  const now = deps.now?.() ?? Date.now();
  const changed = [];
  for (const p of listPosts(store, { status: ["scheduled"] })) {
    if (p.platform !== "youtube" || p.options.uploaded || (p.options.privacy ?? "public") !== "public") continue;
    if (Date.parse(p.scheduledAt) - now > AHEAD_MS) { const r = await uploadAhead(store, p, deps, now); if (r) changed.push(r); }
  }
  for (const p of duePosts(store, new Date(now))) {
    if (p.options.uploaded) { changed.push(finishPost(store, p.id, { status: "posted", externalId: p.externalId, url: p.url, note: "YouTube published it at its time." })); continue; }
    if (now - Date.parse(p.scheduledAt) > GRACE_MS) {
      changed.push(finishPost(store, p.id, { status: "missed", error: `It was due at ${when(p.scheduledAt)}, while knitted was closed. Post it now, or pick another time.` }));
      continue;
    }
    const r = await postOne(store, p, deps, now);
    if (r) changed.push(r);
  }
  return changed;
}

/** Sign-ins that last 60 days are renewed while knitted is open, so a quiet month does not lose them. */
export async function keepFresh(store, deps = {}) {
  const http = deps.http ?? makeHttp({ fetch: deps.fetch, wait: deps.wait });
  for (const a of listAccounts(store)) {
    if (a.status !== "ok" || !ADAPTERS[a.platform].refreshBefore) continue;
    try { await freshTokens(store, a.id, http, deps); } catch { /* the account says so itself */ }
  }
}

/** Cancel a post. One already on YouTube, waiting for its time, is taken off YouTube first. */
export async function cancelScheduled(store, id, deps = {}) {
  const p = getPost(store, id);
  if (p.platform === "youtube" && p.options.uploaded && p.externalId && p.status === "scheduled") {
    const http = deps.http ?? makeHttp({ fetch: deps.fetch });
    try { await ADAPTERS.youtube.remove(http, await freshTokens(store, p.accountId, http, deps), p.externalId); }
    catch (e) { throw new SocialError(`YouTube would not take it back: ${e.message} Delete it in YouTube Studio.`); }
  }
  return cancelPost(store, id);
}

const g = globalThis;
/** Start posting on time, once per server. Returns `{ kick }` to look again now (after Post now). */
export function startScheduler(store, deps = {}) {
  if (g.__knittedScheduler) return g.__knittedScheduler;
  recoverInterrupted(store);
  let running = null, again = false, lastFresh = 0, lastMetrics = 0;
  const tick = async () => {
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do { again = false; await runDue(store, deps); } while (again);
        if (Date.now() - lastFresh > 6 * 3600_000) { lastFresh = Date.now(); await keepFresh(store, deps); }
        // How posts are doing: after posting, which matters more, and not every tick.
        if (Date.now() - lastMetrics > (deps.metricsEvery ?? 5 * 60_000)) { lastMetrics = Date.now(); await runMetrics(store, deps); }
      } catch (e) { console.error("social scheduler:", e?.message ?? e); }
      finally { running = null; }
    })();
    return running;
  };
  const timer = setInterval(tick, deps.every ?? 20_000);
  timer.unref?.();
  setTimeout(tick, 1500).unref?.();
  g.__knittedScheduler = { kick: tick, stop: () => { clearInterval(timer); g.__knittedScheduler = null; } };
  return g.__knittedScheduler;
}
