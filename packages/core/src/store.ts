// The store: the one place anything is read from or written to the library.
//
// The studio server, the MCP server and the render worker all open this same
// file, which is what makes "two equal front doors" true: a model's edit and a
// person's edit are the same operation on the same document, and each sees the
// other's work.
//
// Every write to a Pattern goes through `apply()`. That is where the lock rule
// is enforced (via commands.ts), where history is recorded, and where a stale
// write is detected. There is deliberately no `savePattern(whole)`: a whole-
// document overwrite is how one writer silently erases another.

import { rmSync } from "node:fs";
import type { ActivityAction, Actor, Motion, PartSlot, Pattern, Project, Refusal, Size, Stitch } from "./types.ts";
import { LIBRARY_ID, SIZES } from "./types.ts";
import { partFromEditor } from "./parts-pure.ts";
import { applyCommand, type Command } from "./commands.ts";
import { openDb, tx, type Db } from "./db.ts";
import { newId } from "./ids.ts";
import { blankPattern, socialStarterPack } from "./starters.ts";
import { paths as defaultPaths, type KnittedPaths } from "./paths.ts";
import { SWATCH_TEMPLATES, insertSwatch } from "./swatch.ts";
import { cleanFolder, fileInto } from "./folders.ts";
import { backfillKnitVersions } from "./knit-versions.ts";
import { compactDesignVersions } from "./designs.ts";

export class ValidationError extends Error { readonly kind = "validation"; }
export class NotFoundError extends Error { readonly kind = "not_found"; }
/** A write based on an out-of-date view. The caller refetches and rebases. */
export class ConflictError extends Error {
  readonly kind = "conflict";
  readonly currentVersion: number;
  constructor(message: string, currentVersion: number) { super(message); this.currentVersion = currentVersion; }
}

const now = () => new Date().toISOString();
const MAX_REVISIONS = 200;
const COALESCE_MS = 2000;

type Row = Record<string, unknown>;

function cleanName(raw: unknown, what = "name"): string {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new ValidationError(`Give it a ${what}.`);
  if (name.length > 120) throw new ValidationError(`That ${what} is too long. Keep it under 120 characters.`);
  return name;
}

export interface ProjectSummary extends Project {
  /** `newKnits`: knits nobody has opened yet. */
  counts: { patterns: number; yarn: number; knits: number; newKnits: number };
  /** The project's picture, for its card: its Yarn's id and hash. Null when none is set or the file is gone. */
  cover: { id: string; hash: string } | null;
}
export interface Activity { id: string; projectId: string | null; actor: string; action: string; subject: string | null; detail: unknown; createdAt: string; }
export interface Revision { id: string; patternId: string; author: Actor; label: string | null; createdAt: string; }
export interface ApplyResult { pattern: Pattern; inverse: Command | null; refusals: Refusal[]; changed: boolean; }
export interface Job { id: string; kind: string; status: string; projectId: string | null; input: unknown; progress: unknown; result: unknown; error: string | null; createdAt: string; updatedAt: string; finishedAt: string | null; }

// No constructor parameter properties: Node's type stripping (which runs the
// MCP server and the tests directly) supports only erasable syntax.
export class Store {
  readonly db: Db;
  readonly paths: KnittedPaths;
  constructor(db: Db, paths: KnittedPaths) { this.db = db; this.paths = paths; }

  // ── change counter ──────────────────────────────────────────────────────
  // Bumped inside the same transaction as every write. Other processes (and the
  // SSE stream) poll it to learn "something changed" without a message broker.
  rev(): number {
    return Number((this.db.prepare("select value from meta where key = 'rev'").get() as { value: string }).value);
  }
  private bump() { this.db.exec("update meta set value = cast(value as integer) + 1 where key = 'rev'"); }
  /** Run `fn` as one transaction that also bumps the change counter. */
  write<T>(fn: () => T): T { return tx(this.db, () => { const out = fn(); this.bump(); return out; }); }
  private has(table: string): boolean {
    return !!this.db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table);
  }

  // ── projects ────────────────────────────────────────────────────────────
  private toProject(r: Row): Project {
    return {
      id: r.id as string, name: r.name as string, description: r.description as string,
      swatchId: (r.swatch_id as string) ?? null, coverYarnId: (r.cover_yarn_id as string) ?? null,
      example: !!r.example, archivedAt: (r.archived_at as string) ?? null, deletedAt: (r.deleted_at as string) ?? null,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    };
  }

  private count(table: string, projectId: string, unseen = false): number {
    if (!this.has(table)) return 0;
    // A project's Yarn is what is on its Yarn shelf: the Brief's reference is counted apart.
    // A knit counts once, however many versions and formats it has.
    const live = table === "yarn" ? " and deleted_at is null and shelf = 'yarn'" : table === "knits" ? ` and head = 1${unseen ? " and seen_at is null" : ""}` : table === "patterns" ? " and part_id is null" : "";
    return Number((this.db.prepare(`select count(*) as n from ${table} where project_id = ?${live}`).get(projectId) as { n: number }).n);
  }

  listProjects(opts: { archived?: boolean; deleted?: boolean } = {}): ProjectSummary[] {
    // The Library holds what every project shares: it is not a project of its own to list.
    const where = `id != '${LIBRARY_ID}' and ` + (opts.deleted ? "deleted_at is not null" : `deleted_at is null and archived_at is ${opts.archived ? "not null" : "null"}`);
    const rows = this.db.prepare(`select * from projects where ${where} order by updated_at desc`).all() as Row[];
    return rows.map((r) => {
      const p = this.toProject(r);
      const cover = p.coverYarnId ? this.pictureYarn(p.id, p.coverYarnId) : undefined;
      return { ...p, counts: { patterns: this.count("patterns", p.id), yarn: this.count("yarn", p.id), knits: this.count("knits", p.id), newKnits: this.count("knits", p.id, true) }, cover: cover?.thumb ? { id: cover.id, hash: cover.hash } : null };
    });
  }

  /** A project's own live Yarn, or the Library's, as far as its picture needs it. A file that was deleted is not a picture. */
  private pictureYarn(projectId: string, yarnId: string): { id: string; hash: string; kind: string; thumb: boolean } | undefined {
    if (!this.has("yarn")) return undefined;
    const r = this.db.prepare(`select id, hash, kind, meta from yarn where id = ? and project_id in (?, '${LIBRARY_ID}') and deleted_at is null`).get(yarnId, projectId) as Row | undefined;
    return r && { id: r.id as string, hash: r.hash as string, kind: r.kind as string, thumb: !!(JSON.parse(r.meta as string) as { thumb?: string }).thumb };
  }

  getProject(id: string): Project {
    const r = this.db.prepare("select * from projects where id = ?").get(id) as Row | undefined;
    if (!r) throw new NotFoundError(`That project is not here. It may have been deleted.`);
    return this.toProject(r);
  }

  createProject(input: { name: string; description?: string; starter?: "blank" | "social"; example?: boolean; actor?: Actor }): Project {
    const name = cleanName(input.name);
    const id = newId("pj");
    const t = now();
    const starter = input.starter ?? "blank";
    this.write(() => {
      this.db.prepare("insert into projects (id, name, description, example, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
        .run(id, name, (input.description ?? "").slice(0, 2000), input.example ? 1 : 0, t, t);
      const patterns = starter === "social" ? socialStarterPack() : [blankPattern()];
      for (const sp of patterns) this.insertPattern(id, sp.name, sp.size, sp.stitches);
      // Every project starts with a Swatch, so patterns always have brand tokens to resolve.
      const sid = insertSwatch(this, id, SWATCH_TEMPLATES[input.example ? "knitted" : "starter"].data);
      this.db.prepare("update projects set swatch_id = ? where id = ?").run(sid, id);
      this.logRow(id, input.actor ?? "human", "project.created", name, { starter });
    });
    return this.getProject(id);
  }

  updateProject(id: string, patch: { name?: string; description?: string; swatchId?: string | null; coverYarnId?: string | null }, actor: Actor = "human"): Project {
    const cur = this.getProject(id);
    const next = {
      name: patch.name !== undefined ? cleanName(patch.name) : cur.name,
      description: patch.description !== undefined ? patch.description.slice(0, 2000) : cur.description,
      swatchId: patch.swatchId !== undefined ? patch.swatchId : cur.swatchId,
      coverYarnId: patch.coverYarnId !== undefined ? patch.coverYarnId : cur.coverYarnId,
    };
    if (patch.coverYarnId) {
      const y = this.pictureYarn(id, patch.coverYarnId);
      if (!y) throw new ValidationError("That picture is not in this project's Yarn. Add it there first.");
      if (!y.thumb || (y.kind !== "image" && y.kind !== "video")) throw new ValidationError("A project's picture is an image or a video from its Yarn.");
    }
    this.write(() => {
      this.db.prepare("update projects set name = ?, description = ?, swatch_id = ?, cover_yarn_id = ?, updated_at = ? where id = ?")
        .run(next.name, next.description, next.swatchId, next.coverYarnId, now(), id);
      if (next.name !== cur.name) this.logRow(id, actor, "project.renamed", next.name, { from: cur.name });
      if (next.coverYarnId !== cur.coverYarnId) this.logRow(id, actor, "project.picture", next.coverYarnId, { from: cur.coverYarnId });
    });
    return this.getProject(id);
  }

  duplicateProject(id: string, opts: { name?: string; actor?: Actor } = {}): Project {
    const src = this.getProject(id);
    const copyId = newId("pj");
    const t = now();
    this.write(() => {
      this.db.prepare("insert into projects (id, name, description, swatch_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
        .run(copyId, cleanName(opts.name ?? `${src.name} copy`), src.description, null, t, t);
      for (const p of this.listPatterns(id)) this.insertPattern(copyId, p.name, p.size, p.stitches, { html: p.html, css: p.css, durationMs: p.durationMs, motion: p.motion, folder: p.folder });
      // The brand comes along with the patterns that reference it.
      const rows = this.db.prepare("select data, folder from swatches where project_id = ? order by created_at, rowid").all(id) as { data: string; folder: string }[];
      const active = src.swatchId ? (this.db.prepare("select data from swatches where id = ?").get(src.swatchId) as { data: string } | undefined) : undefined;
      let first: string | null = null;
      for (const r of rows.length ? rows : [{ data: JSON.stringify(SWATCH_TEMPLATES.starter.data), folder: "" }]) {
        const nid = insertSwatch(this, copyId, { ...(JSON.parse(r.data) as typeof SWATCH_TEMPLATES.starter.data), logos: [] }, r.folder);
        if (!first || (active && r.data === active.data)) first = nid;
      }
      this.db.prepare("update projects set swatch_id = ? where id = ?").run(first, copyId);
      // And so do their folders, empty ones too. Yarn and knits stay with the first project.
      this.db.prepare("insert into folders (project_id, section, path, created_at) select ?, section, path, created_at from folders where project_id = ? and section in ('patterns', 'swatches')").run(copyId, id);
      // The brief is about the same business, so it comes too; its reference files are Yarn, and stay.
      this.db.prepare("insert into briefs (project_id, profile, notes, source, by, built_at, site, updated_at) select ?, profile, notes, source, by, built_at, json_remove(site, '$.swatchId', '$.pictures'), ? from briefs where project_id = ?").run(copyId, t, id);
      this.logRow(copyId, opts.actor ?? "human", "project.duplicated", src.name, { from: id });
    });
    return this.getProject(copyId);
  }

  archiveProject(id: string) { this.getProject(id); this.write(() => this.db.prepare("update projects set archived_at = ?, updated_at = ? where id = ?").run(now(), now(), id)); }
  restoreProject(id: string) { this.getProject(id); this.write(() => this.db.prepare("update projects set archived_at = null, updated_at = ? where id = ?").run(now(), id)); }

  /** Soft delete. Rows and files stay until purged, which is what makes Undo a real undo. */
  deleteProject(id: string, actor: Actor = "human") {
    const p = this.getProject(id);
    this.write(() => {
      this.db.prepare("update projects set deleted_at = ?, updated_at = ? where id = ?").run(now(), now(), id);
      this.logRow(id, actor, "project.deleted", p.name, null);
    });
  }
  undeleteProject(id: string) {
    this.getProject(id);
    this.write(() => this.db.prepare("update projects set deleted_at = null, updated_at = ? where id = ?").run(now(), id));
  }

  /** Permanently remove projects deleted before `olderThanMs` ago, files included. Returns how many. */
  purgeDeleted(olderThanMs = 24 * 3600_000): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const rows = this.db.prepare("select id from projects where deleted_at is not null and deleted_at <= ?").all(cutoff) as { id: string }[];
    for (const { id } of rows) {
      this.write(() => this.db.prepare("delete from projects where id = ?").run(id));
      rmSync(this.paths.projectDir(id), { recursive: true, force: true });
    }
    return rows.length;
  }

  // ── patterns ────────────────────────────────────────────────────────────
  private toPattern(r: Row): Pattern {
    const doc = JSON.parse(r.doc as string) as { stitches: Stitch[]; html?: string; css?: string; motion?: Motion };
    return {
      id: r.id as string, projectId: r.project_id as string, name: r.name as string, size: JSON.parse(r.size as string) as Size,
      durationMs: Number(r.duration_ms), stitches: doc.stitches, html: doc.html, css: doc.css, motion: doc.motion,
      version: Number(r.version), folder: (r.folder as string) ?? "", updatedAt: r.updated_at as string,
      ...(r.part_id ? { partId: r.part_id as string } : {}),
    };
  }
  private snapshot(p: Pattern): string {
    return JSON.stringify({ name: p.name, size: p.size, durationMs: p.durationMs, stitches: p.stitches, html: p.html, css: p.css, motion: p.motion });
  }

  private insertPattern(projectId: string, name: string, size: Size, stitches: Stitch[], extra: { html?: string; css?: string; durationMs?: number; motion?: Motion; folder?: string } = {}): string {
    const id = newId("pt");
    const t = now();
    this.db.prepare("insert into patterns (id, project_id, name, size, duration_ms, doc, version, folder, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .run(id, projectId, name, JSON.stringify(size), extra.durationMs ?? 0, JSON.stringify({ stitches, html: extra.html, css: extra.css, motion: extra.motion }), extra.folder ?? "", t, t);
    const p = this.getPattern(id);
    this.db.prepare("insert into pattern_revisions (id, pattern_id, snapshot, author, label, created_at) values (?, ?, ?, 'system', 'Created', ?)")
      .run(newId("rv"), id, this.snapshot(p), t);
    return id;
  }

  /** A project's Patterns. A Part open in the editor is not one of them. */
  listPatterns(projectId: string): Pattern[] {
    return (this.db.prepare("select * from patterns where project_id = ? and part_id is null order by created_at, rowid").all(projectId) as Row[]).map((r) => this.toPattern(r));
  }

  /**
   * The pattern a Part is edited through: the Part's stitches in a frame its shape, hidden
   * from Patterns. `base`: the Part's version now, so this sitting's changes make one version.
   */
  insertPartPattern(projectId: string, partId: string, base: number, name: string, size: Size, stitches: Stitch[]): Pattern {
    const id = this.write(() => {
      const pid = this.insertPattern(projectId, name, size, stitches);
      this.db.prepare("update patterns set part_id = ?, part_base = ? where id = ?").run(partId, base, pid);
      return pid;
    });
    return this.getPattern(id);
  }

  /** A change to a Part's pattern goes to the Part, as its next version. */
  private syncPart(p: Pattern) {
    const row = this.db.prepare("select builtin, kind, version from parts where id = ?").get(p.partId!) as Row | undefined;
    if (!row || row.builtin || row.kind !== "stitches") return;
    const base = (this.db.prepare("select part_base from patterns where id = ?").get(p.id) as Row | undefined)?.part_base;
    const next = partFromEditor(p.stitches, p.size);
    if (!next.stitches.length) return; // a Part keeps at least one stitch: the last one is not taken away
    this.db.prepare("update parts set name = ?, data = ?, slots = ?, aspect = ?, version = max(version, ?), updated_at = ? where id = ?")
      .run(p.name.slice(0, 80), JSON.stringify({ stitches: next.stitches }), JSON.stringify(next.slots), next.aspect, Number(base ?? row.version) + 1, now(), p.partId!);
  }

  /**
   * Each Part in a pattern, with the Part's slots as they are now: a slot locked in the Part
   * since it was added is locked in every pattern that uses it, before anyone accepts the update.
   */
  private withPartSlots(p: Pattern): Pattern {
    const ids = [...new Set(p.stitches.filter((s) => s.kind === "part" && s.partId).map((s) => s.partId!))];
    if (!ids.length) return p;
    const rows = this.db.prepare(`select id, slots from parts where id in (${ids.map(() => "?").join(",")})`).all(...ids) as Row[];
    const slots = new Map(rows.map((r) => [r.id as string, JSON.parse(r.slots as string) as PartSlot[]]));
    return { ...p, stitches: p.stitches.map((s) => (s.kind === "part" && slots.has(s.partId!) ? { ...s, partSlots: slots.get(s.partId!) } : s)) };
  }

  getPattern(id: string): Pattern {
    const r = this.db.prepare("select * from patterns where id = ?").get(id) as Row | undefined;
    if (!r) throw new NotFoundError("That pattern is not here. Open one from your project.");
    return this.toPattern(r);
  }

  /** `folder`: the folder in Patterns it goes in, made when it is not there. */
  createPattern(projectId: string, input: { name?: string; size?: Size; stitches?: Stitch[]; folder?: string; actor?: Actor }): Pattern {
    this.getProject(projectId);
    const name = cleanName(input.name ?? "Untitled pattern");
    cleanFolder(input.folder);
    const id = this.write(() => {
      const pid = this.insertPattern(projectId, name, input.size ?? SIZES[0], input.stitches ?? [], { folder: fileInto(this, projectId, "patterns", input.folder) });
      this.touchProject(projectId);
      this.logRow(projectId, input.actor ?? "human", "pattern.created", name, { patternId: pid });
      return pid;
    });
    return this.getPattern(id);
  }

  duplicatePattern(id: string, actor: Actor = "human"): Pattern {
    const p = this.getPattern(id);
    const newPid = this.write(() => {
      // The copy goes next to the original, in its folder.
      const pid = this.insertPattern(p.projectId, `${p.name} copy`, p.size, p.stitches, { html: p.html, css: p.css, durationMs: p.durationMs, folder: p.folder });
      this.touchProject(p.projectId);
      this.logRow(p.projectId, actor, "pattern.duplicated", p.name, { patternId: pid });
      return pid;
    });
    return this.getPattern(newPid);
  }

  deletePattern(id: string, actor: Actor = "human") {
    const p = this.getPattern(id);
    this.write(() => {
      this.db.prepare("delete from patterns where id = ?").run(id);
      this.touchProject(p.projectId);
      this.logRow(p.projectId, actor, "pattern.deleted", p.name, null);
    });
  }

  private touchProject(id: string) { this.db.prepare("update projects set updated_at = ? where id = ?").run(now(), id); }

  /**
   * The one write path for a Pattern.
   *
   * Runs in a transaction that takes the write lock first, so two processes
   * editing the same Pattern cannot interleave a read and a write. Refusals are
   * logged to the activity feed for anyone but the brand owner, because an
   * audit trail that omits what a model TRIED to do is not much of a trail.
   */
  apply(patternId: string, cmd: Command, actor: Actor, opts: { expectVersion?: number; label?: string; coalesce?: boolean } = {}): ApplyResult {
    return this.write(() => {
      const cur = this.withPartSlots(this.getPattern(patternId));
      if (opts.expectVersion !== undefined && opts.expectVersion !== cur.version) {
        throw new ConflictError("This pattern changed while you were editing it. Reload to see the latest.", cur.version);
      }
      const r = applyCommand(cur, cmd, actor);
      if (actor !== "human" && r.refusals.length) {
        this.logRow(cur.projectId, actor, "edit.refused", cur.name, { patternId, refusals: r.refusals });
      }
      if (!r.changed) return { pattern: cur, inverse: null, refusals: r.refusals, changed: false };

      const t = now();
      const next = r.pattern;
      this.db.prepare("update patterns set name = ?, size = ?, duration_ms = ?, doc = ?, version = version + 1, updated_at = ? where id = ?")
        .run(next.name, JSON.stringify(next.size), next.durationMs, JSON.stringify({ stitches: next.stitches, html: next.html, css: next.css, motion: next.motion }), t, patternId);
      const saved = this.getPattern(patternId);
      if (saved.partId) this.syncPart(saved);
      const label = opts.label ?? (cmd.type === "batch" ? "Edit" : cmd.type);

      const last = this.db.prepare("select id, author, label, created_at from pattern_revisions where pattern_id = ? order by created_at desc, rowid desc limit 1")
        .get(patternId) as { id: string; author: string; label: string | null; created_at: string } | undefined;
      const canMerge = opts.coalesce && actor === "human" && last && last.author === "human" && last.label === label
        && Date.now() - Date.parse(last.created_at) < COALESCE_MS;
      if (canMerge) {
        this.db.prepare("update pattern_revisions set snapshot = ?, created_at = ? where id = ?").run(this.snapshot(saved), t, last.id);
      } else {
        this.db.prepare("insert into pattern_revisions (id, pattern_id, snapshot, author, label, created_at) values (?, ?, ?, ?, ?, ?)")
          .run(newId("rv"), patternId, this.snapshot(saved), actor, label, t);
        this.db.prepare(`delete from pattern_revisions where pattern_id = ? and id not in
          (select id from pattern_revisions where pattern_id = ? order by created_at desc, rowid desc limit ${MAX_REVISIONS})`).run(patternId, patternId);
      }
      this.touchProject(cur.projectId);
      return { pattern: saved, inverse: r.inverse, refusals: r.refusals, changed: true };
    });
  }

  revisions(patternId: string, limit = 50): Revision[] {
    return (this.db.prepare("select id, pattern_id, author, label, created_at from pattern_revisions where pattern_id = ? order by created_at desc, rowid desc limit ?")
      .all(patternId, limit) as Row[]).map((r) => ({ id: r.id as string, patternId: r.pattern_id as string, author: r.author as Actor, label: (r.label as string) ?? null, createdAt: r.created_at as string }));
  }

  revisionSnapshot(revisionId: string): Pick<Pattern, "name" | "size" | "durationMs" | "stitches" | "html" | "css" | "motion"> {
    const r = this.db.prepare("select snapshot from pattern_revisions where id = ?").get(revisionId) as { snapshot: string } | undefined;
    if (!r) throw new NotFoundError("That revision is not here.");
    return JSON.parse(r.snapshot);
  }

  restoreRevision(patternId: string, revisionId: string, actor: Actor = "human"): Pattern {
    const snap = this.revisionSnapshot(revisionId);
    return this.write(() => {
      const cur = this.getPattern(patternId);
      this.db.prepare("update patterns set name = ?, size = ?, duration_ms = ?, doc = ?, version = version + 1, updated_at = ? where id = ?")
        .run(snap.name, JSON.stringify(snap.size), snap.durationMs, JSON.stringify({ stitches: snap.stitches, html: snap.html, css: snap.css, motion: snap.motion }), now(), patternId);
      const saved = this.getPattern(patternId);
      if (saved.partId) this.syncPart(saved);
      this.db.prepare("insert into pattern_revisions (id, pattern_id, snapshot, author, label, created_at) values (?, ?, ?, ?, 'Restored', ?)")
        .run(newId("rv"), patternId, this.snapshot(saved), actor, now());
      this.touchProject(cur.projectId);
      return saved;
    });
  }

  // ── activity ────────────────────────────────────────────────────────────
  /** Append to the activity log. Use INSIDE a transaction; `log()` opens its own. */
  logRow(projectId: string | null, actor: string, action: ActivityAction, subject: string | null, detail: unknown) {
    this.db.prepare("insert into activity (id, project_id, actor, action, subject, detail, created_at) values (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("ac"), projectId, actor, action, subject, detail === null || detail === undefined ? null : JSON.stringify(detail), now());
  }
  log(projectId: string | null, actor: Actor, action: ActivityAction, subject: string | null, detail?: unknown) {
    this.write(() => this.logRow(projectId, actor, action, subject, detail));
  }
  activity(projectId: string, limit = 30): Activity[] {
    return (this.db.prepare("select * from activity where project_id = ? order by created_at desc, rowid desc limit ?").all(projectId, limit) as Row[]).map((r) => ({
      id: r.id as string, projectId: r.project_id as string, actor: r.actor as string, action: r.action as string,
      subject: (r.subject as string) ?? null, detail: r.detail ? JSON.parse(r.detail as string) : null, createdAt: r.created_at as string,
    }));
  }

  // ── settings ────────────────────────────────────────────────────────────
  getSetting<T = unknown>(key: string, fallback: T): T {
    const r = this.db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : fallback;
  }
  setSetting(key: string, value: unknown) {
    this.write(() => this.db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, JSON.stringify(value)));
  }

  // ── jobs ────────────────────────────────────────────────────────────────
  private toJob(r: Row): Job {
    const j = (v: unknown) => (v ? JSON.parse(v as string) : null);
    return { id: r.id as string, kind: r.kind as string, status: r.status as string, projectId: (r.project_id as string) ?? null, input: j(r.input), progress: j(r.progress), result: j(r.result), error: (r.error as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string, finishedAt: (r.finished_at as string) ?? null };
  }
  createJob(kind: string, projectId: string | null, input: unknown): Job {
    const id = newId("jb"); const t = now();
    this.write(() => this.db.prepare("insert into jobs (id, kind, status, project_id, input, created_at, updated_at) values (?, ?, 'queued', ?, ?, ?, ?)").run(id, kind, projectId, JSON.stringify(input ?? null), t, t));
    return this.getJob(id);
  }
  getJob(id: string): Job {
    const r = this.db.prepare("select * from jobs where id = ?").get(id) as Row | undefined;
    if (!r) throw new NotFoundError("That job is not here.");
    return this.toJob(r);
  }
  updateJob(id: string, patch: { status?: string; progress?: unknown; result?: unknown; error?: string | null }): Job {
    const cur = this.getJob(id);
    const status = patch.status ?? cur.status;
    const done = ["done", "failed", "cancelled", "interrupted"].includes(status);
    this.write(() => this.db.prepare("update jobs set status = ?, progress = ?, result = ?, error = ?, updated_at = ?, finished_at = ? where id = ?").run(
      status, JSON.stringify(patch.progress !== undefined ? patch.progress : cur.progress), JSON.stringify(patch.result !== undefined ? patch.result : cur.result),
      patch.error !== undefined ? patch.error : cur.error, now(), done ? (cur.finishedAt ?? now()) : null, id));
    return this.getJob(id);
  }
  /** `active`: only what is running or waiting to start. */
  listJobs(opts: { projectId?: string; status?: string; kind?: string; active?: boolean; limit?: number } = {}): Job[] {
    const where: string[] = []; const args: (string | number)[] = [];
    if (opts.projectId) { where.push("project_id = ?"); args.push(opts.projectId); }
    if (opts.status) { where.push("status = ?"); args.push(opts.status); }
    if (opts.kind) { where.push("kind = ?"); args.push(opts.kind); }
    if (opts.active) where.push("status in ('running', 'queued')");
    return (this.db.prepare(`select * from jobs ${where.length ? "where " + where.join(" and ") : ""} order by created_at desc limit ?`).all(...args, opts.limit ?? 50) as Row[]).map((r) => this.toJob(r));
  }
  /** Jobs still marked running when a process starts were killed with it. */
  interruptStaleJobs(): number {
    const stale = this.db.prepare("select id from jobs where status in ('running')").all() as { id: string }[];
    for (const { id } of stale) this.updateJob(id, { status: "interrupted", error: "The app closed while this was running." });
    return stale.length;
  }

  /** Seed the example project once. Safe to call every start. */
  ensureExample(): Project | null {
    if (this.getSetting("seeded.example", false)) return null;
    const p = this.createProject({ name: "Example: launch week", description: "A small project to look around in. Delete it any time.", starter: "social", example: true, actor: "system" });
    this.setSetting("seeded.example", true);
    return p;
  }
}

// One Store per database file per process. Next's dev server reloads modules,
// so the cache lives on globalThis or every edit would leak a connection.
const g = globalThis as unknown as { __knittedStores?: Map<string, Store> };

export function getStore(p: KnittedPaths = defaultPaths()): Store {
  const stores = (g.__knittedStores ??= new Map());
  let s = stores.get(p.db);
  if (!s) {
    s = sorted(new Store(openDb(p.db), p));
    s.interruptStaleJobs();
    stores.set(p.db, s);
  }
  return s;
}

/**
 * Knits made before versions, given theirs, once. Should it fail, each file still shows as a knit
 * of its own. And design versions kept as whole copies, kept the lighter way, once.
 */
function sorted(store: Store): Store {
  try { backfillKnitVersions(store); } catch (e) { console.error(`Could not sort older knits into versions: ${(e as Error).message}`); }
  try { compactDesignVersions(store); } catch (e) { console.error(`Could not keep older design versions the lighter way: ${(e as Error).message}`); }
  return store;
}

export function openStore(file: string, p?: Partial<KnittedPaths>): Store {
  const base = defaultPaths({ KNITTED_HOME: file === ":memory:" ? undefined : file.replace(/[/\\][^/\\]+$/, "") });
  return sorted(new Store(openDb(file), { ...base, ...p }));
}
