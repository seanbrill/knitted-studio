"use client";

// Which model the person talks to: Auto, or one model for everything. One choice, the same in
// Settings and beside every message box, so picking it anywhere changes it everywhere. A run
// that is going takes a new pick at its next step.

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@knitted/core/client";

export interface Choice { id: string; label: string }
interface State { choice: string | null; choices: Choice[] }

let state: State = { choice: null, choices: [] };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (s: State) => { state = s; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const SERVER: State = { choice: null, choices: [] };

function load() {
  loading ??= api.agent.config().then((c) => set({ choice: c.model, choices: c.models })).catch(() => { loading = null; });
  return loading;
}

/** Settings, Model saved something: what the boxes show follows it. */
export function choiceSaved(choice: string, choices?: Choice[]) {
  set({ choice, choices: choices ?? state.choices });
}

/** The choice, what can be chosen, and a way to choose. */
export function useModelChoice() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  useEffect(() => { void load(); }, []);
  const choose = async (id: string) => {
    const before = state.choice;
    set({ ...state, choice: id });
    try { const c = await api.agent.save({ model: id }); set({ choice: c.model, choices: c.models }); }
    catch (e) { set({ ...state, choice: before }); throw e; }
  };
  return { choice: s.choice, choices: s.choices, choose };
}

/** The choice as it is now, for a message sent later than it was written (one that waited its turn). */
export const currentChoice = () => state.choice ?? undefined;

/** A model's name from its id, as a chat shows it: "Haiku 5.5". */
export const modelName = (id: string) => id.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-(\d+)$/, " $1").replace(/^\w/, (ch) => ch.toUpperCase());

/** A model's name, short enough to sit beside a message box: "Auto", "Sonnet 5.5". */
export const shortName = (id: string, choices: Choice[]) => {
  if (id === "auto") return "Auto";
  const label = choices.find((c) => c.id === id)?.label ?? id;
  return label.replace(/^Claude\s+/, "").replace(/\s*\(.*\)\s*$/, "");
};
