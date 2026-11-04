// What a model is doing right now, so a person can watch it work and keep out of its way.
//
// Every tool call a model makes, through either MCP door or the studio's own model, is
// written here when it starts and when it ends (packages/mcp/src/context.mjs): what it is,
// in words, and where it works. The studio streams it (api/events) and shows it.
//
// It lives in the meta table beside the change counter, so it needs no migration, and it
// is written OUTSIDE store.write on purpose: a model reading a pattern is not a change to
// the library, and every open window refetches what it shows on a change. So it has a
// counter of its own. It is in the database rather than in memory because the stdio
// server is a process of its own.

import { tx } from "./db.ts";
import { newId } from "./ids.ts";
import type { Store } from "./store.ts";
import type { AgentCall, AgentState, AgentWhere } from "./types.ts";

const KEEP = 30;
// A call that never said it ended: its process stopped. A knit that waits can run long, so this is generous.
const STALE_MS = 15 * 60_000;

const read = (store: Store, key: string) => (store.db.prepare("select value from meta where key = ?").get(key) as { value: string } | undefined)?.value;
const put = (store: Store, key: string, value: string) => store.db.prepare("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
const bump = (store: Store) => put(store, "agent.rev", String(agentRev(store) + 1));

/** Bumped whenever a call starts or ends or the person pauses: what the change stream polls. */
export function agentRev(store: Store): number {
  return Number(read(store, "agent.rev") ?? 0);
}

export function agentState(store: Store): AgentState {
  let calls: AgentCall[] = [];
  try { calls = JSON.parse(read(store, "agent.calls") ?? "[]"); } catch { /* unreadable: start again */ }
  const now = Date.now();
  return {
    paused: read(store, "agent.paused") === "1",
    calls: calls.map((c) => (c.state === "running" && now - Date.parse(c.startedAt) > STALE_MS ? { ...c, state: "failed", note: "It stopped without saying how it went." } : c)),
  };
}

function update(store: Store, fn: (calls: AgentCall[]) => AgentCall[]) {
  tx(store.db, () => {
    put(store, "agent.calls", JSON.stringify(fn(agentState(store).calls).slice(-KEEP)));
    bump(store);
  });
}

/** A call starting. Returns its id, for agentEnd. */
export function agentBegin(store: Store, call: Pick<AgentCall, "client" | "tool" | "summary" | "edits" | "where">): string {
  const id = newId("ac");
  update(store, (calls) => [...calls, { ...call, id, state: "running", startedAt: new Date().toISOString() }]);
  return id;
}

/** How a call ended, and what it made (a stitch, a pattern, a job), so the studio can point at it. */
export function agentEnd(store: Store, id: string, end: { state: AgentCall["state"]; note?: string; where?: AgentWhere }) {
  update(store, (calls) => calls.map((c) => (c.id === id ? { ...c, state: end.state, ...(end.note ? { note: end.note.slice(0, 300) } : {}), where: { ...c.where, ...end.where }, endedAt: new Date().toISOString() } : c)));
}

/** The person's hand on the model: while it is paused, its edits are refused and it is told why. */
export function setAgentPaused(store: Store, paused: boolean): AgentState {
  tx(store.db, () => { put(store, "agent.paused", paused ? "1" : "0"); bump(store); });
  return agentState(store);
}
