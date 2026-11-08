// How posts did: each post that went out is asked about a few times over its first month
// (core's METRIC_AGES: often while it is new, then less), while knitted is open, and when the
// person asks. A platform that gives no numbers (LinkedIn, to an app like this) says so once.
//
// X charges for every read, so its numbers are asked for only when the person has turned
// them on (Settings, Social). Nothing here posts, so a failure is only a note on the post:
// its last numbers stay, and it is asked again at its next time.

import { PLATFORMS, METRIC_AGES, STORY_AGES, nextMetricsCheck } from "@knitted/core";
import { getAccount, getPost, postedPosts, saveMetrics, setPostLink } from "@knitted/core/node";
import { ADAPTERS, freshTokens, socialConfig } from "./accounts.mjs";
import { SocialError, makeHttp } from "./http.mjs";

/** Posts are asked about up to this long after they went out. */
export const METRICS_FOR_MS = 31 * 24 * 3600_000;
/** At most this many posts asked about in one go, so a long-closed app does not flood a platform. */
export const METRICS_PER_RUN = 12;

const agesOf = (p) => (p.options.story ? STORY_AGES : METRIC_AGES);

/** Why a platform has no numbers for knitted, or null if it has. */
export function noMetrics(store, platform) {
  if (!ADAPTERS[platform]?.metrics) return ADAPTERS[platform]?.noMetrics ?? `${PLATFORMS[platform].name} gives no numbers to apps like knitted. See them on the post.`;
  if (platform === "x" && !socialConfig(store).metricsX) return "X charges your developer account for each look at a post's numbers, so knitted asks only when you turn X numbers on, in Settings, Social.";
  return null;
}

/** Ask one platform how one post is doing, and keep what it says. Returns the post. */
export async function checkOne(store, id, deps = {}) {
  const http = deps.http ?? makeHttp({ fetch: deps.fetch, wait: deps.wait });
  const p = getPost(store, id);
  if (p.status !== "posted") throw new SocialError("Only a post that went out has numbers.");
  const now = deps.now?.() ?? Date.now();
  const at = new Date(now).toISOString();
  const none = noMetrics(store, p.platform);
  if (none) { saveMetrics(store, id, null, none, at); return getPost(store, id); }
  if (!p.accountId) { saveMetrics(store, id, null, "Its account was disconnected, so knitted cannot ask how it is doing.", at); return getPost(store, id); }
  if (!p.externalId) { saveMetrics(store, id, null, `${PLATFORMS[p.platform].name} gave no id for it, so knitted cannot ask how it is doing.`, at); return getPost(store, id); }
  try {
    const account = getAccount(store, p.accountId);
    const tokens = await freshTokens(store, account.id, http, deps);
    const r = await ADAPTERS[p.platform].metrics(http, { tokens, account, post: p, now });
    if (r.externalId && r.externalId !== p.externalId) setPostLink(store, id, r.externalId, r.url ?? p.url);
    saveMetrics(store, id, r.metrics ?? null, r.note ?? null, at);
  } catch (e) {
    saveMetrics(store, id, null, e instanceof SocialError ? e.message : `knitted could not ask: ${e?.message ?? e}`, at);
  }
  return getPost(store, id);
}

/** Every post due a look now, oldest due first, up to METRICS_PER_RUN. */
export function metricsDue(store, now = Date.now()) {
  const since = new Date(now - METRICS_FOR_MS).toISOString();
  const due = [];
  for (const p of postedPosts(store, { since })) {
    if (!p.postedAt) continue;
    // A platform with no numbers is told once, not at every time.
    if (noMetrics(store, p.platform)) { if (!p.metricsNote) due.push({ p, at: 0 }); continue; }
    const next = nextMetricsCheck(p.postedAt, p.metricsAt, agesOf(p));
    if (next != null && next <= now) due.push({ p, at: next });
  }
  return due.sort((a, b) => a.at - b.at).slice(0, METRICS_PER_RUN).map((d) => d.p);
}

/** Look at every post due a look. Returns the posts it changed. */
export async function runMetrics(store, deps = {}) {
  const changed = [];
  for (const p of metricsDue(store, deps.now?.() ?? Date.now())) changed.push(await checkOne(store, p.id, deps));
  return changed;
}
