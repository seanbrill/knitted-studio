// A knit's versions and formats.
//
// A knit is one pattern at one size, and one row of a batch: what a person thinks of as "the
// Hook slide, in Post". Knitted again after a change, it has a new version. The same version
// made as another file type, or at 2x, is another format of that version, not another knit.
// Knits shows each knit once, as one file (its head), and keeps the rest a click away: the
// grid had filled with each slide five times over, and a video twice, at 1x and at 2x.
//
//   unit       which knit a file is: "pattern id|size name|w:h|row"
//   look       which version: a hash of all that changes the picture, but the type, scale and frame rate
//   chosen_at  when the person picked this file, or knitted it again
//   head       1 on the one file shown for the knit
//
// The current version is the one made or picked last. Its head is the file picked in it last,
// or else the first one made, so knitting a JPEG of it for a website does not change what posts.

import type { Store } from "./store.ts";
import { SIZES } from "./types.ts";

export interface VersionRow { id: string; look: string | null; createdAt: string; chosenAt: string | null }
export interface KnitVersion<T extends VersionRow> {
  /** 1 for the first made. */
  no: number; look: string;
  /** Its files, the one shown first. */
  files: T[];
  createdAt: string;
  /** When it was made or picked last: the latest is the current version. */
  rank: string;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** A shape in its lowest terms: 1080x1350 and 2160x2700 are both 4:5. */
export function aspectOf(w: number, h: number): string {
  const W = Math.round(w), H = Math.round(h), g = gcd(W, H) || 1;
  return `${W / g}:${H / g}`;
}

/** Which knit a file is. `row` counts from 1; null when it was not one of a batch's rows. */
export function unitKey(patternId: string | null, patternName: string, sizeName: string, w: number, h: number, row: number | null): string {
  return [patternId ?? `~${patternName}`, sizeName, aspectOf(w, h), row ?? ""].join("|");
}
/** What a unit says: the size's name and shape, and the row. */
export function readUnit(unit: string | null): { sizeName: string; aspect: string; row: number | null } | null {
  if (!unit) return null;
  const parts = unit.split("|");
  if (parts.length < 4) return null;
  const row = parts[parts.length - 1], aspect = parts[parts.length - 2], sizeName = parts[parts.length - 3];
  return { sizeName: sizeName ?? "", aspect: aspect ?? "", row: row ? Number(row) : null };
}

const later = (a: string, b: string) => (a > b ? a : b);

/** One knit's files, as its versions, oldest first, and which is current and shown. */
export function versionsOf<T extends VersionRow>(rows: T[]): { versions: KnitVersion<T>[]; current: KnitVersion<T>; head: T } {
  if (!rows.length) throw new Error("A knit has at least one file.");
  const byLook = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const key = r.look ?? r.id;
    const list = byLook.get(key);
    if (list) list.push(r); else byLook.set(key, [r]);
  }
  const versions = [...byLook].map(([look, files], i): KnitVersion<T> => {
    const picked = files.filter((f) => f.chosenAt).sort((a, b) => b.chosenAt!.localeCompare(a.chosenAt!))[0];
    const shown = picked ?? files[0]!;
    return { no: i + 1, look, files: [shown, ...files.filter((f) => f !== shown)], createdAt: files[0]!.createdAt, rank: files.reduce((m, f) => later(later(m, f.createdAt), f.chosenAt ?? ""), "") };
  });
  // On a tie, the later version.
  const current = versions.reduce((best, v) => (v.rank >= best.rank ? v : best));
  return { versions, current, head: current.files[0]! };
}

type Row = Record<string, unknown>;
const versionRow = (r: Row): VersionRow => ({ id: r.id as string, look: (r.look as string) ?? null, createdAt: r.created_at as string, chosenAt: (r.chosen_at as string) ?? null });

/** Mark the file shown for one knit. Inside the caller's write. */
export function settleHead(store: Store, projectId: string, unit: string | null): void {
  if (!unit) return;
  const rows = (store.db.prepare("select id, look, created_at, chosen_at from knits where project_id = ? and unit = ?").all(projectId, unit) as Row[]).map(versionRow);
  if (!rows.length) return;
  const { head } = versionsOf(rows);
  store.db.prepare("update knits set head = case when id = ? then 1 else 0 end where project_id = ? and unit = ?").run(head.id, projectId, unit);
}

/**
 * Which knit a file made before versions is, read from its label: the runner names each file
 * "pattern · size · #row headline". Null when the label is not one the runner wrote.
 */
export function legacyUnit(r: { patternId: string | null; patternName: string; label: string; width: number; height: number }): string {
  const rest = r.label.startsWith(r.patternName) ? r.label.slice(r.patternName.length) : null;
  if (rest === null || (rest && !rest.startsWith(" · "))) return unitKey(r.patternId, r.patternName, `?${r.label}`, r.width, r.height, null);
  const segs = rest ? rest.slice(3).split(" · ") : [];
  const at = segs.findIndex((s) => /^#\d+( |$)/.test(s));
  const sizeName = (at < 0 ? segs : segs.slice(0, at)).join(" · ");
  return unitKey(r.patternId, r.patternName, sizeName, r.width, r.height, at < 0 ? null : Number(segs[at]!.slice(1).split(" ")[0]));
}

/** A file's scale, from its size's name when that is a named size, or else against the smallest file of the same knit. */
export function legacyScale(sizeName: string, width: number, smallest: number): number {
  const named = SIZES.find((s) => s.name === sizeName);
  if (named && width === named.w * 2) return 2;
  if (named && width === named.w) return 1;
  return Math.min(4, Math.max(1, Math.round(width / Math.max(1, smallest))));
}

/**
 * Give the files made before versions their knit and version, once. Their version is read from
 * the pattern's history: files of a knit made with no save of the pattern between them are one
 * version, unless two of them are the same type and scale and differ (the swatch or a file
 * changed). Where the pattern is gone, each knit job is a version. Of a version's files, the
 * one made last is the one shown, as the person (or their model) had filed that one.
 */
export function backfillKnitVersions(store: Store): number {
  if (!store.db.prepare("select 1 from knits where unit is null limit 1").get()) return 0;
  return store.write(() => {
    const rows = store.db.prepare("select id, project_id, pattern_id, pattern_name, label, width, height, format, hash, job_id, created_at from knits where unit is null order by created_at, rowid").all() as Row[];
    if (!rows.length) return 0;
    const revs = store.db.prepare("select count(*) as n from pattern_revisions where pattern_id = ? and created_at <= ?");
    const alive = store.db.prepare("select 1 from patterns where id = ?");
    const units = new Map<string, Row[]>();
    for (const r of rows) {
      const unit = legacyUnit({ patternId: (r.pattern_id as string) ?? null, patternName: r.pattern_name as string, label: r.label as string, width: Number(r.width), height: Number(r.height) });
      const key = `${r.project_id}\u0000${unit}`;
      r.unit = unit;
      const list = units.get(key);
      if (list) list.push(r); else units.set(key, [r]);
    }
    const set = store.db.prepare("update knits set unit = ?, look = ?, scale = ?, chosen_at = ? where id = ?");
    for (const list of units.values()) {
      const smallest = Math.min(...list.map((r) => Number(r.width)));
      const sizeName = readUnit(list[0]!.unit as string)?.sizeName ?? "";
      // Each version so far, by what it was made from, with the hash of each type and scale in it.
      const open = new Map<string, { look: string; made: Map<string, string>; rows: Row[] }>();
      const all: { look: string; rows: Row[] }[] = [];
      for (const r of list) {
        const scale = legacyScale(sizeName, Number(r.width), smallest);
        const from = r.pattern_id && alive.get(r.pattern_id as string) ? `rev${(revs.get(r.pattern_id as string, r.created_at as string) as { n: number }).n}` : `job${(r.job_id as string) ?? (r.id as string)}`;
        const fmt = `${r.format}@${scale}`;
        let v = open.get(from);
        if (!v || (v.made.has(fmt) && v.made.get(fmt) !== r.hash)) {
          v = { look: `legacy:${from}:${all.length + 1}`, made: new Map(), rows: [] };
          open.set(from, v); all.push(v);
        }
        v.made.set(fmt, r.hash as string); v.rows.push(r);
        r.scale = scale; r.look = v.look;
      }
      for (const v of all) {
        const last = v.rows[v.rows.length - 1]!;
        for (const r of v.rows) set.run(r.unit as string, r.look as string, r.scale as number, r === last ? (r.created_at as string) : null, r.id as string);
      }
      settleHead(store, list[0]!.project_id as string, list[0]!.unit as string);
    }
    return rows.length;
  });
}
