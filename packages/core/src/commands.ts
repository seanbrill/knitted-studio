// Every change to a Pattern is a command.
//
// One mechanism serves four needs that are usually built four times: undo and
// redo (each command knows its inverse), autosave (a command is a small diff),
// a model's change set (a batch of commands tagged with an actor), and the lock
// rule (decided in exactly one place, below).
//
// This file is PURE: no I/O, no clock, no database, so the editor in the browser
// runs the very same code the server does and they cannot disagree.

import type { Actor, Clip, AudioClip, Motion, Pattern, Refusal, Size, Stitch } from "./types.ts";

export type Command =
  | { type: "addStitch"; stitch: Stitch; index?: number }
  | { type: "updateStitch"; id: string; patch: Partial<Omit<Stitch, "id">> }
  | { type: "removeStitch"; id: string }
  | { type: "reorder"; id: string; toIndex: number }
  | { type: "setSize"; size: Size }
  | { type: "fillSlot"; slot: string; content: string }
  | { type: "setLocked"; id: string; locked: boolean }
  | { type: "setMeta"; name?: string; durationMs?: number }
  | { type: "setMotion"; stitchId: string; clips: Clip[] }
  | { type: "setAudio"; audio: AudioClip[] }
  | { type: "batch"; commands: Command[]; atomic?: boolean };

export interface Applied {
  pattern: Pattern;
  /** Undoes exactly what was applied, or null if nothing changed. */
  inverse: Command | null;
  refusals: Refusal[];
  changed: boolean;
}

/** Actors that must respect locks. A human in Pattern mode is the brand owner and does not. */
const RESPECTS_LOCKS: ReadonlySet<Actor> = new Set<Actor>(["fill", "model", "import"]);

export function respectsLocks(actor: Actor): boolean {
  return RESPECTS_LOCKS.has(actor);
}

const UNLOCK_MSG = "locked by the pattern; unlock it in the studio first";

function describe(s: Stitch) {
  return { stitchId: s.id, slot: s.slot };
}

/**
 * Apply one command. Never mutates its input.
 *
 * A refused command changes nothing and says why. `batch` applies what it can
 * and reports the rest, unless `atomic`, in which case any refusal rolls the
 * whole batch back: a model that asked for four edits should not get two.
 */
export function applyCommand(pattern: Pattern, cmd: Command, actor: Actor): Applied {
  const refusals: Refusal[] = [];
  const none = (): Applied => ({ pattern, inverse: null, refusals, changed: false });
  const lockRule = respectsLocks(actor);
  const find = (id: string) => pattern.stitches.findIndex((s) => s.id === id);

  switch (cmd.type) {
    case "addStitch": {
      if (pattern.stitches.some((s) => s.id === cmd.stitch.id)) {
        refusals.push({ stitchId: cmd.stitch.id, why: "a stitch with that id already exists" });
        return none();
      }
      if (cmd.stitch.slot && pattern.stitches.some((s) => s.slot === cmd.stitch.slot)) {
        refusals.push({ ...describe(cmd.stitch), why: `slot "${cmd.stitch.slot}" is already used in this pattern` });
        return none();
      }
      const at = Math.min(Math.max(cmd.index ?? pattern.stitches.length, 0), pattern.stitches.length);
      const stitches = [...pattern.stitches];
      stitches.splice(at, 0, cmd.stitch);
      return { pattern: { ...pattern, stitches }, inverse: { type: "removeStitch", id: cmd.stitch.id }, refusals, changed: true };
    }

    case "updateStitch": {
      const i = find(cmd.id);
      if (i < 0) { refusals.push({ stitchId: cmd.id, why: "no such stitch" }); return none(); }
      const cur = pattern.stitches[i];
      if (cmd.patch.locked !== undefined && cmd.patch.locked !== cur.locked && lockRule) {
        refusals.push({ ...describe(cur), why: "only a person in the studio can lock or unlock a stitch" });
        return none();
      }
      if (cur.locked && lockRule) { refusals.push({ ...describe(cur), why: UNLOCK_MSG }); return none(); }
      if (cmd.patch.slot && cmd.patch.slot !== cur.slot && pattern.stitches.some((s) => s.slot === cmd.patch.slot)) {
        refusals.push({ ...describe(cur), why: `slot "${cmd.patch.slot}" is already used in this pattern` });
        return none();
      }
      const before: Record<string, unknown> = {};
      const patch = cmd.patch as Record<string, unknown>;
      let differs = false;
      for (const k of Object.keys(patch)) {
        before[k] = (cur as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(before[k]) !== JSON.stringify(patch[k])) differs = true;
      }
      if (!differs) return none();
      const stitches = [...pattern.stitches];
      // `undefined` in a patch means "this key did not exist", which is what an
      // inverse says about a field the stitch never had. Drop the key rather
      // than store undefined, so undo restores the exact original shape.
      const merged = { ...cur, ...cmd.patch } as Record<string, unknown>;
      for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
      stitches[i] = merged as unknown as Stitch;
      return {
        pattern: { ...pattern, stitches },
        inverse: { type: "updateStitch", id: cmd.id, patch: before as Partial<Omit<Stitch, "id">> },
        refusals,
        changed: true,
      };
    }

    case "removeStitch": {
      const i = find(cmd.id);
      if (i < 0) { refusals.push({ stitchId: cmd.id, why: "no such stitch" }); return none(); }
      const cur = pattern.stitches[i];
      if (cur.locked && lockRule) { refusals.push({ ...describe(cur), why: UNLOCK_MSG }); return none(); }
      const stitches = pattern.stitches.filter((_, k) => k !== i);
      // Removing a stitch removes its animation too, and undo must bring BOTH back.
      const track = pattern.motion?.tracks[cur.id];
      if (track?.length) {
        const { [cur.id]: _gone, ...rest } = pattern.motion!.tracks; void _gone;
        const motion: Motion = { ...pattern.motion!, tracks: rest };
        return { pattern: { ...pattern, stitches, motion }, inverse: { type: "batch", commands: [{ type: "addStitch", stitch: cur, index: i }, { type: "setMotion", stitchId: cur.id, clips: track }] }, refusals, changed: true };
      }
      return { pattern: { ...pattern, stitches }, inverse: { type: "addStitch", stitch: cur, index: i }, refusals, changed: true };
    }

    case "reorder": {
      const i = find(cmd.id);
      if (i < 0) { refusals.push({ stitchId: cmd.id, why: "no such stitch" }); return none(); }
      const cur = pattern.stitches[i];
      if (cur.locked && lockRule) { refusals.push({ ...describe(cur), why: UNLOCK_MSG }); return none(); }
      const to = Math.min(Math.max(cmd.toIndex, 0), pattern.stitches.length - 1);
      if (to === i) return none();
      const stitches = [...pattern.stitches];
      stitches.splice(i, 1);
      stitches.splice(to, 0, cur);
      return { pattern: { ...pattern, stitches }, inverse: { type: "reorder", id: cmd.id, toIndex: i }, refusals, changed: true };
    }

    case "setSize": {
      if (!(cmd.size.w > 0 && cmd.size.h > 0)) { refusals.push({ why: "a size needs a width and a height above zero" }); return none(); }
      if (pattern.size.w === cmd.size.w && pattern.size.h === cmd.size.h && pattern.size.name === cmd.size.name) return none();
      return { pattern: { ...pattern, size: cmd.size }, inverse: { type: "setSize", size: pattern.size }, refusals, changed: true };
    }

    // The model's main verb. Slots, not ids: a slot is what a Pattern PROMISES,
    // while an id is an implementation detail that changes when someone rebuilds
    // the layout, so a model writing to slots keeps working across a redesign.
    case "fillSlot": {
      // "instance.slot" addresses a slot INSIDE a Part instance. The Part's own lock
      // is honoured too, so a brand-locked quote block stays locked wherever it lands.
      if (cmd.slot.includes(".")) {
        const [inst, sub] = cmd.slot.split(".", 2);
        const pi = pattern.stitches.findIndex((s) => s.slot === inst && s.kind === "part");
        if (pi < 0) { refusals.push({ slot: cmd.slot, why: `no part called "${inst}" in this pattern` }); return none(); }
        const part = pattern.stitches[pi];
        const def = part.partSlots?.find((x) => x.name === sub);
        if (!def) { refusals.push({ slot: cmd.slot, stitchId: part.id, why: `"${inst}" has no slot called "${sub}"` }); return none(); }
        if ((part.locked || def.locked) && lockRule) { refusals.push({ slot: cmd.slot, stitchId: part.id, why: UNLOCK_MSG }); return none(); }
        const content = String(cmd.content);
        if ((part.overrides ?? {})[sub] === content) return none();
        const stitches = [...pattern.stitches];
        stitches[pi] = { ...part, overrides: { ...(part.overrides ?? {}), [sub]: content } };
        return { pattern: { ...pattern, stitches }, inverse: { type: "updateStitch", id: part.id, patch: { overrides: part.overrides } }, refusals, changed: true };
      }
      const i = pattern.stitches.findIndex((s) => s.slot === cmd.slot);
      if (i < 0) { refusals.push({ slot: cmd.slot, why: "no stitch with that slot" }); return none(); }
      const cur = pattern.stitches[i];
      if (cur.locked && lockRule) { refusals.push({ ...describe(cur), why: UNLOCK_MSG }); return none(); }
      if (cur.kind !== "text") { refusals.push({ ...describe(cur), why: `slot "${cmd.slot}" is a ${cur.kind} slot; fill it with Yarn, not text` }); return none(); }
      const content = String(cmd.content);
      if (cur.content === content) return none();
      const stitches = [...pattern.stitches];
      stitches[i] = { ...cur, content };
      return {
        pattern: { ...pattern, stitches },
        inverse: { type: "updateStitch", id: cur.id, patch: { content: cur.content } },
        refusals,
        changed: true,
      };
    }

    case "setLocked": {
      const i = find(cmd.id);
      if (i < 0) { refusals.push({ stitchId: cmd.id, why: "no such stitch" }); return none(); }
      const cur = pattern.stitches[i];
      if (lockRule) { refusals.push({ ...describe(cur), why: "only a person in the studio can lock or unlock a stitch" }); return none(); }
      if (cur.locked === cmd.locked) return none();
      const stitches = [...pattern.stitches];
      stitches[i] = { ...cur, locked: cmd.locked };
      return { pattern: { ...pattern, stitches }, inverse: { type: "setLocked", id: cmd.id, locked: cur.locked }, refusals, changed: true };
    }

    case "setMeta": {
      const next = { ...pattern };
      const inv: { type: "setMeta"; name?: string; durationMs?: number } = { type: "setMeta" };
      if (cmd.name !== undefined && cmd.name.trim() && cmd.name !== pattern.name) { inv.name = pattern.name; next.name = cmd.name.trim(); }
      if (cmd.durationMs !== undefined && cmd.durationMs >= 0 && cmd.durationMs !== pattern.durationMs) { inv.durationMs = pattern.durationMs; next.durationMs = Math.round(cmd.durationMs); }
      if (inv.name === undefined && inv.durationMs === undefined) return none();
      return { pattern: next, inverse: inv, refusals, changed: true };
    }

    case "setMotion": {
      const s = pattern.stitches.find((x) => x.id === cmd.stitchId);
      if (!s) { refusals.push({ stitchId: cmd.stitchId, why: "no such stitch" }); return none(); }
      if (s.locked && lockRule) { refusals.push({ ...describe(s), why: UNLOCK_MSG }); return none(); }
      const clips = cmd.clips.filter((k) => k.endMs > k.startMs).map((k) => ({ ...k, startMs: Math.max(0, Math.round(k.startMs)), endMs: Math.round(k.endMs) })).sort((a, b) => a.startMs - b.startMs);
      const before = pattern.motion?.tracks[s.id] ?? [];
      if (JSON.stringify(before) === JSON.stringify(clips)) return none();
      const tracks = { ...(pattern.motion?.tracks ?? {}) };
      if (clips.length) tracks[s.id] = clips; else delete tracks[s.id];
      return { pattern: { ...pattern, motion: { ...(pattern.motion ?? { tracks: {} }), tracks } }, inverse: { type: "setMotion", stitchId: s.id, clips: before }, refusals, changed: true };
    }

    case "setAudio": {
      if (lockRule && actor !== "model") { /* fill-mode users may place sound; nothing to protect */ }
      const audio = cmd.audio.map((a) => ({ ...a, startMs: Math.max(0, Math.round(a.startMs)) }));
      const before = pattern.motion?.audio ?? [];
      if (JSON.stringify(before) === JSON.stringify(audio)) return none();
      return { pattern: { ...pattern, motion: { ...(pattern.motion ?? { tracks: {} }), audio } }, inverse: { type: "setAudio", audio: before }, refusals, changed: true };
    }

    case "batch": {
      let cur = pattern;
      const inverses: Command[] = [];
      for (const c of cmd.commands) {
        const r = applyCommand(cur, c, actor);
        refusals.push(...r.refusals);
        if (r.changed && r.inverse) { cur = r.pattern; inverses.unshift(r.inverse); }
      }
      if (cmd.atomic && refusals.length) return { pattern, inverse: null, refusals, changed: false };
      if (!inverses.length) return { pattern, inverse: null, refusals, changed: false };
      return { pattern: cur, inverse: { type: "batch", commands: inverses }, refusals, changed: true };
    }
  }
}

/** Commands a given actor is allowed to even attempt through the model interface. */
export const MODEL_COMMANDS: Command["type"][] = ["addStitch", "updateStitch", "removeStitch", "reorder", "setSize", "fillSlot", "setMeta", "batch"];

// ── two writers on one pattern ───────────────────────────────────────────────
//
// A person and a model can edit the same pattern at once. When one's change lands under
// the other's, these say whether a change can be carried over without undoing the other:
// a command, and the difference between two versions, each reduced to what they touch,
// field by field ("whole" is what belongs to the pattern rather than a stitch).

/** What a command or a difference touches: stitch id to field names ("*" for all of it), and the pattern as a whole. */
export interface Touch { stitches: Map<string, Set<string>>; whole: boolean; }

const ALL = new Set(["*"]);
const mark = (t: Touch, id: string, fields: Iterable<string>) => {
  const cur = t.stitches.get(id);
  if (cur?.has("*")) return;
  const add = new Set(fields);
  t.stitches.set(id, add.has("*") ? ALL : new Set([...(cur ?? []), ...add]));
};

/** What `cmd` would change if it were applied to `p`. */
export function touches(p: Pattern, cmd: Command, t: Touch = { stitches: new Map(), whole: false }): Touch {
  switch (cmd.type) {
    case "addStitch": mark(t, cmd.stitch.id, ["*"]); break;
    case "removeStitch": mark(t, cmd.id, ["*"]); break;
    case "updateStitch": mark(t, cmd.id, Object.keys(cmd.patch)); break;
    case "setLocked": mark(t, cmd.id, ["locked"]); break;
    case "setMotion": mark(t, cmd.stitchId, ["motion"]); break;
    case "reorder": t.whole = true; break;
    case "setSize": case "setMeta": case "setAudio": t.whole = true; break;
    case "fillSlot": {
      const [inst, sub] = cmd.slot.split(".", 2);
      const s = p.stitches.find((x) => x.slot === (sub ? inst : cmd.slot));
      if (s) mark(t, s.id, [sub ? `overrides.${sub}` : "content"]);
      break;
    }
    case "batch": for (const c of cmd.commands) touches(p, c, t); break;
  }
  return t;
}

/** What differs between two versions of a pattern, in the same terms. */
export function changedBetween(a: Pattern, b: Pattern): Touch {
  const t: Touch = { stitches: new Map(), whole: false };
  const before = new Map(a.stitches.map((s) => [s.id, s]));
  const after = new Map(b.stitches.map((s) => [s.id, s]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(id), y = after.get(id);
    if (!x || !y) { mark(t, id, ["*"]); continue; }
    const fields = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => k !== "overrides" && JSON.stringify(x[k as keyof Stitch]) !== JSON.stringify(y[k as keyof Stitch]));
    for (const k of new Set([...Object.keys(x.overrides ?? {}), ...Object.keys(y.overrides ?? {})])) if (x.overrides?.[k] !== y.overrides?.[k]) fields.push(`overrides.${k}`);
    if (JSON.stringify(a.motion?.tracks?.[id] ?? []) !== JSON.stringify(b.motion?.tracks?.[id] ?? [])) fields.push("motion");
    if (fields.length) mark(t, id, fields);
  }
  const order = (p: Pattern) => p.stitches.map((s) => s.id).filter((id) => before.has(id) && after.has(id)).join();
  t.whole = JSON.stringify([a.size, a.name, a.durationMs, a.motion?.audio ?? []]) !== JSON.stringify([b.size, b.name, b.durationMs, b.motion?.audio ?? []]) || order(a) !== order(b);
  return t;
}

/** Whether two touches meet: the same field of the same stitch, or both the pattern as a whole. */
export function clashes(a: Touch, b: Touch): boolean {
  if (a.whole && b.whole) return true;
  for (const [id, fields] of a.stitches) {
    const other = b.stitches.get(id);
    if (!other) continue;
    if (fields.has("*") || other.has("*")) return true;
    for (const f of fields) if (other.has(f)) return true;
  }
  return false;
}
