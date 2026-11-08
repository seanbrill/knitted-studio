// What the person's own API key has spent: one row per answer from the model, with its tokens
// and what they cost, and the limits that stop a run before the bill gets out of hand.
//
// The cost is worked out when the answer comes in, at the prices of the day, and kept: a
// later change of prices does not rewrite what was spent.

import { newId } from "./ids.ts";
import type { Store } from "./store.ts";

export type UsageKind = "chat" | "post" | "profile" | "generate" | "other";
export interface UsageEntry {
  id: string; at: string; kind: UsageKind; model: string; projectId: string | null; chatId: string | null;
  input: number; output: number; cacheWrite: number; cacheRead: number;
  /** Dollars. */
  cost: number;
}
/** Dollars. `monthly`: no more this calendar month. `perRun`: no more on one answer to one message. Null: no limit. */
export interface SpendLimits { monthly: number | null; perRun: number | null; warnAt: number }
export const DEFAULT_LIMITS: SpendLimits = { monthly: null, perRun: 2, warnAt: 0.8 };

export function spendLimits(store: Store): SpendLimits {
  return { ...DEFAULT_LIMITS, ...store.getSetting<Partial<SpendLimits>>("spend", {}) };
}
export function setSpendLimits(store: Store, change: Partial<SpendLimits>): SpendLimits {
  const next = { ...spendLimits(store), ...change };
  store.setSetting("spend", next);
  return next;
}

export function recordUsage(store: Store, u: Omit<UsageEntry, "id" | "at"> & { at?: string }): UsageEntry {
  const row: UsageEntry = { id: newId("us"), at: u.at ?? new Date().toISOString(), ...u };
  store.write(() => store.db.prepare("insert into usage (id, at, kind, model, project_id, chat_id, input, output, cache_write, cache_read, cost) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.at, row.kind, row.model, row.projectId, row.chatId, row.input, row.output, row.cacheWrite, row.cacheRead, row.cost));
  return row;
}

/** Midnight on the first of this month, where the person is. */
export function monthStart(now = new Date()): Date { return new Date(now.getFullYear(), now.getMonth(), 1); }

export function spentSince(store: Store, since: Date): number {
  return Number((store.db.prepare("select coalesce(sum(cost), 0) as n from usage where at >= ?").get(since.toISOString()) as { n: number }).n);
}

export interface UsageSummary {
  month: number; today: number; limits: SpendLimits;
  /** This month, by model. */
  models: { model: string; cost: number; input: number; output: number; answers: number }[];
  /** The last 30 days, a day each, oldest first. Days with nothing spent are there, at 0. */
  days: { day: string; cost: number }[];
  /** This month, by what it was spent on. */
  kinds: { kind: UsageKind; cost: number }[];
}

const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function usageSummary(store: Store, now = new Date()): UsageSummary {
  const month = monthStart(now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(today); from.setDate(from.getDate() - 29);
  const models = (store.db.prepare("select model, sum(cost) as cost, sum(input + cache_write + cache_read) as input, sum(output) as output, count(*) as answers from usage where at >= ? group by model order by cost desc").all(month.toISOString()) as { model: string; cost: number; input: number; output: number; answers: number }[])
    .map((r) => ({ model: r.model, cost: Number(r.cost), input: Number(r.input), output: Number(r.output), answers: Number(r.answers) }));
  const kinds = (store.db.prepare("select kind, sum(cost) as cost from usage where at >= ? group by kind order by cost desc").all(month.toISOString()) as { kind: UsageKind; cost: number }[]).map((r) => ({ kind: r.kind, cost: Number(r.cost) }));
  // Grouped here, not in SQL: a day is the person's own day, and the rows are kept in UTC.
  const byDay = new Map<string, number>();
  for (const r of store.db.prepare("select at, cost from usage where at >= ?").all(from.toISOString()) as { at: string; cost: number }[]) {
    const d = dayOf(new Date(r.at));
    byDay.set(d, (byDay.get(d) ?? 0) + Number(r.cost));
  }
  const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(from); d.setDate(from.getDate() + i); const k = dayOf(d); return { day: k, cost: byDay.get(k) ?? 0 }; });
  return { month: spentSince(store, month), today: spentSince(store, today), limits: spendLimits(store), models, days, kinds };
}

/**
 * Whether another answer may be asked for, and if not, why, in words for the person.
 * `run`: what this run has spent so far.
 */
export function spendCheck(store: Store, run = 0, now = new Date()): { ok: true } | { ok: false; why: string } {
  const l = spendLimits(store);
  if (l.perRun != null && run >= l.perRun) return { ok: false, why: `This answer reached its limit of $${l.perRun.toFixed(2)}, so your model stopped here. Raise the limit for one answer in Settings, Spending, or ask for less at a time.` };
  if (l.monthly != null) {
    const spent = spentSince(store, monthStart(now));
    if (spent >= l.monthly) return { ok: false, why: `Your key has spent $${spent.toFixed(2)} this month, and your limit is $${l.monthly.toFixed(2)}. Your model waits until next month, or until you raise the limit in Settings, Spending.` };
  }
  return { ok: true };
}
