// How posts did, and what the person's own posts say works: pure, for the studio's Insights
// page, its Posts tab and the person's model (post_insights).
//
// Platforms count differently and a post keeps growing for days, so a post is compared only
// with posts on the same account, at about the same age: its views about a week in, against
// the usual for that account ("lift"). A factor (videos or pictures, the time it went out)
// is said to matter only when each side has a few posts and the gap between them is clear.
// Even then it is what happened, not proof, and the page says so.

import type { Platform } from "./social-pure.ts";
import type { PostMetrics, SocialPost } from "./social.ts";

/** The numbers knitted keeps, in the order they are shown. Each platform gives some of them. */
export const METRICS: { key: string; label: string; one: string }[] = [
  { key: "views", label: "views", one: "view" },
  { key: "reach", label: "reached", one: "reached" },
  { key: "likes", label: "likes", one: "like" },
  { key: "comments", label: "comments", one: "comment" },
  { key: "shares", label: "shares", one: "share" },
  { key: "reposts", label: "reposts", one: "repost" },
  { key: "quotes", label: "quotes", one: "quote" },
  { key: "saves", label: "saves", one: "save" },
  { key: "minutesWatched", label: "minutes watched", one: "minute watched" },
  { key: "avgWatchSec", label: "seconds watched on average", one: "second watched on average" },
  { key: "followers", label: "new followers", one: "new follower" },
];

/** What people did with a post, besides seeing it. */
export function interactions(m: PostMetrics | null | undefined): number {
  if (!m) return 0;
  return ["likes", "comments", "shares", "reposts", "quotes", "saves"].reduce((n, k) => n + (m[k] ?? 0), 0);
}

/** Of those who saw it, how many did something, from 0 to 1. Null when nothing says how many saw it. */
export function engagement(m: PostMetrics | null | undefined): number | null {
  const v = m?.views;
  return v ? interactions(m) / v : null;
}

const n = (v: number) => v.toLocaleString("en-US");
export const pct = (r: number) => `${r >= 0.1 ? Math.round(r * 100) : Math.round(r * 1000) / 10}%`;

/** A post's numbers in a line: "1,240 views · 87 likes · 12 comments · 7.9% engaged". */
export function metricsLine(m: PostMetrics | null | undefined): string {
  if (!m) return "";
  const parts = METRICS.filter((d) => m[d.key] != null && !["reach", "minutesWatched"].includes(d.key)).map((d) => {
    const v = m[d.key]!;
    return d.key === "avgWatchSec" ? `${Math.round(v * 10) / 10}s watched on average` : `${n(v)} ${v === 1 ? d.one : d.label}`;
  });
  const e = engagement(m);
  if (e != null) parts.push(`${pct(e)} engaged`);
  return parts.join(" · ");
}

// ── when to ask ──────────────────────────────────────────────────────────

const H = 3600_000, D = 24 * H;
/** How old a post is each time knitted asks how it is doing: often while it is new, then less. */
export const METRIC_AGES = [1 * H, 6 * H, 1 * D, 3 * D, 7 * D, 14 * D, 30 * D];
/** An Instagram Story's numbers go when the Story does, after a day. */
export const STORY_AGES = [1 * H, 6 * H, 22 * H];

/** When to ask next, as an epoch in ms, or null when knitted has stopped asking. */
export function nextMetricsCheck(postedAt: string, metricsAt: string | null, ages = METRIC_AGES): number | null {
  const posted = Date.parse(postedAt);
  const last = metricsAt ? Date.parse(metricsAt) : posted;
  for (const a of ages) if (posted + a > last) return posted + a;
  return null;
}

// ── what works ───────────────────────────────────────────────────────────

/** What is known about what a post was of, from its knits. */
export interface PostShape {
  kind: "video" | "pictures" | "picture" | "words";
  durationMs: number | null;
  sound: boolean;
  patternName: string | null;
}

export interface Snapshot { at: string; metrics: PostMetrics }

export interface PostResult {
  id: string; projectId: string; platform: Platform; accountId: string | null;
  caption: string; title: string; url: string | null; postedAt: string; by: "human" | "model";
  metrics: PostMetrics | null; metricsAt: string | null; note: string | null;
  views: number | null; interactions: number; engagement: number | null;
  /** Its views about a week in, against the usual for its account then. Null until it can be compared. */
  lift: number | null;
  /** Why it is not compared yet, if it is not. */
  waiting: string | null;
  shape: PostShape;
}

export interface Finding {
  factor: string;
  /** In words, best first: "Videos got 1.8 times your usual views (6 posts); pictures 0.7 times (4)." */
  text: string;
  clear: boolean;
  groups: { label: string; posts: number; lift: number }[];
}

export interface PlatformSummary {
  platform: Platform; posts: number; measured: number; views: number; interactions: number;
  medianViews: number | null; medianEngagement: number | null;
}

export interface Insights {
  platforms: PlatformSummary[];
  posts: PostResult[];
  findings: Finding[];
  /** How many posts can be compared, and how many it takes before anything is said. */
  compared: number;
  needed: number;
  note: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The snapshot to compare a post by: the one nearest a week in, from three days on. */
export function weekIn(postedAt: string, history: Snapshot[]): Snapshot | null {
  const posted = Date.parse(postedAt);
  let best: Snapshot | null = null, gap = Infinity;
  for (const s of history) {
    const age = Date.parse(s.at) - posted;
    if (age < 3 * D || s.metrics.views == null) continue;
    const g = Math.abs(age - 7 * D);
    if (g < gap) { best = s; gap = g; }
  }
  return best;
}

/** At least this many posts on an account before one is compared with its usual. */
export const PER_ACCOUNT = 3;
/** At least this many posts on each side of a factor before it is said to matter. */
export const PER_GROUP = 3;
/** How far apart two sides have to be to be called a difference. */
export const CLEAR = 1.25;

const times = (l: number) => (l >= 0.95 && l <= 1.05 ? "about your usual views" : `${Math.round(l * 10) / 10} times your usual views`);

const hour = (iso: string) => new Date(iso).getHours();
const partOfDay = (iso: string) => { const h = hour(iso); return h >= 5 && h < 11 ? "Posts in the morning" : h < 14 && h >= 11 ? "Posts around midday" : h >= 14 && h < 17 ? "Posts in the afternoon" : h >= 17 && h < 22 ? "Posts in the evening" : "Posts at night"; };
const tags = (c: string) => (c.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;

/** The factors looked at, each sorting a post into a side, or leaving it out. */
const FACTORS: { factor: string; side: (p: PostResult) => string | null }[] = [
  { factor: "What it was", side: (p) => ({ video: "Videos", pictures: "Carousels", picture: "Single pictures", words: "Words alone" })[p.shape.kind] },
  { factor: "Video length", side: (p) => { const d = p.shape.durationMs; if (p.shape.kind !== "video" || !d) return null; return d < 15_000 ? "Videos under 15 seconds" : d < 30_000 ? "Videos of 15 to 30 seconds" : d < 60_000 ? "Videos of 30 to 60 seconds" : "Videos over a minute"; } },
  { factor: "Sound", side: (p) => (p.shape.kind !== "video" ? null : p.shape.sound ? "Videos with sound" : "Silent videos") },
  { factor: "When it went out", side: (p) => partOfDay(p.postedAt) },
  { factor: "Caption length", side: (p) => { const l = [...p.caption].length; return l <= 80 ? "Short captions (80 characters or less)" : l <= 300 ? "Captions of 80 to 300 characters" : "Long captions (over 300)"; } },
  { factor: "Hashtags", side: (p) => { const t = tags(p.caption); return t === 0 ? "Posts with no hashtags" : t <= 3 ? "Posts with 1 to 3 hashtags" : "Posts with 4 or more hashtags"; } },
  { factor: "Pattern", side: (p) => (p.shape.patternName ? `Knits of ${p.shape.patternName}` : null) },
  { factor: "Who wrote it", side: (p) => (p.by === "model" ? "Posts your model wrote" : "Posts you wrote") },
];

function finding(factor: string, side: (p: PostResult) => string | null, posts: PostResult[]): Finding | null {
  const by = new Map<string, number[]>();
  for (const p of posts) {
    const s = p.lift == null ? null : side(p);
    if (!s) continue;
    by.set(s, [...(by.get(s) ?? []), p.lift!]);
  }
  const groups = [...by].filter(([, l]) => l.length >= PER_GROUP).map(([label, l]) => ({ label, posts: l.length, lift: median(l)! })).sort((a, b) => b.lift - a.lift);
  if (groups.length < 2) return null;
  const clear = groups[0].lift >= groups[groups.length - 1].lift * CLEAR;
  const name = (g: { label: string }, i: number) => (i ? g.label.charAt(0).toLowerCase() + g.label.slice(1) : g.label);
  const said = groups.map((g, i) => `${name(g, i)} ${i ? times(g.lift).replace(" your usual views", "") : `got ${times(g.lift)}`} (${g.posts}${i ? "" : " posts"})`);
  const names = groups.map(name);
  const text = clear ? `${said.join("; ")}.` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} did about as well as each other.`;
  return { factor, text, clear, groups };
}

/**
 * Everything the Insights page shows. `history` is each post's snapshots, oldest first;
 * `shape` what each was of. Only posts that went out are looked at.
 */
export function insights(all: SocialPost[], history: Map<string, Snapshot[]>, shape: (p: SocialPost) => PostShape, now = Date.now()): Insights {
  const posted = all.filter((p) => p.status === "posted" && p.postedAt);
  const results: PostResult[] = posted.map((p) => {
    const m = p.metrics;
    return {
      id: p.id, projectId: p.projectId, platform: p.platform, accountId: p.accountId, caption: p.caption, title: p.title, url: p.url, postedAt: p.postedAt!, by: p.by,
      metrics: m, metricsAt: p.metricsAt, note: p.metricsNote ?? null,
      views: m?.views ?? null, interactions: interactions(m), engagement: engagement(m), lift: null, waiting: null, shape: shape(p),
    };
  });
  // Each post's views a week in, then each account's usual.
  const week = new Map<string, number>();
  for (const r of results) {
    const s = weekIn(r.postedAt, history.get(r.id) ?? []);
    if (s) week.set(r.id, s.metrics.views!);
    else r.waiting = !r.metrics ? (r.note ? "No numbers." : "No numbers yet.") : now - Date.parse(r.postedAt) < 3 * D ? "Too new to compare: it is compared from three days in." : "Not compared: knitted had no numbers for it from three days in.";
  }
  const usual = new Map<string, number>();
  const byAccount = new Map<string, number[]>();
  for (const r of results) if (week.has(r.id)) { const k = `${r.platform}:${r.accountId}`; byAccount.set(k, [...(byAccount.get(k) ?? []), week.get(r.id)!]); }
  for (const [k, v] of byAccount) if (v.length >= PER_ACCOUNT) usual.set(k, median(v)!);
  for (const r of results) {
    const u = usual.get(`${r.platform}:${r.accountId}`);
    if (!week.has(r.id)) continue;
    if (u == null) { r.waiting = `Compared once this account has ${PER_ACCOUNT} posts a week old.`; continue; }
    r.lift = u > 0 ? week.get(r.id)! / u : null;
  }
  const compared = results.filter((r) => r.lift != null);
  const findings = FACTORS.map((f) => finding(f.factor, f.side, compared)).filter((f): f is Finding => !!f).sort((a, b) => Number(b.clear) - Number(a.clear));
  const platforms: PlatformSummary[] = [...new Set(results.map((r) => r.platform))].map((platform) => {
    const mine = results.filter((r) => r.platform === platform), measured = mine.filter((r) => r.views != null);
    return {
      platform, posts: mine.length, measured: measured.length,
      views: measured.reduce((s, r) => s + (r.views ?? 0), 0), interactions: mine.reduce((s, r) => s + r.interactions, 0),
      medianViews: median(measured.map((r) => r.views!)), medianEngagement: median(mine.map((r) => r.engagement).filter((e): e is number => e != null)),
    };
  }).sort((a, b) => b.posts - a.posts);
  const needed = PER_ACCOUNT + PER_GROUP;
  const note = !results.length ? "Nothing has been posted yet."
    : !compared.length ? `Comparisons start once an account has ${PER_ACCOUNT} posts at least three days old. Until then, here is how each did.`
    : findings.length ? "What happened with your posts, not proof: a few posts can be lucky. Each post is compared with the usual for its own account, about a week in."
    : `Nothing stands out yet. Something is said once there are ${PER_GROUP} or more compared posts on each side.`;
  results.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  return { platforms, posts: results, findings, compared: compared.length, needed, note };
}
