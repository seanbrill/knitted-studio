"use client";

// The editor's state, and the one function every change goes through.
//
// `dispatch` runs a Command through the SAME pure `applyCommand` the server
// uses, so the screen updates instantly and agrees with what will be saved. The
// command then goes to the server in order. Undo is not a separate mechanism:
// `applyCommand` already returns the inverse of whatever it did, and undo is
// just dispatching that.

import { create } from "zustand";
import { api, ApiError } from "@knitted/core/client";
import { applyCommand, type Actor, type Command, type Part, type Pattern, type Refusal, type Stitch, type Swatch, type Yarn } from "@knitted/core";

export type EditMode = "pattern" | "fill";
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
  setPlayhead(ms: number): void;
  setPlaying(p: boolean): void;
  dispatch(cmd: Command, opts?: { label?: string; coalesce?: boolean; history?: boolean }): Refusal[];
  undo(): void;
  redo(): void;
  reload(): Promise<void>;
  say(text: string, refusals?: Refusal[]): void;
}

let noticeId = 0;
let queue: Promise<void> = Promise.resolve();
let pending = 0;

export const useEditor = create<EditorState>((set, get) => ({
  pattern: undefined as unknown as Pattern,
  swatch: undefined as unknown as Swatch,
  yarn: {},
  parts: {},
  mode: "pattern",
  selection: [],
  draft: null,
  zoom: "fit",
  playhead: 0,
  playing: false,
  undoStack: [],
  redoStack: [],
  status: "saved",
  serverVersion: 0,
  notice: null,

  init: ({ pattern, swatch, yarn, parts = [] }) => {
    pending = 0; queue = Promise.resolve();
    set({ pattern, swatch, yarn: Object.fromEntries(yarn.map((y) => [y.id, y])), parts: Object.fromEntries(parts.map((x) => [x.id, x])), serverVersion: pattern.version, selection: [], draft: null, undoStack: [], redoStack: [], status: "saved", mode: "pattern", zoom: "fit", playhead: 0, playing: false, notice: null });
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
  setZoom: (zoom) => set({ zoom }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setPlaying: (playing) => set({ playing }),
  say: (text, refusals) => set({ notice: { id: ++noticeId, text, refusals } }),

  dispatch: (cmd, opts = {}) => {
    const s = get();
    const actor: Actor = s.mode === "fill" ? "fill" : "human";
    const r = applyCommand(s.pattern, cmd, actor);
    if (r.refusals.length) get().say(r.refusals[0].why.includes("locked") ? "Locked by the pattern. Switch to Pattern mode to change it." : r.refusals[0].why, r.refusals);
    if (!r.changed || !r.inverse) return r.refusals;

    const entry: HistoryEntry = { label: opts.label ?? cmd.type, undo: r.inverse, redo: cmd };
    set((st) => ({
      pattern: r.pattern,
      status: "saving",
      ...(opts.history === false ? {} : { undoStack: [...st.undoStack.slice(-199), entry], redoStack: [] }),
      // Anything selected that no longer exists is dropped.
      selection: st.selection.filter((id) => r.pattern.stitches.some((x) => x.id === id)),
    }));

    // Saved in order, one at a time: two in flight at once could land swapped.
    pending++;
    queue = queue.then(async () => {
      try {
        const res = await api.patterns.apply(get().pattern.id, cmd, { actor, expectVersion: get().serverVersion, label: opts.label, coalesce: opts.coalesce });
        set({ serverVersion: res.pattern.version });
        pending--;
        if (pending === 0) {
          // The server is the authority. If it disagrees with what we showed, take its version.
          const mine = JSON.stringify(get().pattern.stitches), theirs = JSON.stringify(res.pattern.stitches);
          set({ status: "saved", ...(mine !== theirs ? { pattern: res.pattern } : {}) });
        }
      } catch (e) {
        pending = 0;
        if (e instanceof ApiError && e.kind === "conflict") {
          get().say("This pattern changed somewhere else, so it was reloaded. Your last change was not applied.");
          await get().reload();
        } else {
          set({ status: "error" });
          get().say((e as Error).message || "That change could not be saved.");
        }
      }
    });
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
    const fresh = await api.patterns.get(get().pattern.id);
    pending = 0;
    set({ pattern: fresh, serverVersion: fresh.version, status: "saved", draft: null });
  },
}));

/** Stitches with any in-flight gesture applied, for drawing. */
export function liveStitches(s: Pick<EditorState, "pattern" | "draft">): Stitch[] {
  const d = s.draft;
  return d ? s.pattern.stitches.map((x) => (d[x.id] ? ({ ...x, ...d[x.id] } as Stitch) : x)) : s.pattern.stitches;
}

export const isPending = () => pending > 0;
