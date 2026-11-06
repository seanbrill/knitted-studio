"use client";

// What a model is doing on the pattern open in the editor, for the canvas to show: where it
// works, what it is doing there, and what the studio's own model is writing as it writes it.
// All of it comes from the models' state the studio streams (lib/agent.ts).

import type { AgentCall, AgentLive, AgentState } from "@knitted/core";
import { RECENT_MS, endedAt } from "../agent";

/** How long the bubble keeps a run's last words after it ends. The server keeps them a little longer. */
export const ENDED_MS = 5000;

/** A place on the canvas, in its pixels as they are drawn now. */
export type Rect = { x: number; y: number; w: number; h: number };
export const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The newest run of the studio's own model writing about this pattern: on it, or on a copy made from it. */
export function liveOn(s: AgentState | null, patternId: string): AgentLive | null {
  const here = (s?.live ?? []).filter((l) => l.where.patternId === patternId || l.from === patternId);
  return here.sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
}

/** The step a run is taking now: its newest call still running, on the pattern it works on. */
export function stepOf(s: AgentState | null, l: AgentLive): AgentCall | null {
  const calls = (s?.calls ?? []).filter((c) => c.client === l.client && c.state === "running" && (!l.where.patternId || c.where.patternId === l.where.patternId));
  return calls.at(-1) ?? null;
}

/** The stitches the newest change to this pattern touches: where a model's attention is now. */
export function focusOn(s: AgentState | null, patternId: string, now: number): string[] {
  const c = [...(s?.calls ?? [])].reverse().find((x) => x.edits && x.where.patternId === patternId && (x.state === "running" || (x.state === "done" && now - endedAt(x) < RECENT_MS)));
  return c?.where.stitchIds ?? [];
}

/**
 * A model at work on this pattern: who, what it is doing, and whether it is changing it or
 * only looking. A call running here, a run of the studio's own model thinking about it, or a
 * call that ended here a moment ago.
 */
export function workOn(s: AgentState | null, patternId: string, now: number): { who: string; what: string; edits: boolean; running: boolean } | null {
  const calls = (s?.calls ?? []).filter((c) => c.where.patternId === patternId && (c.state === "running" || now - endedAt(c) < RECENT_MS));
  const c = calls.filter((x) => x.state === "running").at(-1) ?? calls.at(-1);
  const on = liveOn(s, patternId);
  const l = on && !on.ended ? on : null;
  if (c && (c.state === "running" || !l)) return { who: c.client, what: c.summary, edits: c.edits, running: c.state === "running" };
  if (l) return { who: l.client, what: l.from === patternId && l.where.patternId !== patternId ? "Working on a copy of this pattern" : "Working on this pattern", edits: false, running: true };
  return null;
}
