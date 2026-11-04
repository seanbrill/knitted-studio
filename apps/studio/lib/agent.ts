"use client";

// What models are doing, for the studio to show: one copy of the state for the whole
// page, kept up through the change stream, and the questions every view asks of it.
// The calls themselves are written by packages/mcp/src/context.mjs.

import { useEffect, useState } from "react";
import { create } from "zustand";
import { api, subscribeAgent } from "@knitted/core/client";
import type { AgentCall, AgentState, FolderSection } from "@knitted/core";

/** How long a finished call is still "just now" on the canvas: long enough to see, short enough to be true. */
export const RECENT_MS = 6000;
/** How long the presence stays after the last call, so a model thinking between calls does not flicker away. */
export const LINGER_MS = 120_000;

const useAgentStore = create<{ state: AgentState | null }>(() => ({ state: null }));
let users = 0;
let off: (() => void) | null = null;

/** What models have been doing lately, kept current. Every view shares one copy and one stream. */
export function useAgent(): AgentState | null {
  const state = useAgentStore((x) => x.state);
  useEffect(() => {
    if (users++ === 0) {
      api.agent.activity().then((s) => useAgentStore.setState({ state: s })).catch(() => {});
      off = subscribeAgent((s) => useAgentStore.setState({ state: s }));
    }
    return () => { if (--users === 0) { off?.(); off = null; } };
  }, []);
  return state;
}

/** The state as it is, for code outside React: the editor naming who changed a pattern. */
export const agentNow = () => useAgentStore.getState().state;

/** Pause or resume models, and show the answer at once. */
export async function setPaused(paused: boolean) {
  useAgentStore.setState({ state: await api.agent.pause(paused) });
}

/**
 * A clock for "just now" and "12s ago", ticking only while `ticks(now)` says there is
 * something to time. A new call starts it: it ended after the last tick, so it is recent.
 */
export function useNow(ticks: (now: number) => boolean, every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  const ticking = ticks(now);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [ticking, every]);
  return now;
}

export const endedAt = (c: AgentCall) => Date.parse(c.endedAt ?? c.startedAt);
const newest = (s: AgentState | null) => s?.calls[s.calls.length - 1];

/** The call to show: the newest one still running, else the newest. */
export function current(s: AgentState | null): AgentCall | undefined {
  const running = s?.calls.filter((c) => c.state === "running") ?? [];
  return running[running.length - 1] ?? newest(s);
}

/** Whether a model is at work: a call running, or one that ended a moment ago. */
export function isActive(s: AgentState | null, now: number): boolean {
  const c = newest(s);
  return !!c && (s!.calls.some((x) => x.state === "running") || now - endedAt(c) < LINGER_MS);
}

// Each section's page, for a call that sorts its folders.
const SECTION_PATH: Record<FolderSection, string> = { patterns: "", yarn: "/yarn", parts: "/parts", swatches: "/swatch", knits: "/knits" };

/** The page where a call works: what Follow goes to. */
export function pathFor(c: AgentCall): string | null {
  const w = c.where;
  if (!w.projectId) return null;
  const pj = `/projects/${w.projectId}`;
  if (c.tool === "knit_pattern") return `${pj}/knits`;
  if (w.section) return pj + SECTION_PATH[w.section];
  if (w.patternId) return `${pj}/patterns/${w.patternId}`;
  if (w.yarnId || c.tool === "import_yarn") return `${pj}/yarn`;
  if (w.swatchId || c.tool === "propose_swatch") return `${pj}/swatch`;
  if (w.partId) return `${pj}/parts`;
  return pj;
}

/** The stitches of one pattern a model is changing now, or changed a moment ago, and who it is. */
export function marksOn(s: AgentState | null, patternId: string, now: number): { ids: string[]; who: string; running: boolean } | null {
  const calls = (s?.calls ?? []).filter((c) => c.edits && c.where.patternId === patternId && (c.state === "running" || (c.state === "done" && now - endedAt(c) < RECENT_MS)));
  const ids = [...new Set(calls.flatMap((c) => c.where.stitchIds ?? []))];
  if (!ids.length) return null;
  return { ids, who: calls[calls.length - 1].client, running: calls.some((c) => c.state === "running") };
}

/** The model that changed a pattern a moment ago, if one did: who to name when it reloads. A refused call changed nothing. */
export function whoChanged(s: AgentState | null, patternId: string, now: number): string | null {
  const c = [...(s?.calls ?? [])].reverse().find((x) => x.edits && (x.state === "running" || x.state === "done") && x.where.patternId === patternId && now - endedAt(x) < RECENT_MS * 2);
  return c?.client ?? null;
}

/** "just now", "12s ago", "3 min ago". */
export function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
