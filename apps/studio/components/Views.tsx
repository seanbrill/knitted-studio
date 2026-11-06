"use client";

// How a section is laid out and in what order, the same everywhere: as a grid of pictures or a
// list, sorted by what the person picks. Each section remembers its own choice on this
// computer, so Yarn can stay a list while Patterns stay a grid.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Select, Tip, icons } from "@knitted/ui";

const { LayoutGrid, List } = icons;

export type ViewMode = "grid" | "list";

/** One way to sort: how to read the value from a thing, and which way round it starts. */
export interface SortBy<T> { value: string; label: string; key: (t: T) => string | number; desc?: boolean }

const KEY = (section: string) => `knitted.view.${section}`;
const collate = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The person's layout and order for one section, kept on this computer. */
export function useView<T>(section: string, sorts: SortBy<T>[], defaults: { mode?: ViewMode; sort?: string } = {}) {
  const [mode, setModeState] = useState<ViewMode>(defaults.mode ?? "grid");
  const [sort, setSortState] = useState(defaults.sort ?? sorts[0].value);
  useEffect(() => {
    // Read after mount: the server draws the default, so the first paint matches it.
    try {
      const v = JSON.parse(localStorage.getItem(KEY(section)) ?? "{}") as { mode?: ViewMode; sort?: string };
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v.mode === "grid" || v.mode === "list") setModeState(v.mode);
      if (v.sort && sorts.some((s) => s.value === v.sort)) setSortState(v.sort);
    } catch { /* nothing kept, or not readable: the defaults */ }
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = useCallback((next: { mode?: ViewMode; sort?: string }) => {
    try { localStorage.setItem(KEY(section), JSON.stringify({ ...JSON.parse(localStorage.getItem(KEY(section)) ?? "{}"), ...next })); } catch { /* private window: for now only */ }
  }, [section]);
  const setMode = useCallback((m: ViewMode) => { setModeState(m); keep({ mode: m }); }, [keep]);
  const setSort = useCallback((s: string) => { setSortState(s); keep({ sort: s }); }, [keep]);
  const by = sorts.find((s) => s.value === sort) ?? sorts[0];
  const sorted = useCallback((items: T[]) => [...items].sort((a, b) => {
    const x = by.key(a), y = by.key(b);
    const n = typeof x === "number" && typeof y === "number" ? x - y : collate.compare(String(x), String(y));
    return by.desc ? -n : n;
  }), [by]);
  return { mode, setMode, sort: by.value, setSort, sorts, sorted };
}

export type View<T> = ReturnType<typeof useView<T>>;

/** The layout toggle and the sort, for a section's toolbar. */
export function ViewBar<T>({ view, what }: { view: View<T>; what: string }) {
  const options = useMemo(() => view.sorts.map((s) => ({ value: s.value, label: s.label })), [view.sorts]);
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", marginLeft: "auto" }}>
      <div style={{ minWidth: 170 }}>
        <Select aria-label={`Sort ${what}`} value={view.sort} onValueChange={view.setSort} options={options} />
      </div>
      <div className="segmented" role="radiogroup" aria-label={`Show ${what} as`}>
        <Tip text="A grid of pictures"><button type="button" role="radio" aria-checked={view.mode === "grid"} aria-label="Grid" onClick={() => view.setMode("grid")}><LayoutGrid size={15} aria-hidden /></button></Tip>
        <Tip text="A list, with more about each"><button type="button" role="radio" aria-checked={view.mode === "list"} aria-label="List" onClick={() => view.setMode("list")}><List size={15} aria-hidden /></button></Tip>
      </div>
    </div>
  );
}

/** The ways most sections sort: newest, oldest, by name, and the last changed. */
export function commonSorts<T extends { name?: string; label?: string; createdAt: string; updatedAt?: string }>(): SortBy<T>[] {
  return [
    { value: "updated", label: "Last changed", key: (t) => t.updatedAt ?? t.createdAt, desc: true },
    { value: "newest", label: "Newest first", key: (t) => t.createdAt, desc: true },
    { value: "oldest", label: "Oldest first", key: (t) => t.createdAt },
    { value: "name", label: "Name, A to Z", key: (t) => t.name ?? t.label ?? "" },
    { value: "name-desc", label: "Name, Z to A", key: (t) => t.name ?? t.label ?? "", desc: true },
  ];
}

/** The grid's columns, or the list's one, as a style for the list element. */
export const layout = (mode: ViewMode, min = 180): React.CSSProperties => mode === "grid"
  ? { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-4)", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }
  : { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 };
