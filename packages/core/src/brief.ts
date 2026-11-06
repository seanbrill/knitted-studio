// The Brief: what a model knows about the business a project is for.
//
// A profile, in markdown: who they are, what they offer and to whom, how they talk, what
// they have said is true. The person's model builds it from their public website (crawl.ts
// reads the site; the agent's profile writer turns it into this), or the person writes it,
// or both, one after the other. Beside it, the reference: files on a shelf of the project's
// Yarn of their own, for a model to look at and read, not to knit with (yarn.ts).
//
// A model's change keeps the profile from before it, so Undo can put that back. A person's
// own saves do not: what they wrote last is what they meant.

import type { Actor, Brief, BriefSite, BriefSource } from "./types.ts";
import { ValidationError, type Store } from "./store.ts";

/** About twenty pages: more than a profile needs, and still little for a model to read. */
export const MAX_PROFILE = 60_000;
const MAX_NOTES = 10_000;

type Row = Record<string, unknown>;

function toBrief(projectId: string, r: Row | undefined): Brief {
  if (!r) return { projectId, profile: "", notes: "", source: {}, by: "human", builtAt: null, updatedAt: null, canUndo: false, site: {} };
  const json = <T,>(v: unknown): T => { try { return JSON.parse(v as string) as T; } catch { return {} as T; } };
  return {
    projectId, profile: r.profile as string, notes: r.notes as string, source: json<BriefSource>(r.source),
    by: r.by === "model" ? "model" : "human", builtAt: (r.built_at as string) ?? null, updatedAt: r.updated_at as string,
    canUndo: r.previous != null, site: json<BriefSite>(r.site),
  };
}

const row = (store: Store, projectId: string) => store.db.prepare("select * from briefs where project_id = ?").get(projectId) as Row | undefined;

/** A project's brief. One that was never written is empty. */
export function getBrief(store: Store, projectId: string): Brief {
  store.getProject(projectId);
  return toBrief(projectId, row(store, projectId));
}

function cleanProfile(raw: unknown): string {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (text.length > MAX_PROFILE) throw new ValidationError(`That profile is ${text.length.toLocaleString("en-US")} characters. Keep it under ${MAX_PROFILE.toLocaleString("en-US")}: what a model needs, not everything there is.`);
  return text;
}

function write(store: Store, projectId: string, set: { profile?: string; previous?: string | null; notes?: string; source?: BriefSource; by?: "human" | "model"; builtAt?: string; site?: BriefSite }) {
  const cur = row(store, projectId);
  const t = new Date().toISOString();
  const next = {
    profile: set.profile ?? (cur?.profile as string) ?? "",
    previous: set.previous !== undefined ? set.previous : ((cur?.previous as string) ?? null),
    notes: set.notes ?? (cur?.notes as string) ?? "",
    source: JSON.stringify(set.source ?? (cur ? JSON.parse(cur.source as string) : {})),
    by: set.by ?? (cur?.by as string) ?? "human",
    builtAt: set.builtAt ?? (cur?.built_at as string) ?? null,
    site: JSON.stringify(set.site ?? (cur ? JSON.parse(cur.site as string) : {})),
  };
  store.db.prepare(`insert into briefs (project_id, profile, previous, notes, source, by, built_at, site, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(project_id) do update set profile = excluded.profile, previous = excluded.previous, notes = excluded.notes, source = excluded.source, by = excluded.by, built_at = excluded.built_at, site = excluded.site, updated_at = excluded.updated_at`)
    .run(projectId, next.profile, next.previous, next.notes, next.source, next.by, next.builtAt, next.site, t);
  store.db.prepare("update projects set updated_at = ? where id = ?").run(t, projectId);
}

/** The person's own profile, or their edit of the one their model built. */
export function saveProfile(store: Store, projectId: string, profile: string): Brief {
  const cur = getBrief(store, projectId);
  const text = cleanProfile(profile);
  if (text === cur.profile) return cur;
  store.write(() => {
    write(store, projectId, { profile: text, by: "human", source: cur.source.kind ? cur.source : { kind: "written" } });
    store.logRow(projectId, "human", "brief.changed", "the profile", null);
  });
  return getBrief(store, projectId);
}

/**
 * A profile from a model: built from a website (`built`, with what it read in `source`), or a
 * model's change to it. Either way the one before is kept, for Undo.
 */
export function setProfile(store: Store, projectId: string, profile: string, o: { actor?: Actor; built?: boolean; source?: BriefSource } = {}): Brief {
  const cur = getBrief(store, projectId);
  const text = cleanProfile(profile);
  if (!text) throw new ValidationError("A profile needs something in it.");
  const actor = o.actor ?? "model";
  store.write(() => {
    write(store, projectId, {
      profile: text, previous: cur.profile, by: actor === "human" ? "human" : "model",
      source: o.source ?? (cur.source.kind ? cur.source : { kind: "written" }),
      ...(o.built ? { builtAt: new Date().toISOString() } : {}),
    });
    store.logRow(projectId, actor, o.built ? "brief.built" : "brief.changed", o.source?.url ?? "the profile", o.built ? { pages: o.source?.pages?.length ?? 0 } : null);
  });
  return getBrief(store, projectId);
}

/** Back to the profile from before the last build or model change. Once: Undo again changes nothing. */
export function undoProfile(store: Store, projectId: string): Brief {
  const r = row(store, projectId);
  store.getProject(projectId);
  if (r?.previous == null) throw new ValidationError("There is no profile from before to go back to.");
  store.write(() => {
    write(store, projectId, { profile: r.previous as string, previous: null, by: "human" });
    store.logRow(projectId, "human", "brief.changed", "the profile", { undo: true });
  });
  return getBrief(store, projectId);
}

/** What the person wants the builder to know: what to stress, what is out of date on the site. */
export function setBriefNotes(store: Store, projectId: string, notes: string): Brief {
  store.getProject(projectId);
  const text = String(notes ?? "").replace(/\r\n?/g, "\n").trim();
  if (text.length > MAX_NOTES) throw new ValidationError(`Keep notes for the builder under ${MAX_NOTES.toLocaleString("en-US")} characters.`);
  store.write(() => write(store, projectId, { notes: text }));
  return getBrief(store, projectId);
}

/** The business's website, and what a sync with it just did: the next sync starts from here. */
export function setBriefSite(store: Store, projectId: string, site: BriefSite): Brief {
  store.getProject(projectId);
  const url = site.url === undefined ? undefined : String(site.url).trim().slice(0, 2000);
  store.write(() => write(store, projectId, { site: { ...getBrief(store, projectId).site, ...site, ...(url !== undefined ? { url } : {}) } }));
  return getBrief(store, projectId);
}
