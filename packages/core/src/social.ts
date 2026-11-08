// The person's accounts on social platforms, and the posts knitted makes to them.
//
// An account is a row here and its tokens are a secret (packages/social): the database is
// copied by every backup, and a token in it would be too. A post is of one or more knits,
// to one account, now, at a time, or kept as a draft; the studio's scheduler posts it.

import { newId } from "./ids.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import { getKnit } from "./knits.ts";
import { PLATFORM_IDS, checkPost, type Platform, type PostStatus } from "./social-pure.ts";
import { insights, type Insights, type PostShape } from "./social-insights.ts";

export interface SocialAccount {
  id: string; platform: Platform; externalId: string; name: string; handle: string; avatar: string | null;
  scopes: string[];
  /** "ok", or "reconnect" when the platform stopped taking its sign-in: `note` says why. */
  status: "ok" | "reconnect";
  note: string | null;
  /** When its sign-in runs out and cannot be renewed without the person (LinkedIn's 60 days). */
  expiresAt: string | null;
  connectedAt: string; updatedAt: string;
}

export interface PostMetrics { views?: number; likes?: number; comments?: number; shares?: number; saves?: number; reach?: number; [k: string]: number | undefined }

export interface SocialPost {
  id: string; projectId: string; accountId: string | null; platform: Platform;
  knitIds: string[]; caption: string; title: string;
  /** The platform's own choices: TikTok's privacy and toggles, YouTube's privacy, and what knitted kept while posting. */
  options: Record<string, unknown>;
  scheduledAt: string | null; status: PostStatus;
  externalId: string | null; url: string | null; error: string | null; attempts: number; postedAt: string | null;
  by: "human" | "model";
  metrics: PostMetrics | null; metricsAt: string | null;
  /** Why it has no numbers, or not all: the platform gives none, or the post is gone from it. */
  metricsNote: string | null;
  createdAt: string; updatedAt: string;
}

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const s = (v: unknown) => (v == null ? null : String(v));

const toAccount = (r: Row): SocialAccount => ({
  id: r.id as string, platform: r.platform as Platform, externalId: r.external_id as string, name: r.name as string, handle: r.handle as string,
  avatar: s(r.avatar), scopes: JSON.parse((r.scopes as string) ?? "[]"), status: r.status === "reconnect" ? "reconnect" : "ok", note: s(r.note),
  expiresAt: s(r.expires_at), connectedAt: r.connected_at as string, updatedAt: r.updated_at as string,
});
const toPost = (r: Row): SocialPost => ({
  id: r.id as string, projectId: r.project_id as string, accountId: s(r.account_id), platform: r.platform as Platform,
  knitIds: JSON.parse((r.knit_ids as string) ?? "[]"), caption: r.caption as string, title: r.title as string, options: JSON.parse((r.options as string) ?? "{}"),
  scheduledAt: s(r.scheduled_at), status: r.status as PostStatus, externalId: s(r.external_id), url: s(r.url), error: s(r.error), attempts: Number(r.attempts ?? 0),
  postedAt: s(r.posted_at), by: r.by === "model" ? "model" : "human", metrics: r.metrics ? JSON.parse(r.metrics as string) : null, metricsAt: s(r.metrics_at),
  metricsNote: s(r.metrics_note), createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});

// ── accounts ───────────────────────────────────────────────────────────────

export function listAccounts(store: Store): SocialAccount[] {
  return (store.db.prepare("select * from social_accounts order by platform, connected_at").all() as Row[]).map(toAccount);
}
export function getAccount(store: Store, id: string): SocialAccount {
  const r = store.db.prepare("select * from social_accounts where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That account is not connected any more. Connect it again in Settings, Social.");
  return toAccount(r);
}

/** Save an account the person signed in to. Signing in to one already here renews it, and keeps its posts. */
export function saveAccount(store: Store, a: Pick<SocialAccount, "platform" | "externalId" | "name" | "handle" | "avatar" | "scopes" | "expiresAt">): SocialAccount {
  const t = now();
  const had = store.db.prepare("select id from social_accounts where platform = ? and external_id = ?").get(a.platform, a.externalId) as { id: string } | undefined;
  const id = had?.id ?? newId("sa");
  store.write(() => {
    if (had) store.db.prepare("update social_accounts set name = ?, handle = ?, avatar = ?, scopes = ?, expires_at = ?, status = 'ok', note = null, updated_at = ? where id = ?")
      .run(a.name, a.handle, a.avatar, JSON.stringify(a.scopes), a.expiresAt, t, id);
    else store.db.prepare("insert into social_accounts (id, platform, external_id, name, handle, avatar, scopes, expires_at, connected_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, a.platform, a.externalId, a.name, a.handle, a.avatar, JSON.stringify(a.scopes), a.expiresAt, t, t);
  });
  return getAccount(store, id);
}

export function setAccountState(store: Store, id: string, change: { status?: "ok" | "reconnect"; note?: string | null; expiresAt?: string | null }) {
  const a = getAccount(store, id);
  store.write(() => store.db.prepare("update social_accounts set status = ?, note = ?, expires_at = ?, updated_at = ? where id = ?")
    .run(change.status ?? a.status, change.note === undefined ? a.note : change.note, change.expiresAt === undefined ? a.expiresAt : change.expiresAt, now(), id));
  return getAccount(store, id);
}

/** Forget an account. Its posted posts stay, with their links; any still to go are cancelled, saying why. */
export function removeAccount(store: Store, id: string) {
  getAccount(store, id);
  store.write(() => {
    store.db.prepare("update social_posts set status = 'cancelled', error = 'The account was disconnected before this went out.', updated_at = ? where account_id = ? and status in ('scheduled', 'draft', 'missed', 'failed')").run(now(), id);
    store.db.prepare("delete from social_accounts where id = ?").run(id);
  });
}

// ── posts ──────────────────────────────────────────────────────────────────

export interface NewPost {
  projectId: string; accountId: string; knitIds: string[]; caption: string; title?: string;
  options?: Record<string, unknown>;
  /** ISO time. Null: now, unless it is a draft. */
  at?: string | null;
  draft?: boolean;
  by?: "human" | "model";
}

/** The knits a post is of, as the checks see them. A knit that is gone is a problem, not a crash. */
function mediaOf(store: Store, projectId: string, knitIds: string[]) {
  return knitIds.map((id) => {
    let k;
    try { k = getKnit(store, id); } catch { throw new ValidationError(`The knit ${id} is not here any more. Pick another.`); }
    if (k.projectId !== projectId) throw new ValidationError(`The knit ${k.label} is in another project.`);
    return { kind: k.kind, width: k.width, height: k.height, durationMs: k.durationMs };
  });
}

/** Refuses, in words, a post the platform would refuse. */
export function validatePost(store: Store, p: Pick<NewPost, "projectId" | "accountId" | "knitIds" | "caption" | "title" | "options">, scheduling = false): { account: SocialAccount; notes: string[] } {
  const account = getAccount(store, p.accountId);
  const media = mediaOf(store, p.projectId, p.knitIds);
  const c = checkPost(account.platform, media, p.caption, p.title ?? "");
  // TikTok's rule: the person picks who sees each post; nothing is picked for them.
  if (scheduling && account.platform === "tiktok" && !p.options?.privacy) c.problems.push("Pick who can see it on TikTok.");
  if (c.problems.length) throw new ValidationError(c.problems.join(" "));
  return { account, notes: c.notes };
}

/** A time a minute or two ago is "now"; one long gone is a mistake to say, not a post to send late. */
function notPast(at: Date) {
  if (at.getTime() < Date.now() - 5 * 60_000) throw new ValidationError("That time has passed. Pick one ahead, or post it now.");
}

export function createPost(store: Store, p: NewPost): SocialPost {
  store.getProject(p.projectId);
  const { account } = validatePost(store, p, !p.draft);
  const at = p.at ? new Date(p.at) : null;
  if (at && Number.isNaN(at.getTime())) throw new ValidationError("That time is not one knitted can read. Give it as 2026-11-20T09:00:00-05:00.");
  if (at && !p.draft) notPast(at);
  const t = now(), id = newId("sp");
  const status: PostStatus = p.draft ? "draft" : "scheduled";
  const when = at ? at.toISOString() : p.draft ? null : t;
  store.write(() => store.db.prepare("insert into social_posts (id, project_id, account_id, platform, knit_ids, caption, title, options, scheduled_at, status, by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, p.projectId, account.id, account.platform, JSON.stringify(p.knitIds), p.caption, p.title ?? "", JSON.stringify(p.options ?? {}), when, status, p.by ?? "human", t, t));
  return getPost(store, id);
}

export function getPost(store: Store, id: string): SocialPost {
  const r = store.db.prepare("select * from social_posts where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That post is not here any more.");
  return toPost(r);
}

export function listPosts(store: Store, f: { projectId?: string; status?: PostStatus[]; limit?: number } = {}): SocialPost[] {
  const where: string[] = [], args: (string | number)[] = [];
  if (f.projectId) { where.push("project_id = ?"); args.push(f.projectId); }
  if (f.status?.length) { where.push(`status in (${f.status.map(() => "?").join(", ")})`); args.push(...f.status); }
  const sql = `select * from social_posts ${where.length ? `where ${where.join(" and ")}` : ""} order by coalesce(scheduled_at, created_at) desc, rowid desc limit ?`;
  return (store.db.prepare(sql).all(...args, f.limit ?? 500) as Row[]).map(toPost);
}

/** What a post still to go out may have changed: its words, its time, its choices, or whether it is a draft. */
export interface PostChange { caption?: string; title?: string; options?: Record<string, unknown>; at?: string | null; draft?: boolean; knitIds?: string[] }

export function updatePost(store: Store, id: string, change: PostChange): SocialPost {
  const p = getPost(store, id);
  if (!["draft", "scheduled", "failed", "missed", "cancelled"].includes(p.status)) throw new ValidationError(p.status === "posting" ? "It is being posted now." : "It has been posted. Change it on the platform.");
  if (p.status === "scheduled" && p.options.uploaded) throw new ValidationError("It is already on YouTube, waiting for its time. Cancel it to change it.");
  if (!p.accountId) throw new ValidationError("Its account was disconnected.");
  const next = { caption: change.caption ?? p.caption, title: change.title ?? p.title, knitIds: change.knitIds ?? p.knitIds };
  const options = { ...p.options, ...(change.options ?? {}) };
  const at = change.at === undefined ? p.scheduledAt : change.at;
  if (at && Number.isNaN(new Date(at).getTime())) throw new ValidationError("That time is not one knitted can read.");
  if (change.at && change.draft !== true) notPast(new Date(change.at));
  const status: PostStatus = change.draft === true ? "draft" : change.draft === false || change.at !== undefined ? "scheduled" : p.status;
  validatePost(store, { projectId: p.projectId, accountId: p.accountId, ...next, options }, status === "scheduled");
  const when = status === "scheduled" ? new Date(at ?? Date.now()).toISOString() : at ? new Date(at).toISOString() : null;
  // Sent again by the person: it gets its tries afresh.
  const again = status === "scheduled" && p.status !== "scheduled";
  store.write(() => store.db.prepare("update social_posts set caption = ?, title = ?, knit_ids = ?, options = ?, scheduled_at = ?, status = ?, error = case when ? = 'scheduled' then null else error end, attempts = case when ? then 0 else attempts end, updated_at = ? where id = ?")
    .run(next.caption, next.title, JSON.stringify(next.knitIds), JSON.stringify(options), when, status, status, again ? 1 : 0, now(), id));
  return getPost(store, id);
}

export function cancelPost(store: Store, id: string): SocialPost {
  const p = getPost(store, id);
  if (p.status === "posting") throw new ValidationError("It is being posted now, so it cannot be stopped.");
  if (p.status === "posted") throw new ValidationError("It has been posted. Delete it on the platform.");
  store.write(() => store.db.prepare("update social_posts set status = 'cancelled', updated_at = ? where id = ?").run(now(), id));
  return getPost(store, id);
}

export function deletePost(store: Store, id: string) {
  const p = getPost(store, id);
  if (p.status === "posting") throw new ValidationError("It is being posted now. Wait for it to finish.");
  store.write(() => store.db.prepare("delete from social_posts where id = ?").run(id));
}

// ── the scheduler's side ───────────────────────────────────────────────────

/** Scheduled posts whose time has come, oldest first. */
export function duePosts(store: Store, at = new Date()): SocialPost[] {
  return (store.db.prepare("select * from social_posts where status = 'scheduled' and scheduled_at <= ? order by scheduled_at, rowid").all(at.toISOString()) as Row[]).map(toPost);
}

/**
 * Take a post to post it, if nobody else has: one process, and one post, at a time. False:
 * it was cancelled, changed or taken meanwhile.
 */
export function claimPost(store: Store, id: string, updatedAt: string): boolean {
  return store.write(() => Number(store.db.prepare("update social_posts set status = 'posting', attempts = attempts + 1, updated_at = ? where id = ? and status = 'scheduled' and updated_at = ?").run(now(), id, updatedAt).changes) === 1);
}

export function finishPost(store: Store, id: string, r:
  | { status: "posted"; externalId: string | null; url: string | null; note?: string | null; options?: Record<string, unknown> }
  | { status: "failed" | "missed"; error: string; options?: Record<string, unknown> }
  | { status: "scheduled"; at: string; error?: string | null; externalId?: string | null; url?: string | null; options?: Record<string, unknown> }) {
  const p = getPost(store, id);
  const options = JSON.stringify({ ...p.options, ...(r.options ?? {}) });
  store.write(() => {
    if (r.status === "posted") store.db.prepare("update social_posts set status = 'posted', external_id = ?, url = ?, error = ?, posted_at = ?, options = ?, updated_at = ? where id = ?").run(r.externalId, r.url, r.note ?? null, now(), options, now(), id);
    else if (r.status === "scheduled") store.db.prepare("update social_posts set status = 'scheduled', scheduled_at = ?, error = ?, external_id = coalesce(?, external_id), url = coalesce(?, url), options = ?, updated_at = ? where id = ?").run(r.at, r.error ?? null, r.externalId ?? null, r.url ?? null, options, now(), id);
    else store.db.prepare("update social_posts set status = ?, error = ?, options = ?, updated_at = ? where id = ?").run(r.status, r.error, options, now(), id);
  });
  return getPost(store, id);
}

/**
 * Posts left "posting" when knitted stopped: nobody can say whether they went out, so each
 * says so, for the person to look, rather than be posted twice.
 */
export function recoverInterrupted(store: Store): number {
  return store.write(() => Number(store.db.prepare("update social_posts set status = 'failed', error = 'knitted was closed while this was being posted. Look on the platform before you post it again: it may be there.', updated_at = ? where status = 'posting'").run(now()).changes));
}

/**
 * What the platform counted for a post just now. Kept as its latest, and in its history.
 * With no numbers, only the note is kept (and the time, so it is not asked again at once).
 */
export function saveMetrics(store: Store, id: string, metrics: PostMetrics | null, note: string | null = null, at = now()) {
  const clean = metrics && Object.fromEntries(Object.entries(metrics).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
  store.write(() => {
    if (clean && Object.keys(clean).length) {
      store.db.prepare("update social_posts set metrics = ?, metrics_at = ?, metrics_note = ? where id = ?").run(JSON.stringify(clean), at, note, id);
      store.db.prepare("insert into social_metrics (post_id, at, metrics) values (?, ?, ?)").run(id, at, JSON.stringify(clean));
    } else store.db.prepare("update social_posts set metrics_at = ?, metrics_note = ? where id = ?").run(at, note, id);
  });
}

/** A post's id and link on its platform, learned after it went out (TikTok gives them once it is processed). */
export function setPostLink(store: Store, id: string, externalId: string, url: string | null) {
  store.write(() => store.db.prepare("update social_posts set external_id = ?, url = ?, updated_at = ? where id = ?").run(externalId, url, now(), id));
}

/** Each time a post's numbers were taken, oldest first. */
export function metricsHistory(store: Store, ids: string[]): Map<string, { at: string; metrics: PostMetrics }[]> {
  const out = new Map<string, { at: string; metrics: PostMetrics }[]>(ids.map((id) => [id, []]));
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const rows = store.db.prepare(`select post_id, at, metrics from social_metrics where post_id in (${part.map(() => "?").join(", ")}) order by at`).all(...part) as Row[];
    for (const r of rows) out.get(r.post_id as string)!.push({ at: r.at as string, metrics: JSON.parse(r.metrics as string) });
  }
  return out;
}

/** Every post that went out, in any project, newest first, for the Insights page. */
export function postedPosts(store: Store, f: { projectId?: string; since?: string } = {}): SocialPost[] {
  const where = ["status = 'posted'"], args: string[] = [];
  if (f.projectId) { where.push("project_id = ?"); args.push(f.projectId); }
  if (f.since) { where.push("posted_at >= ?"); args.push(f.since); }
  return (store.db.prepare(`select * from social_posts where ${where.join(" and ")} order by posted_at desc limit 2000`).all(...args) as Row[]).map(toPost);
}

/**
 * What a post was of. Kept on the post when it goes out (options.shape), as its knits may be
 * deleted later; read from the knits for a post from before that.
 */
export function postShape(store: Store, p: Pick<SocialPost, "knitIds" | "options">): PostShape {
  const kept = p.options.shape as PostShape | undefined;
  if (kept?.kind) return kept;
  if (!p.knitIds.length) return { kind: "words", durationMs: null, sound: false, patternName: null };
  let k = null;
  try { k = getKnit(store, p.knitIds[0]); } catch { /* deleted */ }
  return {
    kind: k?.kind === "video" ? "video" : p.knitIds.length > 1 ? "pictures" : "picture",
    durationMs: k?.durationMs ?? null, sound: Number.isFinite(k?.report?.lufs), patternName: k?.patternName ?? null,
  };
}

/** Everything the Insights page shows, for one project or all of them. */
export function postInsights(store: Store, f: { projectId?: string } = {}, now = Date.now()): Insights {
  const posts = postedPosts(store, f);
  return insights(posts, metricsHistory(store, posts.map((p) => p.id)), (p) => postShape(store, p), now);
}

export const isPlatform = (v: unknown): v is Platform => PLATFORM_IDS.includes(v as Platform);
