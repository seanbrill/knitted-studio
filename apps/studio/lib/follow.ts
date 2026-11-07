"use client";

// Follow: go where the model works, and keep going as it moves, to watch it design.
// It lasts until the person goes somewhere else themselves or makes a change of their
// own (lib/editor/store.ts), so it never pulls anyone away from their own work.

import { create } from "zustand";

interface Follow {
  on: boolean;
  /** Where Follow last went. Anywhere else means the person went there. */
  target: string | null;
  /** The page Follow is taking them away from, while that page still shows. */
  from: string | null;
  /** The one run followed, when more than one is at work: its job. Absent, the newest edit is followed. */
  run: string | null;
  /** When Follow last set off for a page: a move that never lands is tried again, not waited on. */
  at: number;
  start(to: string, from: string, run?: string): void;
  went(to: string, from: string): void;
  arrived(): void;
  stop(): void;
}

export const useFollow = create<Follow>((set) => ({
  on: false,
  target: null,
  from: null,
  run: null,
  at: 0,
  start: (to, from, run) => set({ on: true, target: to, from: to === from ? null : from, run: run ?? null, at: Date.now() }),
  went: (to, from) => set({ target: to, from, at: Date.now() }),
  arrived: () => set({ from: null }),
  stop: () => set({ on: false, target: null, from: null, run: null }),
}));

export const stopFollowing = () => { if (useFollow.getState().on) useFollow.getState().stop(); };
