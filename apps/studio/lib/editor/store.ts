"use client";

// The editor's state, and the one function every change goes through.
//
// `dispatch` runs a Command through the SAME pure `applyCommand` the server
// uses, so the screen updates instantly and agrees with what will be saved. The
// command then goes to the server in order. Undo is not a separate mechanism:
// `applyCommand` already returns the inverse of whatever it did, and undo is
// just dispatching that.
//
// A model can edit the same pattern at the same time (MCP, Ask). When its change lands
// first, the person's unsaved changes are carried over onto it, and Undo lets go of any
// step that would put back what the model just changed: neither undoes the other by
// accident. Only a change to the very same thing, at the very same moment, is dropped,
// and the person is told (see `rebase`).

import { create } from "zustand";
import { stepZoom } from "../zoom";
import { api, ApiError } from "@knitted/core/client";
import { applyCommand, changedBetween, clashes, touches, type Actor, type Command, type Part, type Pattern, type Refusal, type Stitch, type Swatch, type Touch, type Yarn } from "@knitted/core";
import { agentNow, whoChanged } from "../agent";
import { stopFollowing } from "../follow";

export type EditMode = "pattern" | "fill";

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export type SaveStatus = "saved" | "saving" | "error";
interface HistoryEntry { label: string; undo: Command; redo: Command; }

export interface EditorState {
  pattern: Pattern;
  swatch: Swatch;
  yarn: Record<string, Yarn>;
  parts: Record<string, Part>;
  mode: EditMode;
  selection: string[];
  /** A gesture in flight (a drag): shown live, committed once on release. */
  draft: Record<string, Partial<Stitch>> | null;
  zoom: number | "fit";
  /** What "fit" is at the canvas's size now, so a step in or out starts from what is shown. */
  fitScale: number;
  /** The timeline clock, in ms. The canvas shows the Pattern AT this moment. */
  playhead: number;
  playing: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  status: SaveStatus;
  serverVersion: number;
  notice: { id: number; text: string; refusals?: Refusal[] } | null;

  init(p: { pattern: Pattern; swatch: Swatch; yarn: Yarn[]; parts?: Part[] }): void;
  setYarn(y: Yarn[]): void;
  setParts(p: Part[]): void;
  setSwatch(s: Swatch): void;
  setMode(m: EditMode): void;
  select(ids: string[], additive?: boolean): void;
  setDraft(d: Record<string, Partial<Stitch>> | null): void;
  setZoom(z: number | "fit"): void;
  setFitScale(s: number): void;
  /** One step in (1) or out (-1), from the zoom shown now. */
  zoomStep(dir: 1 | -1): void;
  /** The hand: while it is on, a drag anywhere on the canvas moves it, and selects nothing. */
  hand: boolean;
  setHand(on: boolean): void;
  /** Asked for by Zoom to selection: the canvas zooms to these stitches. Counted, so asking again works. */
  zoomAsk: { ids: string[]; n: number } | null;
  zoomToSelection(): void;
  setPlayhead(ms: number): void;
  setPlaying(p: boolean): void;
  dispatch(cmd: Command, opts?: { label?: string; coalesce?: boolean; history?: boolean }): Refusal[];
  undo(): void;
  redo(): void;
  /**
   * Take the pattern as the server has it now, and say what someone else changed. Null when
   * it did nothing: another pattern opened, or a change of the person's went out meanwhile,
   * whose save meets theirs and carries it over (`rebase`).
   */
  reload(): Promise<Touch | null>;
  say(text: string, refusals?: Refusal[]): void;
  /** Said to a screen reader when a model changes the pattern, without a toast for everyone else. */
  announcement: string;
  announce(text: string): void;
}

let noticeId = 0;
// The pattern as the server last confirmed it, and the person's changes it has not saved
// yet, in order. They are saved one at a time: two in flight at once could land swapped.
// `gen` moves on when another pattern opens, so an answer for the last one is ignored.
let base: Pattern | null = null;
let unsaved: { cmd: Command; actor: "human" | "fill"; label?: string; coalesce?: boolean }[] = [];
let saving = false;
let gen = 0;

export const useEditor = create<EditorState>((set, get) => ({
  pattern: undefined as unknown as Pattern,
  swatch: undefined as unknown as Swatch,
  yarn: {},
  parts: {},
  mode: "pattern",
  selection: [],
  draft: null,
  zoom: "fit",
  fitScale: 0.4,
  hand: false,
  zoomAsk: null,
  playhead: 0,
  playing: false,
  undoStack: [],
  redoStack: [],
  status: "saved",
  serverVersion: 0,
  notice: null,
  announcement: "",

  init: ({ pattern, swatch, yarn, parts = [] }) => {
    gen++; base = pattern; unsaved = []; saving = false;
    set({ pattern, swatch, yarn: Object.fromEntries(yarn.map((y) => [y.id, y])), parts: Object.fromEntries(parts.map((x) => [x.id, x])), serverVersion: pattern.version, selection: [], draft: null, undoStack: [], redoStack: [], status: "saved", mode: "pattern", zoom: "fit", playhead: 0, playing: false, notice: null, announcement: "" });
  },
  setYarn: (y) => set({ yarn: Object.fromEntries(y.map((x) => [x.id, x])) }),
  setParts: (p) => set({ parts: Object.fromEntries(p.map((x) => [x.id, x])) }),
  setSwatch: (swatch) => set({ swatch }),
  setMode: (mode) => set((s) => ({ mode, selection: mode === "fill" ? s.selection.filter((id) => !s.pattern.stitches.find((x) => x.id === id)?.locked) : s.selection })),
  // In Fill mode a locked stitch cannot be selected by ANY route (canvas, layers, keyboard):
  // it is not the user's to change, so it is not offered.
  select: (ids, additive) => set((s) => {
    const ok = s.mode === "fill" ? ids.filter((id) => !s.pattern.stitches.find((x) => x.id === id)?.locked) : ids;
    return { selection: additive ? [...new Set([...s.selection, ...ok])] : ok };
  }),
  setDraft: (draft) => set({ draft }),
  setZoom: (zoom) => set({ zoom: zoom === "fit" ? "fit" : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) }),
  setFitScale: (fitScale) => { if (Math.abs(fitScale - get().fitScale) > 1e-4) set({ fitScale }); },
  zoomStep: (dir) => set((s) => ({ zoom: stepZoom(s.zoom === "fit" ? s.fitScale : s.zoom, dir, ZOOM_MIN, ZOOM_MAX) })),
  setHand: (hand) => set({ hand }),
  zoomToSelection: () => set((s) => (s.selection.length ? { zoomAsk: { ids: s.selection, n: (s.zoomAsk?.n ?? 0) + 1 } } : {})),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setPlaying: (playing) => set({ playing }),
  say: (text, refusals) => set({ notice: { id: ++noticeId, text, refusals } }),
  announce: (announcement) => set({ announcement }),

  dispatch: (cmd, opts = {}) => {
    const s = get();
    const actor: Actor = s.mode === "fill" ? "fill" : "human";
    const r = applyCommand(s.pattern, cmd, actor);
    if (r.refusals.length) get().say(r.refusals[0].why.includes("locked") ? "Locked by the pattern. Switch to Pattern mode to change it." : r.refusals[0].why, r.refusals);
    if (!r.changed || !r.inverse) return r.refusals;
    // A change of their own: Follow stops pulling them somewhere else.
    stopFollowing();

    const entry: HistoryEntry = { label: opts.label ?? cmd.type, undo: r.inverse, redo: cmd };
    set((st) => ({
      pattern: r.pattern,
      status: "saving",
      ...(opts.history === false ? {} : { undoStack: [...st.undoStack.slice(-199), entry], redoStack: [] }),
      // Anything selected that no longer exists is dropped.
      selection: st.selection.filter((id) => r.pattern.stitches.some((x) => x.id === id)),
    }));
    unsaved.push({ cmd, actor, label: opts.label, coalesce: opts.coalesce });
    void save();
    return r.refusals;
  },

  undo: () => {
    const { undoStack } = get();
    const e = undoStack[undoStack.length - 1];
    if (!e) return;
    set({ undoStack: undoStack.slice(0, -1) });
    get().dispatch(e.undo, { label: `Undo ${e.label}`, history: false });
    set((s) => ({ redoStack: [...s.redoStack, e] }));
  },
  redo: () => {
    const { redoStack } = get();
    const e = redoStack[redoStack.length - 1];
    if (!e) return;
    set({ redoStack: redoStack.slice(0, -1) });
    get().dispatch(e.redo, { label: `Redo ${e.label}`, history: false });
    set((s) => ({ undoStack: [...s.undoStack, e] }));
  },

  reload: async () => {
    const g = gen;
    const fresh = await api.patterns.get(get().pattern.id);
    if (g !== gen || saving || unsaved.length) return null;
    const theirs = base ? changedBetween(base, fresh) : null;
    base = fresh; unsaved = [];
    set((s) => ({ pattern: fresh, serverVersion: fresh.version, status: "saved", draft: null, ...(theirs ? keepHistory(s, theirs, fresh) : {}) }));
    return theirs;
  },
}));

/** Send the person's changes, in order, until none are left. */
async function save() {
  if (saving) return;
  saving = true;
  const g = gen;
  let tries = 0;
  try {
    while (unsaved.length) {
      const u = unsaved[0];
      try {
        const res = await api.patterns.apply(useEditor.getState().pattern.id, u.cmd, { actor: u.actor, expectVersion: base!.version, label: u.label, coalesce: u.coalesce });
        if (g !== gen) return;
        unsaved.shift();
        base = res.pattern;
        tries = 0;
        useEditor.setState({ serverVersion: res.pattern.version });
      } catch (e) {
        if (g !== gen) return;
        // Someone else's change landed first: carry this one over onto it, and send it again.
        // A pattern that changes under it ten times running is given up on, and said.
        const problem = e instanceof ApiError && e.kind === "conflict" && ++tries <= 10 ? await rebase().then(() => null, (x: unknown) => x) : e;
        if (g !== gen) return;
        if (!problem) continue;
        unsaved = [];
        useEditor.setState({ status: "error" });
        useEditor.getState().say((problem as Error).message || "That change could not be saved.");
        return;
      }
    }
    // The server is the authority. If it disagrees with what we showed, take its version.
    const mine = JSON.stringify(useEditor.getState().pattern.stitches), theirs = JSON.stringify(base!.stitches);
    useEditor.setState({ status: "saved", ...(mine !== theirs ? { pattern: base! } : {}) });
  } finally {
    if (g === gen) saving = false;
  }
}

/**
 * Someone else's change landed first: a model, or another window. Take the pattern as it
 * is now and carry the person's unsaved changes over onto it, each one unless it would
 * undo what the other just did. Those few are dropped, and the person is told which.
 */
async function rebase() {
  const g = gen;
  const id = useEditor.getState().pattern.id;
  const fresh = await api.patterns.get(id);
  if (g !== gen) return;
  const theirs = changedBetween(base!, fresh);
  let p = fresh;
  const kept: typeof unsaved = [], lost: typeof unsaved = [];
  for (const u of unsaved) {
    // One that changes nothing now (the other made the same change) is simply done.
    const r = applyCommand(p, u.cmd, u.actor);
    if (clashes(touches(p, u.cmd), theirs)) lost.push(u);
    else if (r.changed) { kept.push(u); p = r.pattern; }
  }
  base = fresh; unsaved = kept;
  const st = useEditor.getState();
  useEditor.setState({ pattern: p, serverVersion: fresh.version, selection: st.selection.filter((x) => p.stitches.some((s) => s.id === x)), ...keepHistory(st, theirs, fresh) });
  const who = whoChanged(agentNow(), id, Date.now()) ?? "Someone else";
  if (lost.length) {
    const names = namesOf(lost.reduce((t, u) => touches(fresh, u.cmd, t), { stitches: new Map(), whole: false } as Touch), fresh);
    st.say(`${who} changed ${names} just as you did, so your change to it was not kept. The rest of your changes were.`);
  } else st.announce(`${who} changed ${namesOf(theirs, fresh)}. Your changes were kept.`);
}

/** Undo and Redo steps that would put back what someone else just changed are let go; the rest stay. */
function keepHistory(s: Pick<EditorState, "undoStack" | "redoStack">, theirs: Touch, p: Pattern) {
  const keep = (e: HistoryEntry) => !clashes(touches(p, e.undo, touches(p, e.redo)), theirs);
  return { undoStack: s.undoStack.filter(keep), redoStack: s.redoStack.filter(keep) };
}

/** What a touch is, in words: "headline and photo", or "the pattern" for its size, name or timing. */
export function namesOf(t: Touch, p: Pattern): string {
  const names = [...t.stitches.keys()].map((id) => { const s = p.stitches.find((x) => x.id === id); return s ? s.slot ?? `a ${s.kind}` : "a stitch"; });
  const all = [...new Set(names), ...(t.whole ? ["the pattern"] : [])];
  if (!all.length) return "the pattern";
  const shown = all.length > 3 ? [...all.slice(0, 2), `${all.length - 2} more`] : all;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** Stitches with any in-flight gesture applied, for drawing. */
export function liveStitches(s: Pick<EditorState, "pattern" | "draft">): Stitch[] {
  const d = s.draft;
  return d ? s.pattern.stitches.map((x) => (d[x.id] ? ({ ...x, ...d[x.id] } as Stitch) : x)) : s.pattern.stitches;
}

export const isPending = () => saving || unsaved.length > 0;
