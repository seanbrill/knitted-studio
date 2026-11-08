// Comments: a note pinned to a spot on a knit, at a moment in a video, or on a frame of a design
// sheet, so the person can say "this, here" and their model can change that very part. A
// comment is a thread: the first note has the pin, the replies follow it, by the person or the
// model, until one of them resolves it.

import { getDesign } from "./designs.ts";
import { newId } from "./ids.ts";
import { getKnit } from "./knits.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import type { CommentAuthor, CommentReply, CommentThread } from "./types.ts";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const now = () => new Date().toISOString();
const MAX_TEXT = 4000;

const said = (text: string) => {
  const t = String(text ?? "").trim();
  if (!t) throw new ValidationError("Write the comment first.");
  if (t.length > MAX_TEXT) throw new ValidationError(`A comment can be ${MAX_TEXT} characters at most.`);
  return t;
};
const fraction = (v: unknown, what: string) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new ValidationError(`${what} is a fraction from 0 to 1, of the way across or down.`);
  return Math.round(v * 10000) / 10000;
};

const reply = (r: Row): CommentReply => ({ id: r.id as string, text: r.body as string, author: r.author as CommentAuthor, createdAt: r.created_at as string, updatedAt: r.updated_at as string });

/** What a thread is on, by name: the knit's label, or the frame and its sheet. */
function onWhat(store: Store, r: Row): { label: string; frameName: string | null } {
  if (r.knit_id) { try { return { label: getKnit(store, r.knit_id as string).label, frameName: null }; } catch { return { label: "a knit", frameName: null }; } }
  try {
    const d = getDesign(store, r.design_id as string);
    const f = d.sections.flatMap((s) => s.frames).find((x) => x.id === r.frame_id);
    return { label: d.name, frameName: f?.name ?? null };
  } catch { return { label: "a design", frameName: null }; }
}

function threads(store: Store, rows: Row[]): CommentThread[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const replies = store.db.prepare(`select * from comments where parent_id in (${ids.map(() => "?").join(",")}) order by created_at, rowid`).all(...ids) as Row[];
  // Numbered on what it is on, oldest first, resolved ones too, so a number stays with its pin.
  const numbers = new Map<string, number>();
  for (const r of rows) {
    if (numbers.has(r.id as string)) continue;
    const on = r.knit_id ? ["knit_id", r.knit_id] : ["design_id", r.design_id];
    const all = store.db.prepare(`select id from comments where ${on[0]} = ? and parent_id is null order by created_at, rowid`).all(on[1] as string) as Row[];
    all.forEach((x, i) => numbers.set(x.id as string, i + 1));
  }
  return rows.map((r) => {
    const { label, frameName } = onWhat(store, r);
    return {
      id: r.id as string, n: numbers.get(r.id as string) ?? 0, projectId: r.project_id as string,
      knitId: (r.knit_id as string) ?? null, designId: (r.design_id as string) ?? null, frameId: (r.frame_id as string) ?? null,
      on: label, frameName,
      x: (r.x as number) ?? null, y: (r.y as number) ?? null, timeMs: (r.time_ms as number) ?? null,
      text: r.body as string, author: r.author as CommentAuthor, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
      resolvedAt: (r.resolved_at as string) ?? null,
      replies: replies.filter((x) => x.parent_id === r.id).map(reply),
    };
  });
}

export interface NewComment { knitId?: string; designId?: string; frameId?: string; x?: number; y?: number; timeMs?: number; text: string }

/** A new comment, pinned where it was put. On a design sheet it is on one frame, and a pin is within that frame. */
export function addComment(store: Store, c: NewComment, author: CommentAuthor = "human"): CommentThread {
  if (!!c.knitId === !!c.designId) throw new ValidationError("Say what the comment is on: a knit (knitId) or a design sheet (designId).");
  const text = said(c.text);
  const pinned = c.x != null || c.y != null;
  if (pinned && (c.x == null || c.y == null)) throw new ValidationError("A pin needs both x and y.");
  const x = pinned ? fraction(c.x, "x") : null, y = pinned ? fraction(c.y, "y") : null;
  let projectId: string, timeMs: number | null = null, frameId: string | null = null, label: string;
  if (c.knitId) {
    const k = getKnit(store, c.knitId);
    projectId = k.projectId; label = k.label;
    if (c.timeMs != null) {
      if (k.kind !== "video") throw new ValidationError("Only a video has moments: leave timeMs out for a picture.");
      if (typeof c.timeMs !== "number" || !Number.isFinite(c.timeMs) || c.timeMs < 0 || c.timeMs > (k.durationMs ?? 0) + 1) throw new ValidationError(`timeMs is a moment in the video, from 0 to ${k.durationMs ?? 0}.`);
      timeMs = Math.round(c.timeMs);
    }
    if (c.frameId) throw new ValidationError("A knit has no frames: frameId is for a design sheet.");
  } else {
    const d = getDesign(store, c.designId!);
    projectId = d.projectId; label = d.name;
    if (c.timeMs != null) throw new ValidationError("A design sheet has no moments: leave timeMs out.");
    if (c.frameId) {
      const f = d.sections.flatMap((s) => s.frames).find((x) => x.id === c.frameId);
      if (!f) throw new NotFoundError(`${d.name} has no frame ${c.frameId}. get_design lists its frames.`);
      frameId = f.id; label = `${f.name} in ${d.name}`;
    } else if (pinned) throw new ValidationError("A pin on a design sheet is on a frame: give its frameId.");
  }
  const id = newId("cm"), t = now();
  store.write(() => {
    store.db.prepare("insert into comments (id, project_id, knit_id, design_id, frame_id, x, y, time_ms, body, author, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, projectId, c.knitId ?? null, c.designId ?? null, frameId, x, y, timeMs, text, author, t, t);
    store.logRow(projectId, author, "comment.added", label, { commentId: id, knitId: c.knitId ?? null, designId: c.designId ?? null, frameId });
  });
  return getComment(store, id);
}

function row(store: Store, id: string): Row {
  const r = store.db.prepare("select * from comments where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That comment is not here any more.");
  return r;
}
const top = (store: Store, id: string) => { const r = row(store, id); return r.parent_id ? row(store, r.parent_id as string) : r; };

/** A thread, by its id or the id of a reply in it. */
export function getComment(store: Store, id: string): CommentThread {
  return threads(store, [top(store, id)])[0]!;
}

/** The threads on a knit, a design sheet (or one frame of it), or a whole project, oldest first. `open`: only those not resolved. */
export function listComments(store: Store, f: { knitId?: string; designId?: string; frameId?: string; projectId?: string; open?: boolean }): CommentThread[] {
  const where = ["parent_id is null"], args: string[] = [];
  if (f.knitId) { where.push("knit_id = ?"); args.push(f.knitId); }
  if (f.designId) { where.push("design_id = ?"); args.push(f.designId); }
  if (f.frameId) { where.push("frame_id = ?"); args.push(f.frameId); }
  if (f.projectId) { where.push("project_id = ?"); args.push(f.projectId); }
  if (args.length === 0) throw new ValidationError("Say whose comments: a knitId, a designId or a projectId.");
  if (f.open) where.push("resolved_at is null");
  return threads(store, store.db.prepare(`select * from comments where ${where.join(" and ")} order by created_at, rowid`).all(...args) as Row[]);
}

/** How many threads are open on each knit or design in a project: for a badge on its card. */
export function openCommentCounts(store: Store, projectId: string): Record<string, number> {
  const rows = store.db.prepare("select coalesce(knit_id, design_id) as on_id, count(*) as n from comments where project_id = ? and parent_id is null and resolved_at is null group by on_id").all(projectId) as Row[];
  return Object.fromEntries(rows.map((r) => [r.on_id as string, Number(r.n)]));
}

/** A reply in a thread. `resolve`: true resolves the thread with it, false opens it again. */
export function replyComment(store: Store, id: string, c: { text: string; resolve?: boolean }, author: CommentAuthor = "human"): CommentThread {
  const t0 = top(store, id);
  const text = said(c.text);
  const rid = newId("cm"), t = now();
  const { label } = onWhat(store, t0);
  store.write(() => {
    store.db.prepare("insert into comments (id, project_id, knit_id, design_id, frame_id, parent_id, body, author, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(rid, str(t0.project_id), str(t0.knit_id), str(t0.design_id), str(t0.frame_id), str(t0.id), text, author, t, t);
    if (c.resolve != null) store.db.prepare("update comments set resolved_at = ?, updated_at = ? where id = ?").run(c.resolve ? t : null, t, str(t0.id));
    else store.db.prepare("update comments set updated_at = ? where id = ?").run(t, str(t0.id));
    store.logRow(t0.project_id as string, author, c.resolve ? "comment.resolved" : "comment.replied", label, { commentId: t0.id });
  });
  return getComment(store, t0.id as string);
}

/** Resolve a thread, or open it again. */
export function resolveComment(store: Store, id: string, resolved: boolean, author: CommentAuthor = "human"): CommentThread {
  const t0 = top(store, id);
  const t = now();
  store.write(() => {
    store.db.prepare("update comments set resolved_at = ?, updated_at = ? where id = ?").run(resolved ? t : null, t, str(t0.id));
    if (resolved) store.logRow(t0.project_id as string, author, "comment.resolved", onWhat(store, t0).label, { commentId: t0.id });
  });
  return getComment(store, t0.id as string);
}

/** Change what a comment or a reply says. Only its author may: the person's words are not the model's to rewrite. */
export function editComment(store: Store, id: string, text: string, author: CommentAuthor = "human"): CommentThread {
  const r = row(store, id);
  if (r.author !== author) throw new ValidationError(author === "model" ? "That is the person's comment, so it is theirs to change. Reply instead." : "That is your model's reply. Reply to it instead.");
  const t = now();
  store.write(() => store.db.prepare("update comments set body = ?, updated_at = ? where id = ?").run(said(text), t, id));
  return getComment(store, id);
}

/** Delete a thread with its replies, or one reply. */
export function deleteComment(store: Store, id: string): void {
  row(store, id);
  store.write(() => store.db.prepare("delete from comments where id = ?").run(id));
}
